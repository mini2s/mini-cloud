package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// newAssignmentFixture seeds a single role-driven workflow run parked in
// waiting_role_assignment, with one pending resolution row per slot spec. The
// fixture is isolated by a unique slug and reuses the same shape as the worker
// integration fixture so the two suites share mental model.
func newAssignmentFixture(t *testing.T, slotSpecs []roleSlotSpec) *roleResolutionFixture {
	t.Helper()
	f := newRoleResolutionFixture(t, slotSpecs)

	// Move the run into waiting_role_assignment so AssignWorkflowRoles can act
	// on it. The worker fixture intentionally leaves the run resolving_roles so
	// both tests can share seed code.
	if _, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_run
		SET status = 'waiting_role_assignment'
		WHERE id = $1
	`, f.runID); err != nil {
		t.Fatalf("park run in waiting_role_assignment: %v", err)
	}
	return f
}

// newWorkflowService builds a WorkflowService wired to the fixture pool with
// dispatch helpers intentionally left nil. AssignWorkflowRoles only invokes
// DispatchRootNodeRuns when the run is promoted, which we suppress by leaving
// the run parked in waiting_role_assignment after assignment.
func newWorkflowService(f *roleResolutionFixture) *WorkflowService {
	return &WorkflowService{
		Queries:   f.queries,
		TxStarter: pgxTxStarter{pool: f.pool},
	}
}

// TestWorkflowRoleAssignmentIntegration_BatchResolvePromotesRun covers E2E-08:
// the starter submits a single batch covering every pending slot, the
// transaction stamps each resolution + node-run snapshot with the chosen user,
// emits manual_assignment events, and promotes the run from
// waiting_role_assignment to running.
func TestWorkflowRoleAssignmentIntegration_BatchResolvePromotesRun(t *testing.T) {
	f := newAssignmentFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
		{slotType: "critic", roleName: "qa"},
	})
	defer f.cleanup()

	resolutions := f.loadResolutions(t)
	if len(resolutions) != 2 {
		t.Fatalf("expected 2 resolutions, got %d", len(resolutions))
	}

	assignments := make([]WorkflowRoleManualAssignment, 0, len(resolutions))
	for _, row := range resolutions {
		assignments = append(assignments, WorkflowRoleManualAssignment{
			ResolutionID: row.ID,
			UserID:       f.userIDs[0],
			Version:      row.Version,
		})
	}

	svc := newWorkflowService(f)
	updated, err := svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[0], assignments)
	if err != nil {
		t.Fatalf("AssignWorkflowRoles: %v", err)
	}
	if len(updated) != 2 {
		t.Fatalf("expected 2 updated resolutions, got %d", len(updated))
	}
	for _, row := range updated {
		if row.Status != "resolved" {
			t.Fatalf("resolution %s status = %s, want resolved", row.ID, row.Status)
		}
		if row.Source.String != "manual" {
			t.Fatalf("resolution %s source = %s, want manual", row.ID, row.Source.String)
		}
		if !row.ResolvedUserID.Valid {
			t.Fatalf("resolution %s has no resolved_user_id", row.ID)
		}
		if row.ResolvedUserID.Bytes != f.userIDs[0].Bytes {
			t.Fatalf("resolution %s resolved_user_id = %v, want %v", row.ID, row.ResolvedUserID.Bytes, f.userIDs[0].Bytes)
		}
	}

	if status := f.loadRunStatus(t); status != RunStatusRunning {
		t.Fatalf("run status = %s, want running", status)
	}

	for _, nodeRunID := range f.nodeRunIDs {
		nr := f.loadNodeRun(t, nodeRunID)
		if !nr.WorkerID.Valid && !nr.CriticID.Valid {
			t.Fatalf("node run %s has no worker/critic id", nr.ID)
		}
		if nr.WorkerID.Valid && nr.WorkerNameSnapshot == "" {
			t.Fatalf("node run %s has resolved worker without name snapshot", nr.ID)
		}
		if nr.CriticID.Valid && nr.CriticNameSnapshot == "" {
			t.Fatalf("node run %s has resolved critic without name snapshot", nr.ID)
		}
	}
	var dispatchJobs int
	if err := f.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_run_id = $1 AND phase = 'worker' AND generation = 1
	`, f.runID).Scan(&dispatchJobs); err != nil {
		t.Fatal(err)
	}
	if dispatchJobs != len(f.nodeRunIDs) {
		t.Fatalf("root dispatch jobs=%d, want %d", dispatchJobs, len(f.nodeRunIDs))
	}

	events := f.countEvents(t, "manual_assignment")
	if events != 2 {
		t.Fatalf("expected 2 manual_assignment events, got %d", events)
	}
}

// TestWorkflowRoleAssignmentIntegration_TemplateEditKeepsRunSnapshotFrozen
// protects the run-snapshot contract: once a role has been resolved for a
// started run, later workflow-template edits must only affect future runs.
func TestWorkflowRoleAssignmentIntegration_TemplateEditKeepsRunSnapshotFrozen(t *testing.T) {
	f := newAssignmentFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolution := f.loadResolutions(t)[0]
	svc := newWorkflowService(f)
	if _, err := svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[0], []WorkflowRoleManualAssignment{
		{ResolutionID: resolution.ID, UserID: f.userIDs[0], Version: resolution.Version},
	}); err != nil {
		t.Fatalf("AssignWorkflowRoles: %v", err)
	}

	before := f.loadNodeRun(t, f.nodeRunIDs[0])
	if !before.WorkerID.Valid || before.WorkerID.Bytes != f.userIDs[0].Bytes {
		t.Fatalf("worker snapshot = %v, want initially resolved user %v", before.WorkerID, f.userIDs[0])
	}

	if _, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_node
		SET worker_role_id = NULL, worker_type = 'human', worker_id = $2, updated_at = now()
		WHERE id = (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $1)
	`, f.nodeRunIDs[0], f.userIDs[1]); err != nil {
		t.Fatalf("edit workflow template after run start: %v", err)
	}

	after := f.loadNodeRun(t, f.nodeRunIDs[0])
	if !after.WorkerID.Valid || after.WorkerID.Bytes != f.userIDs[0].Bytes {
		t.Fatalf("started run snapshot changed after template edit: got %v, want %v", after.WorkerID, f.userIDs[0])
	}
}

func (f *roleResolutionFixture) countEvents(t *testing.T, eventType string) int {
	t.Helper()
	var n int
	err := f.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM multica_workflow_role_resolution_event
		WHERE workflow_run_id = $1 AND event_type = $2
	`, f.runID, eventType).Scan(&n)
	if err != nil {
		t.Fatalf("count events %s: %v", eventType, err)
	}
	return n
}

func (f *roleResolutionFixture) countAllEvents(t *testing.T) int {
	t.Helper()
	var n int
	err := f.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM multica_workflow_role_resolution_event
		WHERE workflow_run_id = $1
	`, f.runID).Scan(&n)
	if err != nil {
		t.Fatalf("count all events: %v", err)
	}
	return n
}

// TestWorkflowRoleAssignmentIntegration_OptimisticLockConflict covers E2E-09:
// the first actor commits a valid batch; a second actor using the stale slot
// version gets ErrWorkflowRoleAssignmentConflict, the second batch leaves no
// side effects, and the first actor's resolution survives.
func TestWorkflowRoleAssignmentIntegration_OptimisticLockConflict(t *testing.T) {
	f := newAssignmentFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolutions := f.loadResolutions(t)
	if len(resolutions) != 1 {
		t.Fatalf("expected 1 resolution, got %d", len(resolutions))
	}
	current := resolutions[0]

	// Stale snapshot captured before the first commit lands.
	staleVersion := current.Version

	svc := newWorkflowService(f)
	first, err := svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[0], []WorkflowRoleManualAssignment{
		{ResolutionID: current.ID, UserID: f.userIDs[0], Version: staleVersion},
	})
	if err != nil {
		t.Fatalf("first AssignWorkflowRoles: %v", err)
	}
	if first[0].ResolvedUserID.Bytes != f.userIDs[0].Bytes {
		t.Fatalf("first assignment did not resolve to user 0")
	}

	// Second commit reuses the pre-commit version and must fail atomically.
	_, err = svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[1], []WorkflowRoleManualAssignment{
		{ResolutionID: current.ID, UserID: f.userIDs[1], Version: staleVersion},
	})
	if !errors.Is(err, ErrWorkflowRoleAssignmentConflict) {
		t.Fatalf("expected ErrWorkflowRoleAssignmentConflict, got %v", err)
	}

	// The conflict must not have overwritten the first actor's selection or
	// created a second audit event.
	after := f.loadResolutions(t)
	if after[0].ResolvedUserID.Bytes != f.userIDs[0].Bytes {
		t.Fatalf("conflicting batch overwrote first assignment: got %v, want %v", after[0].ResolvedUserID.Bytes, f.userIDs[0].Bytes)
	}
	if after[0].Source.String != "manual" {
		t.Fatalf("source flipped: %s", after[0].Source.String)
	}
	if n := f.countAllEvents(t); n != 1 {
		t.Fatalf("expected exactly 1 event after conflict, got %d", n)
	}
}

// TestWorkflowRoleAssignmentIntegration_InvalidUserRejected covers the
// membership gate called out in E2E-08: assigning a user who is not an active
// member of the workspace aborts the entire transaction.
func TestWorkflowRoleAssignmentIntegration_InvalidUserRejected(t *testing.T) {
	f := newAssignmentFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolutions := f.loadResolutions(t)
	// A UUID that does not map to any workspace member.
	rogueUserID := pgtype.UUID{Bytes: [16]byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, Valid: true}

	svc := newWorkflowService(f)
	_, err := svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[0], []WorkflowRoleManualAssignment{
		{ResolutionID: resolutions[0].ID, UserID: rogueUserID, Version: resolutions[0].Version},
	})
	if err == nil {
		t.Fatalf("expected error assigning rogue user, got nil")
	}

	after := f.loadResolutions(t)
	if after[0].Status != "pending" {
		t.Fatalf("resolution status = %s, want pending (rolled back)", after[0].Status)
	}
	if after[0].ResolvedUserID.Valid {
		t.Fatalf("rogue assignment was not rolled back")
	}
}

// TestWorkflowRoleAssignmentIntegration_OverridesLLMResult covers E2E-10:
// an LLM-resolved slot in a pre-execution stage can be overridden manually.
// The earlier llm event is preserved, the new event is sourced manual, and
// the node-run snapshot reflects the new user.
func TestWorkflowRoleAssignmentIntegration_OverridesLLMResult(t *testing.T) {
	f := newAssignmentFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	// Simulate a prior LLM resolution: stamp the row and the node-run snapshot.
	resolutions := f.loadResolutions(t)
	llmUser := f.userIDs[0]
	_, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_role_resolution
		SET status = 'resolved',
		    source = 'llm',
		    resolved_user_id = $2,
		    version = version + 1
		WHERE id = $1
	`, resolutions[0].ID, llmUser)
	if err != nil {
		t.Fatalf("seed llm resolution: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_node_run SET worker_id = $2 WHERE id = $1
	`, f.nodeRunIDs[0], llmUser); err != nil {
		t.Fatalf("seed node run worker_id: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(), `
		INSERT INTO multica_workflow_role_resolution_event (
			workflow_run_id, workflow_role_resolution_id, event_type, slot_type,
			role_name_snapshot, resolved_user_id, source, reason_code, actor_user_id
		) VALUES ($1, $2, 'llm_resolution', $3, $4, $5, 'llm', 'auto_resolved', NULL)
	`, f.runID, resolutions[0].ID, resolutions[0].SlotType, resolutions[0].RoleNameSnapshot, llmUser); err != nil {
		t.Fatalf("seed llm event: %v", err)
	}

	// Re-read so we have the post-bump version to satisfy the optimistic lock.
	current := f.loadResolutions(t)[0]

	svc := newWorkflowService(f)
	replacement := f.userIDs[1]
	if _, err := svc.AssignWorkflowRoles(context.Background(), f.runID, f.userIDs[0], []WorkflowRoleManualAssignment{
		{ResolutionID: current.ID, UserID: replacement, Version: current.Version},
	}); err != nil {
		t.Fatalf("override LLM resolution: %v", err)
	}

	after := f.loadResolutions(t)[0]
	if after.ResolvedUserID.Bytes != replacement.Bytes {
		t.Fatalf("override did not stamp replacement user: got %v, want %v", after.ResolvedUserID.Bytes, replacement.Bytes)
	}
	if after.Source.String != "manual" {
		t.Fatalf("source = %s, want manual", after.Source.String)
	}

	// Both the original llm event and the new manual event must be present.
	if n := f.countEvents(t, "llm_resolution"); n != 1 {
		t.Fatalf("expected 1 llm_resolution event, got %d", n)
	}
	if n := f.countEvents(t, "manual_assignment"); n != 1 {
		t.Fatalf("expected 1 manual_assignment event, got %d", n)
	}

	// Node-run snapshot must follow the manual override.
	nr := f.loadNodeRun(t, f.nodeRunIDs[0])
	if !nr.WorkerID.Valid || nr.WorkerID.Bytes != replacement.Bytes {
		t.Fatalf("node run worker_id = %v, want %v", nr.WorkerID, replacement.Bytes)
	}
}

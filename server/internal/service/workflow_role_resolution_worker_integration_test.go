package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// stubOrgProvider is a configurable test double for
// WorkflowRoleOrganizationProvider. It is used in integration tests where the
// real deptsync client is not reachable.
type stubOrgProvider struct {
	configured bool
	snapshot   WorkflowRoleOrganizationSnapshot
	err        error
}

func (s *stubOrgProvider) Configured() bool { return s.configured }

func (s *stubOrgProvider) ResolveMembers(ctx context.Context, _ []string) (WorkflowRoleOrganizationSnapshot, error) {
	if s.err != nil {
		return WorkflowRoleOrganizationSnapshot{}, s.err
	}
	return s.snapshot, nil
}

// roleResolutionFixture captures the IDs integration tests need to drive the
// worker and assert on its observable state.
type roleResolutionFixture struct {
	pool          *pgxpool.Pool
	queries       *db.Queries
	workspaceID   pgtype.UUID
	userIDs       []pgtype.UUID
	workflowID    pgtype.UUID
	runID         pgtype.UUID
	nodeRunIDs    []pgtype.UUID
	roleIDs       map[string]pgtype.UUID
	resolutionIDs []pgtype.UUID
	slug          string
}

// newRoleResolutionFixture seeds a fresh workspace, three active members with
// linked external identities, a single-node role-driven workflow, a
// resolving_roles run, and one role_resolution row per slot spec. The fixture
// is isolated by a unique slug so parallel tests do not collide.
func newRoleResolutionFixture(t *testing.T, slotSpecs []roleSlotSpec) *roleResolutionFixture {
	t.Helper()
	pool := openTestPool(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("rr-%d-%d", os.Getpid(), time.Now().UnixNano())
	slug := "role-res-" + suffix

	var workspaceID pgtype.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'role resolution test workspace', 'RR')
		RETURNING id
	`, "Role Resolution "+suffix, slug).Scan(&workspaceID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}

	// Three members, each with a unique external identity so they survive
	// normalizeWorkflowRoleMemberCandidates deduplication.
	userIDs := make([]pgtype.UUID, 0, 3)
	for i := 0; i < 3; i++ {
		var userID pgtype.UUID
		email := fmt.Sprintf("role-%s-%d@multica.ai", suffix, i)
		err = pool.QueryRow(ctx, `
			INSERT INTO multica_user (name, email)
			VALUES ($1, $2)
			RETURNING id
		`, fmt.Sprintf("Member %d %s", i, suffix), email).Scan(&userID)
		if err != nil {
			t.Fatalf("create user %d: %v", i, err)
		}
		externalID := fmt.Sprintf("ext-%s-%d", suffix, i)
		_, err = pool.Exec(ctx, `
			INSERT INTO multica_member (workspace_id, user_id, role, status, external_universal_id, org_display_name)
			VALUES ($1, $2, 'member', 'active', $3, $4)
		`, workspaceID, userID, externalID, fmt.Sprintf("Member %d", i))
		if err != nil {
			t.Fatalf("create member %d: %v", i, err)
		}
		userIDs = append(userIDs, userID)
	}

	// Roles required by the slot specs.
	roleIDs := map[string]pgtype.UUID{}
	for _, spec := range slotSpecs {
		if _, ok := roleIDs[spec.roleName]; ok {
			continue
		}
		var roleID pgtype.UUID
		err = pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_role (workspace_id, name, normalized_name, description, is_builtin, needs_description)
			VALUES ($1, $2, lower($2), $3, false, false)
			RETURNING id
		`, workspaceID, spec.roleName, spec.roleName+" description").Scan(&roleID)
		if err != nil {
			t.Fatalf("create role %s: %v", spec.roleName, err)
		}
		roleIDs[spec.roleName] = roleID
	}

	// Workflow + role-driven node. A single node with both worker_role_id and
	// critic_role_id lets us cover worker and critic slots in one fixture.
	var workflowID pgtype.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id, is_template)
		VALUES ($1, 'Role Resolution Workflow', '', 'active', 3, 'member', $2, false)
		RETURNING id
	`, workspaceID, userIDs[0]).Scan(&workflowID)
	if err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var workerRoleID, criticRoleID pgtype.UUID
	for _, spec := range slotSpecs {
		if spec.slotType == "worker" && !workerRoleID.Valid {
			workerRoleID = roleIDs[spec.roleName]
		}
		if spec.slotType == "critic" && !criticRoleID.Valid {
			criticRoleID = roleIDs[spec.roleName]
		}
	}
	var nodeID pgtype.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (workflow_id, title, description, position_x, position_y, worker_type, critic_type, worker_role_id, critic_role_id, sort_order)
		VALUES ($1, 'Role Node', '', 100, 50, 'human', 'human', $2, $3, 0)
		RETURNING id
	`, workflowID, workerRoleID, criticRoleID).Scan(&nodeID)
	if err != nil {
		t.Fatalf("create workflow node: %v", err)
	}

	// resolving_roles run + blocked node run snapshot.
	var runID pgtype.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, status, triggered_by_type, triggered_by_id, started_at)
		VALUES ($1, $2, 'resolving_roles', 'member', $3, now())
		RETURNING id
	`, workflowID, workspaceID, userIDs[0]).Scan(&runID)
	if err != nil {
		t.Fatalf("create workflow run: %v", err)
	}

	nodeRunIDs := make([]pgtype.UUID, 0, len(slotSpecs))
	resolutionIDs := make([]pgtype.UUID, 0, len(slotSpecs))
	for _, spec := range slotSpecs {
		var nodeRunID pgtype.UUID
		err = pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node_run (workflow_run_id, workflow_node_id, status, worker_type, critic_type)
			VALUES ($1, $2, 'blocked', 'human', 'human')
			RETURNING id
		`, runID, nodeID).Scan(&nodeRunID)
		if err != nil {
			t.Fatalf("create node run: %v", err)
		}
		nodeRunIDs = append(nodeRunIDs, nodeRunID)

		roleID := roleIDs[spec.roleName]
		var resolutionID pgtype.UUID
		err = pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_role_resolution (
				workflow_run_id, workflow_node_run_id, slot_type, role_id,
				role_name_snapshot, role_description_snapshot, status
			) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
			RETURNING id
		`, runID, nodeRunID, spec.slotType, roleID, spec.roleName, spec.roleName+" description").Scan(&resolutionID)
		if err != nil {
			t.Fatalf("create role resolution row: %v", err)
		}
		resolutionIDs = append(resolutionIDs, resolutionID)
	}

	return &roleResolutionFixture{
		pool:          pool,
		queries:       db.New(pool),
		workspaceID:   workspaceID,
		userIDs:       userIDs,
		workflowID:    workflowID,
		runID:         runID,
		nodeRunIDs:    nodeRunIDs,
		roleIDs:       roleIDs,
		resolutionIDs: resolutionIDs,
		slug:          slug,
	}
}

type roleSlotSpec struct {
	slotType string // "worker" or "critic"
	roleName string
}

func (f *roleResolutionFixture) createPendingJob(t *testing.T, model string) db.MulticaWorkflowRoleResolutionJob {
	t.Helper()
	ctx := context.Background()
	var job db.MulticaWorkflowRoleResolutionJob
	err := f.pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_role_resolution_job (workspace_id, workflow_run_id, model, prompt_version)
		VALUES ($1, $2, $3, 'v1')
		RETURNING id, workspace_id, workflow_run_id, status, attempt_count, max_attempts, org_attempt_count, llm_attempt_count, format_attempt_count, generation, scheduled_at, locked_by, lease_expires_at, heartbeat_at, last_error_code, last_error_detail, model, prompt_version, created_at, started_at, finished_at, updated_at
	`, f.workspaceID, f.runID, model).Scan(
		&job.ID, &job.WorkspaceID, &job.WorkflowRunID, &job.Status, &job.AttemptCount, &job.MaxAttempts,
		&job.OrgAttemptCount, &job.LlmAttemptCount, &job.FormatAttemptCount, &job.Generation,
		&job.ScheduledAt, &job.LockedBy, &job.LeaseExpiresAt, &job.HeartbeatAt,
		&job.LastErrorCode, &job.LastErrorDetail, &job.Model, &job.PromptVersion,
		&job.CreatedAt, &job.StartedAt, &job.FinishedAt, &job.UpdatedAt,
	)
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	return job
}

func (f *roleResolutionFixture) cleanup() {
	if f == nil || f.pool == nil {
		return
	}
	ctx := context.Background()
	_, _ = f.pool.Exec(ctx, `DELETE FROM multica_workspace WHERE slug = $1`, f.slug)
	f.pool.Close()
}

// runWorkerOnce constructs a worker with the supplied resolver/org provider and
// drives a single process() iteration. The fixture seeds a pending job before
// this call so ClaimWorkflowRoleResolutionJob has exactly one row to claim.
func (f *roleResolutionFixture) runWorkerOnce(t *testing.T, resolver WorkflowRoleResolver, org WorkflowRoleOrganizationProvider) {
	t.Helper()
	ctx := context.Background()
	f.createPendingJob(t, "test-model")
	worker := &WorkflowRoleResolutionWorker{
		Queries:       f.queries,
		TxStarter:     pgxTxStarter{pool: f.pool},
		Resolver:      resolver,
		Organization:  org,
		WorkerID:      "test-worker",
		LeaseDuration: 5 * time.Second,
		MaxCandidates: 200,
		MaxSlots:      50,
		MaxInputChars: 100000,
	}
	if err := worker.runOnce(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("worker.runOnce returned error: %v", err)
	}
}

type pgxTxStarter struct {
	pool *pgxpool.Pool
}

func (s pgxTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	return s.pool.Begin(ctx)
}

func (f *roleResolutionFixture) loadResolutions(t *testing.T) []db.MulticaWorkflowRoleResolution {
	t.Helper()
	rows, err := f.queries.ListWorkflowRoleResolutions(context.Background(), f.runID)
	if err != nil {
		t.Fatalf("list resolutions: %v", err)
	}
	return rows
}

func (f *roleResolutionFixture) loadRunStatus(t *testing.T) string {
	t.Helper()
	run, err := f.queries.GetWorkflowRun(context.Background(), f.runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	return run.Status
}

func (f *roleResolutionFixture) loadNodeRun(t *testing.T, id pgtype.UUID) db.MulticaWorkflowNodeRun {
	t.Helper()
	row, err := f.queries.GetWorkflowNodeRun(context.Background(), id)
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	return row
}

func (f *roleResolutionFixture) loadLatestJob(t *testing.T) db.MulticaWorkflowRoleResolutionJob {
	t.Helper()
	job, err := f.queries.GetLatestWorkflowRoleResolutionJob(context.Background(), f.runID)
	if err != nil {
		t.Fatalf("get latest job: %v", err)
	}
	return job
}

func ptrUUID(u pgtype.UUID) pgtype.UUID { return u }

// TestWorkflowRoleResolutionWorkerIntegration_AllSlotsResolved covers E2E-05:
// LLM returns valid candidate IDs for every slot, the run transitions from
// resolving_roles to running, node run snapshots are stamped with real user
// IDs, and the job finishes as succeeded.
func TestWorkflowRoleResolutionWorkerIntegration_AllSlotsResolved(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
		{slotType: "critic", roleName: "qa"},
	})
	defer f.cleanup()

	// Organization snapshot must publish exactly one profile per external
	// identity, with at least one populated org field so the member is included
	// as a candidate.
	org := &stubOrgProvider{configured: true, snapshot: WorkflowRoleOrganizationSnapshot{
		Version: "org-v1",
		Profiles: []WorkflowRoleOrganizationProfile{
			{ExternalIdentity: fmt.Sprintf("ext-%s-0", f.slug[len("role-res-"):]), DisplayName: "Member 0", Position: "Engineer", DepartmentPath: "Engineering", IsMainDepartment: true},
			{ExternalIdentity: fmt.Sprintf("ext-%s-1", f.slug[len("role-res-"):]), DisplayName: "Member 1", Position: "QA", DepartmentPath: "Quality", IsMainDepartment: true},
			{ExternalIdentity: fmt.Sprintf("ext-%s-2", f.slug[len("role-res-"):]), DisplayName: "Member 2", Position: "Tech Lead", DepartmentPath: "Engineering", IsMainDepartment: true},
		},
	}}
	// The Mock LLM maps every slot to candidate_1 deterministically. The worker
	// assigns real user IDs after validating the candidate mapping.
	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, r *http.Request) {
		body := `{"choices":[{"message":{"content":"{\"results\":[{\"slot_id\":\"slot_1\",\"status\":\"resolved\",\"candidate_id\":\"candidate_1\"},{\"slot_id\":\"slot_2\",\"status\":\"resolved\",\"candidate_id\":\"candidate_1\"}]}"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`
		_, _ = w.Write([]byte(body))
	})
	defer closeServer()

	f.runWorkerOnce(t, resolver, org)

	resolutions := f.loadResolutions(t)
	if len(resolutions) != 2 {
		t.Fatalf("expected 2 resolutions, got %d", len(resolutions))
	}
	for _, row := range resolutions {
		if row.Status != "resolved" {
			t.Fatalf("resolution %s status = %s, want resolved", row.ID, row.Status)
		}
		if row.Source.String != "llm" {
			t.Fatalf("resolution %s source = %s, want llm", row.ID, row.Source.String)
		}
		if !row.ResolvedUserID.Valid {
			t.Fatalf("resolution %s resolved_user_id not set", row.ID)
		}
	}

	if status := f.loadRunStatus(t); status != "running" {
		t.Fatalf("run status = %s, want running", status)
	}
	for _, nodeRunID := range f.nodeRunIDs {
		row := f.loadNodeRun(t, nodeRunID)
		if !row.WorkerID.Valid && !row.CriticID.Valid {
			t.Fatalf("node run %s has no worker/critic ID assigned", row.ID)
		}
		if row.Status != "format_checking" && row.Status != "pending" {
			t.Fatalf("node run %s status = %s, want promoted", row.ID, row.Status)
		}
	}

	if job := f.loadLatestJob(t); job.Status != "succeeded" {
		t.Fatalf("job status = %s, want succeeded", job.Status)
	}
}

// TestWorkflowRoleResolutionWorkerIntegration_PartialSuccessTransitionsToWaiting covers E2E-06:
// the LLM resolves one slot and returns an unknown candidate for another. The
// resolved slot must keep its result, the unknown candidate must downgrade to
// needs_human, and the run must land in waiting_role_assignment with the job
// marked partial.
func TestWorkflowRoleResolutionWorkerIntegration_PartialSuccessTransitionsToWaiting(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
		{slotType: "critic", roleName: "qa"},
	})
	defer f.cleanup()

	suffix := f.slug[len("role-res-"):]
	org := &stubOrgProvider{configured: true, snapshot: WorkflowRoleOrganizationSnapshot{
		Version: "org-v1",
		Profiles: []WorkflowRoleOrganizationProfile{
			{ExternalIdentity: fmt.Sprintf("ext-%s-0", suffix), DisplayName: "Member 0", Position: "Engineer", DepartmentPath: "Engineering", IsMainDepartment: true},
			{ExternalIdentity: fmt.Sprintf("ext-%s-1", suffix), DisplayName: "Member 1", Position: "QA", DepartmentPath: "Quality", IsMainDepartment: true},
			{ExternalIdentity: fmt.Sprintf("ext-%s-2", suffix), DisplayName: "Member 2", Position: "Tech Lead", DepartmentPath: "Engineering", IsMainDepartment: true},
		},
	}}
	// slot_1 resolves cleanly, slot_2 references candidate_999 which the
	// validator strips and the worker downgrades to needs_human.
	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		body := `{"choices":[{"message":{"content":"{\"results\":[{\"slot_id\":\"slot_1\",\"status\":\"resolved\",\"candidate_id\":\"candidate_1\"},{\"slot_id\":\"slot_2\",\"status\":\"resolved\",\"candidate_id\":\"candidate_999\"}]}"}}]}`
		_, _ = w.Write([]byte(body))
	})
	defer closeServer()

	f.runWorkerOnce(t, resolver, org)

	if status := f.loadRunStatus(t); status != "waiting_role_assignment" {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	resolutions := f.loadResolutions(t)
	if len(resolutions) != 2 {
		t.Fatalf("expected 2 resolutions, got %d", len(resolutions))
	}
	resolvedCount, needsHumanCount := 0, 0
	for _, row := range resolutions {
		switch row.Status {
		case "resolved":
			resolvedCount++
			if row.Source.String != "llm" || !row.ResolvedUserID.Valid {
				t.Fatalf("resolved row %s has unexpected source/user: source=%s user_valid=%v", row.ID, row.Source.String, row.ResolvedUserID.Valid)
			}
		case "needs_human":
			needsHumanCount++
			if row.ReasonCode != "invalid_model_output" {
				t.Fatalf("needs_human row %s reason_code = %s, want invalid_model_output", row.ID, row.ReasonCode)
			}
		default:
			t.Fatalf("unexpected status %s on row %s", row.Status, row.ID)
		}
	}
	if resolvedCount != 1 || needsHumanCount != 1 {
		t.Fatalf("expected 1 resolved + 1 needs_human, got %d / %d", resolvedCount, needsHumanCount)
	}
	if job := f.loadLatestJob(t); job.Status != "partial" {
		t.Fatalf("job status = %s, want partial", job.Status)
	}
}

// TestWorkflowRoleResolutionWorkerIntegration_ResolverNotConfigured covers E2E-07:
// when the organization provider reports Configured=false (or the resolver is
// nil), no LLM call is made and every slot transitions directly to
// needs_human with the resolver_not_configured reason.
func TestWorkflowRoleResolutionWorkerIntegration_ResolverNotConfigured(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
		{slotType: "critic", roleName: "qa"},
	})
	defer f.cleanup()

	// Organization provider not configured; the worker should short-circuit
	// before any HTTP traffic. The resolver is intentionally nil.
	f.runWorkerOnce(t, nil, &stubOrgProvider{configured: false})

	if status := f.loadRunStatus(t); status != "waiting_role_assignment" {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	for _, row := range f.loadResolutions(t) {
		if row.Status != "needs_human" {
			t.Fatalf("resolution %s status = %s, want needs_human", row.ID, row.Status)
		}
		if row.ReasonCode != "resolver_not_configured" {
			t.Fatalf("resolution %s reason_code = %s, want resolver_not_configured", row.ID, row.ReasonCode)
		}
	}
	if job := f.loadLatestJob(t); job.Status != "partial" {
		t.Fatalf("job status = %s, want partial", job.Status)
	}
}

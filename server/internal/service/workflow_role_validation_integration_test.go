package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// stampSlotResolvedForValidation prepares a worker slot for the E2E-11 code
// path: the resolution is flipped to 'resolved' (sourced llm) with the chosen
// user, the matching node run is stamped with the user id and moved into a
// pre-execution status (format_checking), so the production dispatch path can
// hand the row to validateResolvedHumanMember. The member row is left for the
// caller to mutate (deactivate or remove) so each E2E-11 variant starts from
// the same baseline.
func (f *roleResolutionFixture) stampSlotResolvedForValidation(t *testing.T, slotType string, memberIndex int) {
	t.Helper()
	ctx := context.Background()
	user := f.userIDs[memberIndex]
	row := f.loadResolutions(t)[0]

	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution
		SET status = 'resolved', source = 'llm', resolved_user_id = $2,
		    resolved_at = now(), version = version + 1
		WHERE id = $1
	`, row.ID, user); err != nil {
		t.Fatalf("stamp resolution resolved: %v", err)
	}

	assignCol := "worker_id"
	if slotType == "critic" {
		assignCol = "critic_id"
	}
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET `+assignCol+` = $2, status = 'format_checking'
		WHERE id = $1
	`, f.nodeRunIDs[0], user); err != nil {
		t.Fatalf("stamp node run pre-execution: %v", err)
	}

	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_run SET status = 'running' WHERE id = $1
	`, f.runID); err != nil {
		t.Fatalf("promote fixture run: %v", err)
	}
}

// TestWorkflowRoleValidation_InactiveMemberInvalidated covers E2E-11 (inactive
// branch): when the resolved workspace member has been deactivated between
// role resolution and node dispatch, validateResolvedHumanMember must flip the
// resolution to 'invalidated' with reason_code 'member_inactive', block the
// node run, and record an audit event before returning
// ErrWorkflowRoleMemberInvalid.
func TestWorkflowRoleValidation_InactiveMemberInvalidated(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	f.stampSlotResolvedForValidation(t, "worker", 0)

	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_member SET status = 'inactive'
		WHERE workspace_id = $1 AND user_id = $2
	`, f.workspaceID, f.userIDs[0]); err != nil {
		t.Fatalf("deactivate member: %v", err)
	}

	svc := &WorkflowService{
		Queries:   f.queries,
		TxStarter: pgxTxStarter{pool: f.pool},
	}
	nodeRun := f.loadNodeRun(t, f.nodeRunIDs[0])
	if err := svc.validateResolvedHumanMember(ctx, nodeRun, "worker"); !errors.Is(err, ErrWorkflowRoleMemberInvalid) {
		t.Fatalf("expected ErrWorkflowRoleMemberInvalid, got %v", err)
	}

	after := f.loadResolutions(t)[0]
	if after.Status != "invalidated" {
		t.Fatalf("resolution status = %s, want invalidated", after.Status)
	}
	if after.ReasonCode != "member_inactive" {
		t.Fatalf("reason_code = %s, want member_inactive", after.ReasonCode)
	}

	blocked := f.loadNodeRun(t, f.nodeRunIDs[0])
	if blocked.Status != "blocked" {
		t.Fatalf("node run status = %s, want blocked", blocked.Status)
	}

	var invalidatedEvents int
	if err := f.pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_role_resolution_event
		WHERE workflow_run_id = $1 AND event_type = 'invalidated'
		  AND reason_code = 'member_inactive'
	`, f.runID).Scan(&invalidatedEvents); err != nil {
		t.Fatalf("count invalidated events: %v", err)
	}
	if invalidatedEvents != 1 {
		t.Fatalf("expected 1 invalidated event, got %d", invalidatedEvents)
	}
}

// TestWorkflowRoleValidation_RemovedMemberInvalidated covers E2E-11 (removed
// branch): a hard-deleted member row yields pgx.ErrNoRows from
// GetMemberByUserAndWorkspace, which the validator treats the same as an
// inactive member. The slot lands in 'invalidated' with reason_code
// 'member_inactive' and the node run is blocked.
func TestWorkflowRoleValidation_RemovedMemberInvalidated(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	f.stampSlotResolvedForValidation(t, "worker", 1)

	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `
		DELETE FROM multica_member WHERE workspace_id = $1 AND user_id = $2
	`, f.workspaceID, f.userIDs[1]); err != nil {
		t.Fatalf("delete member: %v", err)
	}

	svc := &WorkflowService{
		Queries:   f.queries,
		TxStarter: pgxTxStarter{pool: f.pool},
	}
	nodeRun := f.loadNodeRun(t, f.nodeRunIDs[0])
	if err := svc.validateResolvedHumanMember(ctx, nodeRun, "worker"); !errors.Is(err, ErrWorkflowRoleMemberInvalid) {
		t.Fatalf("expected ErrWorkflowRoleMemberInvalid, got %v", err)
	}

	after := f.loadResolutions(t)[0]
	if after.Status != "invalidated" {
		t.Fatalf("resolution status = %s, want invalidated", after.Status)
	}
	if after.ReasonCode != "member_inactive" {
		t.Fatalf("reason_code = %s, want member_inactive", after.ReasonCode)
	}
	if status := f.loadNodeRun(t, f.nodeRunIDs[0]).Status; status != "blocked" {
		t.Fatalf("node run status = %s, want blocked", status)
	}
}

// TestWorkflowRoleValidation_ActiveMemberIsValid is the E2E-11 negative
// control: an active member survives validation. The resolution stays
// 'resolved', the node run stays in its pre-execution status, no
// 'invalidated' event is recorded, and the validator returns nil.
func TestWorkflowRoleValidation_ActiveMemberIsValid(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	f.stampSlotResolvedForValidation(t, "worker", 0)

	svc := &WorkflowService{
		Queries:   f.queries,
		TxStarter: pgxTxStarter{pool: f.pool},
	}
	nodeRun := f.loadNodeRun(t, f.nodeRunIDs[0])
	if err := svc.validateResolvedHumanMember(context.Background(), nodeRun, "worker"); err != nil {
		t.Fatalf("active member should validate, got %v", err)
	}

	after := f.loadResolutions(t)[0]
	if after.Status != "resolved" {
		t.Fatalf("resolution status = %s, want resolved (untouched)", after.Status)
	}
	if status := f.loadNodeRun(t, f.nodeRunIDs[0]).Status; status != "format_checking" {
		t.Fatalf("node run status = %s, want format_checking (untouched)", status)
	}
	var invalidatedEvents int
	if err := f.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM multica_workflow_role_resolution_event
		WHERE workflow_run_id = $1 AND event_type = 'invalidated'
	`, f.runID).Scan(&invalidatedEvents); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if invalidatedEvents != 0 {
		t.Fatalf("expected 0 invalidated events for active member, got %d", invalidatedEvents)
	}
}

// runWorkerAndAdvance drives the worker for up to maxIters iterations,
// backdating scheduled_at between iterations so a rescheduled job is immediately
// re-claimable. The loop stops as soon as the latest job leaves the
// pending/running states (i.e. the worker either finished or downgraded to
// needs_human). Used by E2E-13 HTTP-error tests to exercise the worker's retry
// classification against a single seeded job.
func (f *roleResolutionFixture) runWorkerAndAdvance(t *testing.T, resolver WorkflowRoleResolver, org WorkflowRoleOrganizationProvider, jobID pgtype.UUID, maxIters int) {
	t.Helper()
	ctx := context.Background()
	for iter := 0; iter < maxIters; iter++ {
		worker := &WorkflowRoleResolutionWorker{
			Queries:       f.queries,
			TxStarter:     pgxTxStarter{pool: f.pool},
			Resolver:      resolver,
			Organization:  org,
			WorkerID:      "test-worker",
			LeaseDuration: 5_000_000_000,
			MaxCandidates: 200,
			MaxSlots:      50,
			MaxInputChars: 100000,
		}
		if err := worker.runOnce(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("iter %d runOnce: %v", iter, err)
		}
		latest := f.loadLatestJob(t)
		if latest.Status != "pending" && latest.Status != "running" {
			return
		}
		if _, err := f.pool.Exec(ctx, `
			UPDATE multica_workflow_role_resolution_job
			SET scheduled_at = now() - interval '5 seconds'
			WHERE id = $1
		`, jobID); err != nil {
			t.Fatalf("backdate scheduled_at: %v", err)
		}
	}
}

// fixtureOrgSnapshot returns a stubOrgProvider publishing one profile per
// fixture member so the worker's candidate-builder always has material to
// hand the resolver.
func fixtureOrgSnapshot(f *roleResolutionFixture) *stubOrgProvider {
	suffix := f.slug[len("role-res-"):]
	return &stubOrgProvider{configured: true, snapshot: WorkflowRoleOrganizationSnapshot{
		Version: "org-v1",
		Profiles: []WorkflowRoleOrganizationProfile{
			{ExternalIdentity: "ext-" + suffix + "-0", DisplayName: "Member 0", Position: "Engineer", DepartmentPath: "Engineering", IsMainDepartment: true},
			{ExternalIdentity: "ext-" + suffix + "-1", DisplayName: "Member 1", Position: "QA", DepartmentPath: "Quality", IsMainDepartment: true},
			{ExternalIdentity: "ext-" + suffix + "-2", DisplayName: "Member 2", Position: "Tech Lead", DepartmentPath: "Engineering", IsMainDepartment: true},
		},
	}}
}

// TestWorkflowRoleResolutionWorker_HTTPNonRetryableNeedsHuman covers E2E-13
// (4xx classification): the resolver returns HTTP 400 (non-retryable). The
// worker skips the LLM retry path and lands every slot in needs_human with
// reason_code 'resolver_unavailable'. The run parks in waiting_role_assignment
// and the job finishes 'partial' after a single attempt.
func TestWorkflowRoleResolutionWorker_HTTPNonRetryableNeedsHuman(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("bad request"))
	})
	defer closeServer()

	job := f.createPendingJob(t, "test-model")
	f.runWorkerAndAdvance(t, resolver, fixtureOrgSnapshot(f), job.ID, 1)

	if status := f.loadRunStatus(t); status != RunStatusWaitingRoleAssignment {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	row := f.loadResolutions(t)[0]
	if row.Status != "needs_human" {
		t.Fatalf("resolution status = %s, want needs_human", row.Status)
	}
	if row.ReasonCode != "resolver_unavailable" {
		t.Fatalf("reason_code = %s, want resolver_unavailable", row.ReasonCode)
	}
	latest := f.loadLatestJob(t)
	if latest.Status != "partial" {
		t.Fatalf("job status = %s, want partial", latest.Status)
	}
	if latest.LlmAttemptCount != 1 {
		t.Fatalf("llm_attempt_count = %d, want 1 (single non-retryable attempt)", latest.LlmAttemptCount)
	}
}

// TestWorkflowRoleResolutionWorker_HTTPRetryableExhaustsLLMRetries covers
// E2E-13 (5xx/429 classification): the resolver returns HTTP 429 (retryable).
// The worker reschedules on the first attempt, then downgrades to needs_human
// with reason_code 'resolver_unavailable' on the second attempt once
// llm_attempt_count reaches workflowRoleLLMMaxAttempts (2). The job ends as
// 'partial' with both attempts recorded.
func TestWorkflowRoleResolutionWorker_HTTPRetryableExhaustsLLMRetries(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("slow down"))
	})
	defer closeServer()

	job := f.createPendingJob(t, "test-model")
	f.runWorkerAndAdvance(t, resolver, fixtureOrgSnapshot(f), job.ID, workflowRoleLLMMaxAttempts+1)

	if status := f.loadRunStatus(t); status != RunStatusWaitingRoleAssignment {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	row := f.loadResolutions(t)[0]
	if row.Status != "needs_human" {
		t.Fatalf("resolution status = %s, want needs_human", row.Status)
	}
	if row.ReasonCode != "resolver_unavailable" {
		t.Fatalf("reason_code = %s, want resolver_unavailable", row.ReasonCode)
	}
	latest := f.loadLatestJob(t)
	if latest.Status != "partial" {
		t.Fatalf("job status = %s, want partial", latest.Status)
	}
	if latest.LlmAttemptCount != workflowRoleLLMMaxAttempts {
		t.Fatalf("llm_attempt_count = %d, want %d", latest.LlmAttemptCount, workflowRoleLLMMaxAttempts)
	}
}

// TestWorkflowRoleResolutionWorker_InvalidJSONExhaustsFormatRetry covers
// E2E-13 (invalid_model_output classification): the resolver returns a
// syntactically broken body. The worker treats this as invalid_model_output,
// reschedules once via the format-retry path (workflowRoleFormatMaxAttempts =
// 1), then on the second attempt downgrades every slot to needs_human with
// reason_code 'invalid_model_output'.
func TestWorkflowRoleResolutionWorker_InvalidJSONExhaustsFormatRetry(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	})
	defer closeServer()

	job := f.createPendingJob(t, "test-model")
	// One initial attempt (format retry), one exhaustion attempt.
	f.runWorkerAndAdvance(t, resolver, fixtureOrgSnapshot(f), job.ID, workflowRoleFormatMaxAttempts+1)

	if status := f.loadRunStatus(t); status != RunStatusWaitingRoleAssignment {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	row := f.loadResolutions(t)[0]
	if row.Status != "needs_human" {
		t.Fatalf("resolution status = %s, want needs_human", row.Status)
	}
	if row.ReasonCode != "invalid_model_output" {
		t.Fatalf("reason_code = %s, want invalid_model_output", row.ReasonCode)
	}
	latest := f.loadLatestJob(t)
	if latest.Status != "partial" {
		t.Fatalf("job status = %s, want partial", latest.Status)
	}
	if latest.FormatAttemptCount != workflowRoleFormatMaxAttempts+1 {
		t.Fatalf("format_attempt_count = %d, want %d", latest.FormatAttemptCount, workflowRoleFormatMaxAttempts+1)
	}
}

// TestWorkflowRoleResolutionWorker_OversizeResponseNeedsHuman covers E2E-13
// (response_too_large classification): the resolver returns a body exceeding
// maxWorkflowRoleResolverResponseBytes. The error is non-retryable, so a
// single worker attempt lands every slot in needs_human with reason_code
// 'resolver_unavailable' (the worker maps any non-format, non-retryable
// resolver error to that reason).
func TestWorkflowRoleResolutionWorker_OversizeResponseNeedsHuman(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	resolver, closeServer := newWorkflowRoleResolverForTest(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", maxWorkflowRoleResolverResponseBytes+1)))
	})
	defer closeServer()

	job := f.createPendingJob(t, "test-model")
	f.runWorkerAndAdvance(t, resolver, fixtureOrgSnapshot(f), job.ID, 1)

	if status := f.loadRunStatus(t); status != RunStatusWaitingRoleAssignment {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	row := f.loadResolutions(t)[0]
	if row.Status != "needs_human" {
		t.Fatalf("resolution status = %s, want needs_human", row.Status)
	}
	if row.ReasonCode != "resolver_unavailable" {
		t.Fatalf("reason_code = %s, want resolver_unavailable", row.ReasonCode)
	}
	latest := f.loadLatestJob(t)
	if latest.Status != "partial" {
		t.Fatalf("job status = %s, want partial", latest.Status)
	}
	if latest.LlmAttemptCount != 1 {
		t.Fatalf("llm_attempt_count = %d, want 1 (oversize is not retried)", latest.LlmAttemptCount)
	}
}

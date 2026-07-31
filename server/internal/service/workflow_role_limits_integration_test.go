package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedActiveJobForRun inserts a pending role-resolution job tied to an existing
// run. Used to fill up the workspace active-job cap without spinning up the
// worker. The unique index idx_workflow_role_resolution_job_active_run only
// restricts one active job per run, so we can stack many across distinct runs.
func (f *roleResolutionFixture) seedActiveJobForRun(t *testing.T, runID pgtype.UUID) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), `
		INSERT INTO multica_workflow_role_resolution_job (workspace_id, workflow_run_id, model, prompt_version)
		VALUES ($1, $2, 'cap-model', 'v1')
	`, f.workspaceID, runID); err != nil {
		t.Fatalf("seed active job: %v", err)
	}
}

// seedExtraRun creates an additional resolving_roles run inside the fixture
// workspace and returns its ID. Used to stack active jobs in cap tests.
func (f *roleResolutionFixture) seedExtraRun(t *testing.T) pgtype.UUID {
	t.Helper()
	var runID pgtype.UUID
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, status, triggered_by_type, triggered_by_id, started_at)
		VALUES ($1, $2, 'resolving_roles', 'member', $3, now())
		RETURNING id
	`, f.workflowID, f.workspaceID, f.userIDs[0]).Scan(&runID); err != nil {
		t.Fatalf("seed extra run: %v", err)
	}
	return runID
}

// parkFixtureRunForRetry marks every resolution on the fixture run as
// needs_human and parks the run in waiting_role_assignment, the only state from
// which RetryWorkflowRoleResolution can flip rows back to pending. The fixture
// seeds resolutions as 'pending' for worker tests; retry's
// MarkUnresolvedWorkflowRoleResolutionsPending only matches needs_human or
// invalidated rows, so we transition them here.
func (f *roleResolutionFixture) parkFixtureRunForRetry(t *testing.T) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_role_resolution
		SET status = 'needs_human', reason_code = 'resolver_not_configured', updated_at = now()
		WHERE workflow_run_id = $1
	`, f.runID); err != nil {
		t.Fatalf("park resolutions for retry: %v", err)
	}
	if _, err := f.pool.Exec(context.Background(), `
		UPDATE multica_workflow_run
		SET status = 'waiting_role_assignment'
		WHERE id = $1
	`, f.runID); err != nil {
		t.Fatalf("park run for retry: %v", err)
	}
}

// TestWorkflowRoleResolutionLimits_WorkspaceCap covers E2E-18: with
// RoleResolutionMaxActiveJobs=5 and 5 active jobs already in the workspace,
// RetryWorkflowRoleResolution must reject a 6th attempt with
// ErrWorkflowRoleResolutionLimit. Once an active job finishes, retry is
// allowed again.
func TestWorkflowRoleResolutionLimits_WorkspaceCap(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	svc := &WorkflowService{
		Queries:                     f.queries,
		TxStarter:                   pgxTxStarter{pool: f.pool},
		AutoResolveRoles:            true,
		RoleResolutionModel:         "cap-model",
		RoleResolutionPromptVersion: "v1",
		RoleResolutionMaxActiveJobs: 5,
	}

	// Park the fixture run for retry: resolutions → needs_human, run →
	// waiting_role_assignment. The fixture run itself contributes no active
	// job, so retry attempts will be validated by the workspace cap.
	f.parkFixtureRunForRetry(t)

	// Stack 5 active jobs across distinct extra runs. The per-run partial
	// unique index allows only one pending/running job per run, so we cannot
	// pile them all on the fixture run.
	for i := 0; i < 5; i++ {
		runID := f.seedExtraRun(t)
		f.seedActiveJobForRun(t, runID)
	}

	ctx := context.Background()
	before, err := f.queries.CountActiveWorkflowRoleResolutionJobsForWorkspace(ctx, f.workspaceID)
	if err != nil {
		t.Fatalf("count active jobs: %v", err)
	}
	if before != 5 {
		t.Fatalf("workspace active jobs = %d, want 5", before)
	}

	// 6th attempt must be rejected before any state changes.
	_, err = svc.RetryWorkflowRoleResolution(ctx, f.runID)
	if !errors.Is(err, ErrWorkflowRoleResolutionLimit) {
		t.Fatalf("expected ErrWorkflowRoleResolutionLimit, got %v", err)
	}

	// The cap guard must not have left the fixture run mid-transition.
	status := f.loadRunStatus(t)
	if status != "waiting_role_assignment" {
		t.Fatalf("run status = %s, want waiting_role_assignment (untouched)", status)
	}

	// Free a slot by cancelling one of the extras, then retry must succeed and
	// park the run in resolving_roles with a fresh pending job.
	extraRuns := f.listExtraRunIDs(t)
	if len(extraRuns) == 0 {
		t.Fatalf("expected seeded extra runs")
	}
	if err := f.queries.CancelWorkflowRoleResolutionJobs(ctx, extraRuns[0]); err != nil {
		t.Fatalf("cancel extra job: %v", err)
	}
	job, err := svc.RetryWorkflowRoleResolution(ctx, f.runID)
	if err != nil {
		t.Fatalf("retry after free slot: %v", err)
	}
	if job.Status != "pending" {
		t.Fatalf("retry job status = %s, want pending", job.Status)
	}
	if status := f.loadRunStatus(t); status != RunStatusResolvingRoles {
		t.Fatalf("run status = %s, want resolving_roles", status)
	}
}

func (f *roleResolutionFixture) listExtraRunIDs(t *testing.T) []pgtype.UUID {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `
		SELECT id FROM multica_workflow_run
		WHERE workflow_id = $1 AND id <> $2
	`, f.workflowID, f.runID)
	if err != nil {
		t.Fatalf("list extra runs: %v", err)
	}
	defer rows.Close()
	var out []pgtype.UUID
	for rows.Next() {
		var id pgtype.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan extra run: %v", err)
		}
		out = append(out, id)
	}
	return out
}

// TestWorkflowRoleResolutionLimits_RetryRateLimit covers E2E-19: a first
// retry returns a fresh job with generation bumped; a second retry within the
// 1-minute window is rejected with ErrWorkflowRoleRetryRateLimited. After
// backdating the previous job's created_at past the window, retry is allowed.
func TestWorkflowRoleResolutionLimits_RetryRateLimit(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	svc := &WorkflowService{
		Queries:                     f.queries,
		TxStarter:                   pgxTxStarter{pool: f.pool},
		AutoResolveRoles:            true,
		RoleResolutionModel:         "rate-model",
		RoleResolutionPromptVersion: "v1",
		RoleResolutionMaxActiveJobs: 100, // no cap for this test
	}

	f.parkFixtureRunForRetry(t)

	ctx := context.Background()
	first, err := svc.RetryWorkflowRoleResolution(ctx, f.runID)
	if err != nil {
		t.Fatalf("first retry: %v", err)
	}
	if first.Generation != 1 {
		t.Fatalf("first generation = %d, want 1", first.Generation)
	}
	// The freshly created job is pending, so a second retry would trip the
	// active guard before the rate-limit guard. Finish the job so the rate
	// limit becomes the next gating check.
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution_job
		SET status = 'cancelled', finished_at = now(), locked_by = NULL,
		    lease_expires_at = NULL
		WHERE id = $1
	`, first.ID); err != nil {
		t.Fatalf("cancel first job: %v", err)
	}
	// Park the run again so the second retry can flip resolutions back to
	// pending if it gets past the rate-limit guard.
	f.parkFixtureRunForRetry(t)

	if _, err := svc.RetryWorkflowRoleResolution(ctx, f.runID); !errors.Is(err, ErrWorkflowRoleRetryRateLimited) {
		t.Fatalf("second retry within window: expected ErrWorkflowRoleRetryRateLimited, got %v", err)
	}

	// Backdate the prior job so the 1-minute window has elapsed.
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution_job
		SET created_at = now() - interval '2 minutes'
		WHERE id = $1
	`, first.ID); err != nil {
		t.Fatalf("backdate job: %v", err)
	}

	second, err := svc.RetryWorkflowRoleResolution(ctx, f.runID)
	if err != nil {
		t.Fatalf("retry after window: %v", err)
	}
	if second.Generation != 2 {
		t.Fatalf("second generation = %d, want 2", second.Generation)
	}
}

func TestWorkflowRoleResolutionRetryRejectsRunningInvalidatedSlot(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution
		SET status = 'invalidated', resolved_user_id = $2, source = 'llm',
		    reason_code = 'member_inactive', updated_at = now()
		WHERE workflow_run_id = $1
	`, f.runID, f.userIDs[0]); err != nil {
		t.Fatalf("invalidate role resolution: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_run SET status = 'running' WHERE id = $1
	`, f.runID); err != nil {
		t.Fatalf("mark run running: %v", err)
	}

	svc := &WorkflowService{
		Queries:                     f.queries,
		TxStarter:                   pgxTxStarter{pool: f.pool},
		AutoResolveRoles:            true,
		RoleResolutionModel:         "test-model",
		RoleResolutionPromptVersion: "v1",
		RoleResolutionMaxActiveJobs: 5,
	}
	if _, err := svc.RetryWorkflowRoleResolution(ctx, f.runID); !errors.Is(err, ErrWorkflowRoleAssignmentStage) {
		t.Fatalf("RetryWorkflowRoleResolution() error = %v, want ErrWorkflowRoleAssignmentStage", err)
	}

	resolution := f.loadResolutions(t)[0]
	if resolution.Status != "invalidated" {
		t.Fatalf("resolution status = %s, want invalidated", resolution.Status)
	}
	var jobs int
	if err := f.pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_role_resolution_job WHERE workflow_run_id = $1
	`, f.runID).Scan(&jobs); err != nil {
		t.Fatalf("count role resolution jobs: %v", err)
	}
	if jobs != 0 {
		t.Fatalf("role resolution jobs = %d, want 0", jobs)
	}
}

// TestWorkflowRoleResolutionLimits_OrgRetryExhaustion covers E2E-14: when the
// org provider returns a transient error on every call, the worker retries up
// to workflowRoleOrganizationMaxAttempts (3) and then downgrades every slot to
// needs_human with reason_code = "org_service_unavailable", parking the run in
// waiting_role_assignment with the job marked partial.
func TestWorkflowRoleResolutionLimits_OrgRetryExhaustion(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
		{slotType: "critic", roleName: "qa"},
	})
	defer f.cleanup()

	org := &stubOrgProvider{
		configured: true,
		err:        errors.New("org sync timed out"),
	}

	resolver, closeServer := newWorkflowRoleResolverForTest(t, nil)
	defer closeServer()

	// Drive the worker until it stops rescheduling. Each iteration bumps
	// org_attempt_count by 1; once it reaches
	// workflowRoleOrganizationMaxAttempts (3) the worker downgrades every
	// slot and finishes the job as partial.
	ctx := context.Background()
	job := f.createPendingJob(t, "test-model")
	for iter := 0; iter < workflowRoleOrganizationMaxAttempts; iter++ {
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
		// On the final iteration the worker calls needsHuman then returns the
		// original org error from retryOrganization. That error signals
		// successful exhaustion — not a fatal failure.
		err := worker.runOnce(ctx)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) && err.Error() != org.err.Error() {
			t.Fatalf("iter %d runOnce: %v", iter, err)
		}
		latest := f.loadLatestJob(t)
		if latest.Status != "pending" && latest.Status != "running" {
			break
		}
		// Reschedule pushes scheduled_at into the future; backdate so the
		// next iteration's claim can pick the row up immediately.
		if _, err := f.pool.Exec(ctx, `
			UPDATE multica_workflow_role_resolution_job
			SET scheduled_at = now() - interval '5 seconds'
			WHERE id = $1
		`, job.ID); err != nil {
			t.Fatalf("backdate scheduled_at: %v", err)
		}
	}

	if status := f.loadRunStatus(t); status != RunStatusWaitingRoleAssignment {
		t.Fatalf("run status = %s, want waiting_role_assignment", status)
	}
	for _, row := range f.loadResolutions(t) {
		if row.Status != "needs_human" {
			t.Fatalf("resolution %s status = %s, want needs_human", row.ID, row.Status)
		}
		if row.ReasonCode != "org_service_unavailable" {
			t.Fatalf("resolution %s reason_code = %s, want org_service_unavailable", row.ID, row.ReasonCode)
		}
	}
	finalJob := f.loadLatestJob(t)
	if finalJob.Status != "partial" {
		t.Fatalf("job status = %s, want partial", finalJob.Status)
	}
	if finalJob.OrgAttemptCount < int32(workflowRoleOrganizationMaxAttempts) {
		t.Fatalf("org_attempt_count = %d, want >= %d", finalJob.OrgAttemptCount, workflowRoleOrganizationMaxAttempts)
	}
}

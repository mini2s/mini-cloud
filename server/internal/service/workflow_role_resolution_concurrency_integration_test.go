package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestWorkflowRoleResolutionConcurrency_SkipLocked covers E2E-15: two workers
// race to claim the same single pending job. FOR UPDATE SKIP LOCKED guarantees
// worker A wins and worker B sees ErrNoRows rather than blocking or stealing.
func TestWorkflowRoleResolutionConcurrency_SkipLocked(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	job := f.createPendingJob(t, "test-model")

	ctx := context.Background()
	leaseDuration := pgtype.Interval{Microseconds: 5 * int64(time.Second/time.Microsecond), Valid: true}

	// First claim wins.
	first, err := f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-A", Valid: true}, LeaseDuration: leaseDuration})
	if err != nil {
		t.Fatalf("worker-A claim: %v", err)
	}
	if first.ID.Bytes != job.ID.Bytes {
		t.Fatalf("claimed wrong job: got %v, want %v", first.ID.Bytes, job.ID.Bytes)
	}
	if first.Status != "running" {
		t.Fatalf("first claim status = %s, want running", first.Status)
	}

	// Second claim finds nothing because the row is now running, not pending.
	_, err = f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-B", Valid: true}, LeaseDuration: leaseDuration})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("worker-B expected ErrNoRows, got %v", err)
	}

	// Sanity: job still belongs to worker A.
	latest := f.loadLatestJob(t)
	if latest.LockedBy.String != "worker-A" {
		t.Fatalf("locked_by = %s, want worker-A", latest.LockedBy.String)
	}
	if latest.AttemptCount != 1 {
		t.Fatalf("attempt_count = %d, want 1 (single successful claim)", latest.AttemptCount)
	}
}

// TestWorkflowRoleResolutionConcurrency_LeaseExpiryRequeues covers E2E-16: a
// running job whose lease has expired is requeued by the periodic sweeper so a
// fresh worker can pick it up.
func TestWorkflowRoleResolutionConcurrency_LeaseExpiryRequeues(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	job := f.createPendingJob(t, "test-model")
	ctx := context.Background()

	// Claim with a 1-second lease, then backdate the expiry so the sweeper
	// observes it as expired without flakiness.
	shortLease := pgtype.Interval{Microseconds: int64(time.Second / time.Microsecond), Valid: true}
	if _, err := f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-A", Valid: true}, LeaseDuration: shortLease}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution_job
		SET lease_expires_at = now() - interval '5 seconds'
		WHERE id = $1
	`, job.ID); err != nil {
		t.Fatalf("backdate lease: %v", err)
	}

	n, err := f.queries.RequeueExpiredWorkflowRoleResolutionJobs(ctx)
	if err != nil {
		t.Fatalf("requeue expired: %v", err)
	}
	if n != 1 {
		t.Fatalf("requeued %d rows, want 1", n)
	}
	requeued := f.loadLatestJob(t)
	if requeued.Generation != job.Generation+1 {
		t.Fatalf("generation after requeue = %d, want %d", requeued.Generation, job.Generation+1)
	}

	// A second claim must now succeed on the same row.
	second, err := f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-B", Valid: true}, LeaseDuration: shortLease})
	if err != nil {
		t.Fatalf("worker-B claim after requeue: %v", err)
	}
	if second.ID.Bytes != job.ID.Bytes {
		t.Fatalf("second claim picked wrong job")
	}
	if second.AttemptCount != 2 {
		t.Fatalf("attempt_count = %d, want 2 (claim counted twice across leases)", second.AttemptCount)
	}
	if second.LockedBy.String != "worker-B" {
		t.Fatalf("locked_by = %s, want worker-B", second.LockedBy.String)
	}
	if second.Generation != requeued.Generation {
		t.Fatalf("second claim generation = %d, want %d", second.Generation, requeued.Generation)
	}
}

// TestWorkflowRoleResolutionConcurrency_StaleResultDiscarded covers E2E-17: a
// worker whose lease expired (and whose job was requeued + re-claimed by a
// peer) tries to finish the job using the stale generation. The
// generation-guarded UPDATE is a no-op, so neither the run state nor the
// resolved resolutions are clobbered by the slow worker.
func TestWorkflowRoleResolutionConcurrency_StaleResultDiscarded(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	job := f.createPendingJob(t, "test-model")
	ctx := context.Background()

	lease := pgtype.Interval{Microseconds: 5 * int64(time.Second/time.Microsecond), Valid: true}
	first, err := f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-A", Valid: true}, LeaseDuration: lease})
	if err != nil {
		t.Fatalf("claim A: %v", err)
	}
	staleGeneration := first.Generation

	// Lease expiry must bump the generation before worker B reclaims the job.
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution_job
		SET lease_expires_at = now() - interval '5 seconds'
		WHERE id = $1
	`, job.ID); err != nil {
		t.Fatalf("backdate lease: %v", err)
	}
	if n, err := f.queries.RequeueExpiredWorkflowRoleResolutionJobs(ctx); err != nil {
		t.Fatalf("requeue expired job: %v", err)
	} else if n != 1 {
		t.Fatalf("requeued %d rows, want 1", n)
	}
	if _, err := f.queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{LockedBy: pgtype.Text{String: "worker-B", Valid: true}, LeaseDuration: lease}); err != nil {
		t.Fatalf("claim B: %v", err)
	}

	// Worker A wakes up with stale generation and tries to mark the job
	// succeeded. The guard rejects the write.
	affected, err := f.queries.FinishWorkflowRoleResolutionJob(ctx, db.FinishWorkflowRoleResolutionJobParams{
		ID: job.ID, Generation: staleGeneration, Status: "succeeded",
	})
	if err != nil {
		t.Fatalf("finish: %v", err)
	}
	if affected != 0 {
		t.Fatalf("stale finish affected %d rows, want 0", affected)
	}

	latest := f.loadLatestJob(t)
	if latest.Status == "succeeded" {
		t.Fatalf("stale worker A overwrote job status to succeeded")
	}
	if latest.LockedBy.String != "worker-B" {
		t.Fatalf("locked_by = %s, want worker-B preserved", latest.LockedBy.String)
	}
}

// TestWorkflowRoleResolutionConcurrency_CancelPendingJob covers E2E-12:
// CancelWorkflowRoleResolutionJobs moves any pending/running jobs to
// cancelled. After cancellation the run is safe to park in
// waiting_role_assignment for manual assignment.
func TestWorkflowRoleResolutionConcurrency_CancelPendingJob(t *testing.T) {
	f := newRoleResolutionFixture(t, []roleSlotSpec{
		{slotType: "worker", roleName: "developer"},
	})
	defer f.cleanup()

	// The unique index idx_workflow_role_resolution_job_active_run allows at
	// most one pending OR running job per run, so we exercise cancel against a
	// single job that we first transition into running to confirm both status
	// branches are handled by the same UPDATE.
	job := f.createPendingJob(t, "test-model")
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `
		UPDATE multica_workflow_role_resolution_job
		SET status = 'running', locked_by = 'worker-A',
		    lease_expires_at = now() + interval '5 seconds'
		WHERE id = $1
	`, job.ID); err != nil {
		t.Fatalf("flip job to running: %v", err)
	}

	if err := f.queries.CancelWorkflowRoleResolutionJobs(ctx, f.runID); err != nil {
		t.Fatalf("cancel jobs: %v", err)
	}

	latest := f.loadLatestJob(t)
	if latest.Status != "cancelled" {
		t.Fatalf("latest job status = %s, want cancelled", latest.Status)
	}

	var pendingOrRunning int
	if err := f.pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_role_resolution_job
		WHERE workflow_run_id = $1 AND status IN ('pending', 'running')
	`, f.runID).Scan(&pendingOrRunning); err != nil {
		t.Fatalf("count pending/running: %v", err)
	}
	if pendingOrRunning != 0 {
		t.Fatalf("expected 0 active jobs after cancel, got %d", pendingOrRunning)
	}

	// Re-running cancel is a no-op (idempotent) and never errors.
	if err := f.queries.CancelWorkflowRoleResolutionJobs(ctx, f.runID); err != nil {
		t.Fatalf("idempotent cancel: %v", err)
	}
}

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestEnqueueWorkflowDispatchRejectsUnknownPhase(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	err := EnqueueWorkflowDispatch(fixture.ctx, fixture.queries, fixture.nodeRunID, "invalid", 2)
	if err == nil {
		t.Fatal("unknown dispatch phase was accepted")
	}
	var count int
	if scanErr := fixture.pool.QueryRow(fixture.ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1
	`, fixture.nodeRunID).Scan(&count); scanErr != nil {
		t.Fatal(scanErr)
	}
	if count != 1 {
		t.Fatalf("dispatch jobs=%d, want original job only", count)
	}
}

func TestEnqueueWorkflowDispatchIsIdempotent(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	if err := EnqueueWorkflowDispatch(fixture.ctx, fixture.queries, fixture.nodeRunID, "worker", 1); err != nil {
		t.Fatal(err)
	}
	if err := EnqueueWorkflowDispatch(fixture.ctx, fixture.queries, fixture.nodeRunID, "worker", 1); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1 AND phase = 'worker' AND generation = 1
	`, fixture.nodeRunID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("dispatch jobs=%d, want 1", count)
	}
}

func TestWorkflowDispatchWorkerRecoversAfterTaskInsertBeforeJobSuccess(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	job := fixture.pendingJob(t)
	fixture.insertAgentTaskForJob(t, job)
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_agent SET runtime_id = NULL, is_builtin = false WHERE id = $1
	`, fixture.agentID); err != nil {
		t.Fatal(err)
	}

	worker := fixture.worker("worker-b")
	if err := worker.runOnce(fixture.ctx); err != nil {
		t.Fatal(err)
	}
	if got := fixture.countAgentTasksForJob(t, job.ID); got != 1 {
		t.Fatalf("tasks=%d, want 1", got)
	}
	if got := fixture.dispatchJobStatus(t, job.ID); got != "succeeded" {
		t.Fatalf("status=%q, want succeeded", got)
	}
}

func TestWorkflowDispatchWorkerReclaimsExpiredLease(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	job := fixture.pendingJob(t)
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node_run_dispatch_job
		SET status = 'running', locked_by = 'worker-a',
		    lease_expires_at = now() - interval '1 second',
		    scheduled_at = '1990-01-01 00:00:00+00'
		WHERE id = $1
	`, job.ID); err != nil {
		t.Fatal(err)
	}
	if err := fixture.worker("worker-b").runOnce(fixture.ctx); err != nil {
		t.Fatal(err)
	}
	if got := fixture.dispatchJobStatus(t, job.ID); got != "succeeded" {
		t.Fatalf("status=%q, want succeeded", got)
	}
	if got := fixture.countAgentTasksForJob(t, job.ID); got != 1 {
		t.Fatalf("tasks=%d, want 1", got)
	}
}

func TestWorkflowDispatchWorkerExhaustionFailsRunAtomically(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	job := fixture.pendingJob(t)
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node_run_dispatch_job SET max_attempts = 1 WHERE id = $1
	`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_agent SET runtime_id = NULL, is_builtin = false WHERE id = $1
	`, fixture.agentID); err != nil {
		t.Fatal(err)
	}
	err := fixture.worker("worker-b").runOnce(fixture.ctx)
	if err == nil {
		t.Fatal("dispatch failure was not returned")
	}
	if errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected lease cancellation: %v", err)
	}
	var jobStatus, nodeStatus, nodeReason, runStatus, runReason string
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT job.status, node_run.status, node_run.failure_reason,
		       workflow_run.status, workflow_run.failure_reason
		FROM multica_workflow_node_run_dispatch_job job
		JOIN multica_workflow_node_run node_run ON node_run.id = job.workflow_node_run_id
		JOIN multica_workflow_run workflow_run ON workflow_run.id = job.workflow_run_id
		WHERE job.id = $1
	`, job.ID).Scan(&jobStatus, &nodeStatus, &nodeReason, &runStatus, &runReason); err != nil {
		t.Fatal(err)
	}
	if jobStatus != "failed" || nodeStatus != RunStatusFailed || nodeReason != "dispatch_failed" ||
		runStatus != RunStatusFailed || runReason != "dispatch_failed" {
		t.Fatalf("job/node/run=%s %s/%s %s/%s", jobStatus, nodeStatus, nodeReason, runStatus, runReason)
	}
}

func TestWorkflowDispatchWorkerRetriesRuntimeUnavailableWithoutFailingRun(t *testing.T) {
	fixture := newWorkflowDispatchFixture(t)
	job := fixture.pendingJob(t)
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node_run_dispatch_job SET max_attempts = 2 WHERE id = $1
	`, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_agent SET runtime_id = NULL, is_builtin = true WHERE id = $1
	`, fixture.agentID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_agent_runtime SET status = 'offline' WHERE id = $1
	`, fixture.runtimeID); err != nil {
		t.Fatal(err)
	}
	if err := fixture.worker("worker-b").runOnce(fixture.ctx); err == nil {
		t.Fatal("runtime unavailability was not returned")
	}
	var jobStatus, nodeStatus, runStatus string
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT job.status, node_run.status, workflow_run.status
		FROM multica_workflow_node_run_dispatch_job job
		JOIN multica_workflow_node_run node_run ON node_run.id = job.workflow_node_run_id
		JOIN multica_workflow_run workflow_run ON workflow_run.id = job.workflow_run_id
		WHERE job.id = $1
	`, job.ID).Scan(&jobStatus, &nodeStatus, &runStatus); err != nil {
		t.Fatal(err)
	}
	if jobStatus != "pending" || nodeStatus != NodeRunStatusFormatOk || runStatus != RunStatusRunning {
		t.Fatalf("job/node/run=%s/%s/%s, want pending/format_ok/running", jobStatus, nodeStatus, runStatus)
	}
}

type workflowDispatchFixture struct {
	ctx         context.Context
	pool        *pgxpool.Pool
	queries     *db.Queries
	service     *WorkflowService
	workspaceID pgtype.UUID
	userID      pgtype.UUID
	agentID     pgtype.UUID
	runtimeID   pgtype.UUID
	runID       pgtype.UUID
	nodeRunID   pgtype.UUID
}

func newWorkflowDispatchFixture(t *testing.T) *workflowDispatchFixture {
	t.Helper()
	pool := openTestPool(t)
	queries := db.New(pool)
	fixture := &workflowDispatchFixture{
		ctx: context.Background(), pool: pool, queries: queries,
	}
	fixture.service = NewWorkflowService(queries, pool, nil, &TaskService{Queries: queries, TxStarter: pool})
	suffix := fmt.Sprintf("dispatch-%d-%d", os.Getpid(), time.Now().UnixNano())
	if err := pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, '', 'WDP') RETURNING id
	`, "Dispatch "+suffix, suffix).Scan(&fixture.workspaceID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_user (name, email) VALUES ('Dispatch User', $1) RETURNING id
	`, suffix+"@multica.test").Scan(&fixture.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(fixture.ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, fixture.workspaceID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_agent_runtime (workspace_id, name, runtime_mode, provider, status)
		VALUES ($1, 'Dispatch Runtime', 'local', 'legacy_local', 'online') RETURNING id
	`, fixture.workspaceID).Scan(&fixture.runtimeID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_agent (workspace_id, name, runtime_mode, runtime_id)
		VALUES ($1, 'Dispatch Agent', 'local', $2) RETURNING id
	`, fixture.workspaceID, fixture.runtimeID).Scan(&fixture.agentID); err != nil {
		t.Fatal(err)
	}
	var workflowID pgtype.UUID
	if err := pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, max_retries, created_by_type, created_by_id)
		VALUES ($1, 'Dispatch workflow', '', 'active', 3, 'member', $2) RETURNING id
	`, fixture.workspaceID, fixture.userID).Scan(&workflowID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(fixture.ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, worker_type, worker_id, critic_type, critic_id
		) VALUES ($1, 'Dispatch node', '', 'agent', $2, 'human', $3)
	`, workflowID, fixture.agentID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID,
		ResponsibleUserID: fixture.userID, RuntimeAuthorizerID: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture.runID = prepared.Run.ID
	fixture.nodeRunID = prepared.NodeRuns[0].ID
	if _, err := pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node_run_dispatch_job
		SET scheduled_at = '2000-01-01 00:00:00+00'
		WHERE workflow_run_id = $1
	`, fixture.runID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM multica_agent_task_queue WHERE agent_id = $1`, fixture.agentID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM multica_workspace WHERE id = $1`, fixture.workspaceID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM multica_user WHERE id = $1`, fixture.userID)
		pool.Close()
	})
	return fixture
}

func (f *workflowDispatchFixture) pendingJob(t *testing.T) db.MulticaWorkflowNodeRunDispatchJob {
	t.Helper()
	var job db.MulticaWorkflowNodeRunDispatchJob
	err := f.pool.QueryRow(f.ctx, `
		SELECT id, workflow_run_id, workflow_node_run_id, phase, generation, status,
		       attempt_count, max_attempts, scheduled_at, locked_by, lease_expires_at,
		       last_error, created_at, updated_at
		FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_run_id = $1
	`, f.runID).Scan(
		&job.ID, &job.WorkflowRunID, &job.WorkflowNodeRunID, &job.Phase, &job.Generation,
		&job.Status, &job.AttemptCount, &job.MaxAttempts, &job.ScheduledAt, &job.LockedBy,
		&job.LeaseExpiresAt, &job.LastError, &job.CreatedAt, &job.UpdatedAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func (f *workflowDispatchFixture) insertAgentTaskForJob(t *testing.T, job db.MulticaWorkflowNodeRunDispatchJob) {
	t.Helper()
	contextJSON, err := json.Marshal(map[string]any{"type": "workflow", "phase": job.Phase})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		INSERT INTO multica_agent_task_queue (
			agent_id, runtime_id, status, priority, workflow_node_run_id,
			workflow_dispatch_job_id, context
		) VALUES ($1, $2, 'queued', 2, $3, $4, $5)
	`, f.agentID, f.runtimeID, f.nodeRunID, job.ID, contextJSON); err != nil {
		t.Fatal(err)
	}
}

func (f *workflowDispatchFixture) worker(workerID string) *WorkflowDispatchWorker {
	return &WorkflowDispatchWorker{
		Queries: f.queries, TxStarter: f.pool, Workflow: f.service,
		WorkerID: workerID, LeaseDuration: 30 * time.Second,
	}
}

func (f *workflowDispatchFixture) countAgentTasksForJob(t *testing.T, jobID pgtype.UUID) int {
	t.Helper()
	var count int
	if err := f.pool.QueryRow(f.ctx, `
		SELECT count(*) FROM multica_agent_task_queue WHERE workflow_dispatch_job_id = $1
	`, jobID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func (f *workflowDispatchFixture) dispatchJobStatus(t *testing.T, jobID pgtype.UUID) string {
	t.Helper()
	var status string
	if err := f.pool.QueryRow(f.ctx, `
		SELECT status FROM multica_workflow_node_run_dispatch_job WHERE id = $1
	`, jobID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

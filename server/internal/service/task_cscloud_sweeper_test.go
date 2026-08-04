package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type fakeCSCloudPush struct {
	statusCode int32
	err        error
	calls      int32
}

func (f *fakeCSCloudPush) Enabled() bool { return true }

func (f *fakeCSCloudPush) Do(_ context.Context, _ cloudruntime.Request) (*cloudruntime.Response, error) {
	atomic.AddInt32(&f.calls, 1)
	if f.err != nil {
		return nil, f.err
	}
	return &cloudruntime.Response{StatusCode: int(f.statusCode)}, nil
}

// setupCSCloudSweeperFixture creates a running cs-cloud workflow task with the
// given CSC session_id binding, started 5 minutes ago so it clears the probe's
// min-running threshold. Returns the task and node-run ids.
func setupCSCloudSweeperFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, taskSessionID string) (taskID, nodeRunID pgtype.UUID) {
	t.Helper()
	q := db.New(pool)
	wfSvc := NewWorkflowService(q, pool, events.New(), nil)
	suffix := fmt.Sprintf("wf-sw-%d-%d", os.Getpid(), time.Now().UnixNano())

	// Clean slate: the sweeper queries running cs-cloud tasks globally, so
	// leftover rows from a prior test run would inflate candidate counts and
	// corrupt probe-call assertions. Tests run serially within this package.
	_, _ = pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE status='running' AND runtime_id IN (SELECT id FROM multica_agent_runtime WHERE provider='cs-cloud')`)

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'sweeper test workspace', 'WFSW')
		RETURNING id
	`, "Sweeper Workspace "+suffix, "wf-sw-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		// Delete in FK-safe order. The sweeper queries tasks across the whole
		// DB (not per-workspace), so leftover running tasks from one test would
		// bleed into the next tick and corrupt probe-call assertions.
		_, _ = pool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE agent_id IN (SELECT id FROM multica_agent WHERE workspace_id = $1)`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_agent WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
	})

	workspaceUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		t.Fatalf("parse workspace id: %v", err)
	}

	var workflowID, nodeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries, created_by_type, created_by_id
		)
		VALUES ($1, 'Sweeper Run', 'sweeper run', 'active', 0, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Do work', '', 0, 0, '{}'::jsonb, 'human', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("create node: %v", err)
	}

	workflowUUID, err := util.ParseUUID(workflowID)
	if err != nil {
		t.Fatalf("parse workflow id: %v", err)
	}
	run, err := wfSvc.StartRun(ctx, db.MulticaWorkflow{
		ID: workflowUUID, WorkspaceID: workspaceUUID, Title: "Sweeper Run", Status: "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	nodeUUID, err := util.ParseUUID(nodeID)
	if err != nil {
		t.Fatalf("parse node id: %v", err)
	}
	nodeRun, err := q.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
		WorkflowRunID: run.ID, WorkflowNodeID: nodeUUID,
	})
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE multica_workflow_node_run SET status = 'working' WHERE id = $1`, nodeRun.ID); err != nil {
		t.Fatalf("set node run working: %v", err)
	}

	// cs-cloud runtime with a device_id in metadata (csCloudDeviceID reads it).
	var runtimeID, agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata
		)
		VALUES ($1, 'dev-sw-1', 'test-runtime', 'cloud', 'cs-cloud', 'online', '', '{"device_id":"dev-sw-1"}')
		RETURNING id
	`, workspaceID).Scan(&runtimeID); err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (
			workspace_id, name, runtime_mode, visibility, status, runtime_id
		)
		VALUES ($1, 'test-agent', 'cloud', 'private', 'idle', $2)
		RETURNING id
	`, workspaceID, runtimeID).Scan(&agentID); err != nil {
		t.Fatalf("create agent: %v", err)
	}

	agentUUID, err := util.ParseUUID(agentID)
	if err != nil {
		t.Fatalf("parse agent id: %v", err)
	}
	runtimeUUID, err := util.ParseUUID(runtimeID)
	if err != nil {
		t.Fatalf("parse runtime id: %v", err)
	}
	contextJSON, err := json.Marshal(map[string]any{"phase": "worker"})
	if err != nil {
		t.Fatalf("marshal context: %v", err)
	}

	var sessionArg any
	if taskSessionID != "" {
		sessionArg = taskSessionID
	}
	var taskIDStr string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_task_queue (
			agent_id, runtime_id, status, priority,
			workflow_node_run_id, context, session_id, started_at, attempt, max_attempts
		)
		VALUES ($1, $2, 'running', 2, $3, $4, $5, now() - interval '5 minutes', 1, 3)
		RETURNING id
	`, agentUUID, runtimeUUID, nodeRun.ID, contextJSON, sessionArg).Scan(&taskIDStr); err != nil {
		t.Fatalf("create running task: %v", err)
	}
	taskID, err = util.ParseUUID(taskIDStr)
	if err != nil {
		t.Fatalf("parse task id: %v", err)
	}
	nodeRunID = nodeRun.ID
	return taskID, nodeRunID
}

func countDispatchJobs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, nodeRunID pgtype.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job WHERE workflow_node_run_id = $1
	`, nodeRunID).Scan(&n); err != nil {
		t.Fatalf("count dispatch jobs: %v", err)
	}
	return n
}

// TestSweepStaleWorkflowTaskSessions_SessionGone: device reports 404 for the
// CSC session -> task is failed with failure_reason='timeout' and a retry
// dispatch job is enqueued.
func TestSweepStaleWorkflowTaskSessions_SessionGone(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	q := db.New(pool)
	push := &fakeCSCloudPush{statusCode: 404}
	taskSvc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New(), CSCloudPush: push}

	taskID, nodeRunID := setupCSCloudSweeperFixture(t, ctx, pool, "sess-gone")
	baseline := countDispatchJobs(t, ctx, pool, nodeRunID)

	taskSvc.SweepStaleWorkflowTaskSessions(ctx)

	task, err := q.GetAgentTask(ctx, taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "failed" {
		t.Fatalf("task status = %s, want failed", task.Status)
	}
	if !task.FailureReason.Valid || task.FailureReason.String != "timeout" {
		t.Fatalf("failure reason = %q, want timeout", task.FailureReason.String)
	}
	if after := countDispatchJobs(t, ctx, pool, nodeRunID); after <= baseline {
		t.Fatalf("expected a new dispatch job after retry, baseline=%d after=%d", baseline, after)
	}
	if push.calls != 1 {
		t.Fatalf("expected 1 probe call, got %d", push.calls)
	}
}

// TestSweepStaleWorkflowTaskSessions_SessionAlive: device reports 200 -> the
// task is left running and no probe side effect occurs.
func TestSweepStaleWorkflowTaskSessions_SessionAlive(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	q := db.New(pool)
	push := &fakeCSCloudPush{statusCode: 200}
	taskSvc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New(), CSCloudPush: push}

	taskID, _ := setupCSCloudSweeperFixture(t, ctx, pool, "sess-alive")

	taskSvc.SweepStaleWorkflowTaskSessions(ctx)

	task, err := q.GetAgentTask(ctx, taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "running" {
		t.Fatalf("task status = %s, want running (session alive)", task.Status)
	}
	if push.calls != 1 {
		t.Fatalf("expected 1 probe call, got %d", push.calls)
	}
}

// TestSweepStaleWorkflowTaskSessions_NoSessionID: a task with no session
// binding (cs-cloud never reported one) is skipped - no probe, task stays
// running. The 2.5h sweepStaleTasks remains the backstop for this task.
func TestSweepStaleWorkflowTaskSessions_NoSessionID(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	q := db.New(pool)
	push := &fakeCSCloudPush{statusCode: 404}
	taskSvc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New(), CSCloudPush: push}

	taskID, _ := setupCSCloudSweeperFixture(t, ctx, pool, "")

	taskSvc.SweepStaleWorkflowTaskSessions(ctx)

	task, err := q.GetAgentTask(ctx, taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "running" {
		t.Fatalf("task status = %s, want running (no session to probe)", task.Status)
	}
	if push.calls != 0 {
		t.Fatalf("expected 0 probe calls for session-less task, got %d", push.calls)
	}
}

// TestSweepStaleWorkflowTaskSessions_ProbeError: a transport error is
// inconclusive -> task is left running (never fail on an inconclusive probe).
func TestSweepStaleWorkflowTaskSessions_ProbeError(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	q := db.New(pool)
	push := &fakeCSCloudPush{err: errors.New("gateway unreachable")}
	taskSvc := &TaskService{Queries: q, TxStarter: pool, Bus: events.New(), CSCloudPush: push}

	taskID, _ := setupCSCloudSweeperFixture(t, ctx, pool, "sess-err")

	taskSvc.SweepStaleWorkflowTaskSessions(ctx)

	task, err := q.GetAgentTask(ctx, taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "running" {
		t.Fatalf("task status = %s, want running (probe error is inconclusive)", task.Status)
	}
	if push.calls != 1 {
		t.Fatalf("expected 1 probe call, got %d", push.calls)
	}
}

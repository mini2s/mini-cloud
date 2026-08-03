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
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// TestHandleWorkflowTaskFailure verifies that when a workflow-bound agent task
// fails, the linked node run transitions from working to failed and the
// workflow run is marked failed.
func TestHandleWorkflowTaskFailure(t *testing.T) {
	pool := openTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	q := db.New(pool)
	svc := NewWorkflowService(q, pool, events.New(), nil)

	suffix := fmt.Sprintf("wf-fail-%d", os.Getpid())

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'workflow failure test workspace', 'WFAIL')
		RETURNING id
	`, "Workflow Failure Workspace "+suffix, "wf-fail-"+suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
	})

	workspaceUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		t.Fatalf("parse workspace id: %v", err)
	}

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries, created_by_type, created_by_id
		)
		VALUES ($1, 'Failure Run', 'failure run', 'active', 0, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	var nodeID, downstreamNodeID string
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
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Do downstream work', '', 100, 0, '{}'::jsonb, 'human', 'human', 1)
		RETURNING id
	`, workflowID).Scan(&downstreamNodeID); err != nil {
		t.Fatalf("create downstream node: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
		VALUES ($1, $2, $3)
	`, workflowID, nodeID, downstreamNodeID); err != nil {
		t.Fatalf("create workflow edge: %v", err)
	}

	workflowUUID, err := util.ParseUUID(workflowID)
	if err != nil {
		t.Fatalf("parse workflow id: %v", err)
	}
	run, err := svc.StartRun(ctx, db.MulticaWorkflow{
		ID:          workflowUUID,
		WorkspaceID: workspaceUUID,
		Title:       "Failure Run",
		Status:      "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	nodeUUID, err := util.ParseUUID(nodeID)
	if err != nil {
		t.Fatalf("parse node id: %v", err)
	}
	nodeRun, err := q.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
		WorkflowRunID:  run.ID,
		WorkflowNodeID: nodeUUID,
	})
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	downstreamNodeUUID, err := util.ParseUUID(downstreamNodeID)
	if err != nil {
		t.Fatalf("parse downstream node id: %v", err)
	}
	downstreamNodeRun, err := q.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
		WorkflowRunID:  run.ID,
		WorkflowNodeID: downstreamNodeUUID,
	})
	if err != nil {
		t.Fatalf("get downstream node run: %v", err)
	}

	// Put the node run into the working phase as if dispatchWorker had run.
	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET status = 'working' WHERE id = $1
	`, nodeRun.ID); err != nil {
		t.Fatalf("set node run working: %v", err)
	}

	// Runtime and agent backing the failed task.
	var runtimeID, agentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata
		)
		VALUES ($1, 'dev-1', 'test-runtime', 'local', 'test', 'online', '', '{}')
		RETURNING id
	`, workspaceID).Scan(&runtimeID); err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent (
			workspace_id, name, runtime_mode, visibility, status, runtime_id
		)
		VALUES ($1, 'test-agent', 'local', 'private', 'idle', $2)
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
	var taskID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_agent_task_queue (
			agent_id, runtime_id, status, priority,
			workflow_node_run_id, context, error, attempt, max_attempts
		)
		VALUES ($1, $2, 'failed', 2, $3, $4, 'context canceled', 1, 3)
		RETURNING id
	`, agentUUID, runtimeUUID, nodeRun.ID, contextJSON).Scan(&taskID); err != nil {
		t.Fatalf("create failed task: %v", err)
	}
	taskUUID, err := util.ParseUUID(taskID)
	if err != nil {
		t.Fatalf("parse task id: %v", err)
	}
	task, err := q.GetAgentTask(ctx, taskUUID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}

	nodeStatusUpdates := make(map[string]int)
	runTerminalCount := 0
	svc.OnNodeStatusChanged = func(_ context.Context, nodeRun db.MulticaWorkflowNodeRun) {
		nodeStatusUpdates[nodeRun.Status]++
	}
	svc.OnRunTerminal = func(_ context.Context, _ db.MulticaWorkflowRun, status string) {
		if status == RunStatusFailed {
			runTerminalCount++
		}
	}

	if err := svc.HandleWorkflowTaskFailure(ctx, task); err != nil {
		t.Fatalf("HandleWorkflowTaskFailure: %v", err)
	}
	if err := svc.HandleWorkflowTaskFailure(ctx, task); err != nil {
		t.Fatalf("repeat HandleWorkflowTaskFailure: %v", err)
	}

	nr, err := q.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		t.Fatalf("get node run after failure: %v", err)
	}
	if nr.Status != NodeRunStatusFailed {
		t.Fatalf("node run status after failure = %s, want %s", nr.Status, NodeRunStatusFailed)
	}
	if !nr.FailureReason.Valid || nr.FailureReason.String != "agent_error" {
		t.Fatalf("node run failure reason = %q, want agent_error", nr.FailureReason.String)
	}

	downstreamAfter, err := q.GetWorkflowNodeRun(ctx, downstreamNodeRun.ID)
	if err != nil {
		t.Fatalf("get downstream node run after failure: %v", err)
	}
	if downstreamAfter.Status != NodeRunStatusCancelled {
		t.Fatalf("downstream node run status after failure = %s, want %s", downstreamAfter.Status, NodeRunStatusCancelled)
	}
	if downstreamAfter.StartedAt.Valid {
		t.Fatalf("downstream node run started at %s, want not started", downstreamAfter.StartedAt.Time)
	}
	if !downstreamAfter.FailureReason.Valid || downstreamAfter.FailureReason.String != "workflow_failed" {
		t.Fatalf("downstream failure reason = %q, want workflow_failed", downstreamAfter.FailureReason.String)
	}

	var downstreamTaskCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM multica_agent_task_queue
		WHERE workflow_node_run_id = $1
	`, downstreamNodeRun.ID).Scan(&downstreamTaskCount); err != nil {
		t.Fatalf("count downstream tasks: %v", err)
	}
	if downstreamTaskCount != 0 {
		t.Fatalf("downstream task count after failure = %d, want 0", downstreamTaskCount)
	}
	if nodeStatusUpdates[NodeRunStatusFailed] != 1 {
		t.Fatalf("failed node status callbacks = %d, want 1", nodeStatusUpdates[NodeRunStatusFailed])
	}
	if nodeStatusUpdates[NodeRunStatusCancelled] != 1 {
		t.Fatalf("cancelled node status callbacks = %d, want 1", nodeStatusUpdates[NodeRunStatusCancelled])
	}
	if runTerminalCount != 1 {
		t.Fatalf("failed run terminal callbacks = %d, want 1", runTerminalCount)
	}

	runAfter, err := q.GetWorkflowRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("get run after failure: %v", err)
	}
	if runAfter.Status != RunStatusFailed {
		t.Fatalf("run status after failure = %s, want %s", runAfter.Status, RunStatusFailed)
	}
}

func TestFinalizeNodeRunFailureStopsDownstream(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 2, [][2]int{{0, 1}})

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'blocked', started_at = now()
		WHERE id = $1
	`, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("set source node blocked: %v", err)
	}
	source, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[0].ID)
	if err != nil {
		t.Fatalf("get blocked source node: %v", err)
	}

	if _, err := fx.service.FinalizeNodeRun(fx.ctx, source, NodeRunStatusFailed); err != nil {
		t.Fatalf("FinalizeNodeRun: %v", err)
	}

	assertFailedRunStopsNodes(t, fx, 0, NodeRunStatusFailed)
}

func TestFormatFailureStopsDownstream(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 2, [][2]int{{0, 1}})

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'format_checking', started_at = now()
		WHERE id = $1
	`, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("set source node format checking: %v", err)
	}
	source, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[0].ID)
	if err != nil {
		t.Fatalf("get format-checking source node: %v", err)
	}

	if _, err := fx.service.TransitionNodeRun(fx.ctx, source, NodeRunStatusFormatFailed); err != nil {
		t.Fatalf("TransitionNodeRun: %v", err)
	}

	assertFailedRunStopsNodes(t, fx, 0, NodeRunStatusFormatFailed)
}

func TestWorkflowFailureCancelsTransitiveDescendants(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 3, [][2]int{{0, 1}, {1, 2}})

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'working', started_at = now()
		WHERE id = $1
	`, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("set source node working: %v", err)
	}
	source, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[0].ID)
	if err != nil {
		t.Fatalf("get working source node: %v", err)
	}

	if _, err := fx.service.TransitionNodeRun(fx.ctx, source, NodeRunStatusFailed); err != nil {
		t.Fatalf("TransitionNodeRun: %v", err)
	}

	assertFailedRunStopsNodes(t, fx, 0, NodeRunStatusFailed)
}

func TestWorkflowFailureCancelsParallelBranchesAndTasks(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 5, [][2]int{{0, 2}, {1, 3}, {2, 4}, {3, 4}})

	for _, nodeRun := range fx.nodeRuns[:2] {
		if _, err := fx.pool.Exec(fx.ctx, `
			UPDATE multica_workflow_node_run
			SET status = 'working', started_at = now()
			WHERE id = $1
		`, nodeRun.ID); err != nil {
			t.Fatalf("set root node working: %v", err)
		}
	}

	var runtimeID, agentID string
	if err := fx.pool.QueryRow(fx.ctx, `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata
		)
		VALUES ($1, 'parallel-dev', 'parallel-runtime', 'local', 'test', 'online', '', '{}')
		RETURNING id
	`, fx.run.WorkspaceID).Scan(&runtimeID); err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	if err := fx.pool.QueryRow(fx.ctx, `
		INSERT INTO multica_agent (
			workspace_id, name, runtime_mode, visibility, status, runtime_id
		)
		VALUES ($1, 'parallel-agent', 'local', 'private', 'working', $2)
		RETURNING id
	`, fx.run.WorkspaceID, runtimeID).Scan(&agentID); err != nil {
		t.Fatalf("create agent: %v", err)
	}

	var taskID string
	if err := fx.pool.QueryRow(fx.ctx, `
		INSERT INTO multica_agent_task_queue (
			agent_id, runtime_id, status, priority, workflow_node_run_id,
			context, attempt, max_attempts
		)
		VALUES ($1, $2, 'running', 2, $3, '{"phase":"worker"}'::jsonb, 1, 3)
		RETURNING id
	`, agentID, runtimeID, fx.nodeRuns[1].ID).Scan(&taskID); err != nil {
		t.Fatalf("create parallel task: %v", err)
	}

	source, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[0].ID)
	if err != nil {
		t.Fatalf("get failed branch source: %v", err)
	}
	if _, err := fx.service.TransitionNodeRun(fx.ctx, source, NodeRunStatusFailed); err != nil {
		t.Fatalf("TransitionNodeRun: %v", err)
	}

	assertFailedRunStopsNodes(t, fx, 0, NodeRunStatusFailed)

	var taskStatus string
	var taskFailureReason *string
	if err := fx.pool.QueryRow(fx.ctx, `
		SELECT status, failure_reason
		FROM multica_agent_task_queue
		WHERE id = $1
	`, taskID).Scan(&taskStatus, &taskFailureReason); err != nil {
		t.Fatalf("get parallel task after failure: %v", err)
	}
	if taskStatus != "cancelled" {
		t.Fatalf("parallel task status after failure = %s, want cancelled", taskStatus)
	}
	if taskFailureReason == nil || *taskFailureReason != "workflow_failed" {
		t.Fatalf("parallel task failure reason = %v, want workflow_failed", taskFailureReason)
	}
}

func TestOnNodeRunCompletedDoesNotPropagateFailure(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 2, [][2]int{{0, 1}})

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'failed', completed_at = now()
		WHERE id = $1
	`, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("set source node failed: %v", err)
	}

	if err := fx.service.OnNodeRunCompleted(fx.ctx, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("OnNodeRunCompleted: %v", err)
	}

	downstream, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[1].ID)
	if err != nil {
		t.Fatalf("get downstream node run: %v", err)
	}
	if downstream.Status != NodeRunStatusPending {
		t.Fatalf("downstream node run status = %s, want %s", downstream.Status, NodeRunStatusPending)
	}
	if downstream.StartedAt.Valid {
		t.Fatalf("downstream node run started at %s, want not started", downstream.StartedAt.Time)
	}
}

func TestJoinDoesNotRunWhenAnyRequiredUpstreamFailed(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 3, [][2]int{{0, 2}, {1, 2}})

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = CASE id
			WHEN $1 THEN 'completed'
			WHEN $2 THEN 'failed'
		END,
		completed_at = now()
		WHERE id IN ($1, $2)
	`, fx.nodeRuns[0].ID, fx.nodeRuns[1].ID); err != nil {
		t.Fatalf("set join upstream statuses: %v", err)
	}

	if err := fx.service.OnNodeRunCompleted(fx.ctx, fx.nodeRuns[0].ID); err != nil {
		t.Fatalf("OnNodeRunCompleted: %v", err)
	}

	join, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[2].ID)
	if err != nil {
		t.Fatalf("get join node run: %v", err)
	}
	if join.Status != NodeRunStatusPending {
		t.Fatalf("join node run status = %s, want %s", join.Status, NodeRunStatusPending)
	}
	if join.StartedAt.Valid {
		t.Fatalf("join node run started at %s, want not started", join.StartedAt.Time)
	}
}

func TestLateDispatchTransitionCannotResurrectCancelledNode(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 2, nil)

	if _, err := fx.pool.Exec(fx.ctx, `
		UPDATE multica_workflow_node_run
		SET status = CASE id
			WHEN $1 THEN 'working'
			WHEN $2 THEN 'format_ok'
		END,
		started_at = now()
		WHERE id IN ($1, $2)
	`, fx.nodeRuns[0].ID, fx.nodeRuns[1].ID); err != nil {
		t.Fatalf("set concurrent node statuses: %v", err)
	}
	source, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[0].ID)
	if err != nil {
		t.Fatalf("get failing node: %v", err)
	}
	if _, err := fx.service.TransitionNodeRun(fx.ctx, source, NodeRunStatusFailed); err != nil {
		t.Fatalf("TransitionNodeRun: %v", err)
	}

	err = fx.service.transitionNodeRunAfterDispatch(fx.ctx, fx.nodeRuns[1].ID, NodeRunStatusWorking)
	if !errors.Is(err, ErrWorkflowRunNotRunning) {
		t.Fatalf("late dispatch transition error = %v, want %v", err, ErrWorkflowRunNotRunning)
	}
	lateNode, err := fx.queries.GetWorkflowNodeRun(fx.ctx, fx.nodeRuns[1].ID)
	if err != nil {
		t.Fatalf("get late-dispatch node: %v", err)
	}
	if lateNode.Status != NodeRunStatusCancelled {
		t.Fatalf("late-dispatch node status = %s, want %s", lateNode.Status, NodeRunStatusCancelled)
	}
}

type workflowFailureGraphFixture struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	queries  *db.Queries
	service  *WorkflowService
	run      db.MulticaWorkflowRun
	nodeRuns []db.MulticaWorkflowNodeRun
}

func setupWorkflowFailureGraph(t *testing.T, nodeCount int, edges [][2]int) workflowFailureGraphFixture {
	t.Helper()

	pool := openTestPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	queries := db.New(pool)
	service := NewWorkflowService(queries, pool, events.New(), nil)
	suffix := fmt.Sprintf("wf-fail-graph-%d-%d", os.Getpid(), time.Now().UnixNano())

	var workspaceID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ($1, $2, 'workflow failure graph test workspace', 'WFG')
		RETURNING id
	`, "Workflow Failure Graph "+suffix, suffix).Scan(&workspaceID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workflow WHERE workspace_id = $1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, workspaceID)
	})

	var workflowID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status, max_retries, created_by_type, created_by_id
		)
		VALUES ($1, 'Failure Graph', 'failure graph', 'active', 0, 'member', gen_random_uuid())
		RETURNING id
	`, workspaceID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}

	nodeIDs := make([]string, nodeCount)
	for i := range nodeCount {
		if err := pool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, description, position_x, position_y,
				format_schema, worker_type, critic_type, sort_order
			)
			VALUES ($1, $2, '', $3, 0, '{}'::jsonb, 'human', 'human', $4)
			RETURNING id
		`, workflowID, fmt.Sprintf("Node %d", i+1), i, i).Scan(&nodeIDs[i]); err != nil {
			t.Fatalf("create node %d: %v", i, err)
		}
	}
	for _, edge := range edges {
		if _, err := pool.Exec(ctx, `
			INSERT INTO multica_workflow_edge (workflow_id, source_node_id, target_node_id)
			VALUES ($1, $2, $3)
		`, workflowID, nodeIDs[edge[0]], nodeIDs[edge[1]]); err != nil {
			t.Fatalf("create edge %d -> %d: %v", edge[0], edge[1], err)
		}
	}

	workspaceUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		t.Fatalf("parse workspace id: %v", err)
	}
	workflowUUID, err := util.ParseUUID(workflowID)
	if err != nil {
		t.Fatalf("parse workflow id: %v", err)
	}
	run, err := service.StartRun(ctx, db.MulticaWorkflow{
		ID:          workflowUUID,
		WorkspaceID: workspaceUUID,
		Title:       "Failure Graph",
		Status:      "active",
	}, "member", "", json.RawMessage(`{}`), pgtype.UUID{})
	if err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'pending', started_at = NULL, completed_at = NULL
		WHERE workflow_run_id = $1
	`, run.ID); err != nil {
		t.Fatalf("reset node runs: %v", err)
	}
	nodeRuns := make([]db.MulticaWorkflowNodeRun, nodeCount)
	for i, nodeID := range nodeIDs {
		nodeUUID, err := util.ParseUUID(nodeID)
		if err != nil {
			t.Fatalf("parse node %d id: %v", i, err)
		}
		nodeRuns[i], err = queries.ListWorkflowNodeRunsByRunAndNode(ctx, db.ListWorkflowNodeRunsByRunAndNodeParams{
			WorkflowRunID:  run.ID,
			WorkflowNodeID: nodeUUID,
		})
		if err != nil {
			t.Fatalf("get node run %d: %v", i, err)
		}
	}

	return workflowFailureGraphFixture{
		ctx:      ctx,
		pool:     pool,
		queries:  queries,
		service:  service,
		run:      *run,
		nodeRuns: nodeRuns,
	}
}

func TestSplittingTransitionSetsStartedAt(t *testing.T) {
	fx := setupWorkflowFailureGraph(t, 1, nil)

	updated, err := fx.queries.UpdateWorkflowNodeRunStatus(fx.ctx, db.UpdateWorkflowNodeRunStatusParams{
		ID:     fx.nodeRuns[0].ID,
		Status: NodeRunStatusSplitting,
	})
	if err != nil {
		t.Fatalf("transition node run to splitting: %v", err)
	}
	if updated.Status != NodeRunStatusSplitting {
		t.Fatalf("node run status = %s, want %s", updated.Status, NodeRunStatusSplitting)
	}
	if !updated.StartedAt.Valid {
		t.Fatal("splitting node run started_at is null")
	}
}

func assertFailedRunStopsNodes(t *testing.T, fx workflowFailureGraphFixture, failedIndex int, failedStatus string) {
	t.Helper()

	for i, nodeRun := range fx.nodeRuns {
		latest, err := fx.queries.GetWorkflowNodeRun(fx.ctx, nodeRun.ID)
		if err != nil {
			t.Fatalf("get node run %d after failure: %v", i, err)
		}
		wantStatus := NodeRunStatusCancelled
		if i == failedIndex {
			wantStatus = failedStatus
		}
		if latest.Status != wantStatus {
			t.Fatalf("node run %d status after failure = %s, want %s", i, latest.Status, wantStatus)
		}
		if i != failedIndex && (!latest.FailureReason.Valid || latest.FailureReason.String != "workflow_failed") {
			t.Fatalf("node run %d failure reason = %q, want workflow_failed", i, latest.FailureReason.String)
		}
	}

	run, err := fx.queries.GetWorkflowRun(fx.ctx, fx.run.ID)
	if err != nil {
		t.Fatalf("get workflow run after failure: %v", err)
	}
	if run.Status != RunStatusFailed {
		t.Fatalf("workflow run status after failure = %s, want %s", run.Status, RunStatusFailed)
	}
}

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
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

	var nodeID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, position_x, position_y,
			format_schema, worker_type, critic_type, sort_order
		)
		VALUES ($1, 'Do work', '', 0, 0, '{}'::jsonb, 'agent', 'human', 0)
		RETURNING id
	`, workflowID).Scan(&nodeID); err != nil {
		t.Fatalf("create node: %v", err)
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

	if err := svc.HandleWorkflowTaskFailure(ctx, task); err != nil {
		t.Fatalf("HandleWorkflowTaskFailure: %v", err)
	}

	nr, err := q.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		t.Fatalf("get node run after failure: %v", err)
	}
	if nr.Status != NodeRunStatusFailed {
		t.Fatalf("node run status after failure = %s, want %s", nr.Status, NodeRunStatusFailed)
	}

	runAfter, err := q.GetWorkflowRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("get run after failure: %v", err)
	}
	if runAfter.Status != RunStatusFailed {
		t.Fatalf("run status after failure = %s, want %s", runAfter.Status, RunStatusFailed)
	}
}

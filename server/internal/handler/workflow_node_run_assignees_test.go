package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// seedNodeRunForAssigneeTest inserts a workflow + node + run + node_run with the
// given status and returns the node_run id. Worker/critic start unset so the
// test can patch them.
func seedNodeRunForAssigneeTest(t *testing.T, status string) string {
	t.Helper()
	ctx := context.Background()
	var wfID, nodeID, runID, nodeRunID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, 'assignee edit wf', 'active', 'member', $2)
		RETURNING id
	`, testWorkspaceID, testUserID).Scan(&wfID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (workflow_id, title, worker_type, critic_type, sort_order)
		VALUES ($1, 'assignee node', 'human', 'human', 0)
		RETURNING id
	`, wfID).Scan(&nodeID); err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id, input)
		VALUES ($1, $2, 'assignee run', 'running', 'member', $3, '{}'::jsonb)
		RETURNING id
	`, wfID, testWorkspaceID, testUserID).Scan(&runID); err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status,
			worker_type, critic_type, format_schema, runtime_config
		)
		VALUES ($1, $2, 'assignee node run', $3, 'human', 'human', '{}'::jsonb, '{}'::jsonb)
		RETURNING id
	`, runID, nodeID, status).Scan(&nodeRunID); err != nil {
		t.Fatalf("create node run: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_run WHERE id = $1`, nodeRunID)
		testPool.Exec(ctx, `DELETE FROM multica_workflow_run WHERE id = $1`, runID)
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node WHERE id = $1`, nodeID)
		testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID)
	})
	return nodeRunID
}

// TestUpdateNodeRunAssignees_Pending_UpdatesWorker verifies that a pending node
// run's worker can be edited and the change persists (dispatch reads this field
// when the node later transitions to worker_assigned).
func TestUpdateNodeRunAssignees_Pending_UpdatesWorker(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	nodeRunID := seedNodeRunForAssigneeTest(t, "pending")

	req := newRequest("PUT", "/api/node-runs/"+nodeRunID+"/assignees", map[string]any{
		"worker_type": "human",
		"worker_id":   testUserID,
	})
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "nodeRunId", nodeRunID)
	resp := httptest.NewRecorder()
	testHandler.UpdateNodeRunAssignees(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var workerID string
	if err := testPool.QueryRow(ctx, `SELECT worker_id::text FROM multica_workflow_node_run WHERE id = $1`, nodeRunID).Scan(&workerID); err != nil {
		t.Fatalf("query worker_id: %v", err)
	}
	if workerID != testUserID {
		t.Fatalf("expected worker_id %s, got %s", testUserID, workerID)
	}
}

// TestUpdateNodeRunAssignees_Working_RejectsWorker verifies the status guard:
// once a node run has reached 'working', the worker is locked and editing
// returns 409.
func TestUpdateNodeRunAssignees_Working_RejectsWorker(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	nodeRunID := seedNodeRunForAssigneeTest(t, "working")

	req := newRequest("PUT", "/api/node-runs/"+nodeRunID+"/assignees", map[string]any{
		"worker_type": "human",
		"worker_id":   testUserID,
	})
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "nodeRunId", nodeRunID)
	resp := httptest.NewRecorder()
	testHandler.UpdateNodeRunAssignees(resp, req)
	if resp.Code != http.StatusConflict {
		t.Fatalf("expected 409 (worker locked past editable window), got %d: %s", resp.Code, resp.Body.String())
	}
}

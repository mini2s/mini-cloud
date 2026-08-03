package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// builtinAgentID is the fixed seed UUID for the "任务拆解" built-in agent.
const builtinAgentID = "4348e20d-eadc-4095-ac7a-cd480e927375"

// TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress verifies that
// built-in agents can be pre-assigned while the issue is still planned, and
// only receive work after a member moves the issue to in_progress.
func TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not available")
	}
	ctx := context.Background()

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":         "Assigned to built-in agent",
		"status":        "todo",
		"assignee_type": "agent",
		"assignee_id":   builtinAgentID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateIssue: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created IssueResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	defer func() {
		cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
		cleanupReq = withURLParam(cleanupReq, "id", created.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	}()

	var taskCount int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
	`, created.ID, builtinAgentID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if taskCount != 0 {
		t.Fatalf("expected no built-in agent task before in_progress, got %d", taskCount)
	}

	w = httptest.NewRecorder()
	req = newRequest("PUT", "/api/issues/"+created.ID, map[string]any{
		"status": "in_progress",
	})
	req = withURLParam(req, "id", created.ID)
	testHandler.UpdateIssue(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UpdateIssue: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
	`, created.ID, builtinAgentID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks after in_progress: %v", err)
	}
	if taskCount == 0 {
		t.Fatalf("expected built-in agent task after in_progress, got 0")
	}

	var selectedRuntimeID string
	if err := testPool.QueryRow(ctx, `
		SELECT runtime_id FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
		LIMIT 1
	`, created.ID, builtinAgentID).Scan(&selectedRuntimeID); err != nil {
		t.Fatalf("look up selected runtime: %v", err)
	}
	var runtimeStatus string
	if err := testPool.QueryRow(ctx, `
		SELECT status FROM multica_agent_runtime WHERE id = $1
	`, selectedRuntimeID).Scan(&runtimeStatus); err != nil {
		t.Fatalf("look up selected runtime status: %v", err)
	}
	if runtimeStatus != "online" {
		t.Fatalf("expected built-in agent to auto-select an online runtime, got status %q", runtimeStatus)
	}
}

// TestQuickCreateWithBuiltinAgentSucceeds verifies that the quick-create path
// allows built-in agents without a fixed runtime, matching the regular issue
// assignment path.
func TestQuickCreateWithBuiltinAgentSucceeds(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not available")
	}
	ctx := context.Background()

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues/quick-create?workspace_id="+testWorkspaceID, map[string]any{
		"agent_id": builtinAgentID,
		"prompt":   "test prompt",
	})
	testHandler.QuickCreateIssue(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("QuickCreateIssue: expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp QuickCreateIssueResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode quick-create response: %v", err)
	}

	var taskCount int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM multica_agent_task_queue WHERE id = $1
	`, resp.TaskID).Scan(&taskCount); err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if taskCount == 0 {
		t.Fatalf("expected built-in agent quick-create task to be enqueued, got 0")
	}
}

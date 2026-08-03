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

// TestCreateIssueRunNowBuiltinAgentEnqueuesWithSpecifiedRuntime verifies that a
// run-now dispatch (status=in_progress at creation) for a built-in agent honors
// the specified_runtime_first policy by enqueuing the task on the runtime the
// caller picked, resolved through the shared workflow runtime selection path.
func TestCreateIssueRunNowBuiltinAgentEnqueuesWithSpecifiedRuntime(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not available")
	}
	ctx := context.Background()

	// Mirror the builtin-agent + runtime fixture used by
	// TestCreateIssueAssignedToBuiltinAgentWaitsUntilInProgress (same file):
	// builtinAgentID is the seeded built-in agent constant; handlerTestRuntimeID
	// returns the online runtime seeded by setupHandlerTestFixture.
	runtimeID := handlerTestRuntimeID(t)

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":                    "Run now builtin",
		"status":                   "in_progress",
		"assignee_type":            "agent",
		"assignee_id":              builtinAgentID,
		"runtime_selection_policy": "specified_runtime_first",
		"runtime_id":               runtimeID,
	})
	testHandler.CreateIssue(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created IssueResponse
	json.NewDecoder(w.Body).Decode(&created)

	defer func() {
		cleanupReq := newRequest("DELETE", "/api/issues/"+created.ID, nil)
		cleanupReq = withURLParam(cleanupReq, "id", created.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	}()

	var taskRuntimeID string
	if err := testPool.QueryRow(ctx, `
		SELECT runtime_id::text FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, created.ID, builtinAgentID).Scan(&taskRuntimeID); err != nil {
		t.Fatalf("no queued task enqueued: %v", err)
	}
	if taskRuntimeID != runtimeID {
		t.Fatalf("expected task runtime %s, got %s", runtimeID, taskRuntimeID)
	}
}

// TestCreateIssueRunNowBuiltinAgentIdleFirstPicksIdleRuntime verifies the new
// policy-resolution path Task 3 added to AfterIssueAssigned: for a built-in
// agent + idle_first dispatch, the issue's task is enqueued on the runtime with
// the fewest active tasks — not merely auto-selected by the task service's
// default (oldest-runtime) fallback.
//
// The fixture runtime (oldest in the workspace) is made "busy" by seeding a
// non-terminal task against it; a second online runtime with zero active tasks
// is then seeded. Under idle_first the dispatch MUST land on the idle runtime.
//
// This test FAILS before feb6646 (pre-fix: the fallback picks the busy oldest
// runtime) and PASSES after (resolveIssueRuntime honors idle_first).
func TestCreateIssueRunNowBuiltinAgentIdleFirstPicksIdleRuntime(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("handler test fixture not available")
	}
	ctx := context.Background()

	// Runtime A: the shared fixture runtime — oldest created_at in the workspace,
	// so ListAgentRuntimes (ORDER BY created_at ASC) returns it first. This is
	// what the pre-Task-3 fallback would pick regardless of load.
	busyRuntimeID := handlerTestRuntimeID(t)

	// Seed a non-terminal task against runtime A so its ActiveTaskCount > 0 in
	// ListWorkflowRuntimeCandidates. The row carries no issue_id, so
	// CancelTasksForIssue on the new issue below cannot touch it.
	var seedTaskID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent_task_queue (agent_id, runtime_id, status, priority)
		VALUES ($1, $2, 'running', 0)
		RETURNING id
	`, builtinAgentID, busyRuntimeID).Scan(&seedTaskID); err != nil {
		t.Fatalf("seed busy task on fixture runtime: %v", err)
	}

	// Runtime B: a second online runtime in the same workspace, created AFTER
	// runtime A (newer created_at), with a fresh last_seen_at so it sorts first
	// under ListWorkflowRuntimeCandidates' last_seen_at DESC ordering. Zero
	// active tasks → the idle_first target.
	var idleRuntimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		)
		VALUES ($1, NULL, $2, 'cloud', $3, 'online', '', '{}'::jsonb, now())
		RETURNING id
	`, testWorkspaceID, "Idle First Test Runtime", "idle_first_test_runtime").Scan(&idleRuntimeID); err != nil {
		t.Fatalf("create idle runtime B: %v", err)
	}

	// FK on multica_agent_task_queue.runtime_id is ON DELETE RESTRICT, so scrub
	// any task rows before the runtime row goes away.
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE runtime_id = $1`, idleRuntimeID)
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_agent_task_queue WHERE id = $1`, seedTaskID)
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id = $1`, idleRuntimeID)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":                    "Run now idle_first builtin",
		"status":                   "in_progress",
		"assignee_type":            "agent",
		"assignee_id":              builtinAgentID,
		"runtime_selection_policy": "idle_first",
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

	var taskRuntimeID string
	if err := testPool.QueryRow(ctx, `
		SELECT runtime_id::text FROM multica_agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1
	`, created.ID, builtinAgentID).Scan(&taskRuntimeID); err != nil {
		t.Fatalf("no queued task enqueued for built-in agent: %v", err)
	}
	if taskRuntimeID != idleRuntimeID {
		t.Fatalf("idle_first should dispatch to the idle runtime %s, got %s (busy runtime was %s)",
			idleRuntimeID, taskRuntimeID, busyRuntimeID)
	}
}

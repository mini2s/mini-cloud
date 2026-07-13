package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/service"
)

type splitApproveFixture struct {
	parentIssueID   string
	parentWorkflow  string
	childWorkflow   string
	parentRunID     string
	splitNodeID     string
	splitNodeRunID  string
	splitSubIssueID string
	taskAID         string
	taskBID         string
}

type splitGenerateFixture struct {
	parentIssueID   string
	parentWorkflow  string
	childWorkflow   string
	parentRunID     string
	splitNodeID     string
	splitNodeRunID  string
	splitSubIssueID string
	runtimeID       string
	agentID         string
}

func nextSplitIssueNumber(t *testing.T, ctx context.Context) int32 {
	t.Helper()

	n, err := testHandler.Queries.IncrementIssueCounter(ctx, parseUUID(testWorkspaceID))
	if err != nil {
		t.Fatalf("increment issue counter: %v", err)
	}
	return n
}

func createSplitApproveFixture(t *testing.T, mode string) splitApproveFixture {
	t.Helper()
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	_ = time.Now().UnixNano()

	var f splitApproveFixture

	t.Cleanup(func() {
		if f.parentIssueID != "" {
			req := newRequest("DELETE", "/api/issues/"+f.parentIssueID, nil)
			req = withURLParam(req, "id", f.parentIssueID)
			testHandler.DeleteIssue(httptest.NewRecorder(), req)
		}
		if f.parentWorkflow != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, f.parentWorkflow)
		}
		if f.childWorkflow != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, f.childWorkflow)
		}
	})

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, creator_type, creator_id, number, position
		)
		VALUES ($1, $2, 'todo', 'medium', 'member', $3, $4, 0)
		RETURNING id
	`, testWorkspaceID, "Split parent issue", testUserID, nextSplitIssueNumber(t, ctx)).Scan(&f.parentIssueID); err != nil {
		t.Fatalf("create parent issue: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id, is_template)
		VALUES ($1, $2, '', 'active', 'member', $3, true)
		RETURNING id
	`, testWorkspaceID, "Split child workflow", testUserID).Scan(&f.childWorkflow); err != nil {
		t.Fatalf("create child workflow: %v", err)
	}

	var childNodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Child node', '', 'human', $2, 'human', 0)
		RETURNING id
	`, f.childWorkflow, testUserID).Scan(&childNodeID); err != nil {
		t.Fatalf("create child workflow node: %v", err)
	}

	splitFormat, err := json.Marshal(map[string]any{
		"type": "split",
		"split_config": map[string]any{
			"sub_template_id": f.childWorkflow,
			"mode":            mode,
			"max_concurrency": 1,
			"max_failures":    0,
		},
	})
	if err != nil {
		t.Fatalf("marshal split format: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id)
		VALUES ($1, $2, '', 'active', 'member', $3)
		RETURNING id
	`, testWorkspaceID, "Split parent workflow", testUserID).Scan(&f.parentWorkflow); err != nil {
		t.Fatalf("create parent workflow: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, format_schema, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Split node', '', $2::jsonb, 'human', $3, 'human', 0)
		RETURNING id
	`, f.parentWorkflow, string(splitFormat), testUserID).Scan(&f.splitNodeID); err != nil {
		t.Fatalf("create split node: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id, input
		)
		VALUES ($1, $2, 'Split parent run', 'running', 'member', $3, '{}'::jsonb)
		RETURNING id
	`, f.parentWorkflow, testWorkspaceID, testUserID).Scan(&f.parentRunID); err != nil {
		t.Fatalf("create parent run: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, worker_id, critic_type
		)
		VALUES ($1, $2, 'Split node', 'awaiting_split_review', 'human', $3, 'human')
		RETURNING id
	`, f.parentRunID, f.splitNodeID, testUserID).Scan(&f.splitNodeRunID); err != nil {
		t.Fatalf("create split node run: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, creator_type, creator_id,
			parent_issue_id, number, position, origin_type, origin_id, workflow_id, workflow_run_id
		)
		VALUES ($1, $2, 'todo', 'medium', 'member', $3, $4, $5, 0, 'workflow', $6, $7, $8)
		RETURNING id
	`, testWorkspaceID, "Split node sub-issue", testUserID, f.parentIssueID, nextSplitIssueNumber(t, ctx), f.splitNodeRunID, f.parentWorkflow, f.parentRunID).Scan(&f.splitSubIssueID); err != nil {
		t.Fatalf("create split sub-issue: %v", err)
	}

	depsA, _ := json.Marshal([]string{})
	depsB, _ := json.Marshal([]string{})
	if mode == "barrier" {
		// Task B depends on task A so only A is ready immediately.
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task A', 'First task', $3::jsonb, 0, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, string(depsA)).Scan(&f.taskAID); err != nil {
			t.Fatalf("create split task A: %v", err)
		}
		depsB, _ = json.Marshal([]string{f.taskAID})
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task B', 'Second task', $3::jsonb, 1, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, string(depsB)).Scan(&f.taskBID); err != nil {
			t.Fatalf("create split task B: %v", err)
		}
	} else {
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task A', 'First task', $3::jsonb, 0, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, string(depsA)).Scan(&f.taskAID); err != nil {
			t.Fatalf("create split task A: %v", err)
		}
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task B', 'Second task', $3::jsonb, 1, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, string(depsB)).Scan(&f.taskBID); err != nil {
			t.Fatalf("create split task B: %v", err)
		}
	}

	return f
}

func createSplitGenerateFixture(t *testing.T, mode string) splitGenerateFixture {
	t.Helper()
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	var f splitGenerateFixture

	t.Cleanup(func() {
		if f.parentIssueID != "" {
			req := newRequest("DELETE", "/api/issues/"+f.parentIssueID, nil)
			req = withURLParam(req, "id", f.parentIssueID)
			testHandler.DeleteIssue(httptest.NewRecorder(), req)
		}
		if f.parentWorkflow != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, f.parentWorkflow)
		}
		if f.childWorkflow != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, f.childWorkflow)
		}
		if f.agentID != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_agent WHERE id = $1`, f.agentID)
		}
		if f.runtimeID != "" {
			_, _ = testPool.Exec(ctx, `DELETE FROM multica_agent_runtime WHERE id = $1`, f.runtimeID)
		}
	})

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider,
			status, device_info, metadata, last_seen_at, visibility
		)
		VALUES ($1, NULL, 'split generate runtime', 'cloud', 'handler_test_runtime', 'online', 'split generate fixture', '{}'::jsonb, now(), 'private')
		RETURNING id
	`, testWorkspaceID).Scan(&f.runtimeID); err != nil {
		t.Fatalf("create runtime: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent (
			workspace_id, name, description, runtime_mode, runtime_config,
			runtime_id, visibility, max_concurrent_tasks, owner_id
		)
		VALUES ($1, 'split generate agent', '', 'cloud', '{}'::jsonb, $2, 'private', 1, $3)
		RETURNING id
	`, testWorkspaceID, f.runtimeID, testUserID).Scan(&f.agentID); err != nil {
		t.Fatalf("create agent: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, creator_type, creator_id, number, position
		)
		VALUES ($1, $2, 'todo', 'medium', 'member', $3, $4, 0)
		RETURNING id
	`, testWorkspaceID, "Split generate parent issue", testUserID, nextSplitIssueNumber(t, ctx)).Scan(&f.parentIssueID); err != nil {
		t.Fatalf("create parent issue: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id, is_template)
		VALUES ($1, $2, '', 'active', 'member', $3, true)
		RETURNING id
	`, testWorkspaceID, "Split generate child workflow", testUserID).Scan(&f.childWorkflow); err != nil {
		t.Fatalf("create child workflow: %v", err)
	}

	var childNodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Child node', '', 'human', $2, 'human', 0)
		RETURNING id
	`, f.childWorkflow, testUserID).Scan(&childNodeID); err != nil {
		t.Fatalf("create child workflow node: %v", err)
	}

	splitFormat, err := json.Marshal(map[string]any{
		"type": "split",
		"split_config": map[string]any{
			"sub_template_id": f.childWorkflow,
			"mode":            mode,
			"max_concurrency": 2,
			"max_failures":    0,
		},
	})
	if err != nil {
		t.Fatalf("marshal split format: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id)
		VALUES ($1, $2, '', 'active', 'member', $3)
		RETURNING id
	`, testWorkspaceID, "Split generate parent workflow", testUserID).Scan(&f.parentWorkflow); err != nil {
		t.Fatalf("create parent workflow: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, format_schema, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Split node', '', $2::jsonb, 'agent', $3, 'human', 0)
		RETURNING id
	`, f.parentWorkflow, string(splitFormat), f.agentID).Scan(&f.splitNodeID); err != nil {
		t.Fatalf("create split node: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id, input
		)
		VALUES ($1, $2, 'Split generate parent run', 'running', 'member', $3, '{}'::jsonb)
		RETURNING id
	`, f.parentWorkflow, testWorkspaceID, testUserID).Scan(&f.parentRunID); err != nil {
		t.Fatalf("create parent run: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, node_title, status, worker_type, worker_id, critic_type
		)
		VALUES ($1, $2, 'Split node', 'splitting', 'agent', $3, 'human')
		RETURNING id
	`, f.parentRunID, f.splitNodeID, f.agentID).Scan(&f.splitNodeRunID); err != nil {
		t.Fatalf("create split node run: %v", err)
	}

	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, creator_type, creator_id,
			assignee_type, assignee_id,
			parent_issue_id, number, position, origin_type, origin_id, workflow_id, workflow_run_id
		)
		VALUES ($1, $2, 'in_progress', 'medium', 'member', $3, 'agent', $4, $5, $6, 0, 'workflow', $7, $8, $9)
		RETURNING id
	`, testWorkspaceID, "Split generate node sub-issue", testUserID, f.agentID, f.parentIssueID, nextSplitIssueNumber(t, ctx), f.splitNodeRunID, f.parentWorkflow, f.parentRunID).Scan(&f.splitSubIssueID); err != nil {
		t.Fatalf("create split sub-issue: %v", err)
	}

	return f
}

func TestApproveSplitTasksPipelineMaterializesTasksAndCompletesNode(t *testing.T) {
	f := createSplitApproveFixture(t, "pipeline")

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID},
		"modifications":     []any{},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)

	testHandler.ApproveSplitTasks(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SplitTasksResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Tasks) != 2 {
		t.Fatalf("expected 2 split tasks in response, got %d", len(resp.Tasks))
	}

	taskA, err := testHandler.Queries.GetSplitTask(context.Background(), parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task A status = %s, want running", taskA.Status)
	}
	if !taskA.IssueID.Valid {
		t.Fatal("task A issue_id should be set")
	}
	if !taskA.RunID.Valid {
		t.Fatal("task A run_id should be set")
	}

	taskB, err := testHandler.Queries.GetSplitTask(context.Background(), parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusDiscarded {
		t.Fatalf("task B status = %s, want discarded", taskB.Status)
	}

	childIssue, err := testHandler.Queries.GetIssue(context.Background(), taskA.IssueID)
	if err != nil {
		t.Fatalf("load child issue: %v", err)
	}
	if childIssue.ParentIssueID != parseUUID(f.parentIssueID) {
		t.Fatalf("child issue parent_issue_id = %s, want %s", uuidToString(childIssue.ParentIssueID), f.parentIssueID)
	}
	if childIssue.OriginType.String != "workflow_split" {
		t.Fatalf("child issue origin_type = %q, want workflow_split", childIssue.OriginType.String)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusCompleted {
		t.Fatalf("split node run status = %s, want completed", nodeRun.Status)
	}
}

func TestApproveSplitTasksBarrierStartsOnlyReadyTasks(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID, f.taskBID},
		"modifications":     []any{},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)

	testHandler.ApproveSplitTasks(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	taskA, err := testHandler.Queries.GetSplitTask(context.Background(), parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task A status = %s, want running", taskA.Status)
	}

	taskB, err := testHandler.Queries.GetSplitTask(context.Background(), parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusCreated {
		t.Fatalf("task B status = %s, want created", taskB.Status)
	}
	if taskB.RunID.Valid {
		t.Fatal("task B run_id should stay empty until dependency completes")
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusSplitActive {
		t.Fatalf("split node run status = %s, want split_active", nodeRun.Status)
	}
}

func TestCancelSplitNodePreservesTerminalChildWork(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	approveReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID, f.taskBID},
		"modifications":     []any{},
	})
	approveReq = withURLParam(approveReq, "nodeRunId", f.splitNodeRunID)

	approveResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(approveResp, approveReq)
	if approveResp.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", approveResp.Code, approveResp.Body.String())
	}

	ctx := context.Background()
	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if !taskA.RunID.Valid || !taskA.IssueID.Valid {
		t.Fatal("task A should have materialized issue and run before cancel test")
	}
	if !taskB.IssueID.Valid {
		t.Fatal("task B should have materialized issue before cancel test")
	}

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'done'
		WHERE id = $1
	`, f.taskAID); err != nil {
		t.Fatalf("mark split task A done: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'completed'
		WHERE workflow_run_id = $1
	`, uuidToString(taskA.RunID)); err != nil {
		t.Fatalf("mark child node runs completed: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET status = 'completed'
		WHERE id = $1
	`, uuidToString(taskA.RunID)); err != nil {
		t.Fatalf("mark child run completed: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_issue
		SET status = 'done'
		WHERE id = $1
	`, uuidToString(taskA.IssueID)); err != nil {
		t.Fatalf("mark child issue done: %v", err)
	}

	cancelReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/cancel", nil)
	cancelReq = withURLParam(cancelReq, "nodeRunId", f.splitNodeRunID)

	cancelResp := httptest.NewRecorder()
	testHandler.CancelSplitNode(cancelResp, cancelReq)
	if cancelResp.Code != http.StatusOK {
		t.Fatalf("CancelSplitNode: expected 200, got %d: %s", cancelResp.Code, cancelResp.Body.String())
	}

	taskA, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("reload split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusDone {
		t.Fatalf("task A status = %s, want done", taskA.Status)
	}

	taskB, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("reload split task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusCancelled {
		t.Fatalf("task B status = %s, want cancelled", taskB.Status)
	}

	childRun, err := testHandler.Queries.GetWorkflowRun(ctx, taskA.RunID)
	if err != nil {
		t.Fatalf("load child run: %v", err)
	}
	if childRun.Status != service.RunStatusCompleted {
		t.Fatalf("child run status = %s, want completed", childRun.Status)
	}

	childIssue, err := testHandler.Queries.GetIssue(ctx, taskA.IssueID)
	if err != nil {
		t.Fatalf("load child issue: %v", err)
	}
	if childIssue.Status != "done" {
		t.Fatalf("child issue status = %s, want done", childIssue.Status)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("reload split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusCancelled {
		t.Fatalf("split node run status = %s, want cancelled", nodeRun.Status)
	}
}

func TestCancelWorkflowRunCascadesActiveSplitTasks(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	approveReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID, f.taskBID},
		"modifications":     []any{},
	})
	approveReq = withURLParam(approveReq, "nodeRunId", f.splitNodeRunID)

	approveResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(approveResp, approveReq)
	if approveResp.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", approveResp.Code, approveResp.Body.String())
	}

	ctx := context.Background()
	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if !taskA.RunID.Valid || !taskA.IssueID.Valid {
		t.Fatal("task A should have materialized issue and run before parent cancel")
	}
	if !taskB.IssueID.Valid {
		t.Fatal("task B should have materialized issue before parent cancel")
	}

	if err := testHandler.WorkflowService.CancelRun(ctx, parseUUID(f.parentRunID)); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	taskA, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("reload split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusCancelled {
		t.Fatalf("task A status = %s, want cancelled", taskA.Status)
	}

	taskB, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("reload split task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusCancelled {
		t.Fatalf("task B status = %s, want cancelled", taskB.Status)
	}

	childRun, err := testHandler.Queries.GetWorkflowRun(ctx, taskA.RunID)
	if err != nil {
		t.Fatalf("load child run: %v", err)
	}
	if childRun.Status != service.RunStatusCancelled {
		t.Fatalf("child run status = %s, want cancelled", childRun.Status)
	}

	childIssue, err := testHandler.Queries.GetIssue(ctx, taskA.IssueID)
	if err != nil {
		t.Fatalf("load child issue: %v", err)
	}
	if childIssue.Status != "cancelled" {
		t.Fatalf("child issue status = %s, want cancelled", childIssue.Status)
	}
}

func TestGenerateSplitTasksDispatchesAndPersistsDraftTasks(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")

	generateResp := httptest.NewRecorder()
	generateReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/generate", nil)
	generateReq = withURLParam(generateReq, "nodeRunId", f.splitNodeRunID)

	testHandler.GenerateSplitTasks(generateResp, generateReq)
	if generateResp.Code != http.StatusOK {
		t.Fatalf("GenerateSplitTasks: expected 200, got %d: %s", generateResp.Code, generateResp.Body.String())
	}

	ctx := context.Background()
	var taskID string
	var taskContext []byte
	if err := testPool.QueryRow(ctx, `
		SELECT id, context
		FROM multica_agent_task_queue
		WHERE workflow_node_run_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, f.splitNodeRunID).Scan(&taskID, &taskContext); err != nil {
		t.Fatalf("load split generation task: %v", err)
	}

	var taskCtx map[string]any
	if err := json.Unmarshal(taskContext, &taskCtx); err != nil {
		t.Fatalf("parse generation task context: %v", err)
	}
	if taskCtx["phase"] != "split" {
		t.Fatalf("generation task phase = %v, want split", taskCtx["phase"])
	}
	if taskCtx["node_run_id"] != f.splitNodeRunID {
		t.Fatalf("generation task node_run_id = %v, want %s", taskCtx["node_run_id"], f.splitNodeRunID)
	}

	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(f.agentID))
	if err != nil {
		t.Fatalf("claim split generation task: %v", err)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start split generation task: %v", err)
	}

	payload, err := json.Marshal(map[string]any{
		"tasks": []map[string]any{
			{
				"title":              "Draft API contract",
				"description":        "Produce the initial API sketch",
				"assignee_type":      "agent",
				"assignee_id":        f.agentID,
				"depends_on_indices": []int{},
			},
			{
				"title":              "Implement server handler",
				"description":        "Wire the endpoint and orchestration",
				"depends_on_indices": []int{0},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal split generation payload: %v", err)
	}
	result, err := json.Marshal(map[string]any{
		"output": string(payload),
	})
	if err != nil {
		t.Fatalf("marshal task result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(ctx, started.ID, result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list generated split tasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("generated split task count = %d, want 2", len(tasks))
	}
	if tasks[0].Status != service.SplitTaskStatusDraft || tasks[1].Status != service.SplitTaskStatusDraft {
		t.Fatalf("generated split task statuses = %s/%s, want draft/draft", tasks[0].Status, tasks[1].Status)
	}
	if !tasks[0].SuggestedAssigneeID.Valid || uuidToString(tasks[0].SuggestedAssigneeID) != f.agentID {
		t.Fatalf("task 0 suggested_assignee_id = %v, want %s", uuidToString(tasks[0].SuggestedAssigneeID), f.agentID)
	}
	var dependsOn []string
	if err := json.Unmarshal(tasks[1].DependsOn, &dependsOn); err != nil {
		t.Fatalf("parse task 1 depends_on: %v", err)
	}
	if len(dependsOn) != 1 || dependsOn[0] != uuidToString(tasks[0].ID) {
		t.Fatalf("task 1 depends_on = %v, want [%s]", dependsOn, uuidToString(tasks[0].ID))
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("reload split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("split node run status = %s, want awaiting_split_review", nodeRun.Status)
	}
}

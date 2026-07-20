package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestSplitAPIErrorStatus(t *testing.T) {
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{service.NewSplitAPIError(service.SplitErrorConflict, "draft_task_conflict", errors.New("version changed")), http.StatusConflict, "draft_task_conflict"},
		{fmt.Errorf("wrapped: %w", service.NewSplitAPIError(service.SplitErrorConflict, "split_config_conflict", errors.New("version changed"))), http.StatusConflict, "split_config_conflict"},
		{service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("inactive")), http.StatusUnprocessableEntity, "invalid_split_task_workflow"},
		{service.NewSplitAPIError(service.SplitErrorUnprocessable, "split_task_limit_exceeded", errors.New("too many")), http.StatusUnprocessableEntity, "split_task_limit_exceeded"},
		{service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_dependency", errors.New("cycle")), http.StatusUnprocessableEntity, "invalid_split_task_dependency"},
		{service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid syntax")), http.StatusBadRequest, "invalid_split_request"},
		{errors.New("database unavailable"), http.StatusInternalServerError, "internal_split_error"},
	}
	for _, tt := range tests {
		status, code := splitAPIErrorResponse(tt.err)
		if status != tt.status || code != tt.code {
			t.Fatalf("got %d/%q, want %d/%q", status, code, tt.status, tt.code)
		}
	}
}

func TestWriteSplitAPIErrorHidesUnknownErrors(t *testing.T) {
	w := httptest.NewRecorder()
	writeSplitAPIError(w, errors.New("sentinel database detail"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	if strings.Contains(w.Body.String(), "sentinel database detail") {
		t.Fatalf("response leaked internal error: %s", w.Body.String())
	}
}

func TestSplitTaskToResponseIncludesDraftMetadata(t *testing.T) {
	task := db.MulticaWorkflowSplitTask{
		WorkflowID:  parseUUID("11111111-1111-1111-1111-111111111111"),
		DraftKey:    pgtype.Text{String: "api", Valid: true},
		DraftSource: service.DraftSourceRecovered,
	}

	resp := splitTaskToResponse(task)
	if resp.WorkflowID == nil || *resp.WorkflowID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("WorkflowID = %v", resp.WorkflowID)
	}
	if resp.DraftKey == nil || *resp.DraftKey != "api" || resp.DraftSource != "recovered" {
		t.Fatalf("draft metadata = %v / %q", resp.DraftKey, resp.DraftSource)
	}
}

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
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id)
		VALUES ($1, $2, '', 'active', 'member', $3)
		RETURNING id
	`, testWorkspaceID, "Split issue workflow", testUserID).Scan(&f.childWorkflow); err != nil {
		t.Fatalf("create issue workflow: %v", err)
	}

	var childNodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Child node', '', 'human', $2, 'human', 0)
		RETURNING id
	`, f.childWorkflow, testUserID).Scan(&childNodeID); err != nil {
		t.Fatalf("create issue workflow node: %v", err)
	}

	splitFormat, err := json.Marshal(map[string]any{
		"type": "split",
		"split_config": map[string]any{
			"default_issue_workflow_id": f.childWorkflow,
			"mode":                      mode,
			"max_concurrency":           1,
			"max_failures":              0,
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
				node_run_id, workspace_id, title, description, workflow_id, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task A', 'First task', $3, $4::jsonb, 0, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, f.childWorkflow, string(depsA)).Scan(&f.taskAID); err != nil {
			t.Fatalf("create split task A: %v", err)
		}
		depsB, _ = json.Marshal([]string{f.taskAID})
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, workflow_id, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task B', 'Second task', $3, $4::jsonb, 1, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, f.childWorkflow, string(depsB)).Scan(&f.taskBID); err != nil {
			t.Fatalf("create split task B: %v", err)
		}
	} else {
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, workflow_id, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task A', 'First task', $3, $4::jsonb, 0, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, f.childWorkflow, string(depsA)).Scan(&f.taskAID); err != nil {
			t.Fatalf("create split task A: %v", err)
		}
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_split_task (
				node_run_id, workspace_id, title, description, workflow_id, depends_on, sort_order, status
			)
			VALUES ($1, $2, 'Split task B', 'Second task', $3, $4::jsonb, 1, 'draft')
			RETURNING id
		`, f.splitNodeRunID, testWorkspaceID, f.childWorkflow, string(depsB)).Scan(&f.taskBID); err != nil {
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
		VALUES ($1, 'split generate agent ' || $2::text, '', 'cloud', '{}'::jsonb, $2::uuid, 'private', 1, $3)
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
		INSERT INTO multica_workflow (workspace_id, title, description, status, created_by_type, created_by_id)
		VALUES ($1, $2, '', 'active', 'member', $3)
		RETURNING id
	`, testWorkspaceID, "Split generate issue workflow", testUserID).Scan(&f.childWorkflow); err != nil {
		t.Fatalf("create issue workflow: %v", err)
	}

	var childNodeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node (
			workflow_id, title, description, worker_type, worker_id, critic_type, sort_order
		)
		VALUES ($1, 'Child node', '', 'human', $2, 'human', 0)
		RETURNING id
	`, f.childWorkflow, testUserID).Scan(&childNodeID); err != nil {
		t.Fatalf("create issue workflow node: %v", err)
	}

	splitFormat, err := json.Marshal(map[string]any{
		"type": "split",
		"split_config": map[string]any{
			"default_issue_workflow_id": f.childWorkflow,
			"mode":                      mode,
			"max_concurrency":           2,
			"max_failures":              0,
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

func startSplitGenerationTask(t *testing.T, f splitGenerateFixture) string {
	t.Helper()

	generateResp := httptest.NewRecorder()
	generateReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/generate", nil)
	generateReq = withURLParam(generateReq, "nodeRunId", f.splitNodeRunID)

	testHandler.GenerateSplitTasks(generateResp, generateReq)
	if generateResp.Code != http.StatusOK {
		t.Fatalf("GenerateSplitTasks: expected 200, got %d: %s", generateResp.Code, generateResp.Body.String())
	}

	ctx := context.Background()
	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(f.agentID))
	if err != nil {
		t.Fatalf("claim split generation task: %v", err)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start split generation task: %v", err)
	}
	return uuidToString(started.ID)
}

func TestAddSplitDraftTaskAcceptsMatchingSplitTask(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":             "api-contract",
		"title":           "Draft API contract",
		"description":     "Define request and response payloads.",
		"depends_on_keys": []string{},
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)

	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("draft task count = %d, want 1", len(tasks))
	}
	if tasks[0].Title != "Draft API contract" {
		t.Fatalf("draft task title = %q", tasks[0].Title)
	}
	if tasks[0].Status != service.SplitTaskStatusDraft {
		t.Fatalf("draft task status = %s, want draft", tasks[0].Status)
	}
}

func TestAddSplitDraftTaskUsesDefaultIssueWorkflow(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":             "api-contract",
		"title":           "Draft API contract",
		"description":     "Define request and response payloads.",
		"depends_on_keys": []string{},
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)

	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("draft task count = %d, want 1", len(tasks))
	}
	if uuidToString(tasks[0].WorkflowID) != f.childWorkflow {
		t.Fatalf("workflow_id = %s, want %s", uuidToString(tasks[0].WorkflowID), f.childWorkflow)
	}
}

func TestBatchAddSplitDraftTasksRollsBackWholeBatch(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/batch", map[string]any{
		"tasks": []map[string]any{
			{"draft_key": "first", "title": "First", "description": "First task", "depends_on": []string{}},
			{"draft_key": "second", "title": "Second", "description": "Second task", "depends_on": []string{"missing"}},
		},
	})
	req.Header.Set("X-Agent-ID", f.agentID)
	req.Header.Set("X-Task-ID", taskID)
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.BatchAddSplitDraftTasks(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", w.Code, w.Body.String())
	}
	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks = %d, want atomic rollback", len(tasks))
	}
}

func TestAddSplitDraftTaskAllowsHumanReviewer(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"title":       "Manual security review",
		"description": "Review permissions",
		"workflow_id": f.childWorkflow,
		"depends_on":  []string{f.taskAID},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.AddSplitDraftTask(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var body SplitTasksResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	created := body.Tasks[len(body.Tasks)-1]
	if created.DraftSource != service.DraftSourceChat || created.WorkflowID == nil {
		t.Fatalf("manual draft = %+v", created)
	}
}

func TestAddSplitDraftTaskUsesDiscardedSlotForReplacementDraft(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	for _, payload := range []map[string]any{
		{"key": "task-01", "title": "Task 01", "description": "First task."},
		{"key": "task-02", "title": "Task 02", "description": "Second task."},
		{"key": "task-03", "title": "Task 03", "description": "Third task."},
	} {
		addResp := httptest.NewRecorder()
		addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", payload)
		addReq.Header.Set("X-Agent-ID", f.agentID)
		addReq.Header.Set("X-Task-ID", taskID)
		addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
		testHandler.AddSplitDraftTask(addResp, addReq)
		if addResp.Code != http.StatusOK {
			t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
		}
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks: %v", err)
	}
	for _, task := range tasks[:2] {
		deleteResp := httptest.NewRecorder()
		deleteReq := newRequest("DELETE", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+uuidToString(task.ID), nil)
		deleteReq.Header.Set("X-Agent-ID", f.agentID)
		deleteReq.Header.Set("X-Task-ID", taskID)
		deleteReq = withURLParams(deleteReq, "nodeRunId", f.splitNodeRunID, "taskId", uuidToString(task.ID))
		testHandler.DeleteSplitDraftTask(deleteResp, deleteReq)
		if deleteResp.Code != http.StatusOK {
			t.Fatalf("DeleteSplitDraftTask: expected 200, got %d: %s", deleteResp.Code, deleteResp.Body.String())
		}
	}

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":         "merged-0102",
		"title":       "Merged 01 and 02",
		"description": "Replacement task for the first two drafts.",
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	tasks, err = testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks after replacement: %v", err)
	}
	for _, task := range tasks {
		if task.Title == "Merged 01 and 02" {
			if task.SortOrder != 0 {
				t.Fatalf("merged draft sort_order = %d, want first discarded slot 0", task.SortOrder)
			}
			return
		}
	}
	t.Fatal("merged draft was not created")
}

func TestAddSplitDraftTaskWithDiscardedKeyCreatesNewDraft(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":         "api-contract",
		"title":       "Original API contract",
		"description": "Define request and response payloads.",
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks: %v", err)
	}
	originalID := uuidToString(tasks[0].ID)

	deleteResp := httptest.NewRecorder()
	deleteReq := newRequest("DELETE", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+originalID, nil)
	deleteReq.Header.Set("X-Agent-ID", f.agentID)
	deleteReq.Header.Set("X-Task-ID", taskID)
	deleteReq = withURLParams(deleteReq, "nodeRunId", f.splitNodeRunID, "taskId", originalID)
	testHandler.DeleteSplitDraftTask(deleteResp, deleteReq)
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("DeleteSplitDraftTask: expected 200, got %d: %s", deleteResp.Code, deleteResp.Body.String())
	}

	readdResp := httptest.NewRecorder()
	readdReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":         "api-contract",
		"title":       "Replacement API contract",
		"description": "Recreate the API contract draft.",
	})
	readdReq.Header.Set("X-Agent-ID", f.agentID)
	readdReq.Header.Set("X-Task-ID", taskID)
	readdReq = withURLParam(readdReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(readdResp, readdReq)
	if readdResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask with discarded key: expected 200, got %d: %s", readdResp.Code, readdResp.Body.String())
	}

	tasks, err = testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split draft tasks after re-add: %v", err)
	}
	var discardedOriginal, activeReplacement bool
	for _, task := range tasks {
		if uuidToString(task.ID) == originalID {
			discardedOriginal = task.Status == service.SplitTaskStatusDiscarded
		}
		if task.Title == "Replacement API contract" && task.Status == service.SplitTaskStatusDraft && uuidToString(task.ID) != originalID {
			activeReplacement = true
		}
	}
	if !discardedOriginal {
		t.Fatal("original discarded draft was revived instead of remaining discarded")
	}
	if !activeReplacement {
		t.Fatal("replacement draft with reused key was not created as a new active draft")
	}
}

func TestAddSplitDraftTaskRejectsMissingDefaultIssueWorkflow(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	splitFormat, err := json.Marshal(map[string]any{
		"type": "split",
		"split_config": map[string]any{
			"mode":            "barrier",
			"max_concurrency": 2,
			"max_failures":    0,
		},
	})
	if err != nil {
		t.Fatalf("marshal split format: %v", err)
	}
	if _, err := testPool.Exec(context.Background(), `
		UPDATE multica_workflow_node
		SET format_schema = $1::jsonb
		WHERE id = $2
	`, string(splitFormat), f.splitNodeID); err != nil {
		t.Fatalf("remove default child assignee from split node: %v", err)
	}
	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":             "api-contract",
		"title":           "Draft API contract",
		"description":     "Define request and response payloads.",
		"depends_on_keys": []string{},
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)

	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusBadRequest {
		t.Fatalf("AddSplitDraftTask: expected 400, got %d: %s", addResp.Code, addResp.Body.String())
	}
	if !strings.Contains(addResp.Body.String(), "default_issue_workflow_id") {
		t.Fatalf("AddSplitDraftTask: expected clear missing default workflow error, got %s", addResp.Body.String())
	}
}

func TestAddSplitDraftTaskDoesNotTreatPartialAgentHeadersAsHuman(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	for _, tc := range []struct {
		name    string
		headers map[string]string
	}{
		{name: "agent only", headers: map[string]string{"X-Agent-ID": f.agentID}},
		{name: "task only", headers: map[string]string{"X-Task-ID": taskID}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
				"title":       "Must not be created",
				"description": "Partial agent headers cannot use human access.",
				"workflow_id": f.childWorkflow,
			})
			for name, value := range tc.headers {
				req.Header.Set(name, value)
			}
			req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
			w := httptest.NewRecorder()

			testHandler.AddSplitDraftTask(w, req)

			if w.Code != http.StatusBadRequest && w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want agent authentication failure: %s", w.Code, w.Body.String())
			}
		})
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks = %d, want no manual fallback", len(tasks))
	}
}

func TestAddSplitDraftTaskRejectsMismatchedTaskHeader(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	other := createSplitGenerateFixture(t, "barrier")

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+other.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":         "wrong-node",
		"title":       "Wrong node",
		"description": "This should be rejected.",
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", other.splitNodeRunID)

	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusForbidden {
		t.Fatalf("AddSplitDraftTask: expected 403, got %d: %s", addResp.Code, addResp.Body.String())
	}
}

func TestSubmitSplitDraftTasksTransitionsToReview(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	for _, payload := range []map[string]any{
		{
			"key":             "setup",
			"title":           "Setup project",
			"description":     "Create the base project structure.",
			"depends_on_keys": []string{},
		},
		{
			"key":             "implementation",
			"title":           "Implement workflow",
			"description":     "Build the workflow after setup.",
			"depends_on_keys": []string{"setup"},
		},
	} {
		addResp := httptest.NewRecorder()
		addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", payload)
		addReq.Header.Set("X-Agent-ID", f.agentID)
		addReq.Header.Set("X-Task-ID", taskID)
		addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
		testHandler.AddSplitDraftTask(addResp, addReq)
		if addResp.Code != http.StatusOK {
			t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
		}
	}

	submitResp := httptest.NewRecorder()
	submitReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-submit", nil)
	submitReq.Header.Set("X-Agent-ID", f.agentID)
	submitReq.Header.Set("X-Task-ID", taskID)
	submitReq = withURLParam(submitReq, "nodeRunId", f.splitNodeRunID)

	testHandler.SubmitSplitDraftTasks(submitResp, submitReq)
	if submitResp.Code != http.StatusOK {
		t.Fatalf("SubmitSplitDraftTasks: expected 200, got %d: %s", submitResp.Code, submitResp.Body.String())
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run status = %s, want awaiting_split_review", nodeRun.Status)
	}
}

func TestSubmitSplitDraftTasksAllowsEmptyPlan(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-submit", nil)
	req.Header.Set("X-Agent-ID", f.agentID)
	req.Header.Set("X-Task-ID", taskID)
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()

	testHandler.SubmitSplitDraftTasks(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil || nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run = %+v, err = %v", nodeRun, err)
	}
}

func TestSplitCompletionUsesExistingDraftRowsBeforeResultParsing(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":         "already-submitted",
		"title":       "Already submitted draft",
		"description": "The draft API is the source of truth.",
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	result, err := json.Marshal(map[string]any{"output": "I added the draft rows through the split draft API."})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run status = %s, want awaiting_split_review", nodeRun.Status)
	}
}

func TestPatchSplitDraftTaskUpdatesTextFields(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	patchResp := httptest.NewRecorder()
	patchReq := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+f.taskAID, map[string]any{
		"title":            "  Updated child issue  ",
		"description":      "Updated implementation notes.",
		"expected_version": int64(1),
	})
	patchReq = withURLParams(patchReq, "nodeRunId", f.splitNodeRunID, "taskId", f.taskAID)
	testHandler.PatchSplitDraftTask(patchResp, patchReq)

	if patchResp.Code != http.StatusOK {
		t.Fatalf("PatchSplitDraftTask: expected 200, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	task, err := testHandler.Queries.GetSplitTask(context.Background(), parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load patched split task: %v", err)
	}
	if task.Title != "Updated child issue" {
		t.Fatalf("title = %q, want trimmed update", task.Title)
	}
	if task.Description != "Updated implementation notes." {
		t.Fatalf("description = %q, want updated description", task.Description)
	}
	if task.Version != 2 {
		t.Fatalf("version = %d, want 2", task.Version)
	}
}

func TestPatchSplitDraftTaskRejectsBlankTitle(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	patchResp := httptest.NewRecorder()
	patchReq := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+f.taskAID, map[string]any{
		"title":            "   ",
		"expected_version": int64(1),
	})
	patchReq = withURLParams(patchReq, "nodeRunId", f.splitNodeRunID, "taskId", f.taskAID)
	testHandler.PatchSplitDraftTask(patchResp, patchReq)

	if patchResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	if !strings.Contains(patchResp.Body.String(), "title is required") {
		t.Fatalf("expected title validation error, got: %s", patchResp.Body.String())
	}
}

func TestPatchSplitDraftTaskRejectsNonReviewNode(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	if _, err := testPool.Exec(context.Background(), `
		UPDATE multica_workflow_node_run
		SET status = 'split_active'
		WHERE id = $1
	`, f.splitNodeRunID); err != nil {
		t.Fatalf("mark split node active: %v", err)
	}

	patchResp := httptest.NewRecorder()
	patchReq := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+f.taskAID, map[string]any{
		"title":            "Should not update",
		"expected_version": int64(1),
	})
	patchReq = withURLParams(patchReq, "nodeRunId", f.splitNodeRunID, "taskId", f.taskAID)
	testHandler.PatchSplitDraftTask(patchResp, patchReq)

	if patchResp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	if !strings.Contains(patchResp.Body.String(), "split draft task can only be edited while awaiting review") {
		t.Fatalf("expected review-state validation error, got: %s", patchResp.Body.String())
	}
}

func TestApproveSplitTasksConfirmEmptyDiscardsDrafts(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{},
		"confirm_empty":     true,
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split tasks: %v", err)
	}
	for _, task := range tasks {
		if task.Status != service.SplitTaskStatusDiscarded {
			t.Fatalf("task %s status = %s, want discarded", uuidToString(task.ID), task.Status)
		}
	}
	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusCompleted {
		t.Fatalf("split node run status = %s, want completed", nodeRun.Status)
	}
}

func TestSplitCompletionRecoversMarkdownBreakdownOutput(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	result, err := json.Marshal(map[string]any{
		"output": strings.Join([]string{
			"## Task 1: Build HTML shell",
			"Create the base HTML document and layout containers.",
			"",
			"## Task 2: Wire interactions",
			"Implement the client-side interactions after Task 1.",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list recovered split tasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("recovered split task count = %d, want 2", len(tasks))
	}
	if tasks[0].Title != "Build HTML shell" || tasks[1].Title != "Wire interactions" {
		t.Fatalf("recovered task titles = %q / %q", tasks[0].Title, tasks[1].Title)
	}
	if !tasks[0].DraftKey.Valid || tasks[0].DraftKey.String != "build-html-shell" ||
		!tasks[1].DraftKey.Valid || tasks[1].DraftKey.String != "wire-interactions" {
		t.Fatalf("recovered draft keys = %q / %q", tasks[0].DraftKey.String, tasks[1].DraftKey.String)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run status = %s, want awaiting_split_review", nodeRun.Status)
	}
}

func TestResetSplitDraftTasksToOriginalRestoresAgentProposal(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	ctx := context.Background()

	payload, err := json.Marshal(map[string]any{
		"tasks": []map[string]any{
			{
				"title":              "Original API contract",
				"description":        "Original generated description",
				"depends_on_indices": []int{},
			},
			{
				"title":              "Original server handler",
				"description":        "Original handler description",
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
	if _, err := testHandler.TaskService.CompleteTask(ctx, parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list generated split tasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("generated split task count = %d, want 2", len(tasks))
	}

	patchReq := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks/"+uuidToString(tasks[0].ID), map[string]any{
		"title":            "Manual edited title",
		"expected_version": tasks[0].Version,
	})
	patchReq = withURLParam(patchReq, "nodeRunId", f.splitNodeRunID)
	patchReq = withURLParam(patchReq, "taskId", uuidToString(tasks[0].ID))
	patchResp := httptest.NewRecorder()
	testHandler.PatchSplitDraftTask(patchResp, patchReq)
	if patchResp.Code != http.StatusOK {
		t.Fatalf("PatchSplitDraftTask: expected 200, got %d: %s", patchResp.Code, patchResp.Body.String())
	}

	resetReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/reset-original", nil)
	resetReq = withURLParam(resetReq, "nodeRunId", f.splitNodeRunID)
	resetResp := httptest.NewRecorder()
	testHandler.ResetSplitDraftTasksToOriginal(resetResp, resetReq)
	if resetResp.Code != http.StatusOK {
		t.Fatalf("ResetSplitDraftTasksToOriginal: expected 200, got %d: %s", resetResp.Code, resetResp.Body.String())
	}

	tasks, err = testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list reset split tasks: %v", err)
	}
	activeTitles := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == service.SplitTaskStatusDraft {
			activeTitles = append(activeTitles, task.Title)
		}
	}
	if len(activeTitles) != 2 {
		t.Fatalf("active reset split task count = %d, want 2", len(activeTitles))
	}
	if activeTitles[0] != "Original API contract" || activeTitles[1] != "Original server handler" {
		t.Fatalf("active reset titles = %q, want original proposal", activeTitles)
	}
}

func TestResetSplitDraftTasksToOriginalRollsBackOnFailure(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)
	ctx := context.Background()

	payload, err := json.Marshal(map[string]any{
		"tasks": []map[string]any{
			{
				"title":              "Original API contract",
				"description":        "Original generated description",
				"depends_on_indices": []int{},
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
	if _, err := testHandler.TaskService.CompleteTask(ctx, parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	before, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list generated split tasks: %v", err)
	}
	activeBefore := make([]string, 0, len(before))
	activeBeforeIDs := make([]string, 0, len(before))
	for _, task := range before {
		if task.Status == service.SplitTaskStatusDraft {
			activeBefore = append(activeBefore, task.Title)
			activeBeforeIDs = append(activeBeforeIDs, uuidToString(task.ID))
		}
	}
	if len(activeBefore) != 1 || activeBefore[0] != "Original API contract" {
		t.Fatalf("active draft before reset = %q, want original draft", activeBefore)
	}

	corruptedPayload, err := json.Marshal(map[string]any{
		"tasks": []map[string]any{
			{
				"title":              "Original API contract",
				"description":        "Original generated description",
				"depends_on_indices": []int{},
			},
			{
				"title":              "Invalid dependency task",
				"description":        "This payload should fail while replacing drafts.",
				"depends_on_indices": []int{99},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal corrupted split generation payload: %v", err)
	}
	corruptedResult, err := json.Marshal(map[string]any{
		"output": string(corruptedPayload),
	})
	if err != nil {
		t.Fatalf("marshal corrupted task result: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_agent_task_queue SET result = $1::jsonb WHERE id = $2
	`, string(corruptedResult), taskID); err != nil {
		t.Fatalf("corrupt split generation result: %v", err)
	}

	resetReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/reset-original", nil)
	resetReq = withURLParam(resetReq, "nodeRunId", f.splitNodeRunID)
	resetResp := httptest.NewRecorder()
	testHandler.ResetSplitDraftTasksToOriginal(resetResp, resetReq)
	if resetResp.Code != http.StatusBadRequest {
		t.Fatalf("ResetSplitDraftTasksToOriginal: expected 400, got %d: %s", resetResp.Code, resetResp.Body.String())
	}
	if !strings.Contains(resetResp.Body.String(), "dependency index 99") {
		t.Fatalf("ResetSplitDraftTasksToOriginal: expected dependency index error, got %s", resetResp.Body.String())
	}

	after, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list reset split tasks: %v", err)
	}
	activeAfter := make([]string, 0, len(after))
	activeAfterIDs := make([]string, 0, len(after))
	for _, task := range after {
		if task.Status == service.SplitTaskStatusDraft {
			activeAfter = append(activeAfter, task.Title)
			activeAfterIDs = append(activeAfterIDs, uuidToString(task.ID))
		}
	}
	if len(activeAfter) != 1 || activeAfter[0] != "Original API contract" {
		t.Fatalf("active draft after failed reset = %q, want unchanged draft", activeAfter)
	}
	if activeAfterIDs[0] != activeBeforeIDs[0] {
		t.Fatalf("active draft id after failed reset = %s, want unchanged %s", activeAfterIDs[0], activeBeforeIDs[0])
	}
}

func TestSplitCompletionRecoversMarkdownBreakdownComment(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO multica_comment (
			issue_id, workspace_id, author_type, author_id, content, type
		)
		VALUES ($1, $2, 'agent', $3, $4, 'comment')
	`, f.splitSubIssueID, testWorkspaceID, f.agentID, strings.Join([]string{
		"## Task 1: Build API contract",
		"Define the draft endpoint request and response.",
		"",
		"## Task 2: Implement CLI command",
		"Wire the workflow split draft command.",
	}, "\n")); err != nil {
		t.Fatalf("create split task comment: %v", err)
	}

	result, err := json.Marshal(map[string]any{
		"output": "I posted the split plan in a comment.",
	})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list recovered split tasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("recovered split task count = %d, want 2", len(tasks))
	}
	if tasks[0].Title != "Build API contract" || tasks[1].Title != "Implement CLI command" {
		t.Fatalf("recovered task titles = %q / %q", tasks[0].Title, tasks[1].Title)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run status = %s, want awaiting_split_review", nodeRun.Status)
	}
}

func TestSplitCompletionDispatchesRepairTaskBeforeFailing(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	result, err := json.Marshal(map[string]any{
		"output": "I could not produce a structured or markdown task breakdown.",
	})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusSplitting {
		t.Fatalf("node run status = %s, want splitting while repair runs", nodeRun.Status)
	}

	var repairTaskID string
	var repairContext []byte
	if err := testPool.QueryRow(context.Background(), `
		SELECT id, context
		FROM multica_agent_task_queue
		WHERE workflow_node_run_id = $1
		  AND id <> $2
		ORDER BY created_at DESC
		LIMIT 1
	`, f.splitNodeRunID, taskID).Scan(&repairTaskID, &repairContext); err != nil {
		t.Fatalf("load repair task: %v", err)
	}

	var taskCtx map[string]any
	if err := json.Unmarshal(repairContext, &taskCtx); err != nil {
		t.Fatalf("parse repair task context: %v", err)
	}
	if taskCtx["phase"] != "split" {
		t.Fatalf("repair task phase = %v, want split", taskCtx["phase"])
	}
	if taskCtx["repair"] != true {
		t.Fatalf("repair task context repair = %v, want true", taskCtx["repair"])
	}
	if taskCtx["repair_source_task_id"] != taskID {
		t.Fatalf("repair source task = %v, want %s", taskCtx["repair_source_task_id"], taskID)
	}
	if uuidToString(nodeRun.AgentTaskID) != repairTaskID {
		t.Fatalf("node run agent_task_id = %s, want repair task %s", uuidToString(nodeRun.AgentTaskID), repairTaskID)
	}
}

func TestSplitRepairCompletionFailureMarksNodeFailed(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	result, err := json.Marshal(map[string]any{
		"output": "No recoverable task breakdown.",
	})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), parseUUID(taskID), result, "", ""); err != nil {
		t.Fatalf("complete split generation task: %v", err)
	}

	claimedRepair, err := testHandler.Queries.ClaimAgentTask(context.Background(), parseUUID(f.agentID))
	if err != nil {
		t.Fatalf("claim repair task: %v", err)
	}
	startedRepair, err := testHandler.Queries.StartAgentTask(context.Background(), claimedRepair.ID)
	if err != nil {
		t.Fatalf("start repair task: %v", err)
	}
	repairResult, err := json.Marshal(map[string]any{
		"output": "Repair still did not produce tasks.",
	})
	if err != nil {
		t.Fatalf("marshal repair result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(context.Background(), startedRepair.ID, repairResult, "", ""); err != nil {
		t.Fatalf("complete repair task: %v", err)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(context.Background(), parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusFailed {
		t.Fatalf("node run status = %s, want failed after repair failure", nodeRun.Status)
	}
}

func TestSplitPhaseTaskCannotCreateIssue(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	createResp := httptest.NewRecorder()
	createReq := newRequest("POST", "/api/issues", map[string]any{
		"title": "Premature child issue",
	})
	createReq.Header.Set("X-Agent-ID", f.agentID)
	createReq.Header.Set("X-Task-ID", taskID)

	testHandler.CreateIssue(createResp, createReq)
	if createResp.Code != http.StatusForbidden {
		t.Fatalf("CreateIssue: expected 403, got %d: %s", createResp.Code, createResp.Body.String())
	}
}

func TestSplitPhaseTaskCannotChangeIssueStatus(t *testing.T) {
	f := createSplitGenerateFixture(t, "barrier")
	taskID := startSplitGenerationTask(t, f)

	updateResp := httptest.NewRecorder()
	updateReq := newRequest("PUT", "/api/issues/"+f.splitSubIssueID, map[string]any{
		"status": "done",
	})
	updateReq.Header.Set("X-Agent-ID", f.agentID)
	updateReq.Header.Set("X-Task-ID", taskID)
	updateReq = withURLParam(updateReq, "id", f.splitSubIssueID)

	testHandler.UpdateIssue(updateResp, updateReq)
	if updateResp.Code != http.StatusForbidden {
		t.Fatalf("UpdateIssue: expected 403, got %d: %s", updateResp.Code, updateResp.Body.String())
	}

	issue, err := testHandler.Queries.GetIssue(context.Background(), parseUUID(f.splitSubIssueID))
	if err != nil {
		t.Fatalf("load split sub-issue: %v", err)
	}
	if issue.Status != "in_progress" {
		t.Fatalf("split sub-issue status = %s, want in_progress", issue.Status)
	}
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

func TestApproveSplitTasksPipelineCompletesNodeWithPendingChildDispatch(t *testing.T) {
	f := createSplitApproveFixture(t, "pipeline")

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

	ctx := context.Background()
	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task A status = %s, want running", taskA.Status)
	}
	if taskB.Status != service.SplitTaskStatusCreated {
		t.Fatalf("task B status = %s, want created", taskB.Status)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusCompleted {
		t.Fatalf("split node run status = %s, want completed", nodeRun.Status)
	}

	parentRun, err := testHandler.Queries.GetWorkflowRun(ctx, parseUUID(f.parentRunID))
	if err != nil {
		t.Fatalf("load parent run: %v", err)
	}
	if parentRun.Status == service.RunStatusRunning {
		t.Fatal("parent run status stayed running after pipeline split approval")
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

func TestScheduleReadyTasksSkipsDependentsAfterStartFailure(t *testing.T) {
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

	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'created', run_id = NULL
		WHERE id = $1
	`, f.taskAID); err != nil {
		t.Fatalf("reset task A for failed scheduling: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow
		SET status = 'paused'
		WHERE id = $1
	`, f.childWorkflow); err != nil {
		t.Fatalf("pause child workflow: %v", err)
	}

	if err := testHandler.SplitOrchestrator.ScheduleReadyTasks(ctx, parseUUID(f.splitNodeRunID)); err != nil {
		t.Fatalf("ScheduleReadyTasks: %v", err)
	}

	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusFailed {
		t.Fatalf("task A status = %s, want failed", taskA.Status)
	}

	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load split task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusSkipped {
		t.Fatalf("task B status = %s, want skipped", taskB.Status)
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("load split node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusFailed {
		t.Fatalf("split node run status = %s, want failed", nodeRun.Status)
	}
}

func TestApproveSplitTasksRejectsNonEmptyModifications(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID},
		"modifications": []map[string]any{
			{"action": "add", "title": "extra"},
		},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "split modifications must be submitted through /split/chat") {
		t.Fatalf("expected modifications rejection message, got: %s", w.Body.String())
	}
}

func TestApproveSplitTasksDoesNotRegressCreatedTaskOnReplay(t *testing.T) {
	f := createSplitApproveFixture(t, "pipeline")
	ctx := context.Background()

	req := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID, f.taskBID},
		"modifications":     []any{},
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	w := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first ApproveSplitTasks: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load split task A: %v", err)
	}
	if !taskA.IssueID.Valid {
		t.Fatal("expected task A to be materialized before replay")
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'created', run_id = NULL
		WHERE id = $1
	`, f.taskAID); err != nil {
		t.Fatalf("force task A to created: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'awaiting_split_review'
		WHERE id = $1
	`, f.splitNodeRunID); err != nil {
		t.Fatalf("restore node run review state: %v", err)
	}

	replayReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID},
		"modifications":     []any{},
	})
	replayReq = withURLParam(replayReq, "nodeRunId", f.splitNodeRunID)
	replayResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(replayResp, replayReq)
	if replayResp.Code != http.StatusOK {
		t.Fatalf("replayed ApproveSplitTasks: expected 200, got %d: %s", replayResp.Code, replayResp.Body.String())
	}

	taskA, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("reload split task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusCreated && taskA.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task A status = %s, want created/running rather than approved", taskA.Status)
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

func TestCancelSplitNodeCancelsRunningChildWorkflowRun(t *testing.T) {
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
	if !taskA.RunID.Valid || !taskA.IssueID.Valid {
		t.Fatal("task A should have materialized issue and run before cancel")
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
	if taskA.Status != service.SplitTaskStatusCancelled {
		t.Fatalf("task A status = %s, want cancelled", taskA.Status)
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

func TestCancelSplitNodeReconcilesAlreadyCancelledParentRun(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'cancelled', completed_at = now()
		WHERE id = $1
	`, f.splitNodeRunID); err != nil {
		t.Fatalf("pre-cancel split node run: %v", err)
	}

	cancelReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/cancel", nil)
	cancelReq = withURLParam(cancelReq, "nodeRunId", f.splitNodeRunID)

	cancelResp := httptest.NewRecorder()
	testHandler.CancelSplitNode(cancelResp, cancelReq)
	if cancelResp.Code != http.StatusOK {
		t.Fatalf("CancelSplitNode: expected 200, got %d: %s", cancelResp.Code, cancelResp.Body.String())
	}

	parentRun, err := testHandler.Queries.GetWorkflowRun(ctx, parseUUID(f.parentRunID))
	if err != nil {
		t.Fatalf("load parent run: %v", err)
	}
	if parentRun.Status == service.RunStatusRunning {
		t.Fatal("parent run status stayed running after cancelling an already-cancelled split node")
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

func TestPatchSplitConfigUpdatesMaxConcurrencyWithExpectedVersion(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	req := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/config", map[string]any{
		"max_concurrency":         4,
		"expected_config_version": 1,
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	resp := httptest.NewRecorder()

	testHandler.PatchSplitConfig(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("PatchSplitConfig: expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	ctx := context.Background()
	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("reload node run: %v", err)
	}
	if nodeRun.SplitConfigVersion != 2 {
		t.Fatalf("split_config_version = %d, want 2", nodeRun.SplitConfigVersion)
	}
	node, err := testHandler.Queries.GetWorkflowNode(ctx, parseUUID(f.splitNodeID))
	if err != nil {
		t.Fatalf("reload split node: %v", err)
	}
	var format struct {
		SplitConfig struct {
			MaxConcurrency int `json:"max_concurrency"`
		} `json:"split_config"`
	}
	if err := json.Unmarshal(node.FormatSchema, &format); err != nil {
		t.Fatalf("parse node format: %v", err)
	}
	if format.SplitConfig.MaxConcurrency != 4 {
		t.Fatalf("max_concurrency = %d, want 4", format.SplitConfig.MaxConcurrency)
	}
}

func TestPatchSplitConfigImmediatelySchedulesNewConcurrencySlots(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET depends_on = '[]'::jsonb
		WHERE id = $1
	`, f.taskBID); err != nil {
		t.Fatalf("remove task B dependency: %v", err)
	}

	approveReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID, f.taskBID},
	})
	approveReq = withURLParam(approveReq, "nodeRunId", f.splitNodeRunID)
	approveResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(approveResp, approveReq)
	if approveResp.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", approveResp.Code, approveResp.Body.String())
	}

	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load task B before patch: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusCreated {
		t.Fatalf("task B before patch = %s, want created", taskB.Status)
	}

	req := newRequest("PATCH", "/api/node-runs/"+f.splitNodeRunID+"/split/config", map[string]any{
		"max_concurrency":         2,
		"expected_config_version": 1,
	})
	req = withURLParam(req, "nodeRunId", f.splitNodeRunID)
	resp := httptest.NewRecorder()
	testHandler.PatchSplitConfig(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("PatchSplitConfig: expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	taskB, err = testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("reload task B after patch: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task B after patch = %s, want running", taskB.Status)
	}
	if !taskB.RunID.Valid {
		t.Fatal("task B should have a run_id after immediate scheduling")
	}
}

func TestRetrySplitTaskResetsFailedTaskAndReschedules(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	approveReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID},
	})
	approveReq = withURLParam(approveReq, "nodeRunId", f.splitNodeRunID)
	approveResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(approveResp, approveReq)
	if approveResp.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", approveResp.Code, approveResp.Body.String())
	}

	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'failed', run_id = NULL, last_error = '{"code":"failed","message":"boom"}'::jsonb
		WHERE id = $1
	`, f.taskAID); err != nil {
		t.Fatalf("mark task failed: %v", err)
	}

	retryReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/tasks/"+f.taskAID+"/retry", nil)
	retryReq = withURLParam(retryReq, "nodeRunId", f.splitNodeRunID)
	retryReq = withURLParam(retryReq, "taskId", f.taskAID)
	retryResp := httptest.NewRecorder()

	testHandler.RetrySplitTask(retryResp, retryReq)
	if retryResp.Code != http.StatusOK {
		t.Fatalf("RetrySplitTask: expected 200, got %d: %s", retryResp.Code, retryResp.Body.String())
	}

	task, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if task.Status != service.SplitTaskStatusRunning {
		t.Fatalf("task status = %s, want running", task.Status)
	}
	if !task.RunID.Valid {
		t.Fatal("expected retry to start a new child run")
	}
	if len(task.LastError) != 0 {
		t.Fatalf("last_error should be cleared, got %s", string(task.LastError))
	}
}

func TestRetrySplitTaskCancelsPreviousChildRun(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")

	approveReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/approve", map[string]any{
		"approved_task_ids": []string{f.taskAID},
	})
	approveReq = withURLParam(approveReq, "nodeRunId", f.splitNodeRunID)
	approveResp := httptest.NewRecorder()
	testHandler.ApproveSplitTasks(approveResp, approveReq)
	if approveResp.Code != http.StatusOK {
		t.Fatalf("ApproveSplitTasks: expected 200, got %d: %s", approveResp.Code, approveResp.Body.String())
	}

	ctx := context.Background()
	before, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load task before retry: %v", err)
	}
	if !before.RunID.Valid {
		t.Fatal("expected initial child run before retry")
	}
	oldRunID := before.RunID

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'failed', last_error = '{"code":"failed","message":"boom"}'::jsonb
		WHERE id = $1
	`, f.taskAID); err != nil {
		t.Fatalf("mark task failed: %v", err)
	}

	retryReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/tasks/"+f.taskAID+"/retry", nil)
	retryReq = withURLParam(retryReq, "nodeRunId", f.splitNodeRunID)
	retryReq = withURLParam(retryReq, "taskId", f.taskAID)
	retryResp := httptest.NewRecorder()

	testHandler.RetrySplitTask(retryResp, retryReq)
	if retryResp.Code != http.StatusOK {
		t.Fatalf("RetrySplitTask: expected 200, got %d: %s", retryResp.Code, retryResp.Body.String())
	}

	oldRun, err := testHandler.Queries.GetWorkflowRun(ctx, oldRunID)
	if err != nil {
		t.Fatalf("load previous child run: %v", err)
	}
	if oldRun.Status != service.RunStatusCancelled {
		t.Fatalf("previous child run status = %s, want cancelled", oldRun.Status)
	}

	after, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("reload task after retry: %v", err)
	}
	if after.RunID == oldRunID {
		t.Fatal("retry should start a new run instead of reusing the previous run")
	}
}

func TestScheduleReadyTasksPersistsStartFailureAndSkipsDependents(t *testing.T) {
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	var childIssueID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, priority, creator_type, creator_id,
			parent_issue_id, number, position, origin_type, origin_id, workflow_id
		)
		VALUES ($1, 'Unstartable split child', 'todo', 'medium', 'member', $2, $3, $4, 0, 'workflow_split', $5, $6)
		RETURNING id
	`, testWorkspaceID, testUserID, f.parentIssueID, nextSplitIssueNumber(t, ctx), f.taskAID, f.childWorkflow).Scan(&childIssueID); err != nil {
		t.Fatalf("create child issue: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET status = 'split_active'
		WHERE id = $1
	`, f.splitNodeRunID); err != nil {
		t.Fatalf("activate split node: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'created', issue_id = $2, workflow_id = NULL
		WHERE id = $1
	`, f.taskAID, childIssueID); err != nil {
		t.Fatalf("make task A unstartable: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_split_task
		SET status = 'created'
		WHERE id = $1
	`, f.taskBID); err != nil {
		t.Fatalf("make task B created: %v", err)
	}

	if err := testHandler.SplitOrchestrator.ScheduleReadyTasks(ctx, parseUUID(f.splitNodeRunID)); err != nil {
		t.Fatalf("ScheduleReadyTasks: %v", err)
	}

	taskA, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskAID))
	if err != nil {
		t.Fatalf("load task A: %v", err)
	}
	if taskA.Status != service.SplitTaskStatusFailed {
		t.Fatalf("task A status = %s, want failed", taskA.Status)
	}
	if len(taskA.LastError) == 0 {
		t.Fatal("task A last_error should describe the start failure")
	}

	taskB, err := testHandler.Queries.GetSplitTask(ctx, parseUUID(f.taskBID))
	if err != nil {
		t.Fatalf("load task B: %v", err)
	}
	if taskB.Status != service.SplitTaskStatusSkipped {
		t.Fatalf("task B status = %s, want skipped after dependency start failure", taskB.Status)
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
	if uuidToString(tasks[0].WorkflowID) != f.childWorkflow {
		t.Fatalf("task 0 workflow_id = %v, want %s", uuidToString(tasks[0].WorkflowID), f.childWorkflow)
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

func TestSplitChatCreatesSessionAndDispatchesTask(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := createSplitGenerateFixture(t, "pipeline")
	ctx := context.Background()

	taskID := startSplitGenerationTask(t, f)

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":             "task-1",
		"title":           "Split task A",
		"description":     "Test task for chat flow",
		"depends_on_keys": []string{},
	})
	addReq.Header.Set("X-Agent-ID", f.agentID)
	addReq.Header.Set("X-Task-ID", taskID)
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	submitResp := httptest.NewRecorder()
	submitReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-submit", nil)
	submitReq.Header.Set("X-Agent-ID", f.agentID)
	submitReq.Header.Set("X-Task-ID", taskID)
	submitReq = withURLParam(submitReq, "nodeRunId", f.splitNodeRunID)
	testHandler.SubmitSplitDraftTasks(submitResp, submitReq)
	if submitResp.Code != http.StatusOK {
		t.Fatalf("SubmitSplitDraftTasks: expected 200, got %d: %s", submitResp.Code, submitResp.Body.String())
	}

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		t.Fatalf("node run status = %s, want %s", nodeRun.Status, service.NodeRunStatusAwaitingSplitReview)
	}

	chatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "请把任务2拆成两个独立任务",
	})
	chatReq = withURLParam(chatReq, "nodeRunId", f.splitNodeRunID)
	chatResp := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp, chatReq)

	if chatResp.Code != http.StatusOK {
		t.Fatalf("HandleSplitChat: expected 200, got %d: %s", chatResp.Code, chatResp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(chatResp.Body.Bytes(), &body); err != nil {
		t.Fatalf("parse chat response: %v", err)
	}
	if body["chat_session_id"] == nil || body["chat_session_id"] == "" {
		t.Fatal("expected chat_session_id in response")
	}
	if body["task_id"] == nil || body["task_id"] == "" {
		t.Fatal("expected task_id in response")
	}
	task, err := testHandler.Queries.GetAgentTask(ctx, parseUUID(body["task_id"].(string)))
	if err != nil {
		t.Fatalf("get split chat task: %v", err)
	}
	if !task.ChatSessionID.Valid {
		t.Fatal("expected split chat task to persist chat_session_id")
	}
	if uuidToString(task.ChatSessionID) != body["chat_session_id"].(string) {
		t.Fatalf("task chat_session_id = %s, want %s", uuidToString(task.ChatSessionID), body["chat_session_id"].(string))
	}

	nodeRun, err = testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	if !nodeRun.SplitReviewChatSessionID.Valid {
		t.Fatal("expected split_review_chat_session_id to be set on node run")
	}
	if uuidToString(nodeRun.SplitReviewChatSessionID) != body["chat_session_id"].(string) {
		t.Fatalf("bound chat session ID mismatch: %s vs %s",
			uuidToString(nodeRun.SplitReviewChatSessionID), body["chat_session_id"].(string))
	}
}

func TestSplitChatCompletionRecoversMarkdownDraftAdjustments(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "split-chat-recover-agent", nil)
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeID); err != nil {
		t.Fatalf("update node worker: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeRunID); err != nil {
		t.Fatalf("update node run worker: %v", err)
	}

	chatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "Use native web technologies for the implementation tasks.",
	})
	chatReq = withURLParam(chatReq, "nodeRunId", f.splitNodeRunID)
	chatResp := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp, chatReq)
	if chatResp.Code != http.StatusOK {
		t.Fatalf("HandleSplitChat: expected 200, got %d: %s", chatResp.Code, chatResp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(chatResp.Body.Bytes(), &body); err != nil {
		t.Fatalf("parse chat response: %v", err)
	}
	taskID := body["task_id"].(string)
	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("claim chat task: %v", err)
	}
	if uuidToString(claimed.ID) != taskID {
		t.Fatalf("claimed task = %s, want %s", uuidToString(claimed.ID), taskID)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start chat task: %v", err)
	}

	result, err := json.Marshal(map[string]any{
		"output": strings.Join([]string{
			"## Task 1: Build native web UI",
			"Use HTML, CSS, and browser APIs without framework-specific dependencies.",
			"",
			"## Task 2: Verify native web behavior",
			"Add focused checks for the browser interaction and rendering path.",
		}, "\n"),
	})
	if err != nil {
		t.Fatalf("marshal chat task result: %v", err)
	}
	if _, err := testHandler.TaskService.CompleteTask(ctx, started.ID, result, "", ""); err != nil {
		t.Fatalf("complete chat task: %v", err)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split tasks: %v", err)
	}
	activeTitles := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Status != service.SplitTaskStatusDiscarded {
			activeTitles = append(activeTitles, task.Title)
			if task.DraftSource != service.DraftSourceChat {
				t.Fatalf("draft source for %q = %q, want chat", task.Title, task.DraftSource)
			}
		}
	}
	wantTitles := []string{"Build native web UI", "Verify native web behavior"}
	if strings.Join(activeTitles, "|") != strings.Join(wantTitles, "|") {
		t.Fatalf("active split task titles = %v, want %v", activeTitles, wantTitles)
	}
}

func TestSplitChatCompletionWithoutDraftUpdateReturnsError(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "split-chat-no-draft-update-agent", nil)
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeID); err != nil {
		t.Fatalf("update node worker: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeRunID); err != nil {
		t.Fatalf("update node run worker: %v", err)
	}

	chatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "合理合并拆分任务",
	})
	chatReq = withURLParam(chatReq, "nodeRunId", f.splitNodeRunID)
	chatResp := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp, chatReq)
	if chatResp.Code != http.StatusOK {
		t.Fatalf("HandleSplitChat: expected 200, got %d: %s", chatResp.Code, chatResp.Body.String())
	}

	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("claim chat task: %v", err)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start chat task: %v", err)
	}

	result, _ := json.Marshal(map[string]any{
		"output": "请告诉我您希望如何调整当前的草稿任务集。",
	})
	if _, err := testHandler.TaskService.CompleteTask(ctx, started.ID, result, "", ""); err == nil {
		t.Fatal("CompleteTask: expected split chat without draft update to fail")
	}

	task, err := testHandler.Queries.GetAgentTask(ctx, started.ID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if task.Status != "failed" {
		t.Fatalf("task status = %s, want failed after rejected completion", task.Status)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split tasks: %v", err)
	}
	for _, task := range tasks {
		if task.DraftSource == service.DraftSourceChat {
			t.Fatalf("unexpected chat draft source on unchanged task %s", task.Title)
		}
	}

	nextChatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "try again after failed adjustment",
	})
	nextChatReq = withURLParam(nextChatReq, "nodeRunId", f.splitNodeRunID)
	nextChatResp := httptest.NewRecorder()
	testHandler.HandleSplitChat(nextChatResp, nextChatReq)
	if nextChatResp.Code != http.StatusOK {
		t.Fatalf("second HandleSplitChat after failed completion: expected 200, got %d: %s", nextChatResp.Code, nextChatResp.Body.String())
	}
}

func TestSplitChatCompletionAcceptsDraftApiMutations(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "split-chat-draft-api-agent", nil)
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeID); err != nil {
		t.Fatalf("update node worker: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeRunID); err != nil {
		t.Fatalf("update node run worker: %v", err)
	}

	chatReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "Add a security review draft.",
	})
	chatReq = withURLParam(chatReq, "nodeRunId", f.splitNodeRunID)
	chatResp := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp, chatReq)
	if chatResp.Code != http.StatusOK {
		t.Fatalf("HandleSplitChat: expected 200, got %d: %s", chatResp.Code, chatResp.Body.String())
	}

	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("claim chat task: %v", err)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start chat task: %v", err)
	}

	addResp := httptest.NewRecorder()
	addReq := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/draft-tasks", map[string]any{
		"key":             "security-review",
		"title":           "Security review",
		"description":     "Review the split plan for security concerns.",
		"depends_on_keys": []string{},
	})
	addReq.Header.Set("X-Agent-ID", agentID)
	addReq.Header.Set("X-Task-ID", uuidToString(started.ID))
	addReq = withURLParam(addReq, "nodeRunId", f.splitNodeRunID)
	testHandler.AddSplitDraftTask(addResp, addReq)
	if addResp.Code != http.StatusOK {
		t.Fatalf("AddSplitDraftTask: expected 200, got %d: %s", addResp.Code, addResp.Body.String())
	}

	result, _ := json.Marshal(map[string]any{
		"output": "I added the security review draft through the split draft API.",
	})
	if _, err := testHandler.TaskService.CompleteTask(ctx, started.ID, result, "", ""); err != nil {
		t.Fatalf("CompleteTask: expected draft API mutation to be accepted, got %v", err)
	}

	task, err := testHandler.Queries.GetAgentTask(ctx, started.ID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if task.Status != "completed" {
		t.Fatalf("task status = %s, want completed", task.Status)
	}

	tasks, err := testHandler.Queries.ListSplitTasksByNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("list split tasks: %v", err)
	}
	found := false
	for _, task := range tasks {
		if task.Title == "Security review" && task.Status == service.SplitTaskStatusDraft && task.DraftSource == service.DraftSourceChat {
			found = true
		}
	}
	if !found {
		t.Fatal("expected Security review draft from chat API mutation to remain active")
	}
}

func TestSplitChatReusesExistingSession(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "split-chat-reuse-agent", nil)
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeID); err != nil {
		t.Fatalf("update node worker: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeRunID); err != nil {
		t.Fatalf("update node run worker: %v", err)
	}

	chatReq1 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "调整任务1的标题",
	})
	chatReq1 = withURLParam(chatReq1, "nodeRunId", f.splitNodeRunID)
	chatResp1 := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp1, chatReq1)
	if chatResp1.Code != http.StatusOK {
		t.Fatalf("first HandleSplitChat: expected 200, got %d: %s", chatResp1.Code, chatResp1.Body.String())
	}

	var body1 map[string]any
	if err := json.Unmarshal(chatResp1.Body.Bytes(), &body1); err != nil {
		t.Fatalf("parse first chat response: %v", err)
	}
	sessionID1 := body1["chat_session_id"].(string)

	nodeRun, err := testHandler.Queries.GetWorkflowNodeRun(ctx, parseUUID(f.splitNodeRunID))
	if err != nil {
		t.Fatalf("get node run: %v", err)
	}
	if !nodeRun.SplitReviewChatSessionID.Valid {
		t.Fatal("expected split_review_chat_session_id to be set")
	}

	claimed, err := testHandler.Queries.ClaimAgentTask(ctx, parseUUID(agentID))
	if err != nil {
		t.Fatalf("claim chat task: %v", err)
	}
	started, err := testHandler.Queries.StartAgentTask(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("start chat task: %v", err)
	}
	resolvedResult, _ := json.Marshal(map[string]any{"output": strings.Join([]string{
		"## Task 1: Adjusted split draft",
		"Keep the split review session reusable after a valid draft adjustment.",
	}, "\n")})
	if _, err := testHandler.TaskService.CompleteTask(ctx, started.ID, resolvedResult, "", ""); err != nil {
		t.Fatalf("complete chat task: %v", err)
	}

	chatReq2 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "再调整一下任务2",
	})
	chatReq2 = withURLParam(chatReq2, "nodeRunId", f.splitNodeRunID)
	chatResp2 := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp2, chatReq2)
	if chatResp2.Code != http.StatusOK {
		t.Fatalf("second HandleSplitChat: expected 200, got %d: %s", chatResp2.Code, chatResp2.Body.String())
	}

	var body2 map[string]any
	if err := json.Unmarshal(chatResp2.Body.Bytes(), &body2); err != nil {
		t.Fatalf("parse second chat response: %v", err)
	}
	sessionID2 := body2["chat_session_id"].(string)

	if sessionID1 != sessionID2 {
		t.Fatalf("expected same chat_session_id (%s), got %s", sessionID1, sessionID2)
	}

	messages, err := testHandler.Queries.ListChatMessages(ctx, parseUUID(sessionID1))
	if err != nil {
		t.Fatalf("list chat messages: %v", err)
	}
	userMsgCount := 0
	for _, msg := range messages {
		if msg.Role == "user" {
			userMsgCount++
		}
	}
	if userMsgCount != 2 {
		t.Fatalf("expected 2 user messages, got %d", userMsgCount)
	}
}

func TestSplitChatRejectsConcurrentTask(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "split-chat-concurrent-agent", nil)
	f := createSplitApproveFixture(t, "barrier")
	ctx := context.Background()

	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeID); err != nil {
		t.Fatalf("update node worker: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run SET worker_id = $1, worker_type = 'agent' WHERE id = $2
	`, agentID, f.splitNodeRunID); err != nil {
		t.Fatalf("update node run worker: %v", err)
	}

	chatReq1 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "调整任务1",
	})
	chatReq1 = withURLParam(chatReq1, "nodeRunId", f.splitNodeRunID)
	chatResp1 := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp1, chatReq1)
	if chatResp1.Code != http.StatusOK {
		t.Fatalf("first HandleSplitChat: expected 200, got %d: %s", chatResp1.Code, chatResp1.Body.String())
	}

	chatReq2 := newRequest("POST", "/api/node-runs/"+f.splitNodeRunID+"/split/chat", map[string]any{
		"content": "这个应该被拒绝",
	})
	chatReq2 = withURLParam(chatReq2, "nodeRunId", f.splitNodeRunID)
	chatResp2 := httptest.NewRecorder()
	testHandler.HandleSplitChat(chatResp2, chatReq2)

	if chatResp2.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict, got %d: %s", chatResp2.Code, chatResp2.Body.String())
	}
	if !strings.Contains(chatResp2.Body.String(), "already in progress") {
		t.Fatalf("expected 'already in progress' error, got: %s", chatResp2.Body.String())
	}
}

package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetWorkflowRunCanvasSummaryAggregatesRuntimeState(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var agentID string
	if err := testPool.QueryRow(ctx,
		`SELECT id FROM multica_agent WHERE workspace_id = $1 AND name = 'Handler Test Agent' LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID); err != nil {
		t.Fatalf("load test agent: %v", err)
	}

	var workflowID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, 'Canvas summary workflow', 'active', 'member', $2)
		RETURNING id
	`, testWorkspaceID, testUserID).Scan(&workflowID); err != nil {
		t.Fatalf("create workflow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	createNode := func(title string, sortOrder int) string {
		t.Helper()
		var nodeID string
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node (
				workflow_id, title, position_x, position_y, worker_type, worker_id,
				critic_type, critic_id, sort_order
			)
			VALUES ($1, $2, $3, 0, 'agent', $4, 'human', $5, $6)
			RETURNING id
		`, workflowID, title, sortOrder*320, agentID, testUserID, sortOrder).Scan(&nodeID); err != nil {
			t.Fatalf("create node %s: %v", title, err)
		}
		return nodeID
	}

	completedNodeID := createNode("Completed node", 0)
	reviewingNodeID := createNode("Reviewing node", 1)
	blockedNodeID := createNode("Blocked node with error", 2)
	splitNodeID := createNode("Split tasks active", 3)
	failedNodeID := createNode("Failed CSC node", 4)

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id
		)
		VALUES ($1, $2, 'Canvas summary workflow', 'running', 'member', $3)
		RETURNING id
	`, workflowID, testWorkspaceID, testUserID).Scan(&runID); err != nil {
		t.Fatalf("create run: %v", err)
	}

	createNodeRun := func(nodeID, title, status string, workerOutput string) string {
		t.Helper()
		var nodeRunID string
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node_run (
				workflow_run_id, workflow_node_id, node_title, status, worker_type, worker_id,
				worker_output, critic_type, critic_id, retry_count, runtime_id, device_id, session_id,
				started_at, completed_at
			)
			VALUES (
				$1, $2, $3, $4, 'agent', $5, $6::jsonb, 'human', $7, 1,
				$8, 'device-a', 'session-a', now() - interval '2 minutes', now()
			)
			RETURNING id
		`, runID, nodeID, title, status, agentID, workerOutput, testUserID, testRuntimeID).Scan(&nodeRunID); err != nil {
			t.Fatalf("create node run %s: %v", title, err)
		}
		return nodeRunID
	}

	completedRunID := createNodeRun(completedNodeID, "Completed node", "completed", `{}`)
	reviewingRunID := createNodeRun(reviewingNodeID, "Reviewing node", "awaiting_critic", `{}`)
	blockedRunID := createNodeRun(blockedNodeID, "Blocked node with error", "blocked", `{"error":"tool failed"}`)
	splitRunID := createNodeRun(splitNodeID, "Split tasks active", "split_active", `{}`)
	failedRunID := createNodeRun(failedNodeID, "Failed CSC node", "failed", `{}`)
	_ = completedRunID
	_ = reviewingRunID
	_ = blockedRunID

	var failedTaskID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_agent_task_queue (
			agent_id, runtime_id, status, priority, workflow_node_run_id,
			error, failure_reason, context, started_at, completed_at
		)
		VALUES (
			$1, $2, 'failed', 2, $3,
			'Max turns reached', 'agent_error', '{"phase":"worker"}'::jsonb,
			now() - interval '1 minute', now()
		)
		RETURNING id
	`, agentID, testRuntimeID, failedRunID).Scan(&failedTaskID); err != nil {
		t.Fatalf("create failed CSC task: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_node_run
		SET worker_agent_task_id = $2
		WHERE id = $1
	`, failedRunID, failedTaskID); err != nil {
		t.Fatalf("link failed CSC task: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_split_task (
			node_run_id, workspace_id, title, description, depends_on, sort_order, status
		)
		VALUES
			($1, $2, 'Created task', '', '[]'::jsonb, 0, 'created'),
			($1, $2, 'Running task', '', '[]'::jsonb, 1, 'running'),
			($1, $2, 'Done task', '', '[]'::jsonb, 2, 'done'),
			($1, $2, 'Failed task', '', '[]'::jsonb, 3, 'failed'),
			($1, $2, 'Cancelled task', '', '[]'::jsonb, 4, 'cancelled'),
			($1, $2, 'Skipped task', '', '[]'::jsonb, 5, 'skipped'),
			($1, $2, 'Draft task', '', '[]'::jsonb, 6, 'draft'),
			($1, $2, 'Approved task', '', '[]'::jsonb, 7, 'approved'),
			($1, $2, 'Discarded task', '', '[]'::jsonb, 8, 'discarded')
	`, splitRunID, testWorkspaceID); err != nil {
		t.Fatalf("create split tasks: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("GET", fmt.Sprintf("/api/workflows/%s/runs/%s/canvas-summary", workflowID, runID), nil)
	req = withURLParams(req, "id", workflowID, "runId", runID)
	testHandler.GetWorkflowRunCanvasSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetWorkflowRunCanvasSummary: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	type splitProgressPayload struct {
		Total     int `json:"total"`
		Created   int `json:"created"`
		Running   int `json:"running"`
		Done      int `json:"done"`
		Failed    int `json:"failed"`
		Cancelled int `json:"cancelled"`
		Skipped   int `json:"skipped"`
	}

	var resp struct {
		NodeRuntimeSummaries []struct {
			WorkflowNodeID  string                `json:"workflow_node_id"`
			NodeRunID       string                `json:"node_run_id"`
			DisplayStatus   string                `json:"display_status"`
			ActiveActorType string                `json:"active_actor_type"`
			ActiveActorID   *string               `json:"active_actor_id"`
			DurationSeconds *int64                `json:"duration_seconds"`
			SessionID       *string               `json:"session_id"`
			RuntimeID       *string               `json:"runtime_id"`
			DeviceID        *string               `json:"device_id"`
			HasError        bool                  `json:"has_error"`
			ErrorMessage    string                `json:"error_message"`
			SplitProgress   *splitProgressPayload `json:"split_progress"`
		} `json:"node_runtime_summaries"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.NodeRuntimeSummaries) != 5 {
		t.Fatalf("expected 5 summaries, got %d", len(resp.NodeRuntimeSummaries))
	}

	byNodeID := map[string]struct {
		NodeRunID       string
		DisplayStatus   string
		ActiveActorType string
		ActiveActorID   *string
		DurationSeconds *int64
		SessionID       *string
		RuntimeID       *string
		DeviceID        *string
		HasError        bool
		ErrorMessage    string
		SplitProgress   *splitProgressPayload
	}{}
	for _, summary := range resp.NodeRuntimeSummaries {
		byNodeID[summary.WorkflowNodeID] = struct {
			NodeRunID       string
			DisplayStatus   string
			ActiveActorType string
			ActiveActorID   *string
			DurationSeconds *int64
			SessionID       *string
			RuntimeID       *string
			DeviceID        *string
			HasError        bool
			ErrorMessage    string
			SplitProgress   *splitProgressPayload
		}{
			NodeRunID:       summary.NodeRunID,
			DisplayStatus:   summary.DisplayStatus,
			ActiveActorType: summary.ActiveActorType,
			ActiveActorID:   summary.ActiveActorID,
			DurationSeconds: summary.DurationSeconds,
			SessionID:       summary.SessionID,
			RuntimeID:       summary.RuntimeID,
			DeviceID:        summary.DeviceID,
			HasError:        summary.HasError,
			ErrorMessage:    summary.ErrorMessage,
			SplitProgress:   summary.SplitProgress,
		}
	}

	completed := byNodeID[completedNodeID]
	if completed.DisplayStatus != "completed" {
		t.Fatalf("completed node summary status mismatch: %+v", completed)
	}
	if completed.DurationSeconds == nil || *completed.DurationSeconds <= 0 {
		t.Fatalf("expected completed duration_seconds to be populated, got %+v", completed.DurationSeconds)
	}

	reviewing := byNodeID[reviewingNodeID]
	if reviewing.DisplayStatus != "reviewing" {
		t.Fatalf("reviewing node summary status mismatch: %+v", reviewing)
	}
	if reviewing.ActiveActorType != "human" || reviewing.ActiveActorID == nil || *reviewing.ActiveActorID != testUserID {
		t.Fatalf("expected reviewing active actor to be critic human %s, got %+v", testUserID, reviewing)
	}

	blocked := byNodeID[blockedNodeID]
	if blocked.DisplayStatus != "blocked" {
		t.Fatalf("blocked node summary status mismatch: %+v", blocked)
	}
	if !blocked.HasError || blocked.ErrorMessage != "tool failed" {
		t.Fatalf("expected blocked node error to be extracted, got %+v", blocked)
	}
	if blocked.SessionID == nil || *blocked.SessionID != "session-a" || blocked.RuntimeID == nil || *blocked.RuntimeID != testRuntimeID || blocked.DeviceID == nil || *blocked.DeviceID != "device-a" {
		t.Fatalf("expected runtime/session fields, got %+v", blocked)
	}

	failed := byNodeID[failedNodeID]
	if failed.DisplayStatus != "blocked" {
		t.Fatalf("failed node summary compatibility status mismatch: %+v", failed)
	}
	if !failed.HasError || failed.ErrorMessage != "Max turns reached" {
		t.Fatalf("expected failed node error from linked task, got %+v", failed)
	}

	split := byNodeID[splitNodeID]
	if split.DisplayStatus != "in_progress" {
		t.Fatalf("split node summary status mismatch: %+v", split)
	}
	if split.SplitProgress == nil {
		t.Fatalf("expected split_progress for split node summary, got %+v", split)
	}
	if split.SplitProgress.Total != 6 ||
		split.SplitProgress.Created != 1 ||
		split.SplitProgress.Running != 1 ||
		split.SplitProgress.Done != 1 ||
		split.SplitProgress.Failed != 1 ||
		split.SplitProgress.Cancelled != 1 ||
		split.SplitProgress.Skipped != 1 {
		t.Fatalf("split progress mismatch: %+v", split.SplitProgress)
	}
}

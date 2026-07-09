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

	greenNodeID := createNode("All deliverables approved", 0)
	yellowNodeID := createNode("Waiting for review", 1)
	redNodeID := createNode("Blocked missing deliverable", 2)

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

	greenRunID := createNodeRun(greenNodeID, "All deliverables approved", "completed", `{}`)
	yellowRunID := createNodeRun(yellowNodeID, "Waiting for review", "awaiting_critic", `{}`)
	redRunID := createNodeRun(redNodeID, "Blocked missing deliverable", "blocked", `{"error":"tool failed"}`)

	createDeliverable := func(nodeID, title string) string {
		t.Helper()
		var deliverableID string
		if err := testPool.QueryRow(ctx, `
			INSERT INTO multica_workflow_node_deliverable (
				workflow_node_id, kind, title, description, required, sort_order
			)
			VALUES ($1, 'document', $2, '', true, 0)
			RETURNING id
		`, nodeID, title).Scan(&deliverableID); err != nil {
			t.Fatalf("create deliverable %s: %v", title, err)
		}
		return deliverableID
	}
	greenDeliverableID := createDeliverable(greenNodeID, "Design doc")
	yellowDeliverableID := createDeliverable(yellowNodeID, "Review notes")
	createDeliverable(redNodeID, "Missing evidence")

	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable_submission (
			workflow_node_run_id, deliverable_id, submitted_by_type, submitted_by_id, status, content
		)
		VALUES
			($1, $2, 'member', $3, 'approved', 'ok'),
			($4, $5, 'member', $3, 'submitted', 'needs review')
	`, greenRunID, greenDeliverableID, testUserID, yellowRunID, yellowDeliverableID); err != nil {
		t.Fatalf("create submissions: %v", err)
	}
	_ = redRunID

	w := httptest.NewRecorder()
	req := newRequest("GET", fmt.Sprintf("/api/workflows/%s/runs/%s/canvas-summary", workflowID, runID), nil)
	req = withURLParams(req, "id", workflowID, "runId", runID)
	testHandler.GetWorkflowRunCanvasSummary(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetWorkflowRunCanvasSummary: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		NodeRuntimeSummaries []struct {
			WorkflowNodeID                string  `json:"workflow_node_id"`
			NodeRunID                     string  `json:"node_run_id"`
			DisplayStatus                 string  `json:"display_status"`
			ActiveActorType               string  `json:"active_actor_type"`
			ActiveActorID                 *string `json:"active_actor_id"`
			DeliverableSignal             string  `json:"deliverable_signal"`
			RequiredDeliverablesTotal     int     `json:"required_deliverables_total"`
			RequiredDeliverablesSubmitted int     `json:"required_deliverables_submitted"`
			RequiredDeliverablesApproved  int     `json:"required_deliverables_approved"`
			DurationSeconds               *int64  `json:"duration_seconds"`
			SessionID                     *string `json:"session_id"`
			RuntimeID                     *string `json:"runtime_id"`
			DeviceID                      *string `json:"device_id"`
			HasError                      bool    `json:"has_error"`
			ErrorMessage                  string  `json:"error_message"`
		} `json:"node_runtime_summaries"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.NodeRuntimeSummaries) != 3 {
		t.Fatalf("expected 3 summaries, got %d", len(resp.NodeRuntimeSummaries))
	}

	byNodeID := map[string]struct {
		NodeRunID                     string
		DisplayStatus                 string
		ActiveActorType               string
		ActiveActorID                 *string
		DeliverableSignal             string
		RequiredDeliverablesTotal     int
		RequiredDeliverablesSubmitted int
		RequiredDeliverablesApproved  int
		DurationSeconds               *int64
		SessionID                     *string
		RuntimeID                     *string
		DeviceID                      *string
		HasError                      bool
		ErrorMessage                  string
	}{}
	for _, summary := range resp.NodeRuntimeSummaries {
		byNodeID[summary.WorkflowNodeID] = struct {
			NodeRunID                     string
			DisplayStatus                 string
			ActiveActorType               string
			ActiveActorID                 *string
			DeliverableSignal             string
			RequiredDeliverablesTotal     int
			RequiredDeliverablesSubmitted int
			RequiredDeliverablesApproved  int
			DurationSeconds               *int64
			SessionID                     *string
			RuntimeID                     *string
			DeviceID                      *string
			HasError                      bool
			ErrorMessage                  string
		}{
			NodeRunID:                     summary.NodeRunID,
			DisplayStatus:                 summary.DisplayStatus,
			ActiveActorType:               summary.ActiveActorType,
			ActiveActorID:                 summary.ActiveActorID,
			DeliverableSignal:             summary.DeliverableSignal,
			RequiredDeliverablesTotal:     summary.RequiredDeliverablesTotal,
			RequiredDeliverablesSubmitted: summary.RequiredDeliverablesSubmitted,
			RequiredDeliverablesApproved:  summary.RequiredDeliverablesApproved,
			DurationSeconds:               summary.DurationSeconds,
			SessionID:                     summary.SessionID,
			RuntimeID:                     summary.RuntimeID,
			DeviceID:                      summary.DeviceID,
			HasError:                      summary.HasError,
			ErrorMessage:                  summary.ErrorMessage,
		}
	}

	green := byNodeID[greenNodeID]
	if green.DeliverableSignal != "green" || green.DisplayStatus != "completed" {
		t.Fatalf("green node summary mismatch: %+v", green)
	}
	if green.RequiredDeliverablesTotal != 1 || green.RequiredDeliverablesSubmitted != 1 || green.RequiredDeliverablesApproved != 1 {
		t.Fatalf("green deliverable counts mismatch: %+v", green)
	}
	if green.DurationSeconds == nil || *green.DurationSeconds <= 0 {
		t.Fatalf("expected green duration_seconds to be populated, got %+v", green.DurationSeconds)
	}

	yellow := byNodeID[yellowNodeID]
	if yellow.DeliverableSignal != "yellow" || yellow.DisplayStatus != "reviewing" {
		t.Fatalf("yellow node summary mismatch: %+v", yellow)
	}
	if yellow.ActiveActorType != "human" || yellow.ActiveActorID == nil || *yellow.ActiveActorID != testUserID {
		t.Fatalf("expected yellow active actor to be critic human %s, got %+v", testUserID, yellow)
	}

	red := byNodeID[redNodeID]
	if red.DeliverableSignal != "red" || red.DisplayStatus != "blocked" {
		t.Fatalf("red node summary mismatch: %+v", red)
	}
	if !red.HasError || red.ErrorMessage != "tool failed" {
		t.Fatalf("expected red node error to be extracted, got %+v", red)
	}
	if red.SessionID == nil || *red.SessionID != "session-a" || red.RuntimeID == nil || *red.RuntimeID != testRuntimeID || red.DeviceID == nil || *red.DeviceID != "device-a" {
		t.Fatalf("expected runtime/session fields, got %+v", red)
	}
}

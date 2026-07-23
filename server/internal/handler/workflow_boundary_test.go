package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/service"
)

func cleanupBoundaryWorkflow(t *testing.T, workflowID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})
}

func createBoundaryNode(t *testing.T, workflowID, title, kind string, wantStatus int) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title": title, "worker_type": "human", "critic_type": "human",
		"format_schema": map[string]any{"type": kind, "shape": "pill"},
	})
	testHandler.CreateWorkflowNode(w, withURLParams(req, "id", workflowID))
	if w.Code != wantStatus {
		t.Fatalf("create %s: got %d, want %d: %s", kind, w.Code, wantStatus, w.Body.String())
	}
	if wantStatus != http.StatusCreated {
		return ""
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.ID
}

func createBoundaryTaskNode(t *testing.T, workflowID, title string) string {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title": title, "worker_type": "human", "critic_type": "human",
		"format_schema": map[string]any{"shape": "rectangle"},
	})
	testHandler.CreateWorkflowNode(w, withURLParams(req, "id", workflowID))
	if w.Code != http.StatusCreated {
		t.Fatalf("create task: got %d: %s", w.Code, w.Body.String())
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.ID
}

func updateBoundaryNode(t *testing.T, workflowID, nodeID string, body map[string]any, wantStatus int) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("PUT", fmt.Sprintf("/api/workflows/%s/nodes/%s", workflowID, nodeID), body)
	testHandler.UpdateWorkflowNode(w, withURLParams(req, "id", workflowID, "nodeId", nodeID))
	if w.Code != wantStatus {
		t.Fatalf("update node: got %d, want %d: %s", w.Code, wantStatus, w.Body.String())
	}
}

func createBoundaryEdge(t *testing.T, workflowID, sourceID, targetID string, wantStatus int) {
	t.Helper()
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/edges", workflowID), map[string]any{
		"source_node_id": sourceID, "target_node_id": targetID,
	})
	testHandler.CreateWorkflowEdge(w, withURLParams(req, "id", workflowID))
	if w.Code != wantStatus {
		t.Fatalf("create edge: got %d, want %d: %s", w.Code, wantStatus, w.Body.String())
	}
}

func TestCreateWorkflowBoundaryNodeRejectsDuplicateKind(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	createBoundaryNode(t, workflowID, "Start again", "start", http.StatusConflict)
}

func TestCreateWorkflowBoundaryNodeRejectsActorAssignments(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title": "Start", "worker_type": "human", "worker_id": testUserID, "critic_type": "human",
		"format_schema": map[string]any{"type": "start"},
	})
	testHandler.CreateWorkflowNode(w, withURLParams(req, "id", workflowID))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create boundary with actor: got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateWorkflowBoundaryNodeRejectsTypeMutation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	nodeID := createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	updateBoundaryNode(t, workflowID, nodeID, map[string]any{
		"format_schema": map[string]any{"type": "end"},
	}, http.StatusUnprocessableEntity)
}

func TestUpdateWorkflowBoundaryNodeRejectsRestrictedFields(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	nodeID := createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	for name, body := range map[string]map[string]any{
		"format schema": {"format_schema": map[string]any{"type": "start", "shape": "rectangle"}},
		"sort order":    {"sort_order": 3},
	} {
		t.Run(name, func(t *testing.T) {
			updateBoundaryNode(t, workflowID, nodeID, body, http.StatusUnprocessableEntity)
		})
	}
}

func TestCreateWorkflowEdgeValidatesBoundaryDirection(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	startID := createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	endID := createBoundaryNode(t, workflowID, "End", "end", http.StatusCreated)
	taskID := createBoundaryTaskNode(t, workflowID, "Task")
	createBoundaryEdge(t, workflowID, startID, taskID, http.StatusCreated)
	createBoundaryEdge(t, workflowID, taskID, endID, http.StatusCreated)
	createBoundaryEdge(t, workflowID, taskID, startID, http.StatusUnprocessableEntity)
	createBoundaryEdge(t, workflowID, endID, taskID, http.StatusUnprocessableEntity)
	createBoundaryEdge(t, workflowID, startID, endID, http.StatusUnprocessableEntity)
}

func TestStartWorkflowBoundaryOnlyRunReturnsCompleted(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	createBoundaryNode(t, workflowID, "Start", "start", http.StatusCreated)
	createBoundaryNode(t, workflowID, "End", "end", http.StatusCreated)
	if _, err := testPool.Exec(context.Background(), `
		UPDATE multica_workflow SET status = 'active' WHERE id = $1
	`, workflowID); err != nil {
		t.Fatalf("activate workflow: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/runs", workflowID), map[string]any{"input": map[string]any{}})
	testHandler.StartWorkflowRun(w, withURLParams(req, "id", workflowID))
	if w.Code != http.StatusCreated {
		t.Fatalf("start run: got %d: %s", w.Code, w.Body.String())
	}
	var response struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Status != service.RunStatusCompleted {
		t.Fatalf("response status = %s, want %s", response.Status, service.RunStatusCompleted)
	}
}

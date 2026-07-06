package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateNode_WithDeliverables(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// Create a workflow
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/workflows", map[string]any{
		"title": "Deliverable Test WF",
	})
	testHandler.CreateWorkflow(w, req)
	var createResp struct{ ID string }
	json.Unmarshal(w.Body.Bytes(), &createResp)
	wfID := createResp.ID
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID)
	})

	// Create node with deliverables
	w = httptest.NewRecorder()
	req = newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", wfID), map[string]any{
		"title":       "Node with deliverables",
		"worker_type": "human",
		"critic_type": "human",
		"deliverables": []map[string]any{
			{"type": "document", "name": "Design Doc", "requirements": "Must cover architecture"},
			{"type": "pull_request", "name": "Implementation PR", "requirements": "All tests pass"},
		},
	})
	req = withURLParams(req, "id", wfID)
	testHandler.CreateWorkflowNode(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var nodeResp struct {
		Deliverables []struct {
			Type string `json:"type"`
			Name string `json:"name"`
		} `json:"deliverables"`
	}
	json.Unmarshal(w.Body.Bytes(), &nodeResp)
	if len(nodeResp.Deliverables) != 2 {
		t.Fatalf("expected 2 deliverables, got %d", len(nodeResp.Deliverables))
	}
	if nodeResp.Deliverables[0].Type != "document" {
		t.Fatalf("expected first deliverable type 'document', got %q", nodeResp.Deliverables[0].Type)
	}
}

func TestCreateNode_InvalidDeliverableType(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/workflows", map[string]any{
		"title": "Invalid Deliv Type WF",
	})
	testHandler.CreateWorkflow(w, req)
	var createResp struct{ ID string }
	json.Unmarshal(w.Body.Bytes(), &createResp)
	wfID := createResp.ID
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID)
	})

	w = httptest.NewRecorder()
	req = newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", wfID), map[string]any{
		"title":       "Bad deliverable",
		"worker_type": "human",
		"critic_type": "human",
		"deliverables": []map[string]any{
			{"type": "invalid_type", "name": "Bad"},
		},
	})
	req = withURLParams(req, "id", wfID)
	testHandler.CreateWorkflowNode(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid deliverable type, got %d", w.Code)
	}
}

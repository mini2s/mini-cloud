package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUpdateWorkflowActivationDefersDefinitionPreflightAndIncrementsRevision(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	createWorkflow := httptest.NewRecorder()
	testHandler.CreateWorkflow(createWorkflow, newRequest(http.MethodPost, "/api/workflows", map[string]any{"title": "Activation without preflight"}))
	if createWorkflow.Code != http.StatusCreated {
		t.Fatalf("create workflow: status=%d body=%s", createWorkflow.Code, createWorkflow.Body.String())
	}
	var workflowResponse struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(createWorkflow.Body.Bytes(), &workflowResponse); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowResponse.ID) })

	createNode := httptest.NewRecorder()
	nodeRequest := withURLParam(newRequest(http.MethodPost, "/api/workflows/"+workflowResponse.ID+"/nodes", map[string]any{
		"title": "Unassigned agent node",
	}), "id", workflowResponse.ID)
	testHandler.CreateWorkflowNode(createNode, nodeRequest)
	if createNode.Code != http.StatusCreated {
		t.Fatalf("create node: status=%d body=%s", createNode.Code, createNode.Body.String())
	}

	activate := httptest.NewRecorder()
	activateRequest := withURLParam(newRequest(http.MethodPatch, "/api/workflows/"+workflowResponse.ID, map[string]any{"status": "active"}), "id", workflowResponse.ID)
	testHandler.UpdateWorkflow(activate, activateRequest)
	if activate.Code != http.StatusOK {
		t.Fatalf("activate workflow: status=%d body=%s", activate.Code, activate.Body.String())
	}

	var status string
	var revision int64
	if err := testPool.QueryRow(ctx, `SELECT status, config_revision FROM multica_workflow WHERE id = $1`, workflowResponse.ID).Scan(&status, &revision); err != nil {
		t.Fatal(err)
	}
	if status != "active" || revision != 2 {
		t.Fatalf("status=%q revision=%d, want active and 2", status, revision)
	}
}

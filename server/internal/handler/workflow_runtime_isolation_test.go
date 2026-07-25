package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestStartWorkflowRunReturnsStructuredConfigError(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	if _, err := testPool.Exec(context.Background(), `
		UPDATE multica_workflow SET status = 'active' WHERE id = $1
	`, workflowID); err != nil {
		t.Fatalf("activate workflow: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, fmt.Sprintf("/api/workflows/%s/runs", workflowID), map[string]any{"input": map[string]any{}})
	testHandler.StartWorkflowRun(w, withURLParams(req, "id", workflowID))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body struct {
		Code   string                        `json:"code"`
		RunID  string                        `json:"run_id"`
		Issues []service.WorkflowConfigIssue `json:"issues"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "workflow_config_invalid" || body.RunID == "" || len(body.Issues) == 0 {
		t.Fatalf("body=%#v", body)
	}
}

func TestWorkflowNodeRunResponseKeepsWorkflowNodeIDAlias(t *testing.T) {
	legacyID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	sourceID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	response := workflowNodeRunToResponse(db.MulticaWorkflowNodeRun{
		WorkflowNodeID: legacyID, SourceWorkflowNodeID: sourceID,
	})
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		WorkflowNodeID       string `json:"workflow_node_id"`
		SourceWorkflowNodeID string `json:"source_workflow_node_id"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.WorkflowNodeID == "" || body.WorkflowNodeID != body.SourceWorkflowNodeID {
		t.Fatalf("response=%s", raw)
	}
}

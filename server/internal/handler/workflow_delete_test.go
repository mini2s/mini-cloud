package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteWorkflowTemplateReturnsDerivedWorkflowConflictCode(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var templateID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status,
			created_by_type, created_by_id, is_template
		)
		VALUES ($1, 'delete conflict template', '', 'active', 'member', $2, true)
		RETURNING id
	`, testWorkspaceID, testUserID).Scan(&templateID); err != nil {
		t.Fatalf("create template: %v", err)
	}

	var derivedID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow (
			workspace_id, title, description, status,
			created_by_type, created_by_id, source_template_id
		)
		VALUES ($1, 'derived workflow', '', 'draft', 'member', $2, $3)
		RETURNING id
	`, testWorkspaceID, testUserID, templateID).Scan(&derivedID); err != nil {
		t.Fatalf("create derived workflow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, derivedID)
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, templateID)
	})

	w := httptest.NewRecorder()
	req := newRequest("DELETE", "/api/workflows/"+templateID, nil)
	req = withURLParam(req, "id", templateID)
	testHandler.DeleteWorkflow(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["code"] != "template_has_derived_workflows" {
		t.Fatalf("code = %v, want template_has_derived_workflows", resp["code"])
	}
}

func TestDeleteWorkflowWithRunReturnsHistoryConflictCode(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status, triggered_by_type, completed_at,
			source_config_revision, definition_schema_version, definition_snapshot, max_retries
		)
		SELECT id, workspace_id, title, 'completed', 'member', now(),
		       0, 0, '{"schema_version":0,"snapshot_origin":"legacy_backfill"}'::jsonb, 0
		FROM multica_workflow WHERE id = $1
		RETURNING id
	`, workflowID).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow_run WHERE id = $1`, runID)
	})

	w := httptest.NewRecorder()
	req := newRequest(http.MethodDelete, "/api/workflows/"+workflowID, nil)
	testHandler.DeleteWorkflow(w, withURLParam(req, "id", workflowID))

	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d, want 409: %s", w.Code, w.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["code"] != "workflow_has_runs" {
		t.Fatalf("code=%v, want workflow_has_runs", response["code"])
	}
}

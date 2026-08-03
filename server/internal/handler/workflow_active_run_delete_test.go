package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type activeRunDeleteFixture struct {
	workflowID  string
	nodeID      string
	deliverable string
	roleID      string
	runID       string
}

func newActiveRunDeleteFixture(t *testing.T) activeRunDeleteFixture {
	t.Helper()
	ctx := context.Background()
	workflowID := createTestWorkflow(t)
	cleanupBoundaryWorkflow(t, workflowID)
	nodeID := createBoundaryTaskNode(t, workflowID, "Captured task")

	var deliverableID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_deliverable
			(workflow_node_id, title, description, required, sort_order)
		VALUES ($1, 'Captured deliverable', '', true, 0)
		RETURNING id
	`, nodeID).Scan(&deliverableID); err != nil {
		t.Fatal(err)
	}

	roleName := fmt.Sprintf("Captured role %d", time.Now().UnixNano())
	var roleID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_role
			(workspace_id, name, normalized_name, description, is_builtin, needs_description, created_by)
		VALUES ($1, $2, lower($2), 'Captured by an active run', false, false, $3)
		RETURNING id
	`, testWorkspaceID, roleName, testUserID).Scan(&roleID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM multica_workflow_role WHERE id = $1`, roleID)
	})
	if _, err := testPool.Exec(ctx, `UPDATE multica_workflow_node SET worker_role_id = $2 WHERE id = $1`, nodeID, roleID); err != nil {
		t.Fatal(err)
	}

	var runID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_run (
			workflow_id, workspace_id, workflow_title, status, triggered_by_type,
			source_config_revision, definition_schema_version, definition_snapshot, max_retries
		)
		SELECT id, workspace_id, title, 'running', 'member', config_revision, 1,
		       jsonb_build_object('schema_version', 1, 'snapshot_origin', 'native'), max_retries
		FROM multica_workflow WHERE id = $1
		RETURNING id
	`, workflowID).Scan(&runID); err != nil {
		t.Fatal(err)
	}

	var nodeRunID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workflow_node_run (
			workflow_run_id, workflow_node_id, source_workflow_node_id, node_title, node_description,
			status, retry_count, format_schema, worker_type, critic_type,
			worker_role_snapshot, runtime_config, worker_name_snapshot, critic_name_snapshot
		) VALUES (
			$1, $2, $2, 'Captured task', '', 'pending', 0, '{}'::jsonb, 'role', 'human',
			jsonb_build_object('id', $3::text, 'name', 'Captured role'), '{}'::jsonb, '', ''
		)
		RETURNING id
	`, runID, nodeID, roleID).Scan(&nodeRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable
			(workflow_node_run_id, source_deliverable_id, title, description, required, sort_order)
		VALUES ($1, $2, 'Captured deliverable', '', true, 0)
	`, nodeRunID, deliverableID); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE multica_workflow_node SET worker_role_id = NULL WHERE id = $1`, nodeID); err != nil {
		t.Fatal(err)
	}

	return activeRunDeleteFixture{
		workflowID: workflowID, nodeID: nodeID, deliverable: deliverableID, roleID: roleID, runID: runID,
	}
}

func (f activeRunDeleteFixture) complete(t *testing.T) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		UPDATE multica_workflow_run SET status = 'completed', completed_at = now() WHERE id = $1
	`, f.runID); err != nil {
		t.Fatal(err)
	}
}

func assertWorkflowDefinitionInUse(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status=%d, want 409: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "workflow_definition_in_use" {
		t.Fatalf("code=%q, want workflow_definition_in_use", body.Code)
	}
}

func TestDeleteWorkflowNodeWithActiveRunReturnsConflict(t *testing.T) {
	f := newActiveRunDeleteFixture(t)
	deleteNode := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodDelete, "/api/workflows/"+f.workflowID+"/nodes/"+f.nodeID, nil)
		testHandler.DeleteWorkflowNode(w, withURLParams(req, "id", f.workflowID, "nodeId", f.nodeID))
		return w
	}
	assertWorkflowDefinitionInUse(t, deleteNode())
	f.complete(t)
	if w := deleteNode(); w.Code != http.StatusOK {
		t.Fatalf("completed run delete status=%d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestDeleteWorkflowNodeDeliverableWithActiveRunReturnsConflict(t *testing.T) {
	f := newActiveRunDeleteFixture(t)
	deleteDeliverable := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodDelete, "/api/workflows/"+f.workflowID+"/nodes/"+f.nodeID+"/deliverables/"+f.deliverable, nil)
		testHandler.DeleteWorkflowNodeDeliverable(w, withURLParams(req,
			"id", f.workflowID, "nodeId", f.nodeID, "deliverableId", f.deliverable))
		return w
	}
	assertWorkflowDefinitionInUse(t, deleteDeliverable())
	f.complete(t)
	if w := deleteDeliverable(); w.Code != http.StatusOK {
		t.Fatalf("completed run delete status=%d, want 200: %s", w.Code, w.Body.String())
	}
}

func TestDeleteWorkflowRoleWithActiveRunReturnsConflict(t *testing.T) {
	f := newActiveRunDeleteFixture(t)
	deleteRole := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := newRequest(http.MethodDelete, "/api/workspaces/"+testWorkspaceID+"/workflow-roles/"+f.roleID, nil)
		testHandler.DeleteWorkflowRole(w, withURLParams(req, "id", testWorkspaceID, "roleId", f.roleID))
		return w
	}
	assertWorkflowDefinitionInUse(t, deleteRole())
	f.complete(t)
	if w := deleteRole(); w.Code != http.StatusNoContent {
		t.Fatalf("completed run delete status=%d, want 204: %s", w.Code, w.Body.String())
	}
}

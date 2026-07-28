package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestValidateSplitReviewerConfig(t *testing.T) {
	splitFormat := []byte(`{"type":"split"}`)
	memberID := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}
	roleID := pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	tests := []struct {
		name       string
		criticType string
		criticID   pgtype.UUID
		roleID     pgtype.UUID
		apiURL     pgtype.Text
		wantErr    bool
	}{
		{name: "direct member", criticType: "human", criticID: memberID},
		{name: "member role", criticType: "human", roleID: roleID},
		{name: "agent", criticType: "agent", criticID: memberID, wantErr: true},
		{name: "api", criticType: "api", apiURL: pgtype.Text{String: "https://example.com/review", Valid: true}, wantErr: true},
		{name: "both member and role", criticType: "human", criticID: memberID, roleID: roleID, wantErr: true},
		{name: "missing reviewer allowed while drafting", criticType: "human"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSplitReviewerConfig(splitFormat, tt.criticType, tt.criticID, tt.roleID, tt.apiURL)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateSplitReviewerConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestCreateWorkflowNodeRejectsInactiveHumanWorker(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	pendingUserID := helperTestUser(t, "Pending Workflow Worker", "pending-workflow-worker@multica.ai")
	helperAddUserToWorkspaceWithStatus(t, pendingUserID, "member", "pending_activation")

	workflowID := createTestWorkflow(t)
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title":       "Inactive worker node",
		"worker_type": "human",
		"worker_id":   pendingUserID,
		"critic_type": "human",
	})
	req = withURLParams(req, "id", workflowID)
	testHandler.CreateWorkflowNode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("CreateWorkflowNode with inactive worker: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "inactive workspace member") {
		t.Fatalf("CreateWorkflowNode with inactive worker: expected inactive member error, got %s", w.Body.String())
	}
}

func TestUpdateWorkflowNodeRejectsInactiveHumanCritic(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	pendingUserID := helperTestUser(t, "Pending Workflow Critic", "pending-workflow-critic@multica.ai")
	helperAddUserToWorkspaceWithStatus(t, pendingUserID, "member", "pending_activation")

	workflowID := createTestWorkflow(t)
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	w := httptest.NewRecorder()
	req := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title":       "Node to update",
		"worker_type": "human",
		"critic_type": "human",
	})
	req = withURLParams(req, "id", workflowID)
	testHandler.CreateWorkflowNode(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateWorkflowNode fixture: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode CreateWorkflowNode response: %v", err)
	}
	nodeID := createResp.ID

	w = httptest.NewRecorder()
	req = newRequest("PUT", fmt.Sprintf("/api/workflows/%s/nodes/%s", workflowID, nodeID), map[string]any{
		"critic_type": "human",
		"critic_id":   pendingUserID,
	})
	req = withURLParams(req, "id", workflowID, "nodeId", nodeID)
	testHandler.UpdateWorkflowNode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("UpdateWorkflowNode with inactive critic: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "inactive workspace member") {
		t.Fatalf("UpdateWorkflowNode with inactive critic: expected inactive member error, got %s", w.Body.String())
	}
}

// TestUpdateWorkflowNodeSwitchesFromInactiveWorkerToRole exercises the bug
// where switching a node from a concrete worker (whose user has since become
// inactive) to a role-based assignment was rejected because the handler
// validated the stale previous worker_id instead of the value that actually
// gets persisted. Role-based assignment clears worker_id in the SQL upsert,
// so the inactive prior worker must not block the save.
func TestUpdateWorkflowNodeSwitchesFromInactiveWorkerToRole(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	// Start the user as active so the initial node creation succeeds.
	workerUserID := helperTestUser(t, "Stale Workflow Worker", "stale-workflow-worker@multica.ai")
	helperAddUserToWorkspaceWithStatus(t, workerUserID, "member", "active")

	workflowID := createTestWorkflow(t)
	t.Cleanup(func() {
		_, _ = testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, workflowID)
	})

	createW := httptest.NewRecorder()
	createReq := newRequest("POST", fmt.Sprintf("/api/workflows/%s/nodes", workflowID), map[string]any{
		"title":       "Role switch node",
		"worker_type": "human",
		"worker_id":   workerUserID,
		"critic_type": "human",
	})
	createReq = withURLParams(createReq, "id", workflowID)
	testHandler.CreateWorkflowNode(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("CreateWorkflowNode fixture: expected 201, got %d: %s", createW.Code, createW.Body.String())
	}
	var createResp struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(createW.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode CreateWorkflowNode response: %v", err)
	}
	nodeID := createResp.ID

	// Self-seed a workflow role for the test workspace. The shared handler
	// fixture creates the workspace via raw SQL (bypassing CreateWorkspace),
	// so no builtin roles exist — we insert one mirroring migration 135.
	var roleID string
	if err := testPool.QueryRow(ctx, `
INSERT INTO multica_workflow_role (workspace_id, name, normalized_name, description, is_builtin, needs_description)
VALUES ($1, 'developer', 'developer', 'Implements product changes.', true, false)
RETURNING id`, testWorkspaceID).Scan(&roleID); err != nil {
		t.Fatalf("seed workflow role: %v", err)
	}

	// Deactivate the worker after the node was created so the prior worker_id
	// is now stale.
	if _, err := testPool.Exec(ctx,
		`UPDATE multica_member SET status = 'pending_activation' WHERE workspace_id = $1 AND user_id = $2`,
		testWorkspaceID, workerUserID,
	); err != nil {
		t.Fatalf("deactivate member: %v", err)
	}

	w := httptest.NewRecorder()
	req := newRequest("PUT", fmt.Sprintf("/api/workflows/%s/nodes/%s", workflowID, nodeID), map[string]any{
		"worker_type":    "human",
		"worker_id":      nil,
		"worker_role_id": roleID,
	})
	req = withURLParams(req, "id", workflowID, "nodeId", nodeID)
	testHandler.UpdateWorkflowNode(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("UpdateWorkflowNode switching to role with stale inactive worker: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		WorkerRoleID *string `json:"worker_role_id"`
		WorkerID     *string `json:"worker_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode UpdateWorkflowNode response: %v", err)
	}
	if resp.WorkerRoleID == nil || *resp.WorkerRoleID != roleID {
		t.Fatalf("expected worker_role_id=%s, got %+v", roleID, resp.WorkerRoleID)
	}
	if resp.WorkerID != nil {
		t.Fatalf("expected worker_id to be cleared, got %q", *resp.WorkerID)
	}
}

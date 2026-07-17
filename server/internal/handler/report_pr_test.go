package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

// seedDeliverableAndNodeRunIn inserts a workflow→node→run→node_run→deliverable
// chain under the given workspace and returns the node-run + deliverable IDs.
// creatorID is used for created_by/triggered_by (these columns have no FK).
func seedDeliverableAndNodeRunIn(t *testing.T, workspaceID, creatorID string) (nodeRunID, deliverableID string) {
	t.Helper()
	ctx := context.Background()
	wfID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow (id, workspace_id, title, status, created_by_type, created_by_id)
		VALUES ($1, $2, 'WF', 'active', 'member', $3)`,
		wfID, workspaceID, creatorID); err != nil {
		t.Fatalf("seed workflow: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workflow WHERE id = $1`, wfID) })

	nodeID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node (id, workflow_id, title, worker_type, critic_type)
		VALUES ($1, $2, 'N', 'agent', 'agent')`, nodeID, wfID); err != nil {
		t.Fatalf("seed node: %v", err)
	}
	dID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, $2, 'document', 'Doc', true)`, dID, nodeID); err != nil {
		t.Fatalf("seed deliverable: %v", err)
	}
	runID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_run (id, workflow_id, workspace_id, workflow_title, status, triggered_by_type, triggered_by_id)
		VALUES ($1, $2, $3, 'R', 'running', 'member', $4)`, runID, wfID, workspaceID, creatorID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	nrID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run (id, workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, critic_type)
		VALUES ($1, $2, $3, 'N', 'working', 0, 'agent', 'agent')`, nrID, runID, nodeID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	return nrID, dID
}

func TestHandleReportDeliverablePR(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	nodeRunID, deliverableID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	body := map[string]string{"pull_request_url": "https://gitea.example.com/t-7f3c9a1e/wf-11111111/pulls/9"}
	req := newDaemonTokenRequest(http.MethodPost, "/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr", body, testWorkspaceID, "test-daemon")
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", deliverableID)
	rec := httptest.NewRecorder()
	testHandler.HandleReportDeliverablePR(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var url, status string
	err := testPool.QueryRow(context.Background(),
		`SELECT pull_request_url, status FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1 AND deliverable_id = $2`,
		nodeRunID, deliverableID).Scan(&url, &status)
	if err != nil {
		t.Fatalf("read submission: %v", err)
	}
	if url != body["pull_request_url"] {
		t.Errorf("pull_request_url = %q", url)
	}
	if status != "submitted" {
		t.Errorf("status = %q, want submitted", status)
	}
	// The response must carry pull_request_url as a plain string (DTO shape),
	// not the raw pgtype row (which would serialize UUID/Timestamptz fields as
	// {"Bytes":...,"Valid":...} objects). Pins the regression where the handler
	// returned db.MulticaWorkflowNodeDeliverableSubmission directly.
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	urlField, ok := resp["pull_request_url"].(string)
	if !ok || urlField != body["pull_request_url"] {
		t.Errorf("response pull_request_url = %#v, want string %q", resp["pull_request_url"], body["pull_request_url"])
	}
}

// TestHandleReportDeliverablePR_RejectsForeignWorkspace pins the IDOR fix: a
// daemon authenticated against workspace A must NOT be able to record a PR
// against a deliverable whose node run lives in workspace B. The daemon token
// is obtained for testWorkspaceID; the seeded chain belongs to a foreign
// workspace. The handler must 404 and write no submission row.
func TestHandleReportDeliverablePR_RejectsForeignWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var foreignWsID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO multica_workspace (name, slug, description, issue_prefix)
		VALUES ('Foreign report-pr', 'foreign-report-pr', 'foreign workspace for IDOR test', 'FRP')
		RETURNING id`).Scan(&foreignWsID); err != nil {
		t.Fatalf("seed foreign workspace: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_workspace WHERE id = $1`, foreignWsID) })

	nodeRunID, deliverableID := seedDeliverableAndNodeRunIn(t, foreignWsID, testUserID)

	body := map[string]string{"pull_request_url": "https://gitea.example.com/foreign/pulls/1"}
	// Daemon token bound to testWorkspaceID — must not touch the foreign run.
	req := newDaemonTokenRequest(http.MethodPost, "/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr", body, testWorkspaceID, "attacker-daemon")
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", deliverableID)
	rec := httptest.NewRecorder()
	testHandler.HandleReportDeliverablePR(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign-workspace node run, got %d: %s", rec.Code, rec.Body.String())
	}
	// No submission must have been persisted.
	var count int
	if err := testPool.QueryRow(ctx,
		`SELECT count(*) FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1 AND deliverable_id = $2`,
		nodeRunID, deliverableID).Scan(&count); err != nil {
		t.Fatalf("count submissions: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no submission row on rejected foreign-workspace report-pr, got %d", count)
	}
}

// TestHandleReportDeliverablePR_EmptyURL pins the 400 path for a missing
// pull_request_url. The ownership check must NOT have run for this request
// (it would 404 on the seed's valid IDs instead of reaching the 400 guard).
func TestHandleReportDeliverablePR_EmptyURL(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	nodeRunID, deliverableID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newDaemonTokenRequest(http.MethodPost,
		"/api/daemon/node-runs/"+nodeRunID+"/deliverables/"+deliverableID+"/report-pr",
		map[string]string{"pull_request_url": ""}, testWorkspaceID, "test-daemon")
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", deliverableID)
	rec := httptest.NewRecorder()
	testHandler.HandleReportDeliverablePR(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for empty url, body = %s", rec.Code, rec.Body.String())
	}
}

// TestHandleReportDeliverablePR_InvalidUUID pins the parseUUIDOrBadRequest
// path: a malformed nodeRunId / deliverableId must yield 400 before any DB
// call is made.
func TestHandleReportDeliverablePR_InvalidUUID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	req := newDaemonTokenRequest(http.MethodPost,
		"/api/daemon/node-runs/not-a-uuid/deliverables/also-bad/report-pr",
		map[string]string{"pull_request_url": "x"}, testWorkspaceID, "test-daemon")
	req = withURLParams(req, "nodeRunId", "not-a-uuid", "deliverableId", "also-bad")
	rec := httptest.NewRecorder()
	testHandler.HandleReportDeliverablePR(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for invalid UUID, body = %s", rec.Code, rec.Body.String())
	}
}

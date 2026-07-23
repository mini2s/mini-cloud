package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestSubmitNodeRunDeliverable_RejectsDocumentContentUpload asserts that a
// content upload for a document deliverable is rejected with 422 — but ONLY
// when the platform Gitea is configured (dormant deployments keep the legacy
// inline-content path). Document bodies live in Gitea once it's provisioned;
// the agent submits them via the report-pr flow instead.
func TestSubmitNodeRunDeliverable_RejectsDocumentContentUpload(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"content": "# my document"})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", docID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (document content rejected when Gitea configured). body=%s", rec.Code, rec.Body.String())
	}
}

// TestSubmitNodeRunDeliverable_AllowsDocumentPullRequestURL asserts that a
// document submission carrying only pull_request_url (the pointer into Gitea)
// is still accepted even when Gitea is configured — the report-pr pointer is
// exactly the path document deliverables are supposed to take.
func TestSubmitNodeRunDeliverable_AllowsDocumentPullRequestURL(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"pull_request_url": "https://gitea.test/t-aaa/wf-bbb/pulls/1"})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", docID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (pull_request_url pointer is allowed). body=%s", rec.Code, rec.Body.String())
	}
}

// TestSubmitNodeRunDeliverable_AllowsDocumentContentWhenDormant asserts that
// when Gitea is NOT configured, a document content upload is accepted (200) —
// dormant deployments keep the legacy inline-content behavior.
func TestSubmitNodeRunDeliverable_AllowsDocumentContentWhenDormant(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "")
	t.Setenv("GITEA_ADMIN_TOKEN", "")

	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"content": "# my document"})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", docID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (document content allowed when Gitea dormant). body=%s", rec.Code, rec.Body.String())
	}
}

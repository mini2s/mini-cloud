package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestHandleGetIssueGiteaDeliverablesAcceptsWorkspaceHeader(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")

	ctx := context.Background()
	nodeRunID, deliverableID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	var runID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`,
		nodeRunID).Scan(&runID); err != nil {
		t.Fatalf("read run id: %v", err)
	}

	issueID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_issue (
			id, workspace_id, title, status, priority, creator_type, creator_id,
			workflow_run_id
		)
		VALUES ($1, $2, 'Gitea issue', 'todo', 'none', 'member', $3, $4)`,
		issueID, testWorkspaceID, testUserID, runID); err != nil {
		t.Fatalf("seed issue: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM multica_issue WHERE id = $1`, issueID) })

	req := newRequestAs(testUserID, http.MethodGet, "/api/daemon/issues/"+issueID+"/gitea-deliverables", nil)
	req.Header.Set("X-Workspace-ID", testWorkspaceID)
	req = withURLParam(req, "issue", issueID)
	rec := httptest.NewRecorder()

	testHandler.HandleGetIssueGiteaDeliverables(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out IssueGiteaDeliverablesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Issues) != 1 || out.Issues[0].Gitea == nil {
		t.Fatalf("expected one issue with gitea context, got %+v", out)
	}
	if got := out.Issues[0].Gitea.Deliverables[0].DeliverableID; got != deliverableID {
		t.Fatalf("deliverable_id = %q, want %q", got, deliverableID)
	}
}

// TestGiteaContextForRun_DefaultWorkflowUsesArchiveRepo asserts that when the
// run's snapshot marks the workflow as default, the repo name is
// wf-deliverable-archive.
func TestGiteaContextForRun_DefaultWorkflowUsesArchiveRepo(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	var runID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`,
		nodeRunID).Scan(&runID); err != nil {
		t.Fatalf("read run id: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow_run
		SET definition_snapshot = jsonb_set(definition_snapshot, '{workflow,is_default}', 'true'::jsonb)
		WHERE id = $1`, runID); err != nil {
		t.Fatalf("mark run snapshot default: %v", err)
	}

	got := testHandler.giteaContextForRun(ctx, parseUUID(runID))
	if got == nil {
		t.Fatal("expected non-nil context")
	}
	if got.Repo != "wf-deliverable-archive" {
		t.Fatalf("Repo = %q, want wf-deliverable-archive", got.Repo)
	}
	if want := "/" + got.Owner + "/wf-deliverable-archive.git"; !strings.HasSuffix(got.CloneURL, want) {
		t.Fatalf("CloneURL = %q, want suffix %q", got.CloneURL, want)
	}
}

// TestGiteaContextForRun_IncludesPullRequestKindDeliverables asserts that
// pull_request-kind deliverables appear in the Gitea context alongside document
// deliverables. Previously, the giteaContextForRun filter skipped non-document
// kinds; now all deliverable kinds are included.
func TestGiteaContextForRun_IncludesPullRequestKindDeliverables(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	// Seed a pull_request-kind deliverable on the same node.
	prDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, title, required)
		VALUES ($1, (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $2), 'Source MR', true)
	`, prDeliverableID, nodeRunID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	// Insert the runtime-level row so ListNodeRunDeliverableRequirements finds it.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable (
			id, workflow_node_run_id, source_deliverable_id, title, description, required, sort_order
		) VALUES ($1, $2, $3, 'Source MR', '', true, 0)
	`, prDeliverableID, nodeRunID, prDeliverableID); err != nil {
		t.Fatalf("seed pull_request runtime deliverable: %v", err)
	}

	var runID string
	if err := testPool.QueryRow(ctx,
		`SELECT workflow_run_id FROM multica_workflow_node_run WHERE id = $1`,
		nodeRunID).Scan(&runID); err != nil {
		t.Fatalf("read run id: %v", err)
	}

	got := testHandler.giteaContextForRun(ctx, parseUUID(runID))
	if got == nil {
		t.Fatal("expected non-nil context")
	}
	// The context must include both deliverables (document + pull_request).
	if len(got.Deliverables) != 2 {
		t.Fatalf("expected 2 deliverables in context, got %d: %+v", len(got.Deliverables), got.Deliverables)
	}

	// Find the pull_request-kind deliverable by ID.
	var found bool
	for _, d := range got.Deliverables {
		if d.DeliverableID == prDeliverableID && d.Title == "Source MR" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("pull_request-kind deliverable %q not found in gitea context", prDeliverableID)
	}
}

// TestGiteaContextForNodeRun_IncludesPullRequestKindDeliverables asserts the
// same for giteaContextForNodeRun: pull_request-kind deliverables are no longer
// filtered out.
func TestGiteaContextForNodeRun_IncludesPullRequestKindDeliverables(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	// Seed a pull_request-kind deliverable on the same node.
	prDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, title, required)
		VALUES ($1, (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $2), 'Source MR', true)
	`, prDeliverableID, nodeRunID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable (
			id, workflow_node_run_id, source_deliverable_id, title, description, required, sort_order
		) VALUES ($1, $2, $3, 'Source MR', '', true, 0)
	`, prDeliverableID, nodeRunID, prDeliverableID); err != nil {
		t.Fatalf("seed pull_request runtime deliverable: %v", err)
	}

	got := testHandler.giteaContextForNodeRun(ctx, parseUUID(nodeRunID))
	if got == nil {
		t.Fatal("expected non-nil context")
	}
	if len(got.Deliverables) != 2 {
		t.Fatalf("expected 2 deliverables in context, got %d: %+v", len(got.Deliverables), got.Deliverables)
	}

	var found bool
	for _, d := range got.Deliverables {
		if d.ID == prDeliverableID && d.Title == "Source MR" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("pull_request-kind deliverable %q not found in node-run gitea context", prDeliverableID)
	}
}

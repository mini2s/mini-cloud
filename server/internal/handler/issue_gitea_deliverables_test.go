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
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

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

func TestGiteaContextForRun_DefaultWorkflowUsesArchiveRepo(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.example.com")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

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

package handler

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// dbTaskWithNodeRun builds a minimal db.MulticaAgentTaskQueue whose only
// populated field is WorkflowNodeRunID — the single field
// buildGiteaDeliverableContext reads. All other fields are left as zero
// values; the builder does not consult them.
func dbTaskWithNodeRun(t *testing.T, nodeRunID string) db.MulticaAgentTaskQueue {
	t.Helper()
	return db.MulticaAgentTaskQueue{
		WorkflowNodeRunID: parseUUID(nodeRunID),
	}
}

// TestBuildGiteaDeliverableContext_Configured seeds a node run with a document
// deliverable (and a pull_request deliverable that must NOT appear) and asserts
// the builder returns owner/repo/inst/node-branch + exactly one document ref
// whose Path matches nodes/<short>/<short>.md.
func TestBuildGiteaDeliverableContext_Configured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	ctx := context.Background()
	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	// Add a pull_request deliverable on the same node to verify the kind
	// filter excludes non-document deliverables.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $2), 'pull_request', 'Code', true)`,
		uuid.NewString(), nodeRunID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	task := dbTaskWithNodeRun(t, nodeRunID)
	got := testHandler.buildGiteaDeliverableContext(ctx, task)
	if got == nil {
		t.Fatal("expected non-nil context when Gitea configured + document deliverable present")
	}
	if len(got.Deliverables) != 1 || got.Deliverables[0].ID != docID {
		t.Fatalf("expected exactly the document deliverable %s, got %+v", docID, got.Deliverables)
	}
	for _, f := range []string{got.Owner, got.Repo, got.InstBranch, got.NodeBranch, got.Deliverables[0].Path, got.Deliverables[0].Title} {
		if f == "" {
			t.Errorf("empty field in context: %+v", got)
		}
	}
	// Path is ID-derived: nodes/<nrShort>/<docShort>.md — shortHex of a UUID
	// equals its first 8 hex chars (the UUID's first segment is 8 hex chars
	// in canonical form, and shortHex hex-encodes the first 4 bytes).
	wantPath := "nodes/" + nodeRunID[:8] + "/" + docID[:8] + ".md"
	if gotPath := got.Deliverables[0].Path; gotPath != wantPath {
		t.Errorf("Path = %q, want %q", gotPath, wantPath)
	}
	// The owner/repo/branches are also derived from the same shortHex of
	// the underlying UUIDs, so we can assert their shape against the
	// canonical UUID prefix.
	if want := "t-" + testWorkspaceID[:8]; got.Owner != want {
		t.Errorf("Owner = %q, want %q", got.Owner, want)
	}
	// CloneURL is the single source of truth (spec §10.3.1): full
	// <base>/<owner>/<repo>.git, server-concatenated so the CLI never self-builds.
	wantSuffix := "/" + got.Owner + "/" + got.Repo + ".git"
	if got.CloneURL == "" || !strings.HasSuffix(got.CloneURL, wantSuffix) {
		t.Errorf("CloneURL = %q, want suffix %q", got.CloneURL, wantSuffix)
	}
	// round-trip through JSON (the daemon deserializes the claim response
	// this way and the JSON tags are the wire contract).
	bs, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var rt GiteaDeliverableContext
	if err := json.Unmarshal(bs, &rt); err != nil {
		t.Fatalf("round-trip: %v", err)
	}
	if rt.Owner != got.Owner || rt.Repo != got.Repo || rt.InstBranch != got.InstBranch ||
		rt.NodeBranch != got.NodeBranch || len(rt.Deliverables) != 1 ||
		rt.Deliverables[0].ID != docID || rt.Deliverables[0].Path != wantPath {
		t.Errorf("JSON round-trip drifted: got %+v from %s", rt, string(bs))
	}
}

func TestBuildGiteaDeliverableContext_DefaultWorkflowUsesArchiveRepo(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	if _, err := testPool.Exec(ctx, `
		UPDATE multica_workflow
		SET is_default = TRUE
		WHERE id = (
			SELECT wr.workflow_id
			FROM multica_workflow_run wr
			JOIN multica_workflow_node_run nr ON nr.workflow_run_id = wr.id
			WHERE nr.id = $1
		)`, nodeRunID); err != nil {
		t.Fatalf("mark workflow default: %v", err)
	}

	got := testHandler.buildGiteaDeliverableContext(ctx, dbTaskWithNodeRun(t, nodeRunID))
	if got == nil {
		t.Fatal("expected non-nil context")
	}
	if got.Repo != "deliverable-archive" {
		t.Fatalf("Repo = %q, want deliverable-archive", got.Repo)
	}
	if !strings.Contains(got.CloneURL, "/deliverable-archive.git") {
		t.Fatalf("CloneURL = %q, want archive repo clone URL", got.CloneURL)
	}
}

// TestBuildGiteaDeliverableContext_Dormant asserts nil when Gitea is
// unconfigured, and also when Gitea IS configured but the task has no
// workflow node-run — proving dormancy isn't only the !isGiteaConfigured() arm.
func TestBuildGiteaDeliverableContext_Dormant(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Run("Gitea unconfigured", func(t *testing.T) {
		t.Setenv("GITEA_BASE_URL", "")
		t.Setenv("GITEA_ADMIN_TOKEN", "")
		task := dbTaskWithNodeRun(t, uuid.NewString())
		if got := testHandler.buildGiteaDeliverableContext(context.Background(), task); got != nil {
			t.Fatalf("expected nil when dormant, got %+v", got)
		}
	})
	t.Run("Gitea configured, no node-run", func(t *testing.T) {
		t.Setenv("GITEA_BASE_URL", "https://gitea.test")
		t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")
		// Zero-value task: WorkflowNodeRunID.Valid == false, so the builder
		// short-circuits at the dormant guard before any DB call.
		task := db.MulticaAgentTaskQueue{}
		if got := testHandler.buildGiteaDeliverableContext(context.Background(), task); got != nil {
			t.Fatalf("expected nil when no node-run, got %+v", got)
		}
	})
}

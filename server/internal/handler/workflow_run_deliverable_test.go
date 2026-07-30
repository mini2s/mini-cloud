package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/service"
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
		INSERT INTO multica_workflow_run (
			id, workflow_id, workspace_id, workflow_title, status, triggered_by_type,
			triggered_by_id, definition_schema_version, definition_snapshot
		)
		VALUES (
			$1, $2, $3, 'R', 'running', 'member', $4, 1,
			jsonb_build_object(
				'schema_version', 1, 'snapshot_origin', 'native',
				'workflow', jsonb_build_object('id', $2::uuid, 'workspace_id', $3::uuid, 'title', 'R', 'is_default', false),
				'nodes', jsonb_build_array(jsonb_build_object('id', $5::uuid, 'title', 'N', 'sort_order', 0)),
				'edges', '[]'::jsonb, 'stages', '[]'::jsonb, 'roles', '[]'::jsonb, 'deliverables', '[]'::jsonb
			)
		)`, runID, wfID, workspaceID, creatorID, nodeID); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	nrID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run (id, workflow_run_id, workflow_node_id, node_title, status, retry_count, worker_type, critic_type)
		VALUES ($1, $2, $3, 'N', 'working', 0, 'agent', 'agent')`, nrID, runID, nodeID); err != nil {
		t.Fatalf("seed node run: %v", err)
	}
	runtimeDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable (
			id, workflow_node_run_id, source_deliverable_id, kind, title, description, required, sort_order
		) VALUES ($1, $2, $3, 'document', 'Doc', '', true, 0)
	`, runtimeDeliverableID, nrID, dID); err != nil {
		t.Fatalf("seed runtime deliverable: %v", err)
	}
	return nrID, runtimeDeliverableID
}

// TestSubmitNodeRunDeliverable_RejectsContentUploadWhenGiteaConfigured asserts
// that a content upload for ANY deliverable kind is rejected with 422 when the
// platform Gitea is configured. The kind column is no longer consulted — the
// rejection is uniform for all deliverables.
func TestSubmitNodeRunDeliverable_RejectsContentUploadWhenGiteaConfigured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	// seedDeliverableAndNodeRunIn creates a document-kind deliverable.
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
		t.Fatalf("status = %d, want 422 (content rejected when Gitea configured). body=%s", rec.Code, rec.Body.String())
	}
}

// TestSubmitNodeRunDeliverable_RejectsPullRequestKindContentWhenGiteaConfigured
// asserts that the kind-agnostic rejection also covers pull_request-kind
// deliverables — previously only document-kind was rejected.
func TestSubmitNodeRunDeliverable_RejectsPullRequestKindContentWhenGiteaConfigured(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("GITEA_BASE_URL", "https://gitea.test")
	t.Setenv("GITEA_ADMIN_TOKEN", "admin-tok")

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)

	// Add a pull_request-kind deliverable on the same node.
	prDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $2), 'pull_request', 'Source MR', true)
	`, prDeliverableID, nodeRunID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	// We need the pull_request deliverable to be a valid target for submission.
	// Insert a runtime-level row for it too.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable (
			id, workflow_node_run_id, source_deliverable_id, kind, title, description, required, sort_order
		) VALUES ($1, $2, $3, 'pull_request', 'Source MR', '', true, 0)
	`, prDeliverableID, nodeRunID, prDeliverableID); err != nil {
		t.Fatalf("seed pull_request runtime deliverable: %v", err)
	}

	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+prDeliverableID+"/submit",
		map[string]any{"content": "# some inline content"})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", prDeliverableID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (pull_request content also rejected when Gitea configured). body=%s", rec.Code, rec.Body.String())
	}
}

// TestSubmitNodeRunDeliverable_AllowsPullRequestURLWhenGiteaConfigured asserts that a
// submission carrying only pull_request_url is accepted even when Gitea is
// configured — the PR URL pointer is the intended submission path.
func TestSubmitNodeRunDeliverable_AllowsPullRequestURLWhenGiteaConfigured(t *testing.T) {
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

// TestSubmitNodeRunDeliverable_AllowsContentWhenDormant asserts that
// when Gitea is NOT configured, an inline content upload is accepted (200) —
// dormant deployments keep the legacy inline-content behavior.
func TestSubmitNodeRunDeliverable_AllowsContentWhenDormant(t *testing.T) {
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
		t.Fatalf("status = %d, want 200 (content allowed when Gitea dormant). body=%s", rec.Code, rec.Body.String())
	}
}

// handlerSpyRepoProvider is a coderepo.RepositoryProvider spy for the handler
// layer: it records UpsertFile calls and signals each one via a channel so the
// test can wait for the async archive goroutine to complete. Other interface
// methods are stubbed to no-op.
type handlerSpyRepoProvider struct {
	mu       sync.Mutex
	upserts  []handlerSpyUpsert
	signalCh chan struct{}
}

type handlerSpyUpsert struct {
	Owner, Repo, Branch, Path, Content, Message string
}

func newHandlerSpyRepoProvider() *handlerSpyRepoProvider {
	return &handlerSpyRepoProvider{signalCh: make(chan struct{}, 16)}
}

func (s *handlerSpyRepoProvider) Name() coderepo.Provider { return coderepo.ProviderGitea }
func (s *handlerSpyRepoProvider) Configured() bool        { return true }
func (s *handlerSpyRepoProvider) CreateBranch(ctx context.Context, owner, repo, branch, fromRef string) error {
	return nil
}
func (s *handlerSpyRepoProvider) UpsertFile(ctx context.Context, owner, repo, branch, p, content, message string) error {
	s.mu.Lock()
	s.upserts = append(s.upserts, handlerSpyUpsert{owner, repo, branch, p, content, message})
	s.mu.Unlock()
	select {
	case s.signalCh <- struct{}{}:
	default:
	}
	return nil
}
func (s *handlerSpyRepoProvider) OpenReviewRequest(ctx context.Context, owner, repo, head, base, title string) (string, error) {
	return "", nil
}
func (s *handlerSpyRepoProvider) MergeReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return nil
}
func (s *handlerSpyRepoProvider) CloseReviewRequest(ctx context.Context, owner, repo string, index int) error {
	return nil
}
func (s *handlerSpyRepoProvider) ListOrgMembers(ctx context.Context, org string) ([]coderepo.OrgMember, error) {
	return nil, nil
}

func (s *handlerSpyRepoProvider) snapshot() []handlerSpyUpsert {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]handlerSpyUpsert, len(s.upserts))
	copy(out, s.upserts)
	return out
}

// waitForCall blocks until at least n UpsertFile calls are recorded or the
// timeout elapses. Returns the recorded calls snapshot.
func (s *handlerSpyRepoProvider) waitForCall(t *testing.T, n int, timeout time.Duration) []handlerSpyUpsert {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		snap := s.snapshot()
		if len(snap) >= n {
			return snap
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return snap
		}
		select {
		case <-s.signalCh:
		case <-time.After(remaining):
		}
	}
}

// TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer asserts that a submission
// carrying a GitLab MR URL triggers ArchiveCodeDeliverable asynchronously —
// the response is 200 (not blocked by the archive) and the spy provider records
// an UpsertFile at the code/<deliverableID>.md path. Only GitLab MR URLs
// trigger the archive; Gitea PRs are managed via the review merge flow.
func TestSubmitNodeRunDeliverable_ArchivesGitLabMRPointer(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	originalSvc := testHandler.WorkflowService
	spy := newHandlerSpyRepoProvider()
	// Swap in a WorkflowService whose RepositoryProvider is the spy. The Queries
	// are reused so the rest of the handler (submission lookup, etc.) works
	// against the real DB. Restored on cleanup so the shared handler is untouched
	// for subsequent tests.
	testHandler.WorkflowService = &service.WorkflowService{
		Queries:            originalSvc.Queries,
		RepositoryProvider: spy,
	}
	t.Cleanup(func() { testHandler.WorkflowService = originalSvc })

	ctx := context.Background()
	nodeRunID, _ := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	// Add a pull_request-kind deliverable on the same node — archiving under
	// code/<id>.md is semantically a code-MR pointer.
	prDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		VALUES ($1, (SELECT workflow_node_id FROM multica_workflow_node_run WHERE id = $2), 'pull_request', 'Source MR', true)
	`, prDeliverableID, nodeRunID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
	}

	// Also insert the runtime-level row so UpsertNodeRunDeliverableSubmission can
	// find it.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_run_deliverable (
			id, workflow_node_run_id, source_deliverable_id, kind, title, description, required, sort_order
		) VALUES ($1, $2, $3, 'pull_request', 'Source MR', '', true, 0)
	`, prDeliverableID, nodeRunID, prDeliverableID); err != nil {
		t.Fatalf("seed pull_request runtime deliverable: %v", err)
	}

	const mrURL = "https://gitlab.example.com/group/proj/-/merge_requests/42"
	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+prDeliverableID+"/submit",
		map[string]any{"pull_request_url": mrURL})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", prDeliverableID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	// The response must be 200 and not wait on the async archive.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	calls := spy.waitForCall(t, 1, 3*time.Second)
	if len(calls) < 1 {
		t.Fatalf("expected ArchiveCodeDeliverable to fire; spy recorded %d calls", len(calls))
	}
	got := calls[0]
	wantSuffix := "/code/" + prDeliverableID + ".md"
	if !strings.HasSuffix(got.Path, wantSuffix) {
		t.Errorf("UpsertFile path = %q, want suffix %q", got.Path, wantSuffix)
	}
	if !strings.Contains(got.Content, mrURL) {
		t.Errorf("UpsertFile content missing MR URL %q; content=%q", mrURL, got.Content)
	}
}

// TestSubmitNodeRunDeliverable_DoesNotArchiveGiteaPR asserts that a Gitea PR
// URL does NOT trigger ArchiveCodeDeliverable. The archive guard dispatches
// by URL host: Gitea PRs are managed via the review merge flow and don't need
// a code/<id>.md pointer. Only GitLab MR URLs trigger the archive.
func TestSubmitNodeRunDeliverable_DoesNotArchiveGiteaPR(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	originalSvc := testHandler.WorkflowService
	spy := newHandlerSpyRepoProvider()
	testHandler.WorkflowService = &service.WorkflowService{
		Queries:            originalSvc.Queries,
		RepositoryProvider: spy,
	}
	t.Cleanup(func() { testHandler.WorkflowService = originalSvc })

	ctx := context.Background()
	// seedDeliverableAndNodeRunIn creates a DOCUMENT-kind deliverable.
	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	// Submit a Gitea PR URL for the document deliverable. The archive must NOT
	// fire because the URL is Gitea-hosted, not GitLab-hosted.
	const prURL = "https://gitea.example.com/t-aaa/wf-bbb/pulls/9"
	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"pull_request_url": prURL})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", docID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	// Submission succeeds.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	// Give the would-be async archive a brief window to (incorrectly) fire, then
	// assert it never did.
	calls := spy.waitForCall(t, 1, 500*time.Millisecond)
	if len(calls) != 0 {
		t.Fatalf("expected NO archive call for Gitea PR URL, got %d: %+v", len(calls), calls)
	}
}

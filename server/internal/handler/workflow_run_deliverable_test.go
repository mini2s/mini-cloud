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

// TestSubmitNodeRunDeliverable_ArchivesCodeMRPointer asserts that a submission
// carrying a pull_request_url triggers ArchiveCodeDeliverable asynchronously —
// the response is 200 (not blocked by the archive) and the spy provider records
// an UpsertFile at the code/<deliverableID>.md path. The response must return
// before (or independent of) the archive write completing.
func TestSubmitNodeRunDeliverable_ArchivesCodeMRPointer(t *testing.T) {
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
	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	// Add a pull_request-kind deliverable on the same node — archiving under
	// code/<id>.md is semantically a code-MR pointer, so use the right kind.
	prDeliverableID := uuid.NewString()
	if _, err := testPool.Exec(ctx, `
		INSERT INTO multica_workflow_node_deliverable (id, workflow_node_id, kind, title, required)
		SELECT $1, workflow_node_id, 'pull_request', 'Source MR', true
		FROM multica_workflow_node_deliverable WHERE id = $2
	`, prDeliverableID, docID); err != nil {
		t.Fatalf("seed pull_request deliverable: %v", err)
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

// TestSubmitNodeRunDeliverable_DoesNotArchiveDocumentPR is the defense-in-depth
// counterpart to TestSubmitNodeRunDeliverable_ArchivesCodeMRPointer: even if an
// off-spec caller posts a DOCUMENT deliverable's PR URL to /submit (document
// deliverables are supposed to go through /report-pr), the kind guard must keep
// ArchiveCodeDeliverable from firing. No code/<id>.md pointer should be written
// for a document-kind deliverable. The submission itself still succeeds (200).
func TestSubmitNodeRunDeliverable_DoesNotArchiveDocumentPR(t *testing.T) {
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
	// seedDeliverableAndNodeRunIn creates a DOCUMENT-kind deliverable (docID).
	nodeRunID, docID := seedDeliverableAndNodeRunIn(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM multica_workflow_node_deliverable_submission WHERE workflow_node_run_id = $1`, nodeRunID)
	})

	const prURL = "https://gitea.example.com/t-aaa/wf-bbb/pulls/9"
	req := newRequest(http.MethodPost, "/api/node-runs/"+nodeRunID+"/deliverables/"+docID+"/submit",
		map[string]any{"pull_request_url": prURL})
	req = withURLParams(req, "nodeRunId", nodeRunID, "deliverableId", docID)
	rec := httptest.NewRecorder()
	testHandler.SubmitNodeRunDeliverable(rec, req)

	// Submission succeeds — the kind guard only suppresses the archive.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	// Give the would-be async archive a brief window to (incorrectly) fire, then
	// assert it never did. A passing test proves the negative; the timeout is the
	// upper bound on how long we'll wait before declaring the archive suppressed.
	calls := spy.waitForCall(t, 1, 500*time.Millisecond)
	if len(calls) != 0 {
		t.Fatalf("expected NO archive call for document-kind deliverable, got %d: %+v", len(calls), calls)
	}
}

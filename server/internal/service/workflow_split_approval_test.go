package service

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type splitReviewTestProvider struct {
	coderepo.RepositoryProvider
	reviewHost string
	metadata   gitea.PullRequestMetadata
	content    []byte
}

func (p *splitReviewTestProvider) Configured() bool { return true }
func (p *splitReviewTestProvider) ReviewHost() string {
	return p.reviewHost
}
func (p *splitReviewTestProvider) GetReviewRequest(context.Context, string, string, int) (gitea.PullRequestMetadata, error) {
	return p.metadata, nil
}
func (p *splitReviewTestProvider) ReadFileAtCommit(context.Context, string, string, string, string) ([]byte, string, error) {
	return p.content, "blob-123", nil
}
func (p *splitReviewTestProvider) MergeReviewRequestAtHead(context.Context, string, string, int, string) error {
	return nil
}

type splitReviewEvidenceFixture struct {
	orchestrator *SplitOrchestrator
	nodeRun      db.MulticaWorkflowNodeRun
	generation   db.MulticaWorkflowSplitGeneration
	canonicalURL string
}

func newSplitReviewEvidenceFixture(t *testing.T, submittedBaseURL, canonicalBaseURL string) splitReviewEvidenceFixture {
	t.Helper()
	mdb := newEnsureRepoTestDB()
	mdb.nodeRun.NodeTitle = "Split plan"
	queries := db.New(mdb)

	owner := gitea.OrgName(util.UUIDToString(mdb.run.WorkspaceID))
	repo := DeliverableRepoName(mdb.run.WorkflowID, false)
	path := "/" + owner + "/" + repo + "/pulls/1"
	canonicalURL := strings.TrimRight(canonicalBaseURL, "/") + path
	provider := &splitReviewTestProvider{
		reviewHost: "10.20.19.101:33000",
		metadata: gitea.PullRequestMetadata{
			Index:         1,
			State:         "open",
			HTMLURL:       canonicalURL,
			HeadOwner:     owner,
			HeadRepo:      repo,
			HeadRef:       gitea.NodeBranch(1, util.UUIDToString(mdb.nodeRun.ID)),
			HeadCommitSHA: "commit-123",
			BaseOwner:     owner,
			BaseRepo:      repo,
			BaseRef:       gitea.InstBranch(util.UUIDToString(mdb.run.ID)),
		},
		content: []byte("## task: Ship\nkey: ship\nassignee: alex@example.com\n\nShip it.\n"),
	}
	wfService := &WorkflowService{Queries: queries, RepositoryProvider: provider}
	return splitReviewEvidenceFixture{
		orchestrator: &SplitOrchestrator{Queries: queries, WfService: wfService},
		nodeRun:      mdb.nodeRun,
		generation: db.MulticaWorkflowSplitGeneration{
			PrUrl: strings.TrimRight(submittedBaseURL, "/") + path,
		},
		canonicalURL: canonicalURL,
	}
}

func TestSplitReviewHostAllowed(t *testing.T) {
	canonicalURL := "https://zgsmtest.xyz:30443/t-workspace/wf-workflow/pulls/1"
	for _, test := range []struct {
		name      string
		submitted string
		want      bool
	}{
		{name: "canonical public host", submitted: canonicalURL, want: true},
		{name: "internal provider host", submitted: "http://10.20.19.101:33000/t-workspace/wf-workflow/pulls/1", want: true},
		{name: "unknown host", submitted: "https://evil.example/t-workspace/wf-workflow/pulls/1", want: false},
		{name: "different port", submitted: "https://zgsmtest.xyz:443/t-workspace/wf-workflow/pulls/1", want: false},
		{name: "relative URL", submitted: "/t-workspace/wf-workflow/pulls/1", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			submitted, err := url.Parse(test.submitted)
			if err != nil {
				t.Fatal(err)
			}
			if got := splitReviewHostAllowed(submitted, "10.20.19.101:33000", canonicalURL); got != test.want {
				t.Fatalf("splitReviewHostAllowed(%q) = %t, want %t", test.submitted, got, test.want)
			}
		})
	}
}

func TestReadSplitReviewEvidenceAcceptsCanonicalPublicHost(t *testing.T) {
	fixture := newSplitReviewEvidenceFixture(t, "https://zgsmtest.xyz:30443", "https://zgsmtest.xyz:30443")
	evidence, err := fixture.orchestrator.readSplitReviewEvidence(context.Background(), fixture.nodeRun, fixture.generation)
	if err != nil {
		t.Fatalf("readSplitReviewEvidence() = %v, want canonical public host accepted", err)
	}
	if evidence.Metadata.HTMLURL != fixture.canonicalURL {
		t.Fatalf("evidence URL = %q, want %q", evidence.Metadata.HTMLURL, fixture.canonicalURL)
	}
}

func TestReadSplitReviewEvidenceAcceptsConfiguredPublicHostWhenMetadataIsInternal(t *testing.T) {
	t.Setenv("GITEA_PUBLIC_BASE_URL", "https://zgsmtest.xyz:30443")
	fixture := newSplitReviewEvidenceFixture(t, "https://zgsmtest.xyz:30443", "http://10.20.19.101:33000")

	evidence, err := fixture.orchestrator.readSplitReviewEvidence(context.Background(), fixture.nodeRun, fixture.generation)
	if err != nil {
		t.Fatalf("readSplitReviewEvidence() = %v, want configured public host accepted", err)
	}
	if evidence.Metadata.HTMLURL != fixture.canonicalURL {
		t.Fatalf("evidence URL = %q, want internal canonical URL %q", evidence.Metadata.HTMLURL, fixture.canonicalURL)
	}
}

func TestReadSplitReviewEvidenceRejectsUnknownHost(t *testing.T) {
	fixture := newSplitReviewEvidenceFixture(t, "https://evil.example", "https://zgsmtest.xyz:30443")
	_, err := fixture.orchestrator.readSplitReviewEvidence(context.Background(), fixture.nodeRun, fixture.generation)
	if err == nil || !strings.Contains(err.Error(), "split review URL uses an unexpected host") {
		t.Fatalf("readSplitReviewEvidence() = %v, want unexpected host error", err)
	}
}

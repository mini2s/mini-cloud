package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
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

func TestApproveSplitWithoutLegacyDefaultWorkflow(t *testing.T) {
	fixture := newWorkflowPrepareFixture(t, true)
	defer fixture.cleanup(t)

	email := fmt.Sprintf("split-reviewer-%s@multica.test", util.UUIDToString(fixture.userID))
	if _, err := fixture.pool.Exec(fixture.ctx, `UPDATE multica_user SET email = $2 WHERE id = $1`, fixture.userID, email); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		INSERT INTO multica_member (workspace_id, user_id, role, status)
		VALUES ($1, $2, 'admin', 'active')
	`, fixture.workspaceID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.pool.Exec(fixture.ctx, `
		UPDATE multica_workflow_node
		SET format_schema = '{"type":"split","split_config":{"mode":"barrier","max_concurrency":1,"max_failures":0}}'::jsonb,
		    critic_type = 'human', critic_id = $2
		WHERE workflow_id = $1
	`, fixture.workflowID, fixture.userID); err != nil {
		t.Fatal(err)
	}

	prepared, err := fixture.service.PrepareWorkflowRunSnapshot(fixture.ctx, fixture.workflowID, PrepareWorkflowRunParams{
		TriggeredByType: "member", TriggeredByID: fixture.userID,
	})
	if err != nil {
		t.Fatal(err)
	}
	nodeRun := prepared.NodeRuns[0]
	requirement, err := fixture.service.Queries.GetNodeRunDeliverableByPurpose(fixture.ctx, db.GetNodeRunDeliverableByPurposeParams{
		WorkflowNodeRunID: nodeRun.ID, Purpose: SplitDeliverablePurpose,
	})
	if err != nil {
		t.Fatal(err)
	}

	owner := gitea.OrgName(util.UUIDToString(fixture.workspaceID))
	repo := DeliverableRepoName(fixture.workflowID, false)
	prURL := "https://gitea.test/" + owner + "/" + repo + "/pulls/1"
	submission, err := fixture.service.Queries.UpsertNodeRunDeliverableSubmission(fixture.ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nodeRun.ID, DeliverableID: requirement.ID,
		SubmittedByType: "member", SubmittedByID: fixture.userID,
		PullRequestUrl: prURL, PullRequestTitle: "Split plan",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.Queries.BindWorkflowSplitGenerationSubmission(fixture.ctx, db.BindWorkflowSplitGenerationSubmissionParams{
		NodeRunID: nodeRun.ID, Generation: 1, SubmissionID: submission.ID, PrUrl: prURL,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.Queries.UpdateWorkflowNodeRunStatus(fixture.ctx, db.UpdateWorkflowNodeRunStatusParams{
		ID: nodeRun.ID, Status: NodeRunStatusAwaitingSplitReview,
	}); err != nil {
		t.Fatal(err)
	}

	provider := &splitReviewTestProvider{
		reviewHost: "gitea.test",
		metadata: gitea.PullRequestMetadata{
			Index: 1, State: "open", HTMLURL: prURL,
			HeadOwner: owner, HeadRepo: repo,
			HeadRef: gitea.NodeBranch(1, util.UUIDToString(nodeRun.ID)), HeadCommitSHA: "commit-123",
			BaseOwner: owner, BaseRepo: repo, BaseRef: gitea.InstBranch(util.UUIDToString(prepared.Run.ID)),
		},
		content: []byte("## task: Ship\nkey: ship\nassignee: " + email + "\n\nShip it.\n"),
	}
	fixture.service.RepositoryProvider = provider
	orchestrator := NewSplitOrchestrator(fixture.service.Queries, pgxTxStarter{pool: fixture.pool}, fixture.service, nil, nil)
	if err := orchestrator.ApproveSplit(context.Background(), nodeRun, fixture.userID, SplitApproveRequest{
		ExpectedSplitGeneration: 1,
		ExpectedSubmissionID:    util.UUIDToString(submission.ID),
	}); err != nil {
		t.Fatalf("ApproveSplit() = %v, want approval without a legacy default workflow", err)
	}

	approvedNode, err := fixture.service.Queries.GetWorkflowNodeRun(fixture.ctx, nodeRun.ID)
	if err != nil {
		t.Fatal(err)
	}
	if approvedNode.Status != NodeRunStatusMaterializing {
		t.Fatalf("node status = %q, want %q", approvedNode.Status, NodeRunStatusMaterializing)
	}
	tasks, err := fixture.service.Queries.ListSplitTasksByGeneration(fixture.ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: 1, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].WorkflowID.Valid || tasks[0].AssigneeType.String != "member" || !tasks[0].AssigneeID.Valid {
		t.Fatalf("materialized split task = %#v, want member assignee and no legacy workflow", tasks)
	}
	var parentIssueID pgtype.UUID
	if err := fixture.pool.QueryRow(fixture.ctx, `
		INSERT INTO multica_issue (
			workspace_id, title, status, creator_type, creator_id, number
		) VALUES ($1, 'Split parent', 'in_progress', 'member', $2, 9999)
		RETURNING id
	`, fixture.workspaceID, fixture.userID).Scan(&parentIssueID); err != nil {
		t.Fatal(err)
	}
	parentIssue, err := fixture.service.Queries.GetIssue(fixture.ctx, parentIssueID)
	if err != nil {
		t.Fatal(err)
	}
	childIssue, created, err := orchestrator.materializeSplitTask(
		fixture.ctx, approvedNode, 1, parentIssue, tasks[0],
	)
	if err != nil {
		t.Fatalf("materializeSplitTask() = %v, want no legacy workflow dependency", err)
	}
	if !created || childIssue.WorkflowID.Valid || childIssue.AssigneeType.String != "member" || !childIssue.AssigneeID.Valid {
		t.Fatalf("child issue = %#v, created=%t; want member assignment and no explicit workflow", childIssue, created)
	}
	var materializeJobs int
	if err := fixture.pool.QueryRow(fixture.ctx, `
		SELECT count(*) FROM multica_workflow_node_run_dispatch_job
		WHERE workflow_node_run_id = $1 AND phase = 'materialize' AND split_plan_generation = 1
	`, nodeRun.ID).Scan(&materializeJobs); err != nil {
		t.Fatal(err)
	}
	if materializeJobs != 1 {
		t.Fatalf("materialize jobs = %d, want 1", materializeJobs)
	}
}

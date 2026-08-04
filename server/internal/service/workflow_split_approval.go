package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type splitReviewEvidence struct {
	Provider   coderepo.ReviewSnapshotProvider
	Owner      string
	Repo       string
	PullIndex  int
	Metadata   gitea.PullRequestMetadata
	Content    []byte
	BlobSHA    string
	TaskPath   string
	NodeBranch string
}

func splitReviewHostAllowed(submitted *url.URL, providerHost string, trustedURLs ...string) bool {
	if submitted == nil || submitted.Host == "" {
		return false
	}
	if providerHost != "" && strings.EqualFold(submitted.Host, providerHost) {
		return true
	}
	for _, rawURL := range trustedURLs {
		trusted, err := url.Parse(strings.TrimSpace(rawURL))
		if err == nil && trusted.Host != "" && strings.EqualFold(submitted.Host, trusted.Host) {
			return true
		}
	}
	return false
}

func (s *SplitOrchestrator) readSplitReviewEvidence(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	generation db.MulticaWorkflowSplitGeneration,
) (splitReviewEvidence, error) {
	if s.WfService == nil {
		return splitReviewEvidence{}, errors.New("workflow service is not configured")
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return splitReviewEvidence{}, fmt.Errorf("get split workflow run: %w", err)
	}
	workflow, err := s.WfService.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		return splitReviewEvidence{}, fmt.Errorf("get split workflow snapshot: %w", err)
	}
	repository, err := s.WfService.deliverableRepositoryForWorkspace(ctx, run.WorkspaceID)
	if err != nil {
		return splitReviewEvidence{}, NewSplitAPIError(SplitErrorUpstream, "split_review_unavailable", err)
	}
	provider, ok := repository.(coderepo.ReviewSnapshotProvider)
	if !ok {
		return splitReviewEvidence{}, NewSplitAPIError(SplitErrorUpstream, "split_review_unavailable", errors.New("repository provider cannot read immutable review snapshots"))
	}
	parsedURL, err := url.Parse(generation.PrUrl)
	if err != nil || parsedURL.Host == "" {
		return splitReviewEvidence{}, NewSplitValidationAPIError("invalid_split_review_source", errors.New("split review URL uses an unexpected host"), nil)
	}
	index, err := gitea.ParsePullRequestIndex(generation.PrUrl)
	if err != nil {
		return splitReviewEvidence{}, NewSplitValidationAPIError("invalid_split_review_source", err, nil)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	expectedPathSuffix := "/" + owner + "/" + repo + "/pulls/" + fmt.Sprint(index)
	if strings.TrimSuffix(parsedURL.Path, "/") != expectedPathSuffix {
		return splitReviewEvidence{}, NewSplitValidationAPIError("invalid_split_review_source", errors.New("split review URL points to an unexpected repository"), nil)
	}
	// This lookup never fetches the submitted URL. It addresses the expected
	// repository through the configured provider. Trust the provider host, Gitea's
	// canonical HTML host, or the server-controlled public host used when dispatch
	// rewrites internal Gitea URLs for cs-cloud.
	metadata, err := provider.GetReviewRequest(ctx, owner, repo, index)
	if err != nil {
		return splitReviewEvidence{}, NewSplitAPIError(SplitErrorUpstream, "split_review_unavailable", err)
	}
	if !splitReviewHostAllowed(parsedURL, provider.ReviewHost(), metadata.HTMLURL, os.Getenv("GITEA_PUBLIC_BASE_URL")) {
		return splitReviewEvidence{}, NewSplitValidationAPIError("invalid_split_review_source", errors.New("split review URL uses an unexpected host"), nil)
	}
	topo, err := RunNodeTopoOrder(ctx, s.Queries, run.ID)
	if err != nil {
		return splitReviewEvidence{}, fmt.Errorf("get split node topological order: %w", err)
	}
	nodeSequence := topo[util.UUIDToString(nodeRun.ID)]
	nodeBranch := gitea.NodeBranch(nodeSequence, util.UUIDToString(nodeRun.ID))
	instBranch := gitea.InstBranch(util.UUIDToString(run.ID))
	validState := metadata.State == "open" || metadata.Merged
	if !validState || metadata.HeadOwner != owner || metadata.HeadRepo != repo || metadata.HeadRef != nodeBranch ||
		metadata.BaseOwner != owner || metadata.BaseRepo != repo || metadata.BaseRef != instBranch || metadata.HeadCommitSHA == "" {
		return splitReviewEvidence{}, NewSplitValidationAPIError("invalid_split_review_source", errors.New("split review pull request does not match the expected run branches"), nil)
	}
	taskPath := gitea.DeliverablePath(nodeSequence, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID), "task")
	content, blobSHA, err := provider.ReadFileAtCommit(ctx, owner, repo, taskPath, metadata.HeadCommitSHA)
	if err != nil {
		return splitReviewEvidence{}, NewSplitAPIError(SplitErrorUpstream, "split_review_unavailable", err)
	}
	return splitReviewEvidence{
		Provider: provider, Owner: owner, Repo: repo, PullIndex: index,
		Metadata: metadata, Content: content, BlobSHA: blobSHA,
		TaskPath: taskPath, NodeBranch: nodeBranch,
	}, nil
}

func (s *SplitOrchestrator) splitAssigneeCandidates(ctx context.Context, workspaceID pgtype.UUID) ([]SplitTaskAssigneeCandidate, error) {
	members, err := s.Queries.ListMembersWithUser(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	candidates := make([]SplitTaskAssigneeCandidate, 0, len(members))
	for _, member := range members {
		if member.Status != "active" || !member.UserID.Valid {
			continue
		}
		name := strings.TrimSpace(member.OrgDisplayName.String)
		if name == "" {
			name = strings.TrimSpace(member.UserName.String)
		}
		candidates = append(candidates, SplitTaskAssigneeCandidate{
			ID: util.UUIDToString(member.ID), DisplayName: name,
			Email: strings.TrimSpace(member.UserEmail.String), Kind: SplitTaskAssigneeHuman,
		})
	}
	agents, err := s.Queries.ListAgents(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	for _, agent := range agents {
		candidates = append(candidates, SplitTaskAssigneeCandidate{ID: util.UUIDToString(agent.ID), DisplayName: agent.Name, Kind: SplitTaskAssigneeAgent})
	}
	squads, err := s.Queries.ListSquads(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	for _, squad := range squads {
		candidates = append(candidates, SplitTaskAssigneeCandidate{ID: util.UUIDToString(squad.ID), DisplayName: squad.Name, Kind: SplitTaskAssigneeSquad})
	}
	return candidates, nil
}

func (s *SplitOrchestrator) ApproveSplit(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, actorUserID pgtype.UUID, req SplitApproveRequest) error {
	if req.ExpectedSplitGeneration < 1 || strings.TrimSpace(req.ExpectedSubmissionID) == "" {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_split_generation and expected_submission_id are required"))
	}
	expectedSubmissionID, err := util.ParseUUID(req.ExpectedSubmissionID)
	if err != nil {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_submission_id must be a UUID"))
	}
	currentNode, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return err
	}
	if currentNode.SplitPlanGeneration < 1 {
		return NewSplitAPIError(SplitErrorConflict, "stale_split_generation", errors.New("split plan generation is not active"))
	}
	generation, err := s.Queries.GetCurrentWorkflowSplitGeneration(ctx, currentNode.ID)
	if err != nil {
		return err
	}
	if currentNode.SplitPlanGeneration != req.ExpectedSplitGeneration || !generation.SubmissionID.Valid || generation.SubmissionID != expectedSubmissionID {
		return staleSplitGenerationError(currentNode, generation)
	}
	if _, err := s.Queries.GetWorkflowSplitSnapshot(ctx, db.GetWorkflowSplitSnapshotParams{
		NodeRunID: currentNode.ID, Generation: generation.Generation,
	}); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err := s.RequireSplitReviewer(ctx, currentNode, actorUserID); err != nil {
		return err
	}
	evidence, err := s.readSplitReviewEvidence(ctx, currentNode, generation)
	if err != nil {
		return err
	}
	plan, details := ParseSplitTaskMarkdown(evidence.Content)
	if len(details) > 0 {
		return NewSplitValidationAPIError("invalid_task_md", fmt.Errorf("task.md validation failed (%d issues)", len(details)), details)
	}
	run, err := s.Queries.GetWorkflowRun(ctx, currentNode.WorkflowRunID)
	if err != nil {
		return err
	}
	candidates, err := s.splitAssigneeCandidates(ctx, run.WorkspaceID)
	if err != nil {
		return fmt.Errorf("list split assignee candidates: %w", err)
	}
	resolvedTasks, assigneeDetails := ResolveSplitTaskAssignees(plan.Tasks, candidates)
	if len(assigneeDetails) > 0 {
		return NewSplitValidationAPIError("invalid_task_md", fmt.Errorf("task.md validation failed (%d issues)", len(assigneeDetails)), assigneeDetails)
	}
	var committedNode db.MulticaWorkflowNodeRun
	err = s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, currentNode.ID)
		if err != nil {
			return err
		}
		lockedGeneration, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: lockedNode.ID, Generation: lockedNode.SplitPlanGeneration,
		})
		if err != nil {
			return err
		}
		if lockedNode.SplitPlanGeneration != req.ExpectedSplitGeneration || lockedGeneration.SubmissionID != expectedSubmissionID {
			return staleSplitGenerationError(lockedNode, lockedGeneration)
		}
		if _, err := qtx.GetWorkflowSplitSnapshot(ctx, db.GetWorkflowSplitSnapshotParams{NodeRunID: lockedNode.ID, Generation: lockedGeneration.Generation}); err == nil {
			committedNode = lockedNode
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if lockedNode.Status != NodeRunStatusAwaitingSplitReview || lockedGeneration.Status != SplitGenerationAwaitingReview {
			return staleSplitGenerationError(lockedNode, lockedGeneration)
		}
		lockedRun, err := qtx.GetWorkflowRun(ctx, lockedNode.WorkflowRunID)
		if err != nil || lockedRun.Status != RunStatusRunning {
			return ErrWorkflowRunNotRunning
		}
		if reviewerID, err := resolveSplitReviewerWithQueries(ctx, qtx, lockedNode); err != nil || reviewerID != actorUserID {
			return NewSplitAPIError(SplitErrorForbidden, "split_reviewer_required", errors.New("only the split reviewer may approve the task plan"))
		}
		for _, task := range resolvedTasks {
			memberID, parseErr := util.ParseUUID(task.AssigneeID)
			if parseErr != nil {
				return parseErr
			}
			member, memberErr := qtx.GetMember(ctx, memberID)
			if memberErr != nil || member.WorkspaceID != lockedRun.WorkspaceID || member.Status != "active" {
				return NewSplitValidationAPIError("invalid_task_md", errors.New("an assignee is no longer active"), []SplitValidationDetail{{Line: task.AssigneeLine, Field: "assignee", Message: "assignee is no longer an active workspace member"}})
			}
		}
		if _, err := qtx.CreateWorkflowSplitSnapshot(ctx, db.CreateWorkflowSplitSnapshotParams{
			NodeRunID: lockedNode.ID, Generation: lockedGeneration.Generation,
			Content: string(evidence.Content), TaskPath: evidence.TaskPath, SourceBranch: evidence.NodeBranch,
			HeadCommitSha: evidence.Metadata.HeadCommitSHA, BlobSha: evidence.BlobSHA, PrUrl: lockedGeneration.PrUrl,
		}); err != nil {
			return fmt.Errorf("create split task plan snapshot: %w", err)
		}
		rowsByKey := make(map[string]db.MulticaWorkflowSplitTask, len(resolvedTasks))
		for index, task := range resolvedTasks {
			assigneeID, _ := util.ParseUUID(task.AssigneeID)
			row, err := qtx.CreateMaterializationSplitTask(ctx, db.CreateMaterializationSplitTaskParams{
				NodeRunID: lockedNode.ID, WorkspaceID: lockedRun.WorkspaceID,
				SplitPlanGeneration: pgtype.Int4{Int32: lockedGeneration.Generation, Valid: true},
				DraftKey:            pgtype.Text{String: task.Key, Valid: true}, Title: task.Title,
				Description: task.Description, SortOrder: int32(index), AssigneeID: assigneeID,
			})
			if err != nil {
				return fmt.Errorf("create split materialization task: %w", err)
			}
			rowsByKey[task.Key] = row
		}
		for _, task := range resolvedTasks {
			dependencies := make([]string, 0, len(task.DependsOn))
			for _, key := range task.DependsOn {
				dependencies = append(dependencies, util.UUIDToString(rowsByKey[key].ID))
			}
			encoded, _ := json.Marshal(dependencies)
			if _, err := qtx.SetMaterializationSplitTaskDependencies(ctx, db.SetMaterializationSplitTaskDependenciesParams{ID: rowsByKey[task.Key].ID, DependsOn: encoded}); err != nil {
				return fmt.Errorf("set split materialization dependencies: %w", err)
			}
		}
		if _, err := qtx.ReviewNodeRunDeliverableSubmission(ctx, db.ReviewNodeRunDeliverableSubmissionParams{
			ID: expectedSubmissionID, Status: "approved", ReviewComment: req.ReviewComment,
		}); err != nil {
			return err
		}
		if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: lockedNode.ID, Generation: lockedGeneration.Generation, Status: SplitGenerationMaterializing,
		}); err != nil {
			return err
		}
		committedNode, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{ID: lockedNode.ID, Status: NodeRunStatusMaterializing})
		if err != nil {
			return err
		}
		dispatchGeneration, err := NextWorkflowDispatchGeneration(ctx, qtx, lockedNode.ID, "materialize")
		if err != nil {
			return err
		}
		return EnqueueSplitWorkflowDispatch(ctx, qtx, lockedNode.ID, "materialize", dispatchGeneration, lockedGeneration.Generation)
	})
	if err != nil {
		return err
	}
	if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, committedNode)
	}
	s.publishSplitEvent(protocol.EventSplitApproved, run, committedNode, SplitLifecycleEventPayload{SplitPlanGeneration: req.ExpectedSplitGeneration})
	s.archiveApprovedSplitPlan(ctx, evidence, currentNode.ID, req.ExpectedSplitGeneration)
	return nil
}

func (s *SplitOrchestrator) archiveApprovedSplitPlan(ctx context.Context, evidence splitReviewEvidence, nodeRunID pgtype.UUID, generation int32) {
	status, archiveError := "merged", ""
	if !evidence.Metadata.Merged {
		err := evidence.Provider.MergeReviewRequestAtHead(ctx, evidence.Owner, evidence.Repo, evidence.PullIndex, evidence.Metadata.HeadCommitSHA)
		switch {
		case err == nil:
		case errors.Is(err, gitea.ErrConditionalMergeUnsupported):
			status = "manual_required"
		case errors.Is(err, gitea.ErrPullRequestHeadChanged):
			status = "head_changed"
		default:
			status = "failed"
			archiveError = err.Error()
		}
	}
	_, _ = s.Queries.UpdateWorkflowSplitSnapshotArchive(ctx, db.UpdateWorkflowSplitSnapshotArchiveParams{
		NodeRunID: nodeRunID, Generation: generation, ArchiveStatus: status, ArchiveError: archiveError,
	})
}

func sortSplitValidationDetails(details []SplitValidationDetail) {
	sort.SliceStable(details, func(i, j int) bool { return details[i].Line < details[j].Line })
}

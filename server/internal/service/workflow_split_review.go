package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type SplitRejectRequest struct {
	ExpectedSplitGeneration int32  `json:"expected_split_generation"`
	ExpectedSubmissionID    string `json:"expected_submission_id"`
	ReviewComment           string `json:"review_comment"`
}

func (s *SplitOrchestrator) RejectSplit(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	actorUserID pgtype.UUID,
	req SplitRejectRequest,
) error {
	if req.ExpectedSplitGeneration < 1 || strings.TrimSpace(req.ExpectedSubmissionID) == "" || strings.TrimSpace(req.ReviewComment) == "" {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_split_generation, expected_submission_id, and review_comment are required"))
	}
	expectedSubmissionID, err := util.ParseUUID(req.ExpectedSubmissionID)
	if err != nil {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_submission_id must be a UUID"))
	}
	currentNode, err := s.Queries.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return err
	}
	generation, err := s.Queries.GetCurrentWorkflowSplitGeneration(ctx, currentNode.ID)
	if err != nil {
		return err
	}
	if currentNode.SplitPlanGeneration != req.ExpectedSplitGeneration || generation.SubmissionID != expectedSubmissionID {
		return staleSplitGenerationError(currentNode, generation)
	}
	if err := s.RequireSplitReviewer(ctx, currentNode, actorUserID); err != nil {
		return err
	}
	evidence, err := s.readSplitReviewEvidence(ctx, currentNode, generation)
	if err != nil {
		return err
	}
	var updated db.MulticaWorkflowNodeRun
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
		if lockedNode.SplitPlanGeneration != req.ExpectedSplitGeneration || lockedGeneration.SubmissionID != expectedSubmissionID ||
			lockedNode.Status != NodeRunStatusAwaitingSplitReview || lockedGeneration.Status != SplitGenerationAwaitingReview {
			return staleSplitGenerationError(lockedNode, lockedGeneration)
		}
		if reviewerID, err := resolveSplitReviewerWithQueries(ctx, qtx, lockedNode); err != nil || reviewerID != actorUserID {
			return NewSplitAPIError(SplitErrorForbidden, "split_reviewer_required", errors.New("only the split reviewer may reject the task plan"))
		}
		if _, err := qtx.ReviewNodeRunDeliverableSubmission(ctx, db.ReviewNodeRunDeliverableSubmissionParams{
			ID: expectedSubmissionID, Status: "rejected", ReviewComment: strings.TrimSpace(req.ReviewComment),
		}); err != nil {
			return err
		}
		if _, err := qtx.RejectWorkflowSplitGeneration(ctx, db.RejectWorkflowSplitGenerationParams{
			NodeRunID: lockedNode.ID, Generation: lockedGeneration.Generation,
			ReviewComment: strings.TrimSpace(req.ReviewComment), ReviewedContent: string(evidence.Content),
			ReviewHeadCommitSha: evidence.Metadata.HeadCommitSHA, ReviewBlobSha: evidence.BlobSHA,
		}); err != nil {
			return err
		}
		if lockedGeneration.PlannerTaskID.Valid {
			_, _ = qtx.CancelAgentTask(ctx, lockedGeneration.PlannerTaskID)
		}
		if err := qtx.InvalidateSplitGenerationDispatchJobs(ctx, db.InvalidateSplitGenerationDispatchJobsParams{
			WorkflowNodeRunID:   lockedNode.ID,
			SplitPlanGeneration: pgtype.Int4{Int32: lockedGeneration.Generation, Valid: true},
		}); err != nil {
			return err
		}
		updated, err = BeginSplitPlanGeneration(ctx, qtx, lockedNode, strings.TrimSpace(req.ReviewComment), string(evidence.Content), evidence.Metadata.HeadCommitSHA)
		return err
	})
	if err != nil {
		return err
	}
	if s.WfService != nil {
		if s.WfService.OnNodeStatusChanged != nil {
			s.WfService.OnNodeStatusChanged(ctx, updated)
		}
		archiveStatus, archiveError := "archived", ""
		if err := s.WfService.ArchiveReviewComment(ctx, currentNode, "rejected", strings.TrimSpace(req.ReviewComment)); err != nil {
			archiveStatus = "failed"
			archiveError = err.Error()
		}
		_, _ = s.Queries.UpdateWorkflowSplitGenerationReviewArchive(ctx, db.UpdateWorkflowSplitGenerationReviewArchiveParams{
			NodeRunID: currentNode.ID, Generation: req.ExpectedSplitGeneration,
			ReviewArchiveStatus: archiveStatus, ReviewArchiveError: archiveError,
		})
	}
	return nil
}

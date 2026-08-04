package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type splitPlannerTaskContext struct {
	Type                string `json:"type"`
	Phase               string `json:"phase"`
	SplitPlanGeneration int32  `json:"split_plan_generation"`
	SplitDeliverableID  string `json:"split_deliverable_id"`
}

func staleSplitGenerationError(nodeRun db.MulticaWorkflowNodeRun, generation db.MulticaWorkflowSplitGeneration) error {
	err := &SplitAPIError{
		Status:                 SplitErrorConflict,
		Code:                   "stale_split_generation",
		Err:                    errors.New("the split plan changed; refresh and retry"),
		CurrentSplitGeneration: nodeRun.SplitPlanGeneration,
	}
	if generation.SubmissionID.Valid {
		err.CurrentSubmissionID = util.UUIDToString(generation.SubmissionID)
	}
	return err
}

func (s *SplitOrchestrator) SubmitSplitTaskPlan(
	ctx context.Context,
	nodeRunID pgtype.UUID,
	deliverableID pgtype.UUID,
	taskID pgtype.UUID,
	agentID pgtype.UUID,
	pullRequestURL string,
) (db.MulticaWorkflowNodeDeliverableSubmission, error) {
	pullRequestURL = strings.TrimSpace(pullRequestURL)
	if pullRequestURL == "" {
		return db.MulticaWorkflowNodeDeliverableSubmission{}, NewSplitAPIError(
			SplitErrorBadRequest, "invalid_split_submission", errors.New("pull_request_url is required"),
		)
	}
	var submission db.MulticaWorkflowNodeDeliverableSubmission
	var nodeRun db.MulticaWorkflowNodeRun
	var run db.MulticaWorkflowRun
	var generation db.MulticaWorkflowSplitGeneration
	replayed := false
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		var err error
		nodeRun, err = qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
		if err != nil {
			return fmt.Errorf("lock split node run: %w", err)
		}
		if nodeRun.SplitPlanGeneration < 1 {
			return NewSplitAPIError(SplitErrorConflict, "stale_split_generation", errors.New("split plan generation is not active"))
		}
		generation, err = qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: nodeRun.ID, Generation: nodeRun.SplitPlanGeneration,
		})
		if err != nil {
			return fmt.Errorf("lock split plan generation: %w", err)
		}
		if generation.DeliverableID != deliverableID || !generation.PlannerTaskID.Valid || generation.PlannerTaskID != taskID {
			return staleSplitGenerationError(nodeRun, generation)
		}
		task, err := qtx.GetAgentTaskForUpdate(ctx, taskID)
		if err != nil {
			return NewSplitAPIError(SplitErrorConflict, "stale_split_generation", errors.New("split planner task is no longer active"))
		}
		if task.AgentID != agentID || task.Status != "running" || task.WorkflowNodeRunID != nodeRun.ID {
			return NewSplitAPIError(SplitErrorForbidden, "split_planner_task_required", errors.New("submission must come from the active split planner task"))
		}
		if nodeRun.Status == NodeRunStatusAwaitingSplitReview && generation.Status == SplitGenerationAwaitingReview && generation.SubmissionID.Valid {
			submission, err = qtx.GetNodeRunDeliverableSubmission(ctx, generation.SubmissionID)
			if err != nil {
				return err
			}
			if submission.WorkflowNodeRunID == nodeRun.ID && submission.DeliverableID == deliverableID &&
				submission.SubmittedByID == agentID && submission.PullRequestUrl == pullRequestURL {
				replayed = true
				return nil
			}
			return staleSplitGenerationError(nodeRun, generation)
		}
		if generation.Status != SplitGenerationSplitting || nodeRun.Status != NodeRunStatusSplitting {
			return staleSplitGenerationError(nodeRun, generation)
		}
		var taskContext splitPlannerTaskContext
		if err := json.Unmarshal(task.Context, &taskContext); err != nil ||
			taskContext.Type != "workflow" || taskContext.Phase != splitPhaseGenerate ||
			taskContext.SplitPlanGeneration != generation.Generation ||
			taskContext.SplitDeliverableID != util.UUIDToString(deliverableID) {
			return staleSplitGenerationError(nodeRun, generation)
		}
		submission, err = qtx.UpsertNodeRunDeliverableSubmission(ctx, db.UpsertNodeRunDeliverableSubmissionParams{
			WorkflowNodeRunID: nodeRun.ID, DeliverableID: deliverableID,
			SubmittedByType: "agent", SubmittedByID: agentID,
			Content: "", PullRequestUrl: pullRequestURL,
		})
		if err != nil {
			return fmt.Errorf("upsert split task plan submission: %w", err)
		}
		generation, err = qtx.BindWorkflowSplitGenerationSubmission(ctx, db.BindWorkflowSplitGenerationSubmissionParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation,
			SubmissionID: submission.ID, PrUrl: pullRequestURL,
		})
		if err != nil {
			return fmt.Errorf("bind split task plan submission: %w", err)
		}
		nodeRun, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
			ID: nodeRun.ID, Status: NodeRunStatusAwaitingSplitReview,
		})
		if err != nil {
			return fmt.Errorf("mark split plan ready for review: %w", err)
		}
		run, err = qtx.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		return err
	})
	if err != nil {
		return db.MulticaWorkflowNodeDeliverableSubmission{}, err
	}
	if replayed {
		return submission, nil
	}
	if s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, nodeRun)
	}
	s.publishSplitEvent(protocol.EventSplitReviewReady, run, nodeRun, SplitLifecycleEventPayload{
		AgentTaskID: util.UUIDToString(taskID), SplitPlanGeneration: generation.Generation,
	})
	return submission, nil
}

package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func ensureSplitMaterializeDispatch(ctx context.Context, qtx *db.Queries, nodeRunID pgtype.UUID, generation int32) error {
	job, err := qtx.FindActiveWorkflowDispatchJob(ctx, db.FindActiveWorkflowDispatchJobParams{
		WorkflowNodeRunID: nodeRunID, Phase: "materialize",
		SplitPlanGeneration: pgtype.Int4{Int32: generation, Valid: true},
	})
	if err == nil {
		if job.Status == "pending" {
			_, err = qtx.ExpediteWorkflowDispatchJob(ctx, job.ID)
		}
		return err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	dispatchGeneration, err := NextWorkflowDispatchGeneration(ctx, qtx, nodeRunID, "materialize")
	if err != nil {
		return err
	}
	return EnqueueSplitWorkflowDispatch(ctx, qtx, nodeRunID, "materialize", dispatchGeneration, generation)
}

func (s *SplitOrchestrator) RetrySplitMaterializationTask(
	ctx context.Context,
	nodeRunID pgtype.UUID,
	taskID pgtype.UUID,
	expectedGeneration int32,
) error {
	if expectedGeneration < 1 {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_split_generation is required"))
	}
	var updatedNode db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		nodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
		if err != nil {
			return err
		}
		generation, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: nodeRun.ID, Generation: nodeRun.SplitPlanGeneration,
		})
		if err != nil {
			return err
		}
		if nodeRun.SplitPlanGeneration != expectedGeneration {
			return staleSplitGenerationError(nodeRun, generation)
		}
		if nodeRun.Status != NodeRunStatusMaterializing && nodeRun.Status != NodeRunStatusFailed {
			return NewSplitAPIError(SplitErrorConflict, "split_task_not_retryable", errors.New("split task is not awaiting materialization retry"))
		}
		if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(taskID)); err != nil {
			return err
		}
		task, err := qtx.GetSplitTaskForUpdate(ctx, taskID)
		if err != nil {
			return err
		}
		if task.NodeRunID != nodeRun.ID || !task.SplitPlanGeneration.Valid || task.SplitPlanGeneration.Int32 != expectedGeneration || task.IssueID.Valid {
			return NewSplitAPIError(SplitErrorConflict, "split_task_not_retryable", errors.New("split task is not an unmaterialized row in the current generation"))
		}
		if task.Status == SplitTaskStatusFailed {
			if _, err := qtx.ResetSplitTaskMaterializationRetry(ctx, task.ID); err != nil {
				return err
			}
		} else if task.Status != SplitTaskStatusCreated {
			return NewSplitAPIError(SplitErrorConflict, "split_task_not_retryable", errors.New("split task retry budget is not exhausted"))
		}
		if nodeRun.Status == NodeRunStatusFailed {
			if nodeRun.FailureReason.String != "materialize_failure_threshold" && nodeRun.FailureReason.String != "materialize_dispatch_failed" {
				return NewSplitAPIError(SplitErrorConflict, "split_task_not_retryable", errors.New("failed split node requires a full regeneration"))
			}
			tasks, err := qtx.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
				NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: expectedGeneration, Valid: true},
			})
			if err != nil {
				return err
			}
			_, cfg, err := splitRunNodeConfig(ctx, qtx, nodeRun)
			if err != nil {
				return err
			}
			exhausted := 0
			for _, candidate := range tasks {
				if !candidate.IssueID.Valid && candidate.Status == SplitTaskStatusFailed && candidate.ID != task.ID {
					exhausted++
				}
			}
			if exhausted > int(cfg.MaxFailures) {
				updatedNode = nodeRun
				return nil
			}
			if _, err := qtx.ReviveWorkflowRunForRetry(ctx, nodeRun.WorkflowRunID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("revive split workflow run: %w", err)
			}
			if _, err := qtx.ReviveCancelledWorkflowNodeRuns(ctx, nodeRun.WorkflowRunID); err != nil {
				return err
			}
			if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
				NodeRunID: nodeRun.ID, Generation: expectedGeneration, Status: SplitGenerationMaterializing,
			}); err != nil {
				return err
			}
			updatedNode, err = qtx.ReactivateWorkflowNodeRunStatus(ctx, db.ReactivateWorkflowNodeRunStatusParams{ID: nodeRun.ID, Status: NodeRunStatusMaterializing})
			if err != nil {
				return err
			}
		} else {
			updatedNode = nodeRun
		}
		return ensureSplitMaterializeDispatch(ctx, qtx, nodeRun.ID, expectedGeneration)
	})
	if err != nil {
		return err
	}
	if updatedNode.ID.Valid && s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, updatedNode)
	}
	return nil
}

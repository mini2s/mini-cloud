package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type SplitGenerateRequest struct {
	ExpectedSplitGeneration int32 `json:"expected_split_generation"`
	ConfirmSupersede        bool  `json:"confirm_supersede,omitempty"`
}

func (s *SplitOrchestrator) GenerateSplitPlan(ctx context.Context, nodeRunID pgtype.UUID, req SplitGenerateRequest) error {
	if req.ExpectedSplitGeneration < 1 {
		return NewSplitAPIError(SplitErrorBadRequest, "invalid_split_request", errors.New("expected_split_generation is required"))
	}
	resumeDispatchOnly := false
	// Stage 1 commits the generation fence before any child cleanup. Once the
	// old generation is superseded, neither its materializer nor its callbacks
	// may make further progress, even if cleanup is interrupted.
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
		if nodeRun.SplitPlanGeneration != req.ExpectedSplitGeneration {
			return staleSplitGenerationError(nodeRun, generation)
		}
		if nodeRun.Status == NodeRunStatusSplitting && generation.Status == SplitGenerationSplitting {
			resumeDispatchOnly = true
			job, findErr := qtx.FindActiveWorkflowDispatchJob(ctx, db.FindActiveWorkflowDispatchJobParams{
				WorkflowNodeRunID: nodeRun.ID, Phase: "split",
				SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
			})
			if findErr == nil {
				if job.Status == "pending" {
					_, findErr = qtx.ExpediteWorkflowDispatchJob(ctx, job.ID)
				}
				return findErr
			}
			if !errors.Is(findErr, pgx.ErrNoRows) {
				return findErr
			}
			dispatchGeneration, err := NextWorkflowDispatchGeneration(ctx, qtx, nodeRun.ID, "split")
			if err != nil {
				return err
			}
			return EnqueueSplitWorkflowDispatch(ctx, qtx, nodeRun.ID, "split", dispatchGeneration, generation.Generation)
		}
		if generation.Status == SplitGenerationSuperseded {
			return nil
		}
		if nodeRun.Status != NodeRunStatusAwaitingSplitReview && nodeRun.Status != NodeRunStatusFailed && nodeRun.Status != NodeRunStatusMaterializing && nodeRun.Status != NodeRunStatusBlocked {
			return NewSplitAPIError(SplitErrorConflict, "split_generation_not_allowed", errors.New("split plan cannot be regenerated from the current state"))
		}
		tasks, err := qtx.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
			NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
		})
		if err != nil {
			return err
		}
		materialized := 0
		for _, task := range tasks {
			if task.IssueID.Valid {
				materialized++
			}
			if task.RunID.Valid {
				return NewSplitAPIError(SplitErrorConflict, "split_generation_not_allowed", errors.New("split plan has already started child workflows"))
			}
		}
		if materialized > 0 && !req.ConfirmSupersede {
			return NewSplitAPIError(SplitErrorConflict, "split_supersede_confirmation_required", errors.New("confirm_supersede is required because child issues will be cancelled"))
		}
		if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation, Status: SplitGenerationSuperseded,
		}); err != nil {
			return err
		}
		if err := qtx.InvalidateSplitGenerationDispatchJobs(ctx, db.InvalidateSplitGenerationDispatchJobsParams{
			WorkflowNodeRunID:   nodeRun.ID,
			SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
		}); err != nil {
			return err
		}
		if generation.PlannerTaskID.Valid {
			_, _ = qtx.CancelAgentTask(ctx, generation.PlannerTaskID)
		}
		return nil
	})
	if err != nil || resumeDispatchOnly {
		return err
	}

	// Stage 2 cleans each row independently using the global lock order. Every
	// row is idempotent, so a caller can safely retry after a partial cleanup.
	tasks, err := s.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID: nodeRunID, SplitPlanGeneration: pgtype.Int4{Int32: req.ExpectedSplitGeneration, Valid: true},
	})
	if err != nil {
		return err
	}
	for _, task := range tasks {
		err := s.runInTx(ctx, func(qtx *db.Queries) error {
			nodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
			if err != nil {
				return err
			}
			if nodeRun.SplitPlanGeneration != req.ExpectedSplitGeneration {
				return nil
			}
			generation, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
				NodeRunID: nodeRun.ID, Generation: req.ExpectedSplitGeneration,
			})
			if err != nil {
				return err
			}
			if generation.Status != SplitGenerationSuperseded {
				return nil
			}
			if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(task.ID)); err != nil {
				return err
			}
			lockedTask, err := qtx.GetSplitTaskForUpdate(ctx, task.ID)
			if err != nil {
				return err
			}
			if lockedTask.IssueID.Valid {
				issue, err := qtx.GetIssue(ctx, lockedTask.IssueID)
				if err != nil {
					return err
				}
				if issue.Status != "done" && issue.Status != "cancelled" {
					if _, err := qtx.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{ID: issue.ID, Status: "cancelled", WorkspaceID: issue.WorkspaceID}); err != nil {
						return err
					}
				}
			}
			if _, err := qtx.CancelOpenSplitTask(ctx, lockedTask.ID); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	// Stage 3 verifies the fence and cleanup, revives a failed run when needed,
	// then creates and dispatches the next generation atomically.
	var updated db.MulticaWorkflowNodeRun
	err = s.runInTx(ctx, func(qtx *db.Queries) error {
		nodeRun, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRunID)
		if err != nil {
			return err
		}
		generation, err := qtx.GetWorkflowSplitGenerationForUpdate(ctx, db.GetWorkflowSplitGenerationForUpdateParams{
			NodeRunID: nodeRun.ID, Generation: req.ExpectedSplitGeneration,
		})
		if err != nil {
			return err
		}
		if nodeRun.SplitPlanGeneration != req.ExpectedSplitGeneration || generation.Status != SplitGenerationSuperseded {
			return staleSplitGenerationError(nodeRun, generation)
		}
		remaining, err := qtx.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
			NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
		})
		if err != nil {
			return err
		}
		for _, task := range remaining {
			if task.RunID.Valid {
				return NewSplitAPIError(SplitErrorConflict, "split_generation_not_allowed", errors.New("split plan has already started child workflows"))
			}
		}
		if nodeRun.Status == NodeRunStatusFailed {
			if _, err := qtx.ReviveWorkflowRunForRetry(ctx, nodeRun.WorkflowRunID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if _, err := qtx.ReviveCancelledWorkflowNodeRuns(ctx, nodeRun.WorkflowRunID); err != nil {
				return err
			}
		}
		updated, err = BeginSplitPlanGeneration(ctx, qtx, nodeRun, "", "", "")
		return err
	})
	if err != nil {
		return err
	}
	if updated.ID.Valid && s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

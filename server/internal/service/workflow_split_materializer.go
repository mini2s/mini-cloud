package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

var splitMaterializationRetryDelays = []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}

type splitMaterializationRowError struct {
	Code      string
	Message   string
	Retryable bool
}

func (e *splitMaterializationRowError) Error() string { return e.Message }

func splitMaterializationNextAttempt(retryCount int32, now time.Time) (int32, pgtype.Timestamptz, bool) {
	nextRetryCount := retryCount + 1
	if int(retryCount) >= len(splitMaterializationRetryDelays) {
		return nextRetryCount, pgtype.Timestamptz{}, true
	}
	return nextRetryCount, pgtype.Timestamptz{Time: now.Add(splitMaterializationRetryDelays[retryCount]), Valid: true}, false
}

func (s *SplitOrchestrator) MaterializeSplitGeneration(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
) (bool, error) {
	if !job.SplitPlanGeneration.Valid || nodeRun.Status != NodeRunStatusMaterializing ||
		nodeRun.SplitPlanGeneration != job.SplitPlanGeneration.Int32 {
		return false, nil
	}
	generation, err := s.Queries.GetWorkflowSplitGeneration(ctx, db.GetWorkflowSplitGenerationParams{
		NodeRunID: nodeRun.ID, Generation: job.SplitPlanGeneration.Int32,
	})
	if err != nil {
		return false, err
	}
	if generation.Status != SplitGenerationMaterializing {
		return false, nil
	}
	parentIssue, err := s.findParentIssue(ctx, nodeRun)
	if err != nil {
		return false, err
	}
	issuePrefix := ""
	if workspace, workspaceErr := s.Queries.GetWorkspace(ctx, parentIssue.WorkspaceID); workspaceErr == nil {
		issuePrefix = workspace.IssuePrefix
	}
	due, err := s.Queries.ListDueSplitTasksForMaterialization(ctx, db.ListDueSplitTasksForMaterializationParams{
		NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
	})
	if err != nil {
		return false, err
	}
	for _, task := range due {
		issue, created, materializeErr := s.materializeSplitTask(ctx, nodeRun, generation.Generation, parentIssue, task)
		if materializeErr != nil {
			var rowErr *splitMaterializationRowError
			if !errors.As(materializeErr, &rowErr) {
				return false, materializeErr
			}
			if err := s.recordSplitMaterializationFailure(ctx, nodeRun, generation.Generation, task, rowErr); err != nil {
				return false, err
			}
			continue
		}
		if created {
			run, _ := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
			s.publishSplitEvent(protocol.EventSplitChildIssueCreated, run, nodeRun, SplitLifecycleEventPayload{
				SplitPlanGeneration: generation.Generation,
				SplitTaskID:         util.UUIDToString(task.ID), ChildIssueID: util.UUIDToString(issue.ID),
			})
			if s.Bus != nil {
				s.Bus.Publish(events.Event{
					Type:        protocol.EventIssueCreated,
					WorkspaceID: util.UUIDToString(issue.WorkspaceID),
					ActorType:   "system",
					Payload:     map[string]any{"issue": issueToMap(issue, issuePrefix)},
				})
			}
		}
	}

	tasks, err := s.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID: nodeRun.ID, SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
	})
	if err != nil {
		return false, err
	}
	allMaterialized := len(tasks) > 0
	exhausted := 0
	var earliestRetry time.Time
	for _, task := range tasks {
		if task.IssueID.Valid {
			continue
		}
		allMaterialized = false
		if task.Status == SplitTaskStatusFailed {
			exhausted++
		}
		if task.MaterializeNextAttemptAt.Valid && (earliestRetry.IsZero() || task.MaterializeNextAttemptAt.Time.Before(earliestRetry)) {
			earliestRetry = task.MaterializeNextAttemptAt.Time
		}
	}
	if allMaterialized {
		if err := s.activateMaterializedSplitGeneration(ctx, nodeRun, generation.Generation); err != nil {
			return false, err
		}
		return false, nil
	}
	_, splitConfig, err := splitRunNodeConfig(ctx, s.Queries, nodeRun)
	if err != nil {
		return false, err
	}
	if exhausted > int(splitConfig.MaxFailures) {
		if _, err := s.Queries.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation, Status: "failed",
		}); err != nil {
			return false, err
		}
		if err := s.WfService.failWorkflowFromNode(ctx, nodeRun, NodeRunStatusFailed, "materialize_failure_threshold"); err != nil {
			return false, err
		}
		return false, nil
	}
	if !earliestRetry.IsZero() {
		if _, err := s.Queries.DeferWorkflowDispatchJob(ctx, db.DeferWorkflowDispatchJobParams{
			ID: job.ID, Generation: job.Generation, LockedBy: job.LockedBy,
			ScheduledAt: pgtype.Timestamptz{Time: earliestRetry, Valid: true},
		}); err != nil {
			return false, fmt.Errorf("defer split materialization job: %w", err)
		}
		return true, nil
	}
	return false, nil
}

func (s *SplitOrchestrator) materializeSplitTask(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	generation int32,
	parentIssue db.MulticaIssue,
	task db.MulticaWorkflowSplitTask,
) (db.MulticaIssue, bool, error) {
	var issue db.MulticaIssue
	created := false
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		if lockedNode.Status != NodeRunStatusMaterializing || lockedNode.SplitPlanGeneration != generation {
			return nil
		}
		if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(task.ID)); err != nil {
			return err
		}
		lockedTask, err := qtx.GetSplitTaskForUpdate(ctx, task.ID)
		if err != nil {
			return err
		}
		if !lockedTask.SplitPlanGeneration.Valid || lockedTask.SplitPlanGeneration.Int32 != generation || lockedTask.IssueID.Valid || lockedTask.Status != SplitTaskStatusCreated {
			return nil
		}
		if lockedTask.MaterializeNextAttemptAt.Valid && lockedTask.MaterializeNextAttemptAt.Time.After(time.Now()) {
			return nil
		}
		if !lockedTask.AssigneeID.Valid || lockedTask.AssigneeType.String != "member" {
			return &splitMaterializationRowError{Code: "split_assignee_invalidated", Message: "split assignee is missing", Retryable: false}
		}
		member, err := qtx.GetMember(ctx, lockedTask.AssigneeID)
		if err != nil || member.Status != "active" || member.WorkspaceID != lockedTask.WorkspaceID {
			return &splitMaterializationRowError{Code: "split_assignee_invalidated", Message: "split assignee is no longer active", Retryable: false}
		}
		if !lockedTask.WorkflowID.Valid {
			return &splitMaterializationRowError{Code: "split_workflow_invalidated", Message: "split workflow is missing", Retryable: false}
		}
		run, err := qtx.GetWorkflowRun(ctx, lockedNode.WorkflowRunID)
		if err != nil {
			return err
		}
		if err := s.validateIssueWorkflow(ctx, qtx, util.UUIDToString(lockedTask.WorkflowID), run.WorkflowID, run.WorkspaceID); err != nil {
			return &splitMaterializationRowError{Code: "split_workflow_invalidated", Message: "split workflow is no longer available", Retryable: false}
		}
		issue, err = qtx.GetIssueByOrigin(ctx, db.GetIssueByOriginParams{
			WorkspaceID: lockedTask.WorkspaceID,
			OriginType:  pgtype.Text{String: "workflow_split", Valid: true}, OriginID: lockedTask.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			issueNumber, err := qtx.IncrementIssueCounter(ctx, parentIssue.WorkspaceID)
			if err != nil {
				return err
			}
			issue, err = qtx.CreateIssueWithOrigin(ctx, db.CreateIssueWithOriginParams{
				WorkspaceID: parentIssue.WorkspaceID, Title: lockedTask.Title,
				Description: textToPgText(lockedTask.Description), Status: "in_progress", Priority: parentIssue.Priority,
				AssigneeType: lockedTask.AssigneeType, AssigneeID: lockedTask.AssigneeID,
				ResponsibleUserID: parentIssue.ResponsibleUserID,
				CreatorType:       parentIssue.CreatorType, CreatorID: parentIssue.CreatorID,
				ParentIssueID: parentIssue.ID, Position: 0, Number: issueNumber, ProjectID: parentIssue.ProjectID,
				OriginType: pgtype.Text{String: "workflow_split", Valid: true}, OriginID: lockedTask.ID,
			})
			if err != nil {
				return err
			}
			created = true
		} else if err != nil {
			return err
		} else if issue.WorkspaceID != parentIssue.WorkspaceID || issue.ParentIssueID != parentIssue.ID ||
			!issue.OriginID.Valid || issue.OriginID != lockedTask.ID {
			return &splitMaterializationRowError{Code: "split_origin_conflict", Message: "split issue origin is owned by another issue", Retryable: false}
		}
		_, err = qtx.SetSplitTaskMaterializedIssue(ctx, db.SetSplitTaskMaterializedIssueParams{ID: lockedTask.ID, IssueID: issue.ID})
		return err
	})
	return issue, created, err
}

func (s *SplitOrchestrator) recordSplitMaterializationFailure(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
	generation int32,
	task db.MulticaWorkflowSplitTask,
	rowErr *splitMaterializationRowError,
) error {
	var updatedNode db.MulticaWorkflowNodeRun
	changed := false
	err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		if lockedNode.Status != NodeRunStatusMaterializing || lockedNode.SplitPlanGeneration != generation {
			return nil
		}
		if err := qtx.LockIssueDuplicateKey(ctx, splitTaskDispatchLockKey(task.ID)); err != nil {
			return err
		}
		lockedTask, err := qtx.GetSplitTaskForUpdate(ctx, task.ID)
		if err != nil {
			return err
		}
		if !lockedTask.SplitPlanGeneration.Valid || lockedTask.SplitPlanGeneration.Int32 != generation ||
			lockedTask.IssueID.Valid || lockedTask.Status != SplitTaskStatusCreated {
			return nil
		}
		retryCount, nextAttempt, exhausted := splitMaterializationNextAttempt(lockedTask.MaterializeRetryCount, time.Now())
		if !rowErr.Retryable {
			exhausted = true
			nextAttempt = pgtype.Timestamptz{}
		}
		status := SplitTaskStatusCreated
		if exhausted {
			status = SplitTaskStatusFailed
		}
		payload, _ := json.Marshal(map[string]any{
			"code": rowErr.Code, "message": rowErr.Message, "retryable": rowErr.Retryable,
			"attempt": retryCount, "next_attempt_at": util.TimestampToPtr(nextAttempt),
		})
		if _, err := qtx.SetSplitTaskMaterializationRetry(ctx, db.SetSplitTaskMaterializationRetryParams{
			ID: lockedTask.ID, MaterializeRetryCount: retryCount, MaterializeNextAttemptAt: nextAttempt,
			LastError: payload, Status: status,
		}); err != nil {
			return err
		}
		updatedNode, err = qtx.TouchWorkflowNodeRun(ctx, lockedNode.ID)
		changed = err == nil
		return err
	})
	if err != nil {
		return err
	}
	if changed && s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, updatedNode)
	}
	return nil
}

func (s *SplitOrchestrator) activateMaterializedSplitGeneration(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, generation int32) error {
	var active db.MulticaWorkflowNodeRun
	if err := s.runInTx(ctx, func(qtx *db.Queries) error {
		lockedNode, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return err
		}
		if lockedNode.Status != NodeRunStatusMaterializing || lockedNode.SplitPlanGeneration != generation {
			return nil
		}
		tasks, err := qtx.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
			NodeRunID: lockedNode.ID, SplitPlanGeneration: pgtype.Int4{Int32: generation, Valid: true},
		})
		if err != nil {
			return err
		}
		if len(tasks) == 0 {
			return errors.New("split generation has no tasks")
		}
		for _, task := range tasks {
			if !task.IssueID.Valid {
				return nil
			}
		}
		if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
			NodeRunID: lockedNode.ID, Generation: generation, Status: SplitGenerationActive,
		}); err != nil {
			return err
		}
		active, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{ID: lockedNode.ID, Status: NodeRunStatusSplitActive})
		return err
	}); err != nil {
		return err
	}
	if active.ID.Valid && s.WfService != nil && s.WfService.OnNodeStatusChanged != nil {
		s.WfService.OnNodeStatusChanged(ctx, active)
	}
	if active.ID.Valid {
		return s.ScheduleReadyTasks(ctx, active.ID)
	}
	return nil
}

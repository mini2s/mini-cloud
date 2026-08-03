package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

var (
	ErrWorkflowRoleAssignmentConflict = errors.New("workflow role assignment version conflict")
	ErrWorkflowRoleAssignmentStage    = errors.New("workflow role assignment stage already started")
	ErrWorkflowRoleRetryRateLimited   = errors.New("workflow role resolution retry rate limited")
	ErrWorkflowRoleRetryActive        = errors.New("workflow role resolution job already active")
	ErrWorkflowRoleRetryUnavailable   = errors.New("workflow role automatic resolution unavailable")
	ErrWorkflowRoleNoUnresolved       = errors.New("workflow run has no unresolved roles")
)

type WorkflowRoleManualAssignment struct {
	ResolutionID pgtype.UUID
	UserID       pgtype.UUID
	Version      int32
}

func (s *WorkflowService) AssignWorkflowRoles(ctx context.Context, runID, actorUserID pgtype.UUID, assignments []WorkflowRoleManualAssignment) ([]db.MulticaWorkflowRoleResolution, error) {
	if len(assignments) == 0 {
		return nil, errors.New("assignments are required")
	}
	seen := map[pgtype.UUID]struct{}{}
	for _, assignment := range assignments {
		if _, ok := seen[assignment.ResolutionID]; ok {
			return nil, errors.New("duplicate resolution_id")
		}
		seen[assignment.ResolutionID] = struct{}{}
	}
	err := s.runInTx(ctx, func(q *db.Queries) error {
		run, err := q.GetWorkflowRun(ctx, runID)
		if err != nil {
			return err
		}
		if run.Status == RunStatusCancelled || run.Status == RunStatusCompleted || run.Status == RunStatusFailed {
			return ErrWorkflowRoleAssignmentStage
		}
		if err := q.LockWorkflowRoleResolutionRun(ctx, runID); err != nil {
			return err
		}
		if err := q.CancelWorkflowRoleResolutionJobs(ctx, runID); err != nil {
			return err
		}

		memberRows, err := q.ListActiveWorkflowRoleCandidateMembers(ctx, run.WorkspaceID)
		if err != nil {
			return err
		}
		validUsers := make(map[pgtype.UUID]struct{}, len(memberRows))
		for _, member := range memberRows {
			validUsers[member.UserID] = struct{}{}
		}

		for _, assignment := range assignments {
			if _, ok := validUsers[assignment.UserID]; !ok {
				return fmt.Errorf("assigned user is not an active workspace member")
			}
			locked, err := q.LockWorkflowRoleResolutionForManual(ctx, db.LockWorkflowRoleResolutionForManualParams{ID: assignment.ResolutionID, WorkflowRunID: runID})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrWorkflowRoleAssignmentConflict
			}
			if err != nil {
				return err
			}
			if locked.Version != assignment.Version {
				return ErrWorkflowRoleAssignmentConflict
			}
			if !workflowRoleSlotAssignable(locked.SlotType, locked.NodeRunStatus) {
				return ErrWorkflowRoleAssignmentStage
			}
			updated, err := q.UpdateWorkflowRoleResolutionManual(ctx, db.UpdateWorkflowRoleResolutionManualParams{
				ID: locked.ID, Version: locked.Version, ResolvedUserID: assignment.UserID, ResolvedBy: actorUserID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrWorkflowRoleAssignmentConflict
			}
			if err != nil {
				return err
			}
			var affected int64
			if locked.SlotType == "worker" {
				affected, err = q.SetWorkflowNodeRunResolvedWorker(ctx, db.SetWorkflowNodeRunResolvedWorkerParams{ID: locked.WorkflowNodeRunID, WorkerID: assignment.UserID})
			} else {
				affected, err = q.SetWorkflowNodeRunResolvedCritic(ctx, db.SetWorkflowNodeRunResolvedCriticParams{ID: locked.WorkflowNodeRunID, CriticID: assignment.UserID})
			}
			if err != nil {
				return err
			}
			if affected != 1 {
				return ErrWorkflowRoleAssignmentStage
			}
			_, err = q.AddWorkflowRoleResolutionEvent(ctx, db.AddWorkflowRoleResolutionEventParams{
				WorkflowRunID: runID, WorkflowRoleResolutionID: updated.ID,
				EventType: "manual_assignment", SlotType: pgtype.Text{String: updated.SlotType, Valid: true},
				RoleNameSnapshot: updated.RoleNameSnapshot, ResolvedUserID: assignment.UserID,
				Source: pgtype.Text{String: "manual", Valid: true}, ReasonCode: "manual_assignment",
				ActorUserID: actorUserID,
			})
			if err != nil {
				return err
			}
			if locked.Status == "invalidated" && run.Status == RunStatusRunning {
				resumeStatus := NodeRunStatusFormatOk
				if locked.SlotType == "critic" {
					resumeStatus = NodeRunStatusAwaitingCritic
				}
				resumedNode, err := q.ResumeWorkflowNodeRunAfterRoleAssignment(ctx, db.ResumeWorkflowNodeRunAfterRoleAssignmentParams{
					ID: locked.WorkflowNodeRunID, Status: resumeStatus,
				})
				if err != nil {
					return err
				}
				phase := "worker"
				if locked.SlotType == "critic" {
					phase = "critic"
				}
				generation, err := NextWorkflowDispatchGeneration(ctx, q, resumedNode.ID, phase)
				if err != nil {
					return err
				}
				if err := EnqueueWorkflowDispatch(ctx, q, resumedNode.ID, phase, generation); err != nil {
					return err
				}
			}
		}
		unresolved, err := q.CountUnresolvedWorkflowRoleResolutions(ctx, runID)
		if err != nil {
			return err
		}
		if unresolved == 0 {
			return PromoteWorkflowRunAndEnqueueRoots(ctx, q, runID)
		}
		_, err = q.SetWorkflowRunWaitingForRoleAssignment(ctx, runID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.Queries.ListWorkflowRoleResolutions(ctx, runID)
}

func workflowRoleSlotAssignable(slotType, nodeStatus string) bool {
	if isTerminalNodeRunStatus(nodeStatus) {
		return false
	}
	if slotType == "worker" {
		switch nodeStatus {
		case NodeRunStatusBlocked, NodeRunStatusPending, NodeRunStatusFormatChecking, NodeRunStatusFormatOk:
			return true
		default:
			return false
		}
	}
	return nodeStatus != NodeRunStatusCriticReviewing && nodeStatus != NodeRunStatusCriticApproved && nodeStatus != NodeRunStatusCriticRework
}

func (s *WorkflowService) RetryWorkflowRoleResolution(ctx context.Context, runID pgtype.UUID) (*db.MulticaWorkflowRoleResolutionJob, error) {
	var created db.MulticaWorkflowRoleResolutionJob
	err := s.runInTx(ctx, func(q *db.Queries) error {
		run, err := q.GetWorkflowRun(ctx, runID)
		if err != nil {
			return err
		}
		if !s.roleResolutionEnabledFor(run.WorkspaceID) {
			return ErrWorkflowRoleRetryUnavailable
		}
		if run.Status != RunStatusWaitingRoleAssignment {
			return ErrWorkflowRoleAssignmentStage
		}
		if err := q.LockWorkflowRoleResolutionRun(ctx, runID); err != nil {
			return err
		}
		latest, err := q.GetLatestWorkflowRoleResolutionJob(ctx, runID)
		generation := int32(1)
		if err == nil {
			if latest.Status == "pending" || latest.Status == "running" {
				return ErrWorkflowRoleRetryActive
			}
			if latest.CreatedAt.Valid && time.Since(latest.CreatedAt.Time) < time.Minute {
				return ErrWorkflowRoleRetryRateLimited
			}
			generation = latest.Generation + 1
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		unresolved, err := q.CountUnresolvedWorkflowRoleResolutions(ctx, runID)
		if err != nil {
			return err
		}
		if unresolved == 0 {
			return ErrWorkflowRoleNoUnresolved
		}
		if err := q.LockWorkflowRoleResolutionWorkspace(ctx, run.WorkspaceID); err != nil {
			return err
		}
		if s.RoleResolutionMaxActiveJobs > 0 {
			active, err := q.CountActiveWorkflowRoleResolutionJobsForWorkspace(ctx, run.WorkspaceID)
			if err != nil {
				return err
			}
			if active >= s.RoleResolutionMaxActiveJobs {
				return ErrWorkflowRoleResolutionLimit
			}
		}
		affected, err := q.MarkUnresolvedWorkflowRoleResolutionsPending(ctx, runID)
		if err != nil {
			return err
		}
		if affected == 0 {
			return ErrWorkflowRoleNoUnresolved
		}
		if _, err := q.SetWorkflowRunResolvingRoles(ctx, runID); err != nil {
			return err
		}
		created, err = q.CreateWorkflowRoleResolutionRetryJob(ctx, db.CreateWorkflowRoleResolutionRetryJobParams{
			WorkspaceID: run.WorkspaceID, WorkflowRunID: runID,
			Model: s.RoleResolutionModel, PromptVersion: s.RoleResolutionPromptVersion,
			Generation: generation,
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

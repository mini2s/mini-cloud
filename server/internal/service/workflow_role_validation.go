package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

var ErrWorkflowRoleMemberInvalid = errors.New("resolved workflow role member is no longer active")

func (s *WorkflowService) validateResolvedHumanMember(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, slotType string) error {
	resolution, err := s.Queries.GetWorkflowRoleResolutionByNodeRunSlot(ctx, db.GetWorkflowRoleResolutionByNodeRunSlotParams{
		WorkflowNodeRunID: nodeRun.ID, SlotType: slotType,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var userID pgtype.UUID
	if slotType == "worker" {
		userID = nodeRun.WorkerID
	} else {
		userID = nodeRun.CriticID
	}
	if resolution.Status != "resolved" || !userID.Valid || resolution.ResolvedUserID != userID {
		return ErrWorkflowRoleMemberInvalid
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return err
	}
	member, err := s.Queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID: userID, WorkspaceID: run.WorkspaceID,
	})
	if err == nil && member.Status == "active" && member.UserID.Valid {
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("validate workflow role member: %w", err)
	}
	var blocked db.MulticaWorkflowNodeRun
	if err := s.runInTx(ctx, func(q *db.Queries) error {
		updated, err := q.InvalidateWorkflowRoleResolution(ctx, db.InvalidateWorkflowRoleResolutionParams{
			ID: resolution.ID, Version: resolution.Version, ResolvedUserID: userID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrWorkflowRoleMemberInvalid
		}
		if err != nil {
			return err
		}
		blocked, err = q.BlockWorkflowNodeRunForInvalidRole(ctx, db.BlockWorkflowNodeRunForInvalidRoleParams{
			ID: nodeRun.ID, Status: nodeRun.Status,
		})
		if err != nil {
			return err
		}
		_, err = q.AddWorkflowRoleResolutionEvent(ctx, db.AddWorkflowRoleResolutionEventParams{
			WorkflowRunID: run.ID, WorkflowRoleResolutionID: updated.ID,
			EventType: "invalidated", SlotType: pgtype.Text{String: slotType, Valid: true},
			RoleNameSnapshot: updated.RoleNameSnapshot, ResolvedUserID: userID,
			Source: updated.Source, ReasonCode: "member_inactive",
		})
		if err != nil {
			return err
		}
		return enqueueWorkflowRoleManualNotifications(ctx, q, run, []db.MulticaWorkflowRoleResolution{updated})
	}); err != nil {
		return err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, blocked)
	}
	return ErrWorkflowRoleMemberInvalid
}

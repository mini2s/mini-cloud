package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (s *WorkflowService) transitionHumanRolePhase(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, slotType, newStatus string) error {
	if !isValidTransition(nodeRun.Status, newStatus) {
		return errors.New("invalid workflow node transition")
	}
	var updated db.MulticaWorkflowNodeRun
	err := s.runInTx(ctx, func(q *db.Queries) error {
		var err error
		updated, err = q.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{ID: nodeRun.ID, Status: newStatus})
		if err != nil {
			return err
		}
		run, err := q.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
		if err != nil {
			return err
		}
		recipient := nodeRun.WorkerID
		notificationType := "execution"
		if slotType == "critic" {
			recipient = nodeRun.CriticID
			notificationType = "review"
		}
		if !recipient.Valid {
			return errors.New("workflow role recipient is missing")
		}
		// Human worker_id/critic_id store a member_id (the issue-assignee model
		// and ListMyWorkflowTasks both key on member_id), but recipient_user_id
		// FK→multica_user. Resolve member→user; if the id is not a member (e.g. a
		// role-resolved user_id), GetMember returns no rows and we use it as-is.
		if m, err := q.GetMember(ctx, recipient); err == nil && m.UserID.Valid {
			recipient = m.UserID
		}
		_, err = q.EnqueueWorkflowRoleNotification(ctx, db.EnqueueWorkflowRoleNotificationParams{
			WorkspaceID: run.WorkspaceID, WorkflowRunID: run.ID, WorkflowNodeRunID: nodeRun.ID,
			SlotType: slotType, RecipientUserID: recipient, NotificationType: notificationType,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		return err
	}
	if s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, updated)
	}
	return nil
}

func enqueueWorkflowRoleManualNotifications(ctx context.Context, q *db.Queries, run db.MulticaWorkflowRun, rows []db.MulticaWorkflowRoleResolution) error {
	recipients, err := q.ListWorkflowRoleManualNotificationRecipients(ctx, run.ID)
	if err != nil {
		return err
	}
	for _, row := range rows {
		for _, recipient := range recipients {
			_, err := q.EnqueueWorkflowRoleNotification(ctx, db.EnqueueWorkflowRoleNotificationParams{
				WorkspaceID: run.WorkspaceID, WorkflowRunID: run.ID,
				WorkflowNodeRunID: row.WorkflowNodeRunID, SlotType: row.SlotType,
				RecipientUserID: recipient.ID, NotificationType: "manual_required",
			})
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
	}
	return nil
}

type WorkflowRoleNotificationWorker struct {
	Queries       *db.Queries
	Email         *EmailService
	WorkerID      string
	PollInterval  time.Duration
	LeaseDuration time.Duration
}

func (w *WorkflowRoleNotificationWorker) Run(ctx context.Context) {
	if w.PollInterval <= 0 {
		w.PollInterval = time.Second
	}
	if w.LeaseDuration <= 0 {
		w.LeaseDuration = 45 * time.Second
	}
	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	_, _ = w.Queries.RequeueExpiredWorkflowRoleNotifications(ctx)
	for {
		err := w.runOnce(ctx)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, context.Canceled) {
			slog.Warn("workflow role notification worker", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *WorkflowRoleNotificationWorker) runOnce(ctx context.Context) error {
	lock := pgtype.Text{String: w.WorkerID, Valid: true}
	notification, err := w.Queries.ClaimWorkflowRoleNotification(ctx, db.ClaimWorkflowRoleNotificationParams{
		LockedBy: lock, LeaseDuration: pgtype.Interval{Microseconds: w.LeaseDuration.Microseconds(), Valid: true},
	})
	if err != nil {
		return err
	}
	user, err := w.Queries.GetUser(ctx, notification.RecipientUserID)
	if err != nil {
		return w.retry(ctx, notification, lock)
	}
	if strings.TrimSpace(user.Email) == "" {
		_, err = w.Queries.MarkWorkflowRoleNotificationSkippedNoEmail(ctx, db.MarkWorkflowRoleNotificationSkippedNoEmailParams{ID: notification.ID, LockedBy: lock})
		return err
	}
	run, err := w.Queries.GetWorkflowRun(ctx, notification.WorkflowRunID)
	if err != nil {
		return w.retry(ctx, notification, lock)
	}
	nodeRun, err := w.Queries.GetWorkflowNodeRun(ctx, notification.WorkflowNodeRunID)
	if err != nil {
		return w.retry(ctx, notification, lock)
	}
	roleName := notification.SlotType
	if resolution, resolveErr := w.Queries.GetWorkflowRoleResolutionByNodeRunSlot(ctx, db.GetWorkflowRoleResolutionByNodeRunSlotParams{
		WorkflowNodeRunID: notification.WorkflowNodeRunID, SlotType: notification.SlotType,
	}); resolveErr == nil {
		roleName = resolution.RoleNameSnapshot
	}
	if err := w.Email.SendWorkflowRoleNotification(user.Email, notification.NotificationType, run.WorkflowTitle, nodeRun.NodeTitle, roleName); err != nil {
		return w.retry(ctx, notification, lock)
	}
	_, err = w.Queries.MarkWorkflowRoleNotificationSent(ctx, db.MarkWorkflowRoleNotificationSentParams{ID: notification.ID, LockedBy: lock})
	return err
}

func (w *WorkflowRoleNotificationWorker) retry(ctx context.Context, notification db.MulticaWorkflowRoleNotification, lock pgtype.Text) error {
	delay := time.Duration(1<<min(int(notification.AttemptCount), 5)) * time.Second
	_, err := w.Queries.RescheduleWorkflowRoleNotification(ctx, db.RescheduleWorkflowRoleNotificationParams{
		ID: notification.ID, LockedBy: lock,
		ScheduledAt: pgtype.Timestamptz{Time: time.Now().Add(delay), Valid: true},
		LastError:   "delivery failed",
	})
	if err != nil {
		slog.Warn("workflow role notification retry failed", "notification_id", util.UUIDToString(notification.ID), "error", err)
	}
	return err
}

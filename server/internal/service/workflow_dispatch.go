package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const workflowDispatchMaxAttempts = 5

type WorkflowDispatchWorker struct {
	Queries       *db.Queries
	TxStarter     TxStarter
	Workflow      *WorkflowService
	WorkerID      string
	PollInterval  time.Duration
	LeaseDuration time.Duration
}

func EnqueueWorkflowDispatch(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
	phase string,
	generation int32,
) error {
	if phase != "worker" && phase != "critic" {
		return fmt.Errorf("unknown workflow dispatch phase: %s", phase)
	}
	nodeRun, err := queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get workflow node run for dispatch: %w", err)
	}
	_, err = queries.CreateWorkflowDispatchJob(ctx, db.CreateWorkflowDispatchJobParams{
		WorkflowRunID: nodeRun.WorkflowRunID, WorkflowNodeRunID: nodeRun.ID,
		Phase: phase, Generation: generation, MaxAttempts: workflowDispatchMaxAttempts,
	})
	if err != nil {
		return fmt.Errorf("create workflow dispatch job: %w", err)
	}
	return nil
}

func (w *WorkflowDispatchWorker) Run(ctx context.Context) {
	w.applyDefaults()
	if _, err := w.Queries.RequeueExpiredWorkflowDispatchJobs(ctx); err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("requeue expired workflow dispatch jobs", "worker_id", w.WorkerID, "error", err)
	}
	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	for {
		if err := w.runOnce(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, context.Canceled) {
			slog.Warn("workflow dispatch worker", "worker_id", w.WorkerID, "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *WorkflowDispatchWorker) runOnce(ctx context.Context) error {
	w.applyDefaults()
	if _, err := w.Queries.RequeueExpiredWorkflowDispatchJobs(ctx); err != nil {
		return fmt.Errorf("requeue expired workflow dispatch jobs: %w", err)
	}
	lockedBy := pgtype.Text{String: w.WorkerID, Valid: true}
	job, err := w.Queries.ClaimWorkflowDispatchJob(ctx, db.ClaimWorkflowDispatchJobParams{
		LockedBy: lockedBy,
		LeaseDuration: pgtype.Interval{
			Microseconds: w.LeaseDuration.Microseconds(), Valid: true,
		},
	})
	if err != nil {
		return err
	}
	jobCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go w.renewLease(jobCtx, cancel, done, job)
	defer func() {
		close(done)
		cancel()
	}()

	if err := w.process(jobCtx, job); err != nil {
		if handleErr := w.handleFailure(ctx, job, err); handleErr != nil {
			return fmt.Errorf("dispatch job %s: %w (record failure: %v)", util.UUIDToString(job.ID), err, handleErr)
		}
		return fmt.Errorf("dispatch job %s: %w", util.UUIDToString(job.ID), err)
	}
	return nil
}

func (w *WorkflowDispatchWorker) applyDefaults() {
	if w.PollInterval <= 0 {
		w.PollInterval = time.Second
	}
	if w.LeaseDuration <= 0 {
		w.LeaseDuration = 30 * time.Second
	}
}

func (w *WorkflowDispatchWorker) renewLease(
	ctx context.Context,
	cancel context.CancelFunc,
	done <-chan struct{},
	job db.MulticaWorkflowNodeRunDispatchJob,
) {
	interval := w.LeaseDuration / 3
	if interval > 2*time.Second {
		interval = 2 * time.Second
	}
	if interval < 500*time.Millisecond {
		interval = 500 * time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-ticker.C:
			_, err := w.Queries.RenewWorkflowDispatchJobLease(ctx, db.RenewWorkflowDispatchJobLeaseParams{
				ID: job.ID, Generation: job.Generation,
				LockedBy: job.LockedBy,
				LeaseDuration: pgtype.Interval{
					Microseconds: w.LeaseDuration.Microseconds(), Valid: true,
				},
			})
			if err != nil {
				cancel()
				return
			}
		}
	}
}

func (w *WorkflowDispatchWorker) process(ctx context.Context, job db.MulticaWorkflowNodeRunDispatchJob) error {
	nodeRun, err := w.Queries.GetWorkflowNodeRun(ctx, job.WorkflowNodeRunID)
	if err != nil {
		return fmt.Errorf("get dispatch node run: %w", err)
	}
	switch job.Phase {
	case "worker":
		if err := w.dispatchWorkerPhase(ctx, job, nodeRun); err != nil {
			return err
		}
	case "critic":
		if err := w.dispatchCriticPhase(ctx, job, nodeRun); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown workflow dispatch phase: %s", job.Phase)
	}
	_, err = w.Queries.CompleteWorkflowDispatchJob(ctx, db.CompleteWorkflowDispatchJobParams{
		ID: job.ID, Generation: job.Generation, LockedBy: job.LockedBy,
	})
	if err != nil {
		return fmt.Errorf("complete workflow dispatch job: %w", err)
	}
	return nil
}

func (w *WorkflowDispatchWorker) dispatchWorkerPhase(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	switch nodeRun.Status {
	case NodeRunStatusFormatOk:
		return w.Workflow.dispatchWorkerForJob(ctx, nodeRun, job.ID)
	case NodeRunStatusWorking:
		return w.requireAgentTaskForCompletedDispatch(ctx, job, nodeRun.WorkerType)
	case NodeRunStatusWorkerAssigned, NodeRunStatusSplitting:
		return nil
	default:
		return fmt.Errorf("worker dispatch cannot resume node status %s", nodeRun.Status)
	}
}

func (w *WorkflowDispatchWorker) dispatchCriticPhase(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	switch nodeRun.Status {
	case NodeRunStatusAwaitingCritic:
		return w.Workflow.dispatchCriticForJob(ctx, nodeRun, job.ID)
	case NodeRunStatusCriticReviewing:
		return w.requireAgentTaskForCompletedDispatch(ctx, job, nodeRun.CriticType)
	default:
		return fmt.Errorf("critic dispatch cannot resume node status %s", nodeRun.Status)
	}
}

func (w *WorkflowDispatchWorker) requireAgentTaskForCompletedDispatch(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	actorType string,
) error {
	if actorType != "agent" && actorType != "squad" {
		return nil
	}
	if _, err := w.Queries.GetAgentTaskByWorkflowDispatchJob(ctx, job.ID); err != nil {
		return fmt.Errorf("get task for completed dispatch: %w", err)
	}
	return nil
}

func (w *WorkflowDispatchWorker) handleFailure(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	cause error,
) error {
	if job.AttemptCount < job.MaxAttempts {
		_, err := w.Queries.RequeueWorkflowDispatchJob(ctx, db.RequeueWorkflowDispatchJobParams{
			ScheduledAt: pgtype.Timestamptz{Time: time.Now().Add(workflowDispatchBackoff(job.AttemptCount)), Valid: true},
			LastError:   cause.Error(), ID: job.ID, Generation: job.Generation, LockedBy: job.LockedBy,
		})
		return err
	}
	if w.TxStarter == nil {
		return errors.New("workflow dispatch failure requires a transaction")
	}
	tx, err := w.TxStarter.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin dispatch failure tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := w.Queries.WithTx(tx)
	if _, err := qtx.FailWorkflowDispatchJob(ctx, db.FailWorkflowDispatchJobParams{
		LastError: cause.Error(), ID: job.ID, Generation: job.Generation, LockedBy: job.LockedBy,
	}); err != nil {
		return err
	}
	if _, err := qtx.FailWorkflowNodeRunForDispatch(ctx, job.WorkflowNodeRunID); err != nil {
		return err
	}
	if _, err := qtx.FailWorkflowRunForDispatch(ctx, job.WorkflowRunID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func workflowDispatchBackoff(attempt int32) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	backoff := time.Second * time.Duration(1<<min(attempt-1, 6))
	if backoff > time.Minute {
		return time.Minute
	}
	return backoff
}

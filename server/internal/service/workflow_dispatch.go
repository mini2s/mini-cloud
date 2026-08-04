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

var ErrSplitDeliverableUnavailable = errors.New("split deliverable unavailable")

const workflowDispatchMaxAttempts = 5

type WorkflowDispatchWorker struct {
	Queries          *db.Queries
	TxStarter        TxStarter
	Workflow         *WorkflowService
	DispatchSplit    func(context.Context, db.MulticaWorkflowNodeRun, pgtype.UUID) error
	MaterializeSplit func(context.Context, db.MulticaWorkflowNodeRunDispatchJob, db.MulticaWorkflowNodeRun) (bool, error)
	WorkerID         string
	PollInterval     time.Duration
	LeaseDuration    time.Duration
}

func EnqueueWorkflowDispatch(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
	phase string,
	generation int32,
) error {
	return enqueueWorkflowDispatch(ctx, queries, nodeRunID, phase, generation, pgtype.Int4{})
}

func EnqueueSplitWorkflowDispatch(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
	phase string,
	dispatchGeneration int32,
	splitPlanGeneration int32,
) error {
	return enqueueWorkflowDispatch(ctx, queries, nodeRunID, phase, dispatchGeneration, pgtype.Int4{Int32: splitPlanGeneration, Valid: true})
}

func enqueueWorkflowDispatch(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
	phase string,
	generation int32,
	splitPlanGeneration pgtype.Int4,
) error {
	if phase != "worker" && phase != "critic" && phase != "recovery" && phase != "split" && phase != "materialize" {
		return fmt.Errorf("unknown workflow dispatch phase: %s", phase)
	}
	if (phase == "split" || phase == "materialize") != splitPlanGeneration.Valid {
		return fmt.Errorf("workflow dispatch phase %s has invalid split plan generation", phase)
	}
	nodeRun, err := queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get workflow node run for dispatch: %w", err)
	}
	_, err = queries.CreateWorkflowDispatchJob(ctx, db.CreateWorkflowDispatchJobParams{
		WorkflowRunID: nodeRun.WorkflowRunID, WorkflowNodeRunID: nodeRun.ID,
		Phase: phase, Generation: generation, MaxAttempts: workflowDispatchMaxAttempts,
		SplitPlanGeneration: splitPlanGeneration,
	})
	if err != nil {
		return fmt.Errorf("create workflow dispatch job: %w", err)
	}
	return nil
}

func BeginInitialSplitPlanGeneration(ctx context.Context, queries *db.Queries, nodeRun db.MulticaWorkflowNodeRun) error {
	if nodeRun.SplitPlanGeneration > 0 {
		return nil
	}
	deliverable, err := queries.GetNodeRunDeliverableByPurpose(ctx, db.GetNodeRunDeliverableByPurposeParams{
		WorkflowNodeRunID: nodeRun.ID,
		Purpose:           SplitDeliverablePurpose,
	})
	if err != nil {
		return fmt.Errorf("get split task plan deliverable: %w", err)
	}
	if _, err := queries.CreateWorkflowSplitGeneration(ctx, db.CreateWorkflowSplitGenerationParams{
		NodeRunID: nodeRun.ID, Generation: 1, Status: SplitGenerationSplitting,
		DeliverableID: deliverable.ID,
	}); err != nil {
		return fmt.Errorf("create initial split plan generation: %w", err)
	}
	if _, err := queries.SetWorkflowNodeRunSplitGeneration(ctx, db.SetWorkflowNodeRunSplitGenerationParams{
		ID: nodeRun.ID, SplitPlanGeneration: 1, Status: NodeRunStatusSplitting,
	}); err != nil {
		return fmt.Errorf("activate initial split plan generation: %w", err)
	}
	dispatchGeneration, err := NextWorkflowDispatchGeneration(ctx, queries, nodeRun.ID, "split")
	if err != nil {
		return err
	}
	return EnqueueSplitWorkflowDispatch(ctx, queries, nodeRun.ID, "split", dispatchGeneration, 1)
}

func BeginSplitPlanGeneration(
	ctx context.Context,
	queries *db.Queries,
	nodeRun db.MulticaWorkflowNodeRun,
	reviewComment string,
	reviewedContent string,
	reviewHeadCommitSHA string,
) (db.MulticaWorkflowNodeRun, error) {
	deliverable, err := queries.GetNodeRunDeliverableByPurpose(ctx, db.GetNodeRunDeliverableByPurposeParams{
		WorkflowNodeRunID: nodeRun.ID, Purpose: SplitDeliverablePurpose,
	})
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, fmt.Errorf("get split task plan deliverable: %w", err)
	}
	nextGeneration := nodeRun.SplitPlanGeneration + 1
	if _, err := queries.CreateWorkflowSplitGeneration(ctx, db.CreateWorkflowSplitGenerationParams{
		NodeRunID: nodeRun.ID, Generation: nextGeneration, Status: SplitGenerationSplitting,
		DeliverableID: deliverable.ID, ReviewComment: reviewComment,
		ReviewedContent: reviewedContent, ReviewHeadCommitSha: reviewHeadCommitSHA,
	}); err != nil {
		return db.MulticaWorkflowNodeRun{}, fmt.Errorf("create split plan generation: %w", err)
	}
	updated, err := queries.SetWorkflowNodeRunSplitGeneration(ctx, db.SetWorkflowNodeRunSplitGenerationParams{
		ID: nodeRun.ID, SplitPlanGeneration: nextGeneration, Status: NodeRunStatusSplitting,
	})
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, fmt.Errorf("activate split plan generation: %w", err)
	}
	dispatchGeneration, err := NextWorkflowDispatchGeneration(ctx, queries, nodeRun.ID, "split")
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, err
	}
	if err := EnqueueSplitWorkflowDispatch(ctx, queries, nodeRun.ID, "split", dispatchGeneration, nextGeneration); err != nil {
		return db.MulticaWorkflowNodeRun{}, err
	}
	return updated, nil
}

func NextWorkflowDispatchGeneration(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
	phase string,
) (int32, error) {
	generation, err := queries.NextWorkflowDispatchGeneration(ctx, db.NextWorkflowDispatchGenerationParams{
		WorkflowNodeRunID: nodeRunID,
		Phase:             phase,
	})
	if err != nil {
		return 0, fmt.Errorf("get next workflow dispatch generation: %w", err)
	}
	return generation, nil
}

func PromoteWorkflowRunAndEnqueueRoots(
	ctx context.Context,
	queries *db.Queries,
	runID pgtype.UUID,
) error {
	promoted, err := queries.PromoteWorkflowRunAfterRoleResolution(ctx, runID)
	if err != nil {
		return fmt.Errorf("promote workflow run after role resolution: %w", err)
	}
	if promoted == 0 {
		return nil
	}
	nodeRuns, err := queries.UnblockWorkflowNodeRunsAfterRoleResolution(ctx, runID)
	if err != nil {
		return fmt.Errorf("unblock workflow node runs after role resolution: %w", err)
	}
	for _, nodeRun := range nodeRuns {
		if nodeRun.Status != NodeRunStatusFormatOk {
			continue
		}
		if workflowNodeType(nodeRun.FormatSchema) == "split" {
			if err := BeginInitialSplitPlanGeneration(ctx, queries, nodeRun); err != nil {
				return err
			}
			continue
		}
		if err := EnqueueWorkflowDispatch(ctx, queries, nodeRun.ID, "worker", 1); err != nil {
			return err
		}
	}
	return nil
}

func ActivateDownstreamAndEnqueue(
	ctx context.Context,
	queries *db.Queries,
	completedNodeRunID pgtype.UUID,
) error {
	edges, err := queries.ListWorkflowRunEdgesBySource(ctx, completedNodeRunID)
	if err != nil {
		return fmt.Errorf("list runtime downstream edges: %w", err)
	}
	for _, edge := range edges {
		if err := activateNodeRunIfReady(ctx, queries, edge.TargetNodeRunID); err != nil {
			return err
		}
	}
	return nil
}

// activateNodeRunIfReady advances a pending node run once every upstream
// dependency reached a dependency-satisfying status, then enqueues its worker
// dispatch. Nodes with unsatisfied upstreams or a non-pending status are left
// untouched.
func activateNodeRunIfReady(
	ctx context.Context,
	queries *db.Queries,
	nodeRunID pgtype.UUID,
) error {
	upstreamEdges, err := queries.ListWorkflowRunEdgesByTarget(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("list runtime upstream edges: %w", err)
	}
	for _, upstreamEdge := range upstreamEdges {
		upstream, err := queries.GetWorkflowNodeRun(ctx, upstreamEdge.SourceNodeRunID)
		if err != nil {
			return fmt.Errorf("get runtime upstream node: %w", err)
		}
		if !isSatisfiedDependencyNodeRunStatus(upstream.Status) {
			return nil
		}
	}
	target, err := queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get runtime downstream node: %w", err)
	}
	targetStatus := NodeRunStatusFormatOk
	gateway := false
	if isInvalidWorkflowGatewayFormat(target.FormatSchema) {
		targetStatus = NodeRunStatusFormatFailed
	} else if _, ok := parseWorkflowNodeFormat(target.FormatSchema); ok {
		targetStatus = NodeRunStatusCompleted
		gateway = true
	}
	advanced, err := queries.AdvancePendingWorkflowNodeRun(ctx, db.AdvancePendingWorkflowNodeRunParams{
		Status: targetStatus,
		ID:     target.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("advance runtime downstream node: %w", err)
	}
	if gateway {
		return ActivateDownstreamAndEnqueue(ctx, queries, advanced.ID)
	}
	if targetStatus == NodeRunStatusFormatFailed {
		return nil
	}
	if workflowNodeType(advanced.FormatSchema) == "split" {
		return BeginInitialSplitPlanGeneration(ctx, queries, advanced)
	}
	generation, err := NextWorkflowDispatchGeneration(ctx, queries, advanced.ID, "worker")
	if err != nil {
		return err
	}
	return EnqueueWorkflowDispatch(ctx, queries, advanced.ID, "worker", generation)
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
	case "recovery":
		if err := w.dispatchRecoveryPhase(ctx, job, nodeRun); err != nil {
			return err
		}
	case "split":
		if err := w.dispatchSplitPhase(ctx, job, nodeRun); err != nil {
			return err
		}
	case "materialize":
		if w.MaterializeSplit == nil {
			return errors.New("split materialization is not configured")
		}
		deferred, err := w.MaterializeSplit(ctx, job, nodeRun)
		if err != nil {
			return err
		}
		if deferred {
			return nil
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
	if workflowNodeType(nodeRun.FormatSchema) == "split" {
		return w.dispatchSplitPhase(ctx, job, nodeRun)
	}
	if _, gateway := parseWorkflowNodeFormat(nodeRun.FormatSchema); gateway {
		return w.completeGatewayDispatch(ctx, nodeRun)
	}
	switch nodeRun.Status {
	case NodeRunStatusFormatOk:
		return w.Workflow.dispatchWorkerForJob(ctx, nodeRun, job.ID)
	case NodeRunStatusWorking:
		return w.ensureAgentTaskForActiveDispatch(ctx, job, nodeRun, "worker", nodeRun.WorkerType)
	case NodeRunStatusWorkerAssigned, NodeRunStatusSplitting:
		return nil
	default:
		return fmt.Errorf("worker dispatch cannot resume node status %s", nodeRun.Status)
	}
}

func (w *WorkflowDispatchWorker) dispatchSplitPhase(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	if job.Phase == "worker" {
		if nodeRun.Status != NodeRunStatusFormatOk {
			return nil
		}
		return BeginInitialSplitPlanGeneration(ctx, w.Queries, nodeRun)
	}
	if job.Phase != "split" || !job.SplitPlanGeneration.Valid ||
		job.SplitPlanGeneration.Int32 != nodeRun.SplitPlanGeneration {
		return nil
	}
	generation, err := w.Queries.GetWorkflowSplitGeneration(ctx, db.GetWorkflowSplitGenerationParams{
		NodeRunID: nodeRun.ID, Generation: job.SplitPlanGeneration.Int32,
	})
	if err != nil {
		return fmt.Errorf("get split plan generation: %w", err)
	}
	if generation.Status != SplitGenerationSplitting || nodeRun.Status != NodeRunStatusSplitting {
		return nil
	}
	if !w.Workflow.teamNamespaceConfigured() {
		return fmt.Errorf("%w: team namespace is not configured", ErrSplitDeliverableUnavailable)
	}
	requirement, err := w.Queries.GetNodeRunDeliverableByPurpose(ctx, db.GetNodeRunDeliverableByPurposeParams{
		WorkflowNodeRunID: nodeRun.ID, Purpose: SplitDeliverablePurpose,
	})
	if err != nil || requirement.ID != generation.DeliverableID {
		return fmt.Errorf("%w: current task-plan requirement is missing", ErrSplitDeliverableUnavailable)
	}
	if err := w.Workflow.ensureNodeRunBranch(ctx, nodeRun); err != nil {
		return fmt.Errorf("%w: ensure split node branch: %v", ErrSplitDeliverableUnavailable, err)
	}
	if w.DispatchSplit == nil {
		return errors.New("split dispatch is not configured")
	}
	return w.DispatchSplit(ctx, nodeRun, job.ID)
}

func (w *WorkflowDispatchWorker) completeGatewayDispatch(
	ctx context.Context,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	var completed db.MulticaWorkflowNodeRun
	newlyCompleted := false
	err := w.Workflow.runInTx(ctx, func(qtx *db.Queries) error {
		locked, err := qtx.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		if err != nil {
			return fmt.Errorf("lock gateway node run: %w", err)
		}
		if locked.Status == NodeRunStatusCompleted {
			completed = locked
			return nil
		}
		if locked.Status != NodeRunStatusFormatOk {
			return fmt.Errorf("gateway dispatch cannot resume node status %s", locked.Status)
		}
		completed, err = qtx.UpdateWorkflowNodeRunStatus(ctx, db.UpdateWorkflowNodeRunStatusParams{
			ID: locked.ID, Status: NodeRunStatusCompleted,
		})
		if err != nil {
			return fmt.Errorf("complete gateway node run: %w", err)
		}
		newlyCompleted = true
		return ActivateDownstreamAndEnqueue(ctx, qtx, completed.ID)
	})
	if err != nil {
		return err
	}
	if newlyCompleted && w.Workflow.OnNodeStatusChanged != nil {
		w.Workflow.OnNodeStatusChanged(ctx, completed)
	}
	w.Workflow.checkRunCompletion(ctx, completed.WorkflowRunID)
	return nil
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
		return w.ensureAgentTaskForActiveDispatch(ctx, job, nodeRun, "critic", nodeRun.CriticType)
	default:
		return fmt.Errorf("critic dispatch cannot resume node status %s", nodeRun.Status)
	}
}

func (w *WorkflowDispatchWorker) dispatchRecoveryPhase(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
) error {
	if nodeRun.Status != NodeRunStatusWorking {
		return fmt.Errorf("recovery dispatch cannot resume node status %s", nodeRun.Status)
	}
	return w.ensureAgentTaskForActiveDispatch(ctx, job, nodeRun, "worker", nodeRun.WorkerType)
}

func (w *WorkflowDispatchWorker) ensureAgentTaskForActiveDispatch(
	ctx context.Context,
	job db.MulticaWorkflowNodeRunDispatchJob,
	nodeRun db.MulticaWorkflowNodeRun,
	phase string,
	actorType string,
) error {
	if actorType != "agent" && actorType != "squad" {
		return nil
	}
	if _, err := w.Queries.GetAgentTaskByWorkflowDispatchJob(ctx, job.ID); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("get task for active dispatch: %w", err)
	}
	_, err := w.Workflow.dispatchAgentTask(ctx, nodeRun, phase, nil, job.ID)
	return err
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
	if job.Phase == "materialize" || job.Phase == "split" {
		if job.SplitPlanGeneration.Valid {
			if _, err := qtx.UpdateWorkflowSplitGenerationStatus(ctx, db.UpdateWorkflowSplitGenerationStatusParams{
				NodeRunID: job.WorkflowNodeRunID, Generation: job.SplitPlanGeneration.Int32, Status: SplitGenerationFailed,
			}); err != nil {
				return err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		nodeRun, err := w.Queries.GetWorkflowNodeRun(ctx, job.WorkflowNodeRunID)
		if err != nil {
			return err
		}
		reason := "split_dispatch_failed"
		if job.Phase == "materialize" {
			reason = "materialize_dispatch_failed"
		} else if errors.Is(cause, ErrSplitDeliverableUnavailable) {
			reason = "split_deliverable_unavailable"
		}
		return w.Workflow.failWorkflowFromNode(ctx, nodeRun, NodeRunStatusFailed, reason)
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

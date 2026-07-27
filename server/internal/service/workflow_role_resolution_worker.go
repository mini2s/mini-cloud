package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	workflowRoleOrganizationMaxAttempts = 3
	workflowRoleLLMMaxAttempts          = 2
	workflowRoleFormatMaxAttempts       = 1
)

type WorkflowRoleResolutionWorker struct {
	Queries        *db.Queries
	TxStarter      TxStarter
	Resolver       WorkflowRoleResolver
	Organization   WorkflowRoleOrganizationProvider
	WorkerID       string
	PollInterval   time.Duration
	LeaseDuration  time.Duration
	MaxCandidates  int
	MaxSlots       int
	MaxInputChars  int
	OnRunPromoted  func(context.Context, pgtype.UUID)
	OnStateChanged func(context.Context, pgtype.UUID, pgtype.UUID)
}

func (w *WorkflowRoleResolutionWorker) Run(ctx context.Context) {
	if w.PollInterval <= 0 {
		w.PollInterval = time.Second
	}
	if w.LeaseDuration <= 0 {
		w.LeaseDuration = 15 * time.Second
	}
	if w.MaxCandidates <= 0 {
		w.MaxCandidates = 200
	}
	if w.MaxSlots <= 0 {
		w.MaxSlots = 50
	}
	if w.MaxInputChars <= 0 {
		w.MaxInputChars = 100000
	}
	ticker := time.NewTicker(w.PollInterval)
	defer ticker.Stop()
	_, _ = w.Queries.RequeueExpiredWorkflowRoleResolutionJobs(ctx)
	nextCallCleanup := time.Time{}
	for {
		if time.Now().After(nextCallCleanup) {
			if _, err := w.Queries.DeleteExpiredWorkflowRoleResolutionCalls(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.Warn("workflow role resolution call cleanup failed", "worker_id", w.WorkerID, "error", err)
			}
			nextCallCleanup = time.Now().Add(24 * time.Hour)
		}
		err := w.runOnce(ctx)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, context.Canceled) {
			slog.Warn("workflow role resolution worker", "worker_id", w.WorkerID, "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *WorkflowRoleResolutionWorker) runOnce(ctx context.Context) error {
	job, err := w.Queries.ClaimWorkflowRoleResolutionJob(ctx, db.ClaimWorkflowRoleResolutionJobParams{
		LockedBy:      pgtype.Text{String: w.WorkerID, Valid: true},
		LeaseDuration: pgtype.Interval{Microseconds: w.LeaseDuration.Microseconds(), Valid: true},
	})
	if err != nil {
		return err
	}
	slog.Info("workflow role resolution job claimed",
		"job_id", util.UUIDToString(job.ID),
		"workspace_id", util.UUIDToString(job.WorkspaceID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"generation", job.Generation,
		"attempt_count", job.AttemptCount,
		"max_attempts", job.MaxAttempts,
		"worker_id", w.WorkerID,
	)
	jobCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go w.renewLease(jobCtx, cancel, done, job)
	defer func() { close(done); cancel() }()
	return w.process(jobCtx, job)
}

func (w *WorkflowRoleResolutionWorker) renewLease(ctx context.Context, cancel context.CancelFunc, done <-chan struct{}, job db.MulticaWorkflowRoleResolutionJob) {
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
			n, err := w.Queries.RenewWorkflowRoleResolutionJobLease(ctx, db.RenewWorkflowRoleResolutionJobLeaseParams{
				ID: job.ID, Generation: job.Generation,
				LeaseDuration: pgtype.Interval{Microseconds: w.LeaseDuration.Microseconds(), Valid: true},
				LockedBy:      pgtype.Text{String: w.WorkerID, Valid: true},
			})
			if err != nil || n != 1 {
				cancel()
				return
			}
		}
	}
}

func (w *WorkflowRoleResolutionWorker) process(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob) error {
	rows, err := w.Queries.ListWorkflowRoleResolutions(ctx, job.WorkflowRunID)
	if err != nil {
		return w.retryGeneric(ctx, job, "resolution_load_failed", err)
	}
	pendingRows := 0
	for _, row := range rows {
		if row.Status == "pending" {
			pendingRows++
		}
	}
	slog.Info("workflow role resolution processing job",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"resolutions_total", len(rows),
		"resolutions_pending", pendingRows,
	)
	if w.Resolver == nil || w.Organization == nil || !w.Organization.Configured() {
		slog.Warn("workflow role resolution resolver not configured; falling back to manual",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"resolver_nil", w.Resolver == nil,
			"organization_nil", w.Organization == nil,
		)
		return w.needsHuman(ctx, job, rows, "resolver_not_configured")
	}
	members, err := ListWorkflowRoleMemberCandidates(ctx, w.Queries, job.WorkspaceID)
	if err != nil {
		return w.retryOrganization(ctx, job, rows, "org_service_unavailable", err, 0)
	}
	if len(members) > w.MaxCandidates {
		slog.Warn("workflow role resolution candidate count exceeds limit",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"candidate_count", len(members),
			"limit", w.MaxCandidates,
		)
		return w.needsHuman(ctx, job, rows, "candidate_limit_exceeded")
	}
	slog.Info("workflow role resolution loaded member candidates",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"candidate_count", len(members),
	)
	identities := make([]string, len(members))
	for i := range members {
		identities[i] = members[i].ExternalIdentity
	}
	orgAttempt, err := w.Queries.IncrementWorkflowRoleResolutionOrgAttempt(ctx, db.IncrementWorkflowRoleResolutionOrgAttemptParams{ID: job.ID, Generation: job.Generation})
	if err != nil {
		return err
	}
	started := time.Now()
	snapshot, orgErr := w.Organization.ResolveMembers(ctx, identities)
	w.recordCall(ctx, job, "organization", orgAttempt, "", started, callResultCode(orgErr, "ok"), orgErr)
	if orgErr != nil {
		slog.Warn("workflow role resolution organization lookup failed",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"attempt", orgAttempt,
			"error", orgErr,
		)
		return w.retryOrganization(ctx, job, rows, "org_service_unavailable", orgErr, orgAttempt)
	}
	slog.Info("workflow role resolution organization snapshot fetched",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"profile_count", len(snapshot.Profiles),
		"requested_count", len(identities),
	)

	profiles := map[string]WorkflowRoleOrganizationProfile{}
	for _, profile := range snapshot.Profiles {
		profiles[profile.ExternalIdentity] = profile
	}
	candidates := []WorkflowRoleResolutionCandidate{}
	candidateUsers := map[string]string{}
	for _, member := range members {
		profile, ok := profiles[member.ExternalIdentity]
		if !ok || (profile.Position == "" && profile.DepartmentPath == "") {
			continue
		}
		id := fmt.Sprintf("candidate_%d", len(candidates)+1)
		name := profile.DisplayName
		if name == "" {
			name = member.DisplayName
		}
		candidates = append(candidates, WorkflowRoleResolutionCandidate{
			ID: id, DisplayName: name, Position: profile.Position,
			DepartmentPath: profile.DepartmentPath, IsMainDepartment: profile.IsMainDepartment,
		})
		candidateUsers[id] = member.UserID
	}
	if len(candidates) == 0 {
		slog.Warn("workflow role resolution produced no eligible candidates after org filter",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"member_count", len(members),
		)
		return w.needsHuman(ctx, job, rows, "no_candidate")
	}

	slots := []WorkflowRoleResolutionSlot{}
	slotRows := map[string]db.MulticaWorkflowRoleResolution{}
	unsafeRows := []db.MulticaWorkflowRoleResolution{}
	for _, row := range rows {
		if row.Status != "pending" {
			continue
		}
		nodeRun, err := w.Queries.GetWorkflowNodeRun(ctx, row.WorkflowNodeRunID)
		if err != nil {
			return w.retryGeneric(ctx, job, "resolution_load_failed", err)
		}
		node, err := w.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
		if err != nil {
			return w.retryGeneric(ctx, job, "resolution_load_failed", err)
		}
		slot := WorkflowRoleResolutionSlot{
			ID: fmt.Sprintf("slot_%d", len(slots)+1), SlotType: row.SlotType,
			RoleName: row.RoleNameSnapshot, RoleDescription: row.RoleDescriptionSnapshot,
			NodeTitle: node.Title, NodeDescription: node.Description,
		}
		if workflowRolePromptInjectionSuspected(slot) {
			unsafeRows = append(unsafeRows, row)
			continue
		}
		slots = append(slots, slot)
		slotRows[slot.ID] = row
	}
	if len(unsafeRows) > 0 {
		slog.Warn("workflow role resolution detected potential prompt injection; marking affected slots needs_human",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"unsafe_slot_count", len(unsafeRows),
		)
		if err := w.markRowsNeedsHuman(ctx, job, unsafeRows, "prompt_injection_suspected", snapshot.Version); err != nil {
			return err
		}
	}
	if len(slots) == 0 {
		return w.finishAccordingToResolutions(ctx, job)
	}
	if len(slots) > w.MaxSlots {
		slog.Warn("workflow role resolution slot count exceeds limit",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"slot_count", len(slots),
			"limit", w.MaxSlots,
		)
		return w.needsHuman(ctx, job, rows, "slot_limit_exceeded")
	}
	request := WorkflowRoleResolverRequest{Slots: slots, Candidates: candidates}
	requestJSON, err := json.Marshal(request)
	if err != nil || utf8.RuneCount(requestJSON) > w.MaxInputChars {
		slog.Warn("workflow role resolution input exceeds character limit or failed to marshal",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"input_chars", utf8.RuneCount(requestJSON),
			"limit", w.MaxInputChars,
			"marshal_error", err,
		)
		return w.needsHuman(ctx, job, rows, "input_limit_exceeded")
	}

	llmAttempt, err := w.Queries.IncrementWorkflowRoleResolutionLLMAttempt(ctx, db.IncrementWorkflowRoleResolutionLLMAttemptParams{ID: job.ID, Generation: job.Generation})
	if err != nil {
		return err
	}
	started = time.Now()
	slog.Info("workflow role resolution invoking LLM resolver",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"slot_count", len(slots),
		"candidate_count", len(candidates),
		"llm_attempt", llmAttempt,
		"model", job.Model,
	)
	response, resolveErr := w.Resolver.Resolve(ctx, request)
	w.recordCall(ctx, job, "llm", llmAttempt, job.Model, started, callResultCode(resolveErr, "ok"), resolveErr, response.Usage)
	if resolveErr != nil {
		slog.Warn("workflow role resolution LLM call failed",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"llm_attempt", llmAttempt,
			"result_code", callResultCode(resolveErr, ""),
			"error", resolveErr,
		)
		var resolverErr *WorkflowRoleResolverError
		if errors.As(resolveErr, &resolverErr) && resolverErr.Code == "invalid_model_output" {
			formatAttempt, incErr := w.Queries.IncrementWorkflowRoleResolutionFormatAttempt(ctx, db.IncrementWorkflowRoleResolutionFormatAttemptParams{ID: job.ID, Generation: job.Generation})
			if incErr != nil {
				return incErr
			}
			if formatAttempt <= workflowRoleFormatMaxAttempts {
				return w.reschedule(ctx, job, "invalid_model_output")
			}
			return w.needsHuman(ctx, job, rows, "invalid_model_output")
		}
		if errors.As(resolveErr, &resolverErr) && resolverErr.Retryable && llmAttempt < workflowRoleLLMMaxAttempts {
			return w.reschedule(ctx, job, resolverErr.Code)
		}
		return w.needsHuman(ctx, job, rows, "resolver_unavailable")
	}
	slog.Info("workflow role resolution LLM call succeeded",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"result_count", len(response.Results),
		"input_tokens", response.Usage.InputTokens,
		"output_tokens", response.Usage.OutputTokens,
	)
	return w.persistResults(ctx, job, slots, slotRows, candidateUsers, response.Results, snapshot.Version)
}

func (w *WorkflowRoleResolutionWorker) persistResults(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, slots []WorkflowRoleResolutionSlot, slotRows map[string]db.MulticaWorkflowRoleResolution, candidateUsers map[string]string, results []WorkflowRoleResolverResult, organizationVersion string) error {
	resultBySlot := map[string]WorkflowRoleResolverResult{}
	for _, result := range results {
		resultBySlot[result.SlotID] = result
	}
	tx, err := w.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.Queries.WithTx(tx)
	for _, slot := range slots {
		row := slotRows[slot.ID]
		result, ok := resultBySlot[slot.ID]
		if !ok {
			result = WorkflowRoleResolverResult{Status: "needs_human", ReasonCode: "invalid_model_output"}
		}
		var userID pgtype.UUID
		if result.Status == "resolved" {
			userID, err = util.ParseUUID(candidateUsers[result.CandidateID])
			if err != nil {
				result.Status, result.ReasonCode = "needs_human", "invalid_model_output"
				userID = pgtype.UUID{}
			}
		}
		slog.Info("workflow role resolution slot result",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"slot_id", slot.ID,
			"slot_type", row.SlotType,
			"role_name", row.RoleNameSnapshot,
			"status", result.Status,
			"resolved_user_id", util.UUIDToString(userID),
			"reason_code", result.ReasonCode,
		)
		updated, updateErr := q.ResolveWorkflowRoleResolutionLLM(ctx, db.ResolveWorkflowRoleResolutionLLMParams{
			ID: row.ID, Version: row.Version, Status: result.Status,
			ReasonCode: result.ReasonCode, ReasonDetail: truncateRunes(result.ReasonDetail, 500),
			ResolvedUserID: userID, JobID: job.ID, JobGeneration: job.Generation,
		})
		if errors.Is(updateErr, pgx.ErrNoRows) {
			slog.Info("workflow role resolution slot result discarded as stale",
				"job_id", util.UUIDToString(job.ID),
				"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
				"slot_id", slot.ID,
			)
			_, _ = q.AddWorkflowRoleResolutionEvent(ctx, roleResolutionEventParams(job, row, "stale_result_discarded", pgtype.UUID{}, "", "stale_result_discarded", "", organizationVersion))
			continue
		}
		if updateErr != nil {
			return updateErr
		}
		if result.Status == "resolved" {
			var affected int64
			if row.SlotType == "worker" {
				affected, err = q.SetWorkflowNodeRunResolvedWorker(ctx, db.SetWorkflowNodeRunResolvedWorkerParams{ID: row.WorkflowNodeRunID, WorkerID: userID})
			} else {
				affected, err = q.SetWorkflowNodeRunResolvedCritic(ctx, db.SetWorkflowNodeRunResolvedCriticParams{ID: row.WorkflowNodeRunID, CriticID: userID})
			}
			if err != nil {
				return err
			}
			if affected != 1 {
				return errors.New("node run is no longer assignable")
			}
		}
		_, err = q.AddWorkflowRoleResolutionEvent(ctx, roleResolutionEventParams(job, updated, "resolution_updated", updated.ResolvedUserID, "llm", result.ReasonCode, result.ReasonDetail, organizationVersion))
		if err != nil {
			return err
		}
	}
	unresolved, err := q.CountUnresolvedWorkflowRoleResolutions(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	status, promoted := "succeeded", int64(0)
	if unresolved > 0 {
		status = "partial"
		slog.Info("workflow role resolution finished with unresolved slots; run waits for manual assignment",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"unresolved_count", unresolved,
		)
		if _, err = q.SetWorkflowRunWaitingForRoleAssignment(ctx, job.WorkflowRunID); err != nil {
			return err
		}
	} else {
		promoted, err = q.PromoteWorkflowRunAfterRoleResolution(ctx, job.WorkflowRunID)
		if err != nil {
			return err
		}
		slog.Info("workflow role resolution complete; run promoted to running",
			"job_id", util.UUIDToString(job.ID),
			"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
			"promoted", promoted,
		)
	}
	affected, err := q.FinishWorkflowRoleResolutionJob(ctx, db.FinishWorkflowRoleResolutionJobParams{ID: job.ID, Generation: job.Generation, Status: status, LastErrorCode: "", LastErrorDetail: ""})
	if err != nil {
		return err
	}
	if affected != 1 {
		return context.Canceled
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if w.OnStateChanged != nil {
		w.OnStateChanged(ctx, job.WorkspaceID, job.WorkflowRunID)
	}
	if promoted > 0 && w.OnRunPromoted != nil {
		w.OnRunPromoted(ctx, job.WorkflowRunID)
	}
	return nil
}

func (w *WorkflowRoleResolutionWorker) markRowsNeedsHuman(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, rows []db.MulticaWorkflowRoleResolution, code, organizationVersion string) error {
	tx, err := w.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.Queries.WithTx(tx)
	for _, row := range rows {
		updated, err := q.MarkWorkflowRoleResolutionNeedsHuman(ctx, db.MarkWorkflowRoleResolutionNeedsHumanParams{
			ID: row.ID, Version: row.Version, JobID: job.ID, JobGeneration: job.Generation,
			ReasonCode: code, ReasonDetail: "",
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		_, err = q.AddWorkflowRoleResolutionEvent(ctx, roleResolutionEventParams(job, updated, "needs_human", pgtype.UUID{}, "", code, "", organizationVersion))
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (w *WorkflowRoleResolutionWorker) needsHuman(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, rows []db.MulticaWorkflowRoleResolution, code string) error {
	if len(rows) == 0 {
		var err error
		rows, err = w.Queries.ListWorkflowRoleResolutions(ctx, job.WorkflowRunID)
		if err != nil {
			return err
		}
	}
	slog.Warn("workflow role resolution falling back to manual assignment",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"workspace_id", util.UUIDToString(job.WorkspaceID),
		"reason_code", code,
		"slot_count", len(rows),
	)
	if err := w.markRowsNeedsHuman(ctx, job, rows, code, ""); err != nil {
		return err
	}
	tx, err := w.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.Queries.WithTx(tx)
	run, err := q.GetWorkflowRun(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	currentRows, err := q.ListWorkflowRoleResolutions(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	unresolvedRows := make([]db.MulticaWorkflowRoleResolution, 0, len(currentRows))
	for _, row := range currentRows {
		if row.Status != "resolved" {
			unresolvedRows = append(unresolvedRows, row)
		}
	}
	if err := enqueueWorkflowRoleManualNotifications(ctx, q, run, unresolvedRows); err != nil {
		return err
	}
	if _, err = q.SetWorkflowRunWaitingForRoleAssignment(ctx, job.WorkflowRunID); err != nil {
		return err
	}
	affected, err := q.FinishWorkflowRoleResolutionJob(ctx, db.FinishWorkflowRoleResolutionJobParams{ID: job.ID, Generation: job.Generation, Status: "partial", LastErrorCode: code, LastErrorDetail: ""})
	if err != nil {
		return err
	}
	if affected != 1 {
		return context.Canceled
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if w.OnStateChanged != nil {
		w.OnStateChanged(ctx, job.WorkspaceID, job.WorkflowRunID)
	}
	return nil
}

func (w *WorkflowRoleResolutionWorker) finishAccordingToResolutions(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob) error {
	unresolved, err := w.Queries.CountUnresolvedWorkflowRoleResolutions(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	if unresolved > 0 {
		rows, err := w.Queries.ListWorkflowRoleResolutions(ctx, job.WorkflowRunID)
		if err != nil {
			return err
		}
		return w.needsHuman(ctx, job, rows, "prompt_injection_suspected")
	}
	slog.Info("workflow role resolution has no remaining slots to resolve; finishing job",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
	)
	tx, err := w.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.Queries.WithTx(tx)
	promoted, err := q.PromoteWorkflowRunAfterRoleResolution(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	affected, err := q.FinishWorkflowRoleResolutionJob(ctx, db.FinishWorkflowRoleResolutionJobParams{ID: job.ID, Generation: job.Generation, Status: "succeeded", LastErrorCode: "", LastErrorDetail: ""})
	if err != nil {
		return err
	}
	if affected != 1 {
		return context.Canceled
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if w.OnStateChanged != nil {
		w.OnStateChanged(ctx, job.WorkspaceID, job.WorkflowRunID)
	}
	if promoted > 0 && w.OnRunPromoted != nil {
		w.OnRunPromoted(ctx, job.WorkflowRunID)
	}
	return nil
}

func (w *WorkflowRoleResolutionWorker) retryOrganization(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, rows []db.MulticaWorkflowRoleResolution, code string, cause error, attempt int32) error {
	if attempt == 0 {
		var err error
		attempt, err = w.Queries.IncrementWorkflowRoleResolutionOrgAttempt(ctx, db.IncrementWorkflowRoleResolutionOrgAttemptParams{ID: job.ID, Generation: job.Generation})
		if err != nil {
			return err
		}
	}
	if attempt < workflowRoleOrganizationMaxAttempts {
		return w.reschedule(ctx, job, code)
	}
	if err := w.needsHuman(ctx, job, rows, code); err != nil {
		return err
	}
	return cause
}

func (w *WorkflowRoleResolutionWorker) retryGeneric(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, code string, cause error) error {
	if job.AttemptCount < job.MaxAttempts {
		return w.reschedule(ctx, job, code)
	}
	rows, err := w.Queries.ListWorkflowRoleResolutions(ctx, job.WorkflowRunID)
	if err != nil {
		return err
	}
	if err := w.needsHuman(ctx, job, rows, code); err != nil {
		return err
	}
	return cause
}

func (w *WorkflowRoleResolutionWorker) reschedule(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, code string) error {
	delay := time.Duration(1<<min(int(job.AttemptCount), 5)) * time.Second
	slog.Info("workflow role resolution rescheduling job after transient failure",
		"job_id", util.UUIDToString(job.ID),
		"workflow_run_id", util.UUIDToString(job.WorkflowRunID),
		"reason_code", code,
		"attempt_count", job.AttemptCount,
		"delay_seconds", delay.Seconds(),
	)
	n, err := w.Queries.RescheduleWorkflowRoleResolutionJob(ctx, db.RescheduleWorkflowRoleResolutionJobParams{
		ID: job.ID, Generation: job.Generation,
		ScheduledAt:   pgtype.Timestamptz{Time: time.Now().Add(delay), Valid: true},
		LastErrorCode: code, LastErrorDetail: "temporary failure",
	})
	if err != nil {
		return err
	}
	if n != 1 {
		return context.Canceled
	}
	return nil
}

func (w *WorkflowRoleResolutionWorker) recordCall(ctx context.Context, job db.MulticaWorkflowRoleResolutionJob, stage string, attempt int32, model string, started time.Time, resultCode string, callErr error, usages ...WorkflowRoleResolverUsage) {
	detail := ""
	if callErr != nil {
		detail = "temporary failure"
	}
	params := db.AddWorkflowRoleResolutionCallParams{
		WorkflowRunID: job.WorkflowRunID, JobID: job.ID, Stage: stage, Attempt: attempt,
		Model: model, DurationMs: time.Since(started).Milliseconds(), ResultCode: resultCode, ErrorDetail: detail,
	}
	if len(usages) > 0 {
		usage := usages[0]
		params.InputTokens = pgtype.Int4{Int32: usage.InputTokens, Valid: usage.InputTokens > 0}
		params.OutputTokens = pgtype.Int4{Int32: usage.OutputTokens, Valid: usage.OutputTokens > 0}
		params.TotalTokens = pgtype.Int4{Int32: usage.TotalTokens, Valid: usage.TotalTokens > 0}
	}
	_, err := w.Queries.AddWorkflowRoleResolutionCall(ctx, params)
	if err != nil && !errors.Is(err, context.Canceled) {
		slog.Warn("workflow role resolution call audit failed", "job_id", util.UUIDToString(job.ID), "error", err)
	}
}

func roleResolutionEventParams(job db.MulticaWorkflowRoleResolutionJob, row db.MulticaWorkflowRoleResolution, eventType string, userID pgtype.UUID, source, reasonCode, reasonDetail, organizationVersion string) db.AddWorkflowRoleResolutionEventParams {
	return db.AddWorkflowRoleResolutionEventParams{
		WorkflowRunID: job.WorkflowRunID, WorkflowRoleResolutionID: row.ID,
		EventType: eventType, SlotType: pgtype.Text{String: row.SlotType, Valid: true},
		RoleNameSnapshot: row.RoleNameSnapshot, ResolvedUserID: userID,
		Source:     pgtype.Text{String: source, Valid: source != ""},
		ReasonCode: reasonCode, ReasonDetail: truncateRunes(reasonDetail, 500),
		Model: job.Model, PromptVersion: job.PromptVersion, OrganizationVersion: organizationVersion,
	}
}

func callResultCode(err error, success string) string {
	if err == nil {
		return success
	}
	var resolverErr *WorkflowRoleResolverError
	if errors.As(err, &resolverErr) {
		return resolverErr.Code
	}
	return "unavailable"
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func workflowRolePromptInjectionSuspected(slot WorkflowRoleResolutionSlot) bool {
	value := strings.ToLower(strings.Join([]string{slot.RoleName, slot.RoleDescription, slot.NodeTitle, slot.NodeDescription}, "\n"))
	for _, phrase := range []string{
		"ignore previous", "ignore all previous", "ignore system", "system prompt",
		"candidate_id", "output protocol", "disregard previous",
		"忽略之前", "忽略系统", "系统提示词", "伪造候选", "改变输出协议",
	} {
		if strings.Contains(value, phrase) {
			return true
		}
	}
	return false
}

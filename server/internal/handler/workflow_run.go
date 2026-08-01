package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ── Request types ────────────────────────────────────────────────────────────

type StartRunRequest struct {
	Input                  json.RawMessage `json:"input"`
	RuntimeSelectionPolicy *string         `json:"runtime_selection_policy"`
	RuntimeID              *string         `json:"runtime_id"`
}

type SubmitNodeRunRequest struct {
	Output json.RawMessage `json:"output"`
}

type ReviewNodeRunRequest struct {
	Approved bool   `json:"approved"`
	Comment  string `json:"comment"`
}

type FinalizeNodeRunRequest struct {
	Approved *bool `json:"approved,omitempty"`
}

// ── Response types ───────────────────────────────────────────────────────────

type WorkflowRunResponse struct {
	ID                      string          `json:"id"`
	WorkflowID              string          `json:"workflow_id"`
	WorkspaceID             string          `json:"workspace_id"`
	WorkflowTitle           string          `json:"workflow_title"`
	Status                  string          `json:"status"`
	TriggeredByType         string          `json:"triggered_by_type"`
	TriggeredByID           *string         `json:"triggered_by_id"`
	RuntimeID               *string         `json:"runtime_id"`
	RuntimeSelectionPolicy  string          `json:"runtime_selection_policy"`
	Input                   json.RawMessage `json:"input"`
	Output                  json.RawMessage `json:"output"`
	StartedAt               string          `json:"started_at"`
	CompletedAt             *string         `json:"completed_at"`
	CreatedAt               string          `json:"created_at"`
	SourceConfigRevision    int64           `json:"source_config_revision,omitempty"`
	DefinitionSchemaVersion int32           `json:"definition_schema_version,omitempty"`
	DefinitionSnapshot      json.RawMessage `json:"definition_snapshot,omitempty"`
	MaxRetries              int32           `json:"max_retries,omitempty"`
	FailureReason           *string         `json:"failure_reason,omitempty"`
	ValidationErrors        json.RawMessage `json:"validation_errors,omitempty"`
}

type WorkflowNodeRunResponse struct {
	ID                       string          `json:"id"`
	WorkflowRunID            string          `json:"workflow_run_id"`
	WorkflowNodeID           string          `json:"workflow_node_id"`
	SourceWorkflowNodeID     string          `json:"source_workflow_node_id,omitempty"`
	NodeTitle                string          `json:"node_title"`
	NodeDescription          string          `json:"node_description,omitempty"`
	Status                   string          `json:"status"`
	RetryCount               int32           `json:"retry_count"`
	WorkerType               string          `json:"worker_type"`
	WorkerID                 *string         `json:"worker_id"`
	WorkerOutput             json.RawMessage `json:"worker_output"`
	WorkerAgentTaskID        *string         `json:"worker_agent_task_id"`
	CriticType               string          `json:"critic_type"`
	CriticID                 *string         `json:"critic_id"`
	CriticOutput             json.RawMessage `json:"critic_output"`
	CriticComment            string          `json:"critic_comment"`
	CriticAgentTaskID        *string         `json:"critic_agent_task_id"`
	AgentTaskID              *string         `json:"agent_task_id"`
	RuntimeID                *string         `json:"runtime_id"`
	RuntimeSelectionReason   *string         `json:"runtime_selection_reason"`
	FailureReason            *string         `json:"failure_reason"`
	DeviceID                 *string         `json:"device_id"`
	SessionID                *string         `json:"session_id"`
	SplitReviewChatSessionID *string         `json:"split_review_chat_session_id"`
	SplitConfigVersion       int64           `json:"split_config_version"`
	StartedAt                *string         `json:"started_at"`
	CompletedAt              *string         `json:"completed_at"`
	CreatedAt                string          `json:"created_at"`
	UpdatedAt                string          `json:"updated_at"`
	FormatSchema             json.RawMessage `json:"format_schema,omitempty"`
	CriticAPIURL             *string         `json:"critic_api_url,omitempty"`
	StageSnapshot            json.RawMessage `json:"stage_snapshot,omitempty"`
	WorkerRoleSnapshot       json.RawMessage `json:"worker_role_snapshot,omitempty"`
	CriticRoleSnapshot       json.RawMessage `json:"critic_role_snapshot,omitempty"`
	RuntimeConfig            json.RawMessage `json:"runtime_config,omitempty"`
	WorkerNameSnapshot       string          `json:"worker_name_snapshot,omitempty"`
	CriticNameSnapshot       string          `json:"critic_name_snapshot,omitempty"`
}

type WorkflowNodeRuntimeSummaryResponse struct {
	WorkflowNodeID  string                 `json:"workflow_node_id"`
	NodeRunID       string                 `json:"node_run_id"`
	DisplayStatus   string                 `json:"display_status"`
	ActiveActorType string                 `json:"active_actor_type"`
	ActiveActorID   *string                `json:"active_actor_id"`
	DurationSeconds *int64                 `json:"duration_seconds"`
	SessionID       *string                `json:"session_id"`
	RuntimeID       *string                `json:"runtime_id"`
	DeviceID        *string                `json:"device_id"`
	HasError        bool                   `json:"has_error"`
	ErrorMessage    string                 `json:"error_message"`
	SplitProgress   *SplitProgressResponse `json:"split_progress,omitempty"`
}

// ── Converters ───────────────────────────────────────────────────────────────

func workflowRunToResponse(r db.MulticaWorkflowRun) WorkflowRunResponse {
	return WorkflowRunResponse{
		ID:                      uuidToString(r.ID),
		WorkflowID:              uuidToString(r.WorkflowID),
		WorkspaceID:             uuidToString(r.WorkspaceID),
		WorkflowTitle:           r.WorkflowTitle,
		Status:                  r.Status,
		TriggeredByType:         r.TriggeredByType,
		TriggeredByID:           uuidToPtr(r.TriggeredByID),
		RuntimeID:               uuidToPtr(r.RuntimeID),
		RuntimeSelectionPolicy:  r.RuntimeSelectionPolicy,
		Input:                   json.RawMessage(r.Input),
		Output:                  json.RawMessage(r.Output),
		StartedAt:               timestampToString(r.StartedAt),
		CompletedAt:             timestampToPtr(r.CompletedAt),
		CreatedAt:               timestampToString(r.CreatedAt),
		SourceConfigRevision:    r.SourceConfigRevision,
		DefinitionSchemaVersion: r.DefinitionSchemaVersion,
		DefinitionSnapshot:      json.RawMessage(r.DefinitionSnapshot),
		MaxRetries:              r.MaxRetries,
		FailureReason:           textToPtr(r.FailureReason),
		ValidationErrors:        json.RawMessage(r.ValidationErrors),
	}
}

func workflowNodeRunCanvasID(nr db.MulticaWorkflowNodeRun) string {
	if nr.SourceWorkflowNodeID.Valid {
		return uuidToString(nr.SourceWorkflowNodeID)
	}
	return uuidToString(nr.WorkflowNodeID)
}

func workflowNodeRunToResponse(nr db.MulticaWorkflowNodeRun) WorkflowNodeRunResponse {
	sourceNodeID := workflowNodeRunCanvasID(nr)
	return WorkflowNodeRunResponse{
		ID:                       uuidToString(nr.ID),
		WorkflowRunID:            uuidToString(nr.WorkflowRunID),
		WorkflowNodeID:           sourceNodeID,
		SourceWorkflowNodeID:     sourceNodeID,
		NodeTitle:                nr.NodeTitle,
		NodeDescription:          nr.NodeDescription,
		Status:                   nr.Status,
		RetryCount:               nr.RetryCount,
		WorkerType:               nr.WorkerType,
		WorkerID:                 uuidToPtr(nr.WorkerID),
		WorkerOutput:             json.RawMessage(nr.WorkerOutput),
		WorkerAgentTaskID:        uuidToPtr(nr.WorkerAgentTaskID),
		CriticType:               nr.CriticType,
		CriticID:                 uuidToPtr(nr.CriticID),
		CriticOutput:             json.RawMessage(nr.CriticOutput),
		CriticComment:            nr.CriticComment.String,
		CriticAgentTaskID:        uuidToPtr(nr.CriticAgentTaskID),
		AgentTaskID:              uuidToPtr(nr.AgentTaskID),
		RuntimeID:                uuidToPtr(nr.RuntimeID),
		RuntimeSelectionReason:   textToPtr(nr.RuntimeSelectionReason),
		FailureReason:            textToPtr(nr.FailureReason),
		DeviceID:                 textToPtr(nr.DeviceID),
		SessionID:                textToPtr(nr.SessionID),
		SplitReviewChatSessionID: uuidToPtr(nr.SplitReviewChatSessionID),
		SplitConfigVersion:       nr.SplitConfigVersion,
		StartedAt:                timestampToPtr(nr.StartedAt),
		CompletedAt:              timestampToPtr(nr.CompletedAt),
		CreatedAt:                timestampToString(nr.CreatedAt),
		UpdatedAt:                timestampToString(nr.UpdatedAt),
		FormatSchema:             json.RawMessage(nr.FormatSchema),
		CriticAPIURL:             textToPtr(nr.CriticApiUrl),
		StageSnapshot:            json.RawMessage(nr.StageSnapshot),
		WorkerRoleSnapshot:       json.RawMessage(nr.WorkerRoleSnapshot),
		CriticRoleSnapshot:       json.RawMessage(nr.CriticRoleSnapshot),
		RuntimeConfig:            json.RawMessage(nr.RuntimeConfig),
		WorkerNameSnapshot:       nr.WorkerNameSnapshot,
		CriticNameSnapshot:       nr.CriticNameSnapshot,
	}
}

// ── Run handlers ─────────────────────────────────────────────────────────────

func workflowDisplayStatus(status string) string {
	switch status {
	case "pending":
		return "pending"
	case "worker_assigned":
		return "todo"
	case "format_checking", "format_ok", "working", "awaiting_input", service.NodeRunStatusSplitting, service.NodeRunStatusSplitActive:
		return "in_progress"
	case "awaiting_critic", "critic_reviewing", service.NodeRunStatusAwaitingSplitReview:
		return "reviewing"
	case "critic_approved", "completed":
		return "completed"
	case "format_failed", "critic_rework", "failed", "blocked":
		return "blocked"
	case "skipped", "cancelled":
		return "cancelled"
	default:
		return "pending"
	}
}

func nodeRunActiveActor(nr db.MulticaWorkflowNodeRun) (string, *string) {
	if nr.Status == "awaiting_critic" || nr.Status == "critic_reviewing" {
		return nr.CriticType, uuidToPtr(nr.CriticID)
	}
	return nr.WorkerType, uuidToPtr(nr.WorkerID)
}

func nodeRunDurationSeconds(nr db.MulticaWorkflowNodeRun) *int64 {
	if !nr.StartedAt.Valid || !nr.CompletedAt.Valid {
		return nil
	}
	seconds := int64(nr.CompletedAt.Time.Sub(nr.StartedAt.Time).Seconds())
	if seconds < 0 {
		seconds = 0
	}
	return &seconds
}

func extractNodeRunError(nr db.MulticaWorkflowNodeRun, taskError string) (bool, string) {
	if nr.Status != "failed" && nr.Status != "blocked" && nr.Status != "format_failed" && nr.Status != "critic_rework" {
		return false, ""
	}

	if taskError != "" {
		return true, taskError
	}

	for _, raw := range [][]byte{nr.WorkerOutput, nr.CriticOutput} {
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal(raw, &obj); err != nil {
			continue
		}
		for _, key := range []string{"error", "message"} {
			if value, ok := obj[key].(string); ok && value != "" {
				return true, value
			}
		}
	}
	return true, ""
}

func (h *Handler) workflowRunTaskErrors(ctx context.Context, runID pgtype.UUID) (map[string]string, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT
			node_run.id::text,
			COALESCE(
				NULLIF(phase_task.error, ''),
				CASE
					WHEN phase_task.id IS NULL THEN NULLIF(agent_task.error, '')
				END,
				''
			) AS error_message
		FROM multica_workflow_node_run node_run
		LEFT JOIN LATERAL (
			SELECT linked_task.id, linked_task.error
			FROM multica_agent_task_queue linked_task
			WHERE linked_task.status = 'failed'
				AND linked_task.id IN (
					node_run.worker_agent_task_id,
					node_run.critic_agent_task_id
				)
			ORDER BY
				linked_task.completed_at DESC NULLS LAST,
				linked_task.created_at DESC,
				linked_task.id DESC
			LIMIT 1
		) phase_task ON TRUE
		LEFT JOIN multica_agent_task_queue agent_task
			ON agent_task.id = node_run.agent_task_id
			AND agent_task.status = 'failed'
		WHERE node_run.workflow_run_id = $1
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	taskErrors := make(map[string]string)
	for rows.Next() {
		var nodeRunID, errorMessage string
		if err := rows.Scan(&nodeRunID, &errorMessage); err != nil {
			return nil, err
		}
		if errorMessage != "" {
			taskErrors[nodeRunID] = errorMessage
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return taskErrors, nil
}

func (h *Handler) workflowRunSplitProgressSummaries(ctx context.Context, runID pgtype.UUID) (map[string]SplitProgressResponse, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT
			st.node_run_id::text AS node_run_id,
			st.status
		FROM multica_workflow_split_task st
		JOIN multica_workflow_node_run wnr ON wnr.id = st.node_run_id
		WHERE wnr.workflow_run_id = $1
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byNodeRunID := make(map[string]service.SplitProgressSummary)
	for rows.Next() {
		var nodeRunID string
		var status string
		if err := rows.Scan(&nodeRunID, &status); err != nil {
			return nil, err
		}
		progress := byNodeRunID[nodeRunID]
		progress.AddStatus(status)
		byNodeRunID[nodeRunID] = progress
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make(map[string]SplitProgressResponse, len(byNodeRunID))
	for nodeRunID, progress := range byNodeRunID {
		result[nodeRunID] = splitProgressFromService(progress)
	}
	return result, nil
}

func (h *Handler) ListWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}

	limit, offset := paginationFromQuery(r)

	runs, err := h.Queries.ListWorkflowRuns(r.Context(), db.ListWorkflowRunsParams{
		WorkflowID: wf.ID,
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runs")
		return
	}

	resp := make([]WorkflowRunResponse, len(runs))
	for i, run := range runs {
		resp[i] = workflowRunToResponse(run)
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": resp, "total": len(resp)})
}

func (h *Handler) StartWorkflowRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}

	if wf.Status != "active" {
		writeError(w, http.StatusBadRequest, "workflow is not active")
		return
	}
	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req StartRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Empty body OK — use default input.
		req.Input = json.RawMessage("{}")
	}
	if len(req.Input) == 0 {
		req.Input = json.RawMessage("{}")
	}
	runtimeSelectionPolicy, runtimePreference, ok := h.validateWorkflowRuntimeSelectionOverride(
		w,
		r,
		req.RuntimeSelectionPolicy,
		req.RuntimeID,
		wf.WorkspaceID,
	)
	if !ok {
		return
	}

	run, err := h.WorkflowService.StartRunWithRuntimeSelection(
		r.Context(),
		wf,
		"member",
		userID,
		req.Input,
		runtimeSelectionPolicy,
		runtimePreference,
	)
	if err != nil {
		var invalid *service.WorkflowConfigInvalidError
		if errors.As(err, &invalid) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error": "workflow configuration is invalid", "code": "workflow_config_invalid",
				"run_id": uuidToString(invalid.RunID), "issues": invalid.Issues,
			})
			return
		}
		if errors.Is(err, service.ErrWorkflowRuntimeSelectionInvalid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, service.ErrWorkflowRoleResolutionLimit) {
			writeError(w, http.StatusTooManyRequests, "too many active workflow role resolution jobs")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to start run")
		return
	}

	startedResp := workflowRunToResponse(*run)
	h.publish(protocol.EventWorkflowRunStarted, workspaceID, "member", userID, map[string]any{
		"run":      startedResp,
		"workflow": map[string]string{"id": uuidToString(wf.ID), "title": wf.Title},
	})
	// Scaffold the run's Gitea deliverable repo + lazily provision the workspace
	// bot (document workflows only; no-op when Gitea is dormant). Fire-and-forget
	// on context.Background(): the goroutine outlives the HTTP request, so
	// r.Context() would cancel mid-scaffold the moment we write the response.
	// Persistent failure transitions the run to failed inside the service.
	go h.WorkflowService.ScaffoldRunDeliverables(context.Background(), *run)

	resp := workflowRunToResponse(*run)
	status := http.StatusCreated
	if run.Status == service.RunStatusResolvingRoles || run.Status == service.RunStatusWaitingRoleAssignment {
		status = http.StatusAccepted
	}
	writeJSON(w, status, resp)
}

func (h *Handler) GetWorkflowRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Load workflow to verify workspace access.
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}

	runID := chi.URLParam(r, "runId")
	runUUID, ok := parseUUIDOrBadRequest(w, runID, "run id")
	if !ok {
		return
	}

	run, err := h.Queries.GetWorkflowRun(r.Context(), runUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	if uuidToString(run.WorkflowID) != uuidToString(wf.ID) {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	resp := workflowRunToResponse(run)

	// Include node runs.
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(r.Context(), run.ID)
	if err != nil {
		nodeRuns = nil
	}
	nodeRunResp := make([]WorkflowNodeRunResponse, len(nodeRuns))
	for i, nr := range nodeRuns {
		nodeRunResp[i] = workflowNodeRunToResponse(nr)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":       resp,
		"node_runs": nodeRunResp,
	})
}

func (h *Handler) GetWorkflowRunCanvasSummary(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}

	runID := chi.URLParam(r, "runId")
	runUUID, ok := parseUUIDOrBadRequest(w, runID, "run id")
	if !ok {
		return
	}

	run, err := h.Queries.GetWorkflowRun(r.Context(), runUUID)
	if err != nil || run.WorkflowID != wf.ID {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(r.Context(), run.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list node runs")
		return
	}

	splitProgressSummaries, err := h.workflowRunSplitProgressSummaries(r.Context(), run.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to summarize split progress")
		return
	}
	taskErrors, err := h.workflowRunTaskErrors(r.Context(), run.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to summarize task errors")
		return
	}

	nodeRunResp := make([]WorkflowNodeRunResponse, 0, len(nodeRuns))
	runtimeSummaries := make([]WorkflowNodeRuntimeSummaryResponse, 0, len(nodeRuns))
	for _, nr := range nodeRuns {
		nodeRunResp = append(nodeRunResp, workflowNodeRunToResponse(nr))
		actorType, actorID := nodeRunActiveActor(nr)
		hasError, errorMessage := extractNodeRunError(nr, taskErrors[uuidToString(nr.ID)])
		var splitProgress *SplitProgressResponse
		if progress, ok := splitProgressSummaries[uuidToString(nr.ID)]; ok {
			progressCopy := progress
			splitProgress = &progressCopy
		}

		runtimeSummaries = append(runtimeSummaries, WorkflowNodeRuntimeSummaryResponse{
			WorkflowNodeID:  workflowNodeRunCanvasID(nr),
			NodeRunID:       uuidToString(nr.ID),
			DisplayStatus:   workflowDisplayStatus(nr.Status),
			ActiveActorType: actorType,
			ActiveActorID:   actorID,
			DurationSeconds: nodeRunDurationSeconds(nr),
			SessionID:       textToPtr(nr.SessionID),
			RuntimeID:       uuidToPtr(nr.RuntimeID),
			DeviceID:        textToPtr(nr.DeviceID),
			HasError:        hasError,
			ErrorMessage:    errorMessage,
			SplitProgress:   splitProgress,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":                    workflowRunToResponse(run),
		"node_runs":              nodeRunResp,
		"node_runtime_summaries": runtimeSummaries,
	})
}

func (h *Handler) CancelWorkflowRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}

	runID := chi.URLParam(r, "runId")
	runUUID, ok := parseUUIDOrBadRequest(w, runID, "run id")
	if !ok {
		return
	}

	run, err := h.Queries.GetWorkflowRun(r.Context(), runUUID)
	if err != nil || uuidToString(run.WorkflowID) != uuidToString(wf.ID) {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	if err := h.WorkflowService.CancelRun(r.Context(), runUUID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to cancel run")
		return
	}

	h.publish(protocol.EventWorkflowRunCancelled, workspaceID, "member", userID, map[string]any{
		"run_id":      uuidToString(runUUID),
		"workflow_id": uuidToString(wf.ID),
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// ── Node run actions ─────────────────────────────────────────────────────────

func (h *Handler) SubmitNodeRun(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node run id")
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req SubmitNodeRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Output) == 0 {
		writeError(w, http.StatusBadRequest, "output is required")
		return
	}

	// Verify workspace access: fetch node run, resolve to workflow, check workspace.
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil || uuidToString(run.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}

	if err := h.WorkflowService.SubmitWorkerOutput(r.Context(), nodeRunUUID, req.Output); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, _ := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	resp := workflowNodeRunToResponse(updated)
	h.publish(protocol.EventWorkflowNodeRunCompleted, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ReviewNodeRun(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node run id")
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req ReviewNodeRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Verify workspace access.
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil || uuidToString(run.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}

	if err := h.WorkflowService.ReviewNodeRun(r.Context(), nodeRunUUID, req.Approved, req.Comment, nil); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, _ := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	resp := workflowNodeRunToResponse(updated)

	eventType := protocol.EventWorkflowNodeRunReviewed
	if updated.Status == service.NodeRunStatusBlocked {
		eventType = protocol.EventWorkflowNodeRunBlocked
	}
	h.publish(eventType, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) SkipNodeRun(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node run id")
	if !ok {
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	// Verify workspace access.
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil || uuidToString(run.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}

	skipped, err := h.WorkflowService.TransitionNodeRun(r.Context(), nodeRun, service.NodeRunStatusSkipped)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := workflowNodeRunToResponse(*skipped)
	h.publish(protocol.EventWorkflowNodeRunCompleted, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})

	// Trigger downstream propagation.
	if err := h.WorkflowService.OnNodeRunCompleted(r.Context(), nodeRunUUID); err != nil {
		// Non-fatal: the skip already persisted.
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) RetryNodeRun(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	nodeRun, run, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}

	updated, err := h.WorkflowService.RetryNodeRun(r.Context(), nodeRun)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := workflowNodeRunToResponse(*updated)
	h.publish(protocol.EventWorkflowNodeRunResumed, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

// loadNodeRunForWorkspace resolves a node-run URL param and verifies the caller
// can access its workspace, returning the node run and its parent run. On any
// failure it writes the response and returns ok=false.
func (h *Handler) loadNodeRunForWorkspace(w http.ResponseWriter, r *http.Request) (db.MulticaWorkflowNodeRun, db.MulticaWorkflowRun, string, bool) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node run id")
	if !ok {
		return db.MulticaWorkflowNodeRun{}, db.MulticaWorkflowRun{}, "", false
	}
	workspaceID := h.resolveWorkspaceID(r)
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return db.MulticaWorkflowNodeRun{}, db.MulticaWorkflowRun{}, "", false
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil || uuidToString(run.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "node run not found")
		return db.MulticaWorkflowNodeRun{}, db.MulticaWorkflowRun{}, "", false
	}
	return nodeRun, run, workspaceID, true
}

// requireRuntimeControlForNodeRun verifies the caller has the "control"
// capability on the runtime bound to the node run. Used to gate takeover,
// handback, and finalize actions (L1.4).
func (h *Handler) requireRuntimeControlForNodeRun(w http.ResponseWriter, r *http.Request, nodeRun db.MulticaWorkflowNodeRun) bool {
	if !nodeRun.RuntimeID.Valid {
		writeError(w, http.StatusBadRequest, "node run is not bound to a runtime")
		return false
	}

	rt, err := h.Queries.GetAgentRuntime(r.Context(), nodeRun.RuntimeID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load runtime")
		return false
	}

	member, ok := h.requireWorkspaceMember(w, r, uuidToString(rt.WorkspaceID), "runtime not found")
	if !ok {
		return false
	}

	explicitRole := ""
	perm, err := h.Queries.GetRuntimePermission(r.Context(), db.GetRuntimePermissionParams{
		RuntimeID: rt.ID,
		UserID:    member.UserID,
	})
	if err == nil {
		explicitRole = perm.Role
	}

	role := resolveRuntimeRole(member, rt, explicitRole)
	if !runtimeCapabilities(role).Control {
		writeError(w, http.StatusForbidden, "insufficient runtime permission")
		return false
	}
	return true
}

// TakeoverNodeRun pauses a running node so a human can intervene in its CSC
// session (working → blocked). Node-level control only — the CSC session
// actions (message/interrupt/permission) flow through Cloud Web, not here.
func (h *Handler) TakeoverNodeRun(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	nodeRun, run, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if !h.requireRuntimeControlForNodeRun(w, r, nodeRun) {
		return
	}

	updated, err := h.WorkflowService.TakeoverNodeRun(r.Context(), nodeRun)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := workflowNodeRunToResponse(*updated)
	h.publish(protocol.EventWorkflowNodeRunBlocked, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

// HandbackNodeRun returns control to the agent (blocked → working) so the
// daemon resumes the same CSC session.
func (h *Handler) HandbackNodeRun(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	nodeRun, run, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if !h.requireRuntimeControlForNodeRun(w, r, nodeRun) {
		return
	}

	updated, err := h.WorkflowService.HandbackNodeRun(r.Context(), nodeRun)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := workflowNodeRunToResponse(*updated)
	h.publish(protocol.EventWorkflowNodeRunResumed, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

// FinalizeNodeRun lets a human conclude a taken-over node directly
// (blocked → completed / failed) instead of handing it back.
func (h *Handler) FinalizeNodeRun(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req FinalizeNodeRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	outcome := service.NodeRunStatusCompleted
	eventType := protocol.EventWorkflowNodeRunCompleted
	if req.Approved != nil && !*req.Approved {
		outcome = service.NodeRunStatusFailed
		eventType = protocol.EventWorkflowNodeRunFailed
	}

	nodeRun, run, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if !h.requireRuntimeControlForNodeRun(w, r, nodeRun) {
		return
	}

	updated, err := h.WorkflowService.FinalizeNodeRun(r.Context(), nodeRun, outcome)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	resp := workflowNodeRunToResponse(*updated)
	h.publish(eventType, workspaceID, "member", userID, map[string]any{
		"node_run": resp,
		"run_id":   uuidToString(run.ID),
	})
	writeJSON(w, http.StatusOK, resp)
}

// ── My tasks ─────────────────────────────────────────────────────────────────

func (h *Handler) ListMyWorkflowTasks(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	userUUID := parseUUID(userID)
	wsUUID := parseUUID(workspaceID)

	// Query node runs where the current user is the human worker or critic.
	// This lists node_runs in awaiting_critic or worker_assigned status
	// where the worker_type/critic_type is "human" and the worker_id is
	// either NULL (any member) or matches this user.
	nodeRuns, err := h.Queries.ListMyWorkflowTasks(r.Context(), db.ListMyWorkflowTasksParams{
		WorkspaceID: wsUUID,
		MemberID:    userUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tasks")
		return
	}

	resp := make([]WorkflowNodeRunResponse, len(nodeRuns))
	for i, nr := range nodeRuns {
		resp[i] = workflowNodeRunToResponse(db.MulticaWorkflowNodeRun{
			ID:             nr.ID,
			WorkflowRunID:  nr.WorkflowRunID,
			WorkflowNodeID: nr.WorkflowNodeID,
			NodeTitle:      nr.NodeTitle,
			Status:         nr.Status,
			RetryCount:     nr.RetryCount,
			WorkerType:     nr.WorkerType,
			WorkerID:       nr.WorkerID,
			WorkerOutput:   nr.WorkerOutput,
			CriticType:     nr.CriticType,
			CriticID:       nr.CriticID,
			CriticOutput:   nr.CriticOutput,
			CriticComment:  nr.CriticComment,
			AgentTaskID:    nr.AgentTaskID,
			RuntimeID:      nr.RuntimeID,
			DeviceID:       nr.DeviceID,
			SessionID:      nr.SessionID,
			StartedAt:      nr.StartedAt,
			CompletedAt:    nr.CompletedAt,
			CreatedAt:      nr.CreatedAt,
			UpdatedAt:      nr.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": resp, "total": len(resp)})
}

func paginationFromQuery(r *http.Request) (int32, int32) { return 50, 0 }

func (h *Handler) ListWorkflowNodeRuns(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	wf, ok := h.loadWorkflowInWorkspace(w, r, id)
	if !ok {
		return
	}
	runID := chi.URLParam(r, "runId")
	runUUID, ok := parseUUIDOrBadRequest(w, runID, "run id")
	if !ok {
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), runUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	if uuidToString(run.WorkflowID) != uuidToString(wf.ID) {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(r.Context(), run.ID)
	if err != nil {
		nodeRuns = nil
	}
	resp := make([]WorkflowNodeRunResponse, 0, len(nodeRuns))
	for _, nr := range nodeRuns {
		resp = append(resp, workflowNodeRunToResponse(nr))
	}
	writeJSON(w, http.StatusOK, map[string]any{"node_runs": resp})
}

// ── Deliverable submission request/response types ─────────────────────────────

type SubmitDeliverableRequest struct {
	Content        string  `json:"content"`
	AttachmentID   *string `json:"attachment_id"`
	PullRequestURL string  `json:"pull_request_url"`
}

type ReviewDeliverableRequest struct {
	Status  string `json:"status"` // "approved" | "rejected"
	Comment string `json:"review_comment"`
}

type WorkflowNodeDeliverableSubmissionResponse struct {
	ID                string  `json:"id"`
	WorkflowNodeRunID string  `json:"workflow_node_run_id"`
	DeliverableID     string  `json:"deliverable_id"`
	SubmittedByType   string  `json:"submitted_by_type"`
	SubmittedByID     *string `json:"submitted_by_id"`
	Status            string  `json:"status"`
	Content           string  `json:"content"`
	AttachmentID      *string `json:"attachment_id"`
	PullRequestURL    string  `json:"pull_request_url"`
	ReviewComment     string  `json:"review_comment"`
	SubmittedAt       string  `json:"submitted_at"`
	ReviewedAt        *string `json:"reviewed_at"`
	CreatedAt         string  `json:"created_at"`
	UpdatedAt         string  `json:"updated_at"`
}

func workflowNodeDeliverableSubmissionToResponse(s db.MulticaWorkflowNodeDeliverableSubmission) WorkflowNodeDeliverableSubmissionResponse {
	return WorkflowNodeDeliverableSubmissionResponse{
		ID:                uuidToString(s.ID),
		WorkflowNodeRunID: uuidToString(s.WorkflowNodeRunID),
		DeliverableID:     uuidToString(s.DeliverableID),
		SubmittedByType:   s.SubmittedByType,
		SubmittedByID:     uuidToPtr(s.SubmittedByID),
		Status:            s.Status,
		Content:           s.Content,
		AttachmentID:      uuidToPtr(s.AttachmentID),
		PullRequestURL:    service.RewriteGiteaHostToPublic(s.PullRequestUrl),
		ReviewComment:     s.ReviewComment,
		SubmittedAt:       timestampToString(s.SubmittedAt),
		ReviewedAt:        timestampToPtr(s.ReviewedAt),
		CreatedAt:         timestampToString(s.CreatedAt),
		UpdatedAt:         timestampToString(s.UpdatedAt),
	}
}

func workflowNodeRunDeliverableToResponse(d db.MulticaWorkflowNodeRunDeliverable, sourceNodeID pgtype.UUID) WorkflowNodeDeliverableResponse {
	createdAt := timestampToString(d.CreatedAt)
	return WorkflowNodeDeliverableResponse{
		ID: uuidToString(d.ID), WorkflowNodeID: uuidToString(sourceNodeID),
		Title: d.Title, Description: d.Description, Required: d.Required, SortOrder: d.SortOrder,
		CreatedAt: createdAt, UpdatedAt: createdAt,
	}
}

// ── Deliverable submission handlers ──────────────────────────────────────────

// ListNodeRunDeliverableSubmissions GET /api/node-runs/{nodeRunId}/deliverables
func (h *Handler) ListNodeRunDeliverableSubmissions(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nrUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "nodeRunId")
	if !ok {
		return
	}

	submissions, err := h.Queries.ListNodeRunDeliverableSubmissions(r.Context(), nrUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list deliverable submissions")
		return
	}

	resp := make([]WorkflowNodeDeliverableSubmissionResponse, 0, len(submissions))
	for _, s := range submissions {
		resp = append(resp, workflowNodeDeliverableSubmissionToResponse(s))
	}

	// Also return the node-run's captured requirements so the frontend can
	// render the right manual-upload control before any submission exists.
	out := map[string]any{"submissions": resp}
	if nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nrUUID); err == nil {
		if requirements, err := h.Queries.ListNodeRunDeliverableRequirements(r.Context(), nodeRun.ID); err == nil {
			defResp := make([]WorkflowNodeDeliverableResponse, 0, len(requirements))
			for _, requirement := range requirements {
				defResp = append(defResp, workflowNodeRunDeliverableToResponse(requirement, nodeRun.SourceWorkflowNodeID))
			}
			out["deliverables"] = defResp
		}
	}

	writeJSON(w, http.StatusOK, out)
}

// SubmitNodeRunDeliverable POST /api/node-runs/{nodeRunId}/deliverables/{deliverableId}/submit
func (h *Handler) SubmitNodeRunDeliverable(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nrUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "nodeRunId")
	if !ok {
		return
	}

	deliverableID := chi.URLParam(r, "deliverableId")
	dUUID, ok := parseUUIDOrBadRequest(w, deliverableID, "deliverableId")
	if !ok {
		return
	}

	var req SubmitDeliverableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// When the platform Gitea is configured, all deliverables are submitted via
	// git PRs (pull_request_url). Inline content/attachment uploads are
	// disabled for every deliverable kind. When Gitea is dormant, inline
	// content is accepted as before.
	if isGiteaConfigured() && (req.Content != "" || req.AttachmentID != nil) {
		writeError(w, http.StatusUnprocessableEntity,
			"deliverables are submitted via git PR; inline content upload is disabled")
		return
	}

	// Derive submitted_by from the authenticated user (or agent, when the
	// request carries valid X-Agent-ID + X-Task-ID headers).
	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	submittedByType := actorType
	submittedByID := parseUUID(actorID)

	submission, err := h.Queries.UpsertNodeRunDeliverableSubmission(r.Context(), db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nrUUID,
		DeliverableID:     dUUID,
		SubmittedByType:   submittedByType,
		SubmittedByID:     submittedByID,
		Content:           req.Content,
		AttachmentID:      ptrStrToUUID(req.AttachmentID),
		PullRequestUrl:    req.PullRequestURL,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "deliverable not found on this node run")
		} else {
			writeError(w, http.StatusInternalServerError, "failed to submit deliverable")
		}
		return
	}

	// Code MR links stay standalone submissions — they are archived to the inst
	// branch only on approval (see WorkflowService.archiveCodeLinksToInst), not
	// at submit time.

	writeJSON(w, http.StatusOK, workflowNodeDeliverableSubmissionToResponse(submission))
}

// ReviewNodeRunDeliverable POST /api/node-runs/{nodeRunId}/deliverables/{submissionId}/review
//
// Permission gate: only a workspace owner/admin, the issue's assignee, or the
// node-run's designated critic may approve/reject a
// deliverable submission. The submission must also belong to a node-run in the
// caller's workspace; cross-workspace and foreign-submission requests are
// rejected as 404 to avoid leaking existence.
func (h *Handler) ReviewNodeRunDeliverable(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nrUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node run id")
	if !ok {
		return
	}
	submissionID := chi.URLParam(r, "submissionId")
	sUUID, ok := parseUUIDOrBadRequest(w, submissionID, "submissionId")
	if !ok {
		return
	}

	var req ReviewDeliverableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Status != "approved" && req.Status != "rejected" {
		writeError(w, http.StatusBadRequest, "status must be 'approved' or 'rejected'")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	// Resolve the node-run and confirm it belongs to the caller's workspace.
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nrUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil || uuidToString(run.WorkspaceID) != workspaceID {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}

	// The submission must belong to this node-run — a foreign submission id
	// pointed at this node-run is rejected as not found.
	belongs := false
	if subs, lerr := h.Queries.ListNodeRunDeliverableSubmissions(r.Context(), nrUUID); lerr == nil {
		for _, s := range subs {
			if uuidToString(s.ID) == uuidToString(sUUID) {
				belongs = true
				break
			}
		}
	}
	if !belongs {
		writeError(w, http.StatusNotFound, "submission not found")
		return
	}

	// Permission gate.
	member, err := h.getWorkspaceMember(r.Context(), userID, workspaceID)
	if err != nil {
		writeError(w, http.StatusForbidden, "no access to this workspace")
		return
	}
	var issue db.MulticaIssue
	if run.SourceIssueID.Valid {
		if found, gerr := h.Queries.GetIssue(r.Context(), run.SourceIssueID); gerr == nil {
			issue = found
		}
	}
	if !canReviewDeliverable(member.Role, userID, nodeRun, issue) {
		writeError(w, http.StatusForbidden, "not allowed to review this deliverable")
		return
	}

	submission, err := h.Queries.ReviewNodeRunDeliverableSubmission(r.Context(), db.ReviewNodeRunDeliverableSubmissionParams{
		ID:            sUUID,
		Status:        req.Status,
		ReviewComment: req.Comment,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to review deliverable")
		return
	}

	writeJSON(w, http.StatusOK, workflowNodeDeliverableSubmissionToResponse(submission))
}

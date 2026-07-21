package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ── Request types ────────────────────────────────────────────────────────────

type StartRunRequest struct {
	Input json.RawMessage `json:"input"`
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
	ID              string          `json:"id"`
	WorkflowID      string          `json:"workflow_id"`
	WorkspaceID     string          `json:"workspace_id"`
	WorkflowTitle   string          `json:"workflow_title"`
	Status          string          `json:"status"`
	TriggeredByType string          `json:"triggered_by_type"`
	TriggeredByID   *string         `json:"triggered_by_id"`
	Input           json.RawMessage `json:"input"`
	Output          json.RawMessage `json:"output"`
	StartedAt       string          `json:"started_at"`
	CompletedAt     *string         `json:"completed_at"`
	CreatedAt       string          `json:"created_at"`
}

type WorkflowNodeRunResponse struct {
	ID                       string          `json:"id"`
	WorkflowRunID            string          `json:"workflow_run_id"`
	WorkflowNodeID           string          `json:"workflow_node_id"`
	NodeTitle                string          `json:"node_title"`
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
	DeviceID                 *string         `json:"device_id"`
	SessionID                *string         `json:"session_id"`
	SplitReviewChatSessionID *string         `json:"split_review_chat_session_id"`
	SplitConfigVersion       int64           `json:"split_config_version"`
	StartedAt                *string         `json:"started_at"`
	CompletedAt              *string         `json:"completed_at"`
	CreatedAt                string          `json:"created_at"`
	UpdatedAt                string          `json:"updated_at"`
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
		ID:              uuidToString(r.ID),
		WorkflowID:      uuidToString(r.WorkflowID),
		WorkspaceID:     uuidToString(r.WorkspaceID),
		WorkflowTitle:   r.WorkflowTitle,
		Status:          r.Status,
		TriggeredByType: r.TriggeredByType,
		TriggeredByID:   uuidToPtr(r.TriggeredByID),
		Input:           json.RawMessage(r.Input),
		Output:          json.RawMessage(r.Output),
		StartedAt:       timestampToString(r.StartedAt),
		CompletedAt:     timestampToPtr(r.CompletedAt),
		CreatedAt:       timestampToString(r.CreatedAt),
	}
}

func workflowNodeRunToResponse(nr db.MulticaWorkflowNodeRun) WorkflowNodeRunResponse {
	return WorkflowNodeRunResponse{
		ID:                       uuidToString(nr.ID),
		WorkflowRunID:            uuidToString(nr.WorkflowRunID),
		WorkflowNodeID:           uuidToString(nr.WorkflowNodeID),
		NodeTitle:                nr.NodeTitle,
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
		DeviceID:                 textToPtr(nr.DeviceID),
		SessionID:                textToPtr(nr.SessionID),
		SplitReviewChatSessionID: uuidToPtr(nr.SplitReviewChatSessionID),
		SplitConfigVersion:       nr.SplitConfigVersion,
		StartedAt:                timestampToPtr(nr.StartedAt),
		CompletedAt:              timestampToPtr(nr.CompletedAt),
		CreatedAt:                timestampToString(nr.CreatedAt),
		UpdatedAt:                timestampToString(nr.UpdatedAt),
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

func extractNodeRunError(nr db.MulticaWorkflowNodeRun) (bool, string) {
	if nr.Status != "failed" && nr.Status != "blocked" && nr.Status != "format_failed" && nr.Status != "critic_rework" {
		return false, ""
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

	// Validate DAG before starting.
	if err := h.WorkflowService.ValidateDAG(r.Context(), wf.ID); err != nil {
		writeError(w, http.StatusBadRequest, "workflow has cycles: "+err.Error())
		return
	}

	run, err := h.WorkflowService.StartRun(r.Context(), wf, "member", userID, req.Input, pgtype.UUID{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start run: "+err.Error())
		return
	}

	// Scaffold the run's Gitea deliverable repo + lazily provision the workspace
	// bot (document workflows only; no-op when Gitea is dormant). Fire-and-forget
	// on context.Background(): the goroutine outlives the HTTP request, so
	// r.Context() would cancel mid-scaffold the moment we write the response.
	// Persistent failure transitions the run to failed inside the service.
	go h.WorkflowService.ScaffoldRunDeliverables(context.Background(), *run)

	resp := workflowRunToResponse(*run)
	h.publish(protocol.EventWorkflowRunStarted, workspaceID, "member", userID, map[string]any{
		"run":      resp,
		"workflow": map[string]string{"id": uuidToString(wf.ID), "title": wf.Title},
	})
	writeJSON(w, http.StatusCreated, resp)
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

	nodeRunResp := make([]WorkflowNodeRunResponse, 0, len(nodeRuns))
	runtimeSummaries := make([]WorkflowNodeRuntimeSummaryResponse, 0, len(nodeRuns))
	for _, nr := range nodeRuns {
		nodeRunResp = append(nodeRunResp, workflowNodeRunToResponse(nr))
		actorType, actorID := nodeRunActiveActor(nr)
		hasError, errorMessage := extractNodeRunError(nr)
		var splitProgress *SplitProgressResponse
		if progress, ok := splitProgressSummaries[uuidToString(nr.ID)]; ok {
			progressCopy := progress
			splitProgress = &progressCopy
		}

		runtimeSummaries = append(runtimeSummaries, WorkflowNodeRuntimeSummaryResponse{
			WorkflowNodeID:  uuidToString(nr.WorkflowNodeID),
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
		PullRequestURL:    s.PullRequestUrl,
		ReviewComment:     s.ReviewComment,
		SubmittedAt:       timestampToString(s.SubmittedAt),
		ReviewedAt:        timestampToPtr(s.ReviewedAt),
		CreatedAt:         timestampToString(s.CreatedAt),
		UpdatedAt:         timestampToString(s.UpdatedAt),
	}
}

// errDeliverableNotFound is returned by deliverableKind when the deliverable
// exists in neither this node run's node nor its siblings. Distinct from the
// DB-error case so the caller can map it to 404 instead of masking 500s.
var errDeliverableNotFound = errors.New("deliverable not found on this node run")

// deliverableKind resolves the kind of the deliverable submitted against the
// given node run. Used to gate document deliverables out of the inline-content
// upload path — document bodies live in Gitea (submitted via the report-pr
// flow) once the platform Gitea is configured.
func (h *Handler) deliverableKind(ctx context.Context, nodeRunID, deliverableID pgtype.UUID) (string, error) {
	nr, err := h.Queries.GetWorkflowNodeRun(ctx, nodeRunID)
	if err != nil {
		return "", fmt.Errorf("get node run: %w", err)
	}
	deliverables, err := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
	if err != nil {
		return "", fmt.Errorf("list deliverables: %w", err)
	}
	for _, d := range deliverables {
		if d.ID == deliverableID {
			return d.Kind, nil
		}
	}
	return "", errDeliverableNotFound
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

	writeJSON(w, http.StatusOK, map[string]any{"submissions": resp})
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

	// Document deliverables are submitted via Gitea PRs (the agent's report-pr
	// flow), not inline content uploads — but only when the platform Gitea is
	// configured. When dormant, document content uploads behave as before.
	if isGiteaConfigured() && (req.Content != "" || req.AttachmentID != nil) {
		kind, err := h.deliverableKind(r.Context(), nrUUID, dUUID)
		if err != nil {
			if errors.Is(err, errDeliverableNotFound) {
				writeError(w, http.StatusNotFound, "deliverable not found")
			} else {
				writeError(w, http.StatusInternalServerError, "failed to load deliverable")
			}
			return
		}
		if kind == "document" {
			writeError(w, http.StatusUnprocessableEntity,
				"document deliverables are submitted via git PR; inline content upload is disabled")
			return
		}
	}

	// Derive submitted_by from the authenticated user
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	submittedByType := "member"
	submittedByID := parseUUID(userID)

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
		writeError(w, http.StatusInternalServerError, "failed to submit deliverable")
		return
	}

	writeJSON(w, http.StatusOK, workflowNodeDeliverableSubmissionToResponse(submission))
}

// ReviewNodeRunDeliverable POST /api/node-runs/{nodeRunId}/deliverables/{submissionId}/review
func (h *Handler) ReviewNodeRunDeliverable(w http.ResponseWriter, r *http.Request) {
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

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type SplitTaskResponse struct {
	ID                       string           `json:"id"`
	NodeRunID                string           `json:"node_run_id"`
	Title                    string           `json:"title"`
	Description              string           `json:"description"`
	WorkflowID               *string          `json:"workflow_id"`
	AssigneeType             *string          `json:"assignee_type"`
	AssigneeID               *string          `json:"assignee_id"`
	DependsOn                []string         `json:"depends_on"`
	SortOrder                int32            `json:"sort_order"`
	Status                   string           `json:"status"`
	IssueID                  *string          `json:"issue_id"`
	RunID                    *string          `json:"run_id"`
	LastError                *json.RawMessage `json:"last_error"`
	CreatedAt                string           `json:"created_at"`
	UpdatedAt                string           `json:"updated_at"`
	MaterializeRetryCount    int32            `json:"materialize_retry_count"`
	MaterializeNextAttemptAt *string          `json:"materialize_next_attempt_at"`
}

type SplitProgressResponse struct {
	Total        int     `json:"total"`
	Created      int     `json:"created"`
	Running      int     `json:"running"`
	Done         int     `json:"done"`
	Failed       int     `json:"failed"`
	Cancelled    int     `json:"cancelled"`
	Skipped      int     `json:"skipped"`
	Materialized int     `json:"materialized"`
	RetryWaiting int     `json:"retry_waiting"`
	Exhausted    int     `json:"exhausted"`
	NextRetryAt  *string `json:"next_retry_at"`
}

type SplitTasksResponse struct {
	Tasks               []SplitTaskResponse   `json:"tasks"`
	Progress            SplitProgressResponse `json:"progress"`
	SplitPlanGeneration int32                 `json:"split_plan_generation"`
	SubmissionID        *string               `json:"submission_id"`
	ArchiveStatus       string                `json:"archive_status"`
	ArchiveError        string                `json:"archive_error"`
}

type PatchSplitConfigRequest struct {
	MaxConcurrency        int32 `json:"max_concurrency"`
	ExpectedConfigVersion int64 `json:"expected_config_version"`
}

func splitProgressResponse(tasks []db.MulticaWorkflowSplitTask) SplitProgressResponse {
	return splitProgressFromService(service.SplitExecutionProgressSummary(tasks))
}

func splitProgressFromService(progress service.SplitProgressSummary) SplitProgressResponse {
	return SplitProgressResponse{
		Total: progress.Total, Created: progress.Created, Running: progress.Running,
		Done: progress.Done, Failed: progress.Failed, Cancelled: progress.Cancelled,
		Skipped: progress.Skipped,
	}
}

func splitTaskToResponse(task db.MulticaWorkflowSplitTask) SplitTaskResponse {
	var dependsOn []string
	if len(task.DependsOn) > 0 {
		_ = json.Unmarshal(task.DependsOn, &dependsOn)
	}
	var lastError *json.RawMessage
	if len(task.LastError) > 0 {
		raw := json.RawMessage(task.LastError)
		lastError = &raw
	}
	return SplitTaskResponse{
		ID: uuidToString(task.ID), NodeRunID: uuidToString(task.NodeRunID),
		Title: task.Title, Description: task.Description,
		WorkflowID: uuidToPtr(task.WorkflowID), AssigneeType: textToPtr(task.AssigneeType),
		AssigneeID: uuidToPtr(task.AssigneeID), DependsOn: dependsOn,
		SortOrder: task.SortOrder, Status: task.Status, IssueID: uuidToPtr(task.IssueID),
		RunID: uuidToPtr(task.RunID), LastError: lastError,
		CreatedAt: timestampToString(task.CreatedAt), UpdatedAt: timestampToString(task.UpdatedAt),
		MaterializeRetryCount:    task.MaterializeRetryCount,
		MaterializeNextAttemptAt: timestampToPtrString(task.MaterializeNextAttemptAt),
	}
}

func timestampToPtrString(value pgtype.Timestamptz) *string {
	if !value.Valid {
		return nil
	}
	formatted := value.Time.Format(time.RFC3339Nano)
	return &formatted
}

func (h *Handler) currentSplitTasksResponse(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) (SplitTasksResponse, error) {
	resp := SplitTasksResponse{Tasks: []SplitTaskResponse{}, ArchiveStatus: "not_started"}
	if nodeRun.SplitPlanGeneration < 1 {
		return resp, nil
	}
	generation, err := h.Queries.GetCurrentWorkflowSplitGeneration(ctx, nodeRun.ID)
	if err != nil {
		return resp, err
	}
	tasks, err := h.Queries.ListSplitTasksByGeneration(ctx, db.ListSplitTasksByGenerationParams{
		NodeRunID:           nodeRun.ID,
		SplitPlanGeneration: pgtype.Int4{Int32: generation.Generation, Valid: true},
	})
	if err != nil {
		return resp, err
	}
	resp.Tasks = make([]SplitTaskResponse, len(tasks))
	resp.Progress = splitProgressResponse(tasks)
	resp.SplitPlanGeneration = generation.Generation
	resp.SubmissionID = uuidToPtr(generation.SubmissionID)
	for i, task := range tasks {
		resp.Tasks[i] = splitTaskToResponse(task)
		if task.IssueID.Valid {
			resp.Progress.Materialized++
			continue
		}
		if task.Status == service.SplitTaskStatusFailed {
			resp.Progress.Exhausted++
		}
		if task.Status == service.SplitTaskStatusCreated && task.MaterializeNextAttemptAt.Valid {
			resp.Progress.RetryWaiting++
			if resp.Progress.NextRetryAt == nil || task.MaterializeNextAttemptAt.Time.Before(parseSplitTimestamp(*resp.Progress.NextRetryAt)) {
				resp.Progress.NextRetryAt = timestampToPtrString(task.MaterializeNextAttemptAt)
			}
		}
	}
	if snapshot, snapshotErr := h.Queries.GetWorkflowSplitSnapshot(ctx, db.GetWorkflowSplitSnapshotParams{
		NodeRunID: nodeRun.ID, Generation: generation.Generation,
	}); snapshotErr == nil {
		resp.ArchiveStatus = snapshot.ArchiveStatus
		resp.ArchiveError = snapshot.ArchiveError
	} else if generation.Generation > 1 {
		previous, previousErr := h.Queries.GetWorkflowSplitGeneration(ctx, db.GetWorkflowSplitGenerationParams{
			NodeRunID: nodeRun.ID, Generation: generation.Generation - 1,
		})
		if previousErr == nil && previous.Status == "rejected" {
			resp.ArchiveStatus = previous.ReviewArchiveStatus
			resp.ArchiveError = previous.ReviewArchiveError
		}
	}
	return resp, nil
}

func parseSplitTimestamp(value string) time.Time {
	parsed, _ := time.Parse(time.RFC3339Nano, value)
	return parsed
}

func (h *Handler) ListSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	response, err := h.currentSplitTasksResponse(r.Context(), nodeRun)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) GenerateSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if _, ok := h.requireSplitReviewer(w, r, nodeRun); !ok {
		return
	}
	var req service.SplitGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split generation payload")))
		return
	}
	if err := h.SplitOrchestrator.GenerateSplitPlan(r.Context(), nodeRun.ID, req); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	h.writeCurrentSplitTasks(w, r, nodeRun.ID)
}

func (h *Handler) ApproveSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	actorUserID, ok := h.requireSplitReviewer(w, r, nodeRun)
	if !ok {
		return
	}
	var req service.SplitApproveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split approval payload")))
		return
	}
	if err := h.SplitOrchestrator.ApproveSplit(r.Context(), nodeRun, actorUserID, req); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	h.writeCurrentSplitTasks(w, r, nodeRun.ID)
}

func (h *Handler) RejectSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	actorUserID, ok := h.requireSplitReviewer(w, r, nodeRun)
	if !ok {
		return
	}
	var req service.SplitRejectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split rejection payload")))
		return
	}
	if err := h.SplitOrchestrator.RejectSplit(r.Context(), nodeRun, actorUserID, req); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	h.writeCurrentSplitTasks(w, r, nodeRun.ID)
}

func (h *Handler) RetrySplitTaskMaterialization(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if _, ok := h.requireSplitReviewer(w, r, nodeRun); !ok {
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "taskId")
	if !ok {
		return
	}
	var req struct {
		ExpectedSplitGeneration int32 `json:"expected_split_generation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split retry payload")))
		return
	}
	if err := h.SplitOrchestrator.RetrySplitMaterializationTask(r.Context(), nodeRun.ID, taskID, req.ExpectedSplitGeneration); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	h.writeCurrentSplitTasks(w, r, nodeRun.ID)
}

func (h *Handler) PatchSplitConfig(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if _, ok := h.requireSplitReviewer(w, r, nodeRun); !ok {
		return
	}
	var req PatchSplitConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split config payload")))
		return
	}
	if err := h.SplitOrchestrator.PatchSplitConfig(r.Context(), nodeRun, req.MaxConcurrency, req.ExpectedConfigVersion); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	h.writeCurrentSplitTasks(w, r, nodeRun.ID)
}

func (h *Handler) CancelSplitNode(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if _, ok := h.requireSplitReviewer(w, r, nodeRun); !ok {
		return
	}
	var req struct {
		ExpectedSplitGeneration int32 `json:"expected_split_generation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorBadRequest, "invalid_split_request", errors.New("invalid split cancellation payload")))
		return
	}
	updated, err := h.SplitOrchestrator.CancelSplitNodeExpected(
		r.Context(), nodeRun, parseUUID(workspaceID), req.ExpectedSplitGeneration,
	)
	if err != nil {
		writeSplitAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, workflowNodeRunToResponse(*updated))
}

func (h *Handler) writeCurrentSplitTasks(w http.ResponseWriter, r *http.Request, nodeRunID pgtype.UUID) {
	currentNode, err := h.Queries.GetWorkflowNodeRun(r.Context(), nodeRunID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load split node")
		return
	}
	response, err := h.currentSplitTasksResponse(r.Context(), currentNode)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) requireSplitReviewer(w http.ResponseWriter, r *http.Request, nodeRun db.MulticaWorkflowNodeRun) (pgtype.UUID, bool) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return pgtype.UUID{}, false
	}
	actorUserID := parseUUID(userID)
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return pgtype.UUID{}, false
	}
	if err := h.SplitOrchestrator.RequireSplitReviewer(r.Context(), nodeRun, actorUserID); err != nil {
		writeSplitAPIError(w, err)
		return pgtype.UUID{}, false
	}
	return actorUserID, true
}

func splitAPIErrorResponse(err error) (int, string) {
	var splitErr *service.SplitAPIError
	if !errors.As(err, &splitErr) {
		return http.StatusInternalServerError, "internal_split_error"
	}
	switch splitErr.Status {
	case service.SplitErrorBadRequest:
		return http.StatusBadRequest, splitErr.Code
	case service.SplitErrorConflict:
		return http.StatusConflict, splitErr.Code
	case service.SplitErrorForbidden:
		return http.StatusForbidden, splitErr.Code
	case service.SplitErrorUnprocessable:
		return http.StatusUnprocessableEntity, splitErr.Code
	case service.SplitErrorUpstream:
		return http.StatusBadGateway, splitErr.Code
	default:
		return http.StatusInternalServerError, "internal_split_error"
	}
}

func writeSplitAPIError(w http.ResponseWriter, err error) {
	status, code := splitAPIErrorResponse(err)
	if status == http.StatusInternalServerError {
		writeJSON(w, status, map[string]any{"code": code, "error": "failed to process split request"})
		return
	}
	payload := map[string]any{"code": code, "error": err.Error()}
	var splitErr *service.SplitAPIError
	if errors.As(err, &splitErr) {
		if status == http.StatusUnprocessableEntity {
			payload["details"] = splitErr.Details
		}
		if splitErr.CurrentSplitGeneration > 0 {
			payload["current_split_generation"] = splitErr.CurrentSplitGeneration
		}
		if splitErr.CurrentSubmissionID != "" {
			payload["current_submission_id"] = splitErr.CurrentSubmissionID
		}
	}
	writeJSON(w, status, payload)
}

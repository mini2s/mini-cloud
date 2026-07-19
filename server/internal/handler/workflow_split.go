package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type SplitTaskResponse struct {
	ID          string           `json:"id"`
	NodeRunID   string           `json:"node_run_id"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	WorkflowID  *string          `json:"workflow_id"`
	DependsOn   []string         `json:"depends_on"`
	SortOrder   int32            `json:"sort_order"`
	Status      string           `json:"status"`
	IssueID     *string          `json:"issue_id"`
	RunID       *string          `json:"run_id"`
	Version     int64            `json:"version"`
	DraftKey    *string          `json:"draft_key"`
	DraftSource string           `json:"draft_source"`
	LastError   *json.RawMessage `json:"last_error"`
	CreatedAt   string           `json:"created_at"`
	UpdatedAt   string           `json:"updated_at"`
}

type SplitProgressResponse struct {
	Total     int `json:"total"`
	Created   int `json:"created"`
	Running   int `json:"running"`
	Done      int `json:"done"`
	Failed    int `json:"failed"`
	Cancelled int `json:"cancelled"`
	Skipped   int `json:"skipped"`
}

type SplitTasksResponse struct {
	Tasks    []SplitTaskResponse   `json:"tasks"`
	Progress SplitProgressResponse `json:"progress"`
}

type PatchSplitDraftTaskRequest struct {
	Title           *string  `json:"title"`
	Description     *string  `json:"description"`
	DependsOn       []string `json:"depends_on"`
	Discarded       *bool    `json:"discarded"`
	WorkflowID      *string  `json:"workflow_id"`
	ExpectedVersion int64    `json:"expected_version"`
}

type BatchCreateSplitDraftTasksRequest struct {
	Tasks []struct {
		DraftKey    string   `json:"draft_key"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		DependsOn   []string `json:"depends_on"`
		WorkflowID  *string  `json:"workflow_id"`
	} `json:"tasks"`
}

type CreateManualSplitDraftTaskRequest struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	WorkflowID  string   `json:"workflow_id"`
	DependsOn   []string `json:"depends_on"`
}

type BatchPatchSplitDraftTasksRequest struct {
	Updates []struct {
		TaskID          string `json:"task_id"`
		WorkflowID      string `json:"workflow_id"`
		ExpectedVersion int64  `json:"expected_version"`
	} `json:"updates"`
}

type PatchSplitConfigRequest struct {
	MaxConcurrency        int32 `json:"max_concurrency"`
	ExpectedConfigVersion int64 `json:"expected_config_version"`
}

type RetrySplitTaskRequest struct {
	WorkflowID *string `json:"workflow_id"`
}

func splitProgressResponse(tasks []db.MulticaWorkflowSplitTask) SplitProgressResponse {
	return splitProgressFromService(service.SplitExecutionProgressSummary(tasks))
}

func splitProgressFromService(progress service.SplitProgressSummary) SplitProgressResponse {
	return SplitProgressResponse{
		Total:     progress.Total,
		Created:   progress.Created,
		Running:   progress.Running,
		Done:      progress.Done,
		Failed:    progress.Failed,
		Cancelled: progress.Cancelled,
		Skipped:   progress.Skipped,
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
		ID:          uuidToString(task.ID),
		NodeRunID:   uuidToString(task.NodeRunID),
		Title:       task.Title,
		Description: task.Description,
		WorkflowID:  uuidToPtr(task.WorkflowID),
		DependsOn:   dependsOn,
		SortOrder:   task.SortOrder,
		Status:      task.Status,
		IssueID:     uuidToPtr(task.IssueID),
		RunID:       uuidToPtr(task.RunID),
		Version:     task.Version,
		DraftKey:    textToPtr(task.DraftKey),
		DraftSource: task.DraftSource,
		LastError:   lastError,
		CreatedAt:   timestampToString(task.CreatedAt),
		UpdatedAt:   timestampToString(task.UpdatedAt),
	}
}

func splitTasksResponse(tasks []db.MulticaWorkflowSplitTask) SplitTasksResponse {
	resp := SplitTasksResponse{
		Tasks:    make([]SplitTaskResponse, len(tasks)),
		Progress: splitProgressResponse(tasks),
	}
	for i, task := range tasks {
		resp.Tasks[i] = splitTaskToResponse(task)
	}
	return resp
}

func (h *Handler) ListSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) PatchSplitDraftTask(w http.ResponseWriter, r *http.Request) {
	nodeRun, run, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		writeSplitAPIError(w, errors.New("split draft task can only be edited while awaiting review"))
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "taskId")
	if !ok {
		return
	}
	var req PatchSplitDraftTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, errors.New("invalid request body"))
		return
	}
	if req.ExpectedVersion < 1 {
		writeSplitAPIError(w, errors.New("expected_version is required"))
		return
	}

	params := db.UpdateSplitTaskDraftFieldsParams{
		ID:        taskID,
		NodeRunID: nodeRun.ID,
		Version:   req.ExpectedVersion,
	}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			writeSplitAPIError(w, errors.New("title is required"))
			return
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.WorkflowID != nil {
		workflowID, ok := parseUUIDOrBadRequest(w, *req.WorkflowID, "workflow_id")
		if !ok {
			return
		}
		if err := h.validateSplitIssueWorkflow(r, workflowID, run.WorkflowID, run.WorkspaceID); err != nil {
			writeSplitAPIError(w, err)
			return
		}
		params.WorkflowID = workflowID
	}
	if req.DependsOn != nil {
		dependsOn, err := json.Marshal(req.DependsOn)
		if err != nil {
			writeSplitAPIError(w, errors.New("invalid depends_on"))
			return
		}
		params.DependsOn = dependsOn
	}
	if req.Discarded != nil {
		params.Discarded = pgtype.Bool{Bool: *req.Discarded, Valid: true}
	}

	if _, err := h.Queries.UpdateSplitTaskDraftFields(r.Context(), params); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorConflict, "draft_task_conflict", errors.New("split draft task version conflict")))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update split draft task")
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) BatchPatchSplitDraftTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, run, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		writeSplitAPIError(w, errors.New("split draft task can only be edited while awaiting review"))
		return
	}
	var req BatchPatchSplitDraftTasksRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, errors.New("invalid request body"))
		return
	}
	for _, update := range req.Updates {
		taskID, ok := parseUUIDOrBadRequest(w, update.TaskID, "task_id")
		if !ok {
			return
		}
		workflowID, ok := parseUUIDOrBadRequest(w, update.WorkflowID, "workflow_id")
		if !ok {
			return
		}
		if update.ExpectedVersion < 1 {
			writeSplitAPIError(w, errors.New("expected_version is required"))
			return
		}
		if err := h.validateSplitIssueWorkflow(r, workflowID, run.WorkflowID, run.WorkspaceID); err != nil {
			writeSplitAPIError(w, err)
			return
		}
		if _, err := h.Queries.UpdateSplitTaskDraftFields(r.Context(), db.UpdateSplitTaskDraftFieldsParams{
			ID:         taskID,
			NodeRunID:  nodeRun.ID,
			Version:    update.ExpectedVersion,
			WorkflowID: workflowID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeSplitAPIError(w, service.NewSplitAPIError(service.SplitErrorConflict, "draft_task_conflict", errors.New("split draft task version conflict")))
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to update split draft task")
			return
		}
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) validateSplitIssueWorkflow(r *http.Request, workflowID, parentWorkflowID, workspaceID pgtype.UUID) error {
	if workflowID == parentWorkflowID {
		return service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("split issue workflow cannot be the parent workflow"))
	}
	workflow, err := h.Queries.GetWorkflowInWorkspace(r.Context(), db.GetWorkflowInWorkspaceParams{
		ID:          workflowID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("split issue workflow not found"))
	}
	if workflow.Status != "active" {
		return service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("split issue workflow is not active"))
	}
	nodes, err := h.Queries.ListWorkflowNodes(r.Context(), workflowID)
	if err != nil {
		return errors.New("failed to inspect split issue workflow")
	}
	for _, node := range nodes {
		if isSplitWorkflowNode(node.FormatSchema) {
			return service.NewSplitAPIError(service.SplitErrorUnprocessable, "invalid_split_task_workflow", errors.New("split issue workflow cannot contain nested split nodes"))
		}
	}
	return nil
}

func (h *Handler) GenerateSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.GenerateSplitTasks(r.Context(), nodeRun); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) RecoverSplitDraftTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.RecoverSplitDraftTasks(r.Context(), nodeRun); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) ResetSplitDraftTasksToOriginal(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.ResetSplitDraftTasksToOriginal(r.Context(), nodeRun); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func splitDraftErrorStatus(err error) int {
	msg := err.Error()
	if strings.Contains(msg, "header") ||
		strings.Contains(msg, "does not match") ||
		strings.Contains(msg, "must be running") {
		return http.StatusForbidden
	}
	return http.StatusBadRequest
}

func splitAPIErrorResponse(err error) (int, string) {
	var splitErr *service.SplitAPIError
	if !errors.As(err, &splitErr) {
		return http.StatusBadRequest, "invalid_split_request"
	}
	switch splitErr.Status {
	case service.SplitErrorConflict:
		return http.StatusConflict, splitErr.Code
	case service.SplitErrorUnprocessable:
		return http.StatusUnprocessableEntity, splitErr.Code
	default:
		return http.StatusBadRequest, splitErr.Code
	}
}

func writeSplitAPIError(w http.ResponseWriter, err error) {
	status, code := splitAPIErrorResponse(err)
	writeJSON(w, status, map[string]any{"code": code, "error": err.Error()})
}

func (h *Handler) AddSplitDraftTask(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	if r.Header.Get("X-Task-ID") == "" && r.Header.Get("X-Agent-ID") == "" {
		h.addManualSplitDraftTask(w, r, nodeRun)
		return
	}
	taskIDHeader := r.Header.Get("X-Task-ID")
	taskID, ok := parseUUIDOrBadRequest(w, taskIDHeader, "X-Task-ID")
	if !ok {
		return
	}
	agentID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Agent-ID"), "X-Agent-ID")
	if !ok {
		return
	}
	var req service.SplitDraftTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid split draft task payload")
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.AddSplitDraftTask(r.Context(), nodeRun, taskID, agentID, req); err != nil {
		writeError(w, splitDraftErrorStatus(err), err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) addManualSplitDraftTask(w http.ResponseWriter, r *http.Request, nodeRun db.MulticaWorkflowNodeRun) {
	if nodeRun.Status != service.NodeRunStatusAwaitingSplitReview {
		writeError(w, http.StatusBadRequest, "split draft task can only be added while awaiting review")
		return
	}
	var req CreateManualSplitDraftTaskRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid split draft task payload")
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.AddManualSplitDraftTask(r.Context(), nodeRun, service.ManualSplitDraftTaskRequest{
		Title:       req.Title,
		Description: req.Description,
		WorkflowID:  req.WorkflowID,
		DependsOn:   req.DependsOn,
	}); err != nil {
		writeError(w, splitDraftErrorStatus(err), err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) BatchAddSplitDraftTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Task-ID"), "X-Task-ID")
	if !ok {
		return
	}
	agentID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Agent-ID"), "X-Agent-ID")
	if !ok {
		return
	}
	var req BatchCreateSplitDraftTasksRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid split draft task batch payload")
		return
	}
	if len(req.Tasks) == 0 {
		writeError(w, http.StatusBadRequest, "tasks is required")
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	requests := make([]service.SplitDraftTaskRequest, 0, len(req.Tasks))
	for _, task := range req.Tasks {
		requests = append(requests, service.SplitDraftTaskRequest{
			Key:           task.DraftKey,
			Title:         task.Title,
			Description:   task.Description,
			DependsOnKeys: task.DependsOn,
		})
	}
	if err := h.SplitOrchestrator.AddSplitDraftTasks(r.Context(), nodeRun, taskID, agentID, requests); err != nil {
		writeError(w, splitDraftErrorStatus(err), err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) SubmitSplitDraftTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	taskIDHeader := r.Header.Get("X-Task-ID")
	taskID, ok := parseUUIDOrBadRequest(w, taskIDHeader, "X-Task-ID")
	if !ok {
		return
	}
	agentID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Agent-ID"), "X-Agent-ID")
	if !ok {
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.SubmitSplitDraftTasks(r.Context(), nodeRun, taskID, agentID); err != nil {
		writeError(w, splitDraftErrorStatus(err), err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) DeleteSplitDraftTask(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	draftTaskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "taskId")
	if !ok {
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Task-ID"), "X-Task-ID")
	if !ok {
		return
	}
	agentID, ok := parseUUIDOrBadRequest(w, r.Header.Get("X-Agent-ID"), "X-Agent-ID")
	if !ok {
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.DeleteSplitDraftTask(r.Context(), nodeRun, draftTaskID, taskID, agentID); err != nil {
		writeError(w, splitDraftErrorStatus(err), err.Error())
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) PatchSplitConfig(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	var req PatchSplitConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, errors.New("invalid split config payload"))
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.PatchSplitConfig(r.Context(), nodeRun, req.MaxConcurrency, req.ExpectedConfigVersion); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) RetrySplitTask(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	taskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "taskId")
	if !ok {
		return
	}
	var req RetrySplitTaskRequest
	if r.Body != nil {
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil && !errors.Is(err, io.EOF) {
			writeSplitAPIError(w, errors.New("invalid split retry payload"))
			return
		}
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.RetrySplitTask(r.Context(), nodeRun, taskID, req.WorkflowID); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) ApproveSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	var req service.SplitApproveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeSplitAPIError(w, errors.New("invalid split approval payload"))
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.ApproveSplit(r.Context(), nodeRun, req); err != nil {
		writeSplitAPIError(w, err)
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) CancelSplitNode(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	nodeRun, _, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}

	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	updated, err := h.SplitOrchestrator.CancelSplitNode(r.Context(), nodeRun, parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, workflowNodeRunToResponse(*updated))
}

func (h *Handler) HandleSplitChat(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	var req service.SplitChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid split chat payload")
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	result, err := h.SplitOrchestrator.SplitChat(r.Context(), nodeRun, parseUUID(userID), req)
	if err != nil {
		code := http.StatusBadRequest
		msg := err.Error()
		if strings.Contains(msg, "already in progress") {
			code = http.StatusConflict
		}
		writeError(w, code, msg)
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"chat_session_id": result.ChatSessionID,
		"task_id":         result.TaskID,
		"tasks":           splitTasksResponse(tasks),
	})
}

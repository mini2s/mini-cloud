package handler

import (
	"encoding/json"
	"net/http"

	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type SplitTaskResponse struct {
	ID                    string   `json:"id"`
	NodeRunID             string   `json:"node_run_id"`
	Title                 string   `json:"title"`
	Description           string   `json:"description"`
	SuggestedAssigneeType *string  `json:"suggested_assignee_type"`
	SuggestedAssigneeID   *string  `json:"suggested_assignee_id"`
	DependsOn             []string `json:"depends_on"`
	SortOrder             int32    `json:"sort_order"`
	Status                string   `json:"status"`
	IssueID               *string  `json:"issue_id"`
	RunID                 *string  `json:"run_id"`
	CreatedAt             string   `json:"created_at"`
	UpdatedAt             string   `json:"updated_at"`
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

func splitProgressResponse(tasks []db.MulticaWorkflowSplitTask) SplitProgressResponse {
	var progress SplitProgressResponse
	for _, task := range tasks {
		if task.Status != service.SplitTaskStatusDiscarded {
			progress.Total++
		}
		switch task.Status {
		case service.SplitTaskStatusCreated:
			progress.Created++
		case service.SplitTaskStatusRunning:
			progress.Running++
		case service.SplitTaskStatusDone:
			progress.Done++
		case service.SplitTaskStatusFailed:
			progress.Failed++
		case service.SplitTaskStatusCancelled:
			progress.Cancelled++
		case service.SplitTaskStatusSkipped:
			progress.Skipped++
		}
	}
	return progress
}

func splitTaskToResponse(task db.MulticaWorkflowSplitTask) SplitTaskResponse {
	var dependsOn []string
	if len(task.DependsOn) > 0 {
		_ = json.Unmarshal(task.DependsOn, &dependsOn)
	}
	return SplitTaskResponse{
		ID:                    uuidToString(task.ID),
		NodeRunID:             uuidToString(task.NodeRunID),
		Title:                 task.Title,
		Description:           task.Description,
		SuggestedAssigneeType: textToPtr(task.SuggestedAssigneeType),
		SuggestedAssigneeID:   uuidToPtr(task.SuggestedAssigneeID),
		DependsOn:             dependsOn,
		SortOrder:             task.SortOrder,
		Status:                task.Status,
		IssueID:               uuidToPtr(task.IssueID),
		RunID:                 uuidToPtr(task.RunID),
		CreatedAt:             timestampToString(task.CreatedAt),
		UpdatedAt:             timestampToString(task.UpdatedAt),
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

func (h *Handler) ApproveSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	var req service.SplitApproveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid split approval payload")
		return
	}
	if h.SplitOrchestrator == nil {
		writeError(w, http.StatusInternalServerError, "split orchestrator is not configured")
		return
	}
	if err := h.SplitOrchestrator.ApproveSplit(r.Context(), nodeRun, req); err != nil {
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

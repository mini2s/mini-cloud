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
		Tasks: make([]SplitTaskResponse, len(tasks)),
	}
	for i, task := range tasks {
		resp.Tasks[i] = splitTaskToResponse(task)
		if task.Status != service.SplitTaskStatusDiscarded {
			resp.Progress.Total++
		}
		switch task.Status {
		case service.SplitTaskStatusCreated:
			resp.Progress.Created++
		case service.SplitTaskStatusRunning:
			resp.Progress.Running++
		case service.SplitTaskStatusDone:
			resp.Progress.Done++
		case service.SplitTaskStatusFailed:
			resp.Progress.Failed++
		case service.SplitTaskStatusCancelled:
			resp.Progress.Cancelled++
		case service.SplitTaskStatusSkipped:
			resp.Progress.Skipped++
		}
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
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	if len(tasks) == 0 {
		writeError(w, http.StatusNotImplemented, "split task generation is not wired yet")
		return
	}
	writeJSON(w, http.StatusOK, splitTasksResponse(tasks))
}

func (h *Handler) ApproveSplitTasks(w http.ResponseWriter, r *http.Request) {
	nodeRun, _, _, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}
	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}
	if len(tasks) == 0 {
		writeError(w, http.StatusBadRequest, "split has no generated tasks")
		return
	}
	writeError(w, http.StatusNotImplemented, "split approval materialization is not wired yet")
}

func (h *Handler) CancelSplitNode(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUserID(w, r); !ok {
		return
	}
	nodeRun, _, workspaceID, ok := h.loadNodeRunForWorkspace(w, r)
	if !ok {
		return
	}

	tasks, err := h.Queries.ListSplitTasksByNodeRun(r.Context(), nodeRun.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list split tasks")
		return
	}

	for _, task := range tasks {
		if task.RunID.Valid {
			_ = h.WorkflowService.CancelRun(r.Context(), task.RunID)
		}
		if task.IssueID.Valid {
			_, _ = h.Queries.UpdateIssueStatus(r.Context(), db.UpdateIssueStatusParams{
				ID:          task.IssueID,
				Status:      "cancelled",
				WorkspaceID: parseUUID(workspaceID),
			})
		}
	}
	if err := h.Queries.CancelOpenSplitTasksByNodeRun(r.Context(), nodeRun.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to cancel split tasks")
		return
	}

	var updated *db.MulticaWorkflowNodeRun
	if nodeRun.Status == service.NodeRunStatusCancelled {
		updated = &nodeRun
	} else if serviceStatusCanCancel(nodeRun.Status) {
		updated, err = h.WorkflowService.TransitionNodeRun(r.Context(), nodeRun, service.NodeRunStatusCancelled)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		writeError(w, http.StatusBadRequest, "split node cannot be cancelled from current status")
		return
	}

	writeJSON(w, http.StatusOK, workflowNodeRunToResponse(*updated))
}

func serviceStatusCanCancel(status string) bool {
	switch status {
	case service.NodeRunStatusPending,
		service.NodeRunStatusFormatChecking,
		service.NodeRunStatusFormatOk,
		service.NodeRunStatusWorkerAssigned,
		service.NodeRunStatusWorking,
		service.NodeRunStatusAwaitingInput,
		service.NodeRunStatusAwaitingCritic,
		service.NodeRunStatusCriticReviewing,
		service.NodeRunStatusBlocked,
		service.NodeRunStatusSplitting,
		service.NodeRunStatusAwaitingSplitReview,
		service.NodeRunStatusSplitActive:
		return true
	default:
		return false
	}
}

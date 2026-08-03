package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/multica-ai/multica/server/internal/events"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// workerAssignableNodeRunStatuses are the node_run statuses before the worker
// starts executing (i.e. before worker_assigned/working). Mirrors the WHERE
// clause of SetWorkflowNodeRunResolvedWorker so the editor can't race the
// state machine.
var workerAssignableNodeRunStatuses = map[string]bool{
	"blocked":         true,
	"pending":         true,
	"format_checking": true,
	"format_ok":       true,
}

// criticAssignableNodeRunStatuses are the statuses before the critic starts
// reviewing (before critic_reviewing). Mirrors SetWorkflowNodeRunResolvedCritic.
var criticAssignableNodeRunStatuses = map[string]bool{
	"blocked":         true,
	"pending":         true,
	"format_checking": true,
	"format_ok":       true,
	"worker_assigned": true,
	"working":         true,
	"awaiting_input":  true,
	"awaiting_critic": true,
}

// UpdateNodeRunAssigneesRequest allows editing a node run's worker/critic.
// Fields are pointers so callers can patch a single role without resetting the
// other: an omitted field keeps the existing value, an explicit "" clears it.
type UpdateNodeRunAssigneesRequest struct {
	WorkerType *string `json:"worker_type,omitempty"`
	WorkerID   *string `json:"worker_id,omitempty"`
	CriticType *string `json:"critic_type,omitempty"`
	CriticID   *string `json:"critic_id,omitempty"`
}

// UpdateNodeRunAssignees edits the worker/critic on an existing node run while
// it is still in the pre-execution window. This is what the issue-detail
// ExecutionPanorama node card calls when a user swaps the executor/reviewer of
// a not-yet-started node. dispatch reads node_run.worker_id/critic_id, so this
// is what makes the new assignee actually take effect when the node progresses.
func (h *Handler) UpdateNodeRunAssignees(w http.ResponseWriter, r *http.Request) {
	nodeRunUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "nodeRunId"), "node run id")
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	var req UpdateNodeRunAssigneesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Load node run + verify workspace access (same pattern as SubmitNodeRun).
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

	workerChanging := req.WorkerType != nil || req.WorkerID != nil
	criticChanging := req.CriticType != nil || req.CriticID != nil
	if !workerChanging && !criticChanging {
		writeError(w, http.StatusBadRequest, "no assignee fields to update")
		return
	}
	if workerChanging && !workerAssignableNodeRunStatuses[nodeRun.Status] {
		writeError(w, http.StatusConflict, "node run has progressed past the editable window for worker")
		return
	}
	if criticChanging && !criticAssignableNodeRunStatuses[nodeRun.Status] {
		writeError(w, http.StatusConflict, "node run has progressed past the editable window for critic")
		return
	}

	workerType := nodeRun.WorkerType
	if req.WorkerType != nil {
		workerType = *req.WorkerType
	}
	workerID := nodeRun.WorkerID
	if req.WorkerID != nil {
		if *req.WorkerID == "" {
			workerID = pgtype.UUID{}
		} else {
			parsed, ok := parseUUIDOrBadRequest(w, *req.WorkerID, "worker_id")
			if !ok {
				return
			}
			workerID = parsed
		}
	}
	if workerType == "human" && workerID.Valid {
		if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			WorkspaceID: run.WorkspaceID, UserID: workerID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "worker_id is not an active workspace member")
			return
		}
	}

	criticType := nodeRun.CriticType
	if req.CriticType != nil {
		criticType = *req.CriticType
	}
	criticID := nodeRun.CriticID
	if req.CriticID != nil {
		if *req.CriticID == "" {
			criticID = pgtype.UUID{}
		} else {
			parsed, ok := parseUUIDOrBadRequest(w, *req.CriticID, "critic_id")
			if !ok {
				return
			}
			criticID = parsed
		}
	}
	if criticType == "human" && criticID.Valid {
		if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			WorkspaceID: run.WorkspaceID, UserID: criticID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "critic_id is not an active workspace member")
			return
		}
	}

	updated, err := h.Queries.UpdateWorkflowNodeRunAssignees(r.Context(), db.UpdateWorkflowNodeRunAssigneesParams{
		ID:         nodeRunUUID,
		WorkerType: workerType,
		WorkerID:   workerID,
		CriticType: criticType,
		CriticID:   criticID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update node run assignees: "+err.Error())
		return
	}

	// Broadcast so connected clients (issue-detail ExecutionPanorama) refresh
	// the node card immediately. dispatch will read the new worker/critic when
	// the node later transitions to worker_assigned/awaiting_critic.
	if h.Bus != nil {
		h.Bus.Publish(events.Event{
			Type:        "workflow:node_run_updated",
			WorkspaceID: workspaceID,
			Payload: map[string]any{
				"node_run_id": uuidToString(updated.ID),
				"run_id":      uuidToString(run.ID),
				"status":      updated.Status,
			},
		})
	}

	writeJSON(w, http.StatusOK, workflowNodeRunToResponse(updated))
}

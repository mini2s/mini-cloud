package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// UploadIssueDeliverableRequest is the body of POST /api/issues/{id}/deliverables/upload.
type UploadIssueDeliverableRequest struct {
	Content string `json:"content"`
}

// UploadIssueDeliverable (POST /api/issues/{id}/deliverables/upload) lets a
// member submit a document deliverable for a member-assigned issue: the server
// writes the content to the issue's default-workflow Gitea repo (node branch),
// opens a PR, registers it on the submission, and advances the node-run into
// review — the server-side mirror of the agent's cs-workflow gitea submit.
// Dormant (Gitea unconfigured) → 503; issue without a workflow run → 409.
func (h *Handler) UploadIssueDeliverable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	if !isGiteaConfigured() {
		writeError(w, http.StatusServiceUnavailable, "deliverable upload requires Gitea to be configured")
		return
	}
	if !issue.WorkflowRunID.Valid {
		writeError(w, http.StatusConflict, "issue is not routed to a deliverable workflow")
		return
	}
	var req UploadIssueDeliverableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if err := h.WorkflowService.UploadMemberDeliverable(r.Context(), issue, req.Content); err != nil {
		slog.Warn("member deliverable upload failed", "issue_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to upload deliverable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

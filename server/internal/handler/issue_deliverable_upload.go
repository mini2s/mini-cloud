package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/multica-ai/multica/server/internal/service"
)

// UploadIssueDeliverableRequest is the body of POST /api/issues/{id}/deliverables/upload.
type UploadIssueDeliverableRequest struct {
	Files []service.MemberDeliverableFile `json:"files"`
}

// UploadIssueDeliverable (POST /api/issues/{id}/deliverables/upload) lets a
// member submit one or more document files for a member-assigned issue: the
// server archives each file (any format, binary-safe) to the issue's
// default-workflow Gitea repo under the node directory, opens a PR, registers
// it on the submission, and advances the node-run into review — the server-side
// mirror of the agent's cs-cloud workflow deliverable submit.
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
	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files are required")
		return
	}
	if err := h.WorkflowService.UploadMemberDeliverable(r.Context(), issue, req.Files); err != nil {
		slog.Warn("member deliverable upload failed", "issue_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to upload deliverable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// UploadIssueDeliverablePRRequest is the body of POST /api/issues/{id}/deliverables/upload-pr.
type UploadIssueDeliverablePRRequest struct {
	PullRequestURL string `json:"pull_request_url"`
}

// UploadIssueDeliverablePR (POST /api/issues/{id}/deliverables/upload-pr) lets a
// member submit a code deliverable for a member-assigned issue by pasting the
// pull/merge-request URL they opened elsewhere. The server records the URL on
// the pull_request-kind deliverable's submission so the node can enter review —
// the manual counterpart to the agent's report-pr path.
func (h *Handler) UploadIssueDeliverablePR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	if !issue.WorkflowRunID.Valid {
		writeError(w, http.StatusConflict, "issue is not routed to a deliverable workflow")
		return
	}
	var req UploadIssueDeliverablePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PullRequestURL == "" {
		writeError(w, http.StatusBadRequest, "pull_request_url is required")
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	if err := h.WorkflowService.UploadMemberDeliverablePR(r.Context(), issue, req.PullRequestURL, userID); err != nil {
		slog.Warn("member deliverable PR upload failed", "issue_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to upload deliverable PR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

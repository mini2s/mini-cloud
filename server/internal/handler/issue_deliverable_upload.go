package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// UploadIssueDeliverableRequest is the body of POST /api/issues/{id}/deliverables/upload.
type UploadIssueDeliverableRequest struct {
	Files []service.MemberDeliverableFile `json:"files"`
	// PullRequestURLs optionally submits code PR/MR links in the SAME call as
	// files. Submitting files and links together is the supported way to upload
	// both at once: two separate calls race, because the file upload can
	// advance the node-run out of the worker phase and the link upload is then
	// rejected (losing the link submission).
	PullRequestURLs []string `json:"pull_request_urls"`
	// DeliverableID optionally targets a specific document deliverable when the
	// node defines several; empty uploads to the first document deliverable.
	DeliverableID string `json:"deliverable_id,omitempty"`
	// Summary is an optional execution note merged into the worker output when
	// this upload advances the node-run into review.
	Summary string `json:"summary"`
}

// normalizeDeliverablePRURLs trims blanks and drops exact duplicates
// (order-preserving) from a list of PR/MR URLs.
func normalizeDeliverablePRURLs(raw []string) []string {
	seen := make(map[string]bool, len(raw))
	out := make([]string, 0, len(raw))
	for _, r := range raw {
		link := strings.TrimSpace(r)
		if link == "" || seen[link] {
			continue
		}
		seen[link] = true
		out = append(out, link)
	}
	return out
}

// UploadIssueDeliverable (POST /api/issues/{id}/deliverables/upload) lets a
// member submit one or more document files for a member-assigned issue: the
// server archives each file (any format, binary-safe) to the issue's
// default-workflow Gitea repo under the node directory, opens a PR, registers
// it on the submission, and advances the node-run into review — the server-side
// mirror of the agent's cs-cloud workflow deliverable submit.
// Dormant (Gitea unconfigured) → 503; issue without a workflow run → 409;
// node run already past the worker phase → 409; caller is not the node run's
// human worker (and not an owner/admin overriding) → 403.
func (h *Handler) UploadIssueDeliverable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	userID, ok := h.requireDeliverableUploadWorker(w, r, issue)
	if !ok {
		return
	}
	var req UploadIssueDeliverableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	links := normalizeDeliverablePRURLs(req.PullRequestURLs)
	if len(req.Files) == 0 && len(links) == 0 {
		writeError(w, http.StatusBadRequest, "files or pull_request_urls are required")
		return
	}
	if req.DeliverableID != "" {
		if _, ok := parseUUIDOrBadRequest(w, req.DeliverableID, "deliverable_id"); !ok {
			return
		}
	}
	// Gitea is only required when archiving files; PR-link-only submissions do not touch it.
	if len(req.Files) > 0 && !isGiteaConfigured() {
		writeError(w, http.StatusServiceUnavailable, "deliverable upload requires Gitea to be configured")
		return
	}
	if err := h.WorkflowService.UploadMemberDeliverableAll(r.Context(), issue, req.Files, links, req.DeliverableID, userID, req.Summary); err != nil {
		if errors.Is(err, service.ErrNodeRunNotInWorkerPhase) {
			writeError(w, http.StatusConflict, "node run is no longer accepting deliverable uploads")
			return
		}
		slog.Warn("member deliverable upload failed", "issue_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to upload deliverable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// UploadIssueDeliverablePRRequest is the body of POST /api/issues/{id}/deliverables/upload-pr.
type UploadIssueDeliverablePRRequest struct {
	// PullRequestURL is the single-link form, kept for older clients.
	PullRequestURL string `json:"pull_request_url"`
	// PullRequestURLs submits one or more code links in a single call. Each
	// link lands on its own submission row of the pull_request deliverable.
	PullRequestURLs []string `json:"pull_request_urls"`
	// DeliverableID optionally targets a specific pull_request deliverable
	// when the node defines several; empty uploads to the first one.
	DeliverableID string `json:"deliverable_id,omitempty"`
	// Summary is an optional execution note merged into the worker output when
	// this upload advances the node-run into review.
	Summary string `json:"summary"`
}

// normalizedPRURLs merges the single-link and multi-link fields, trimming
// blanks and dropping exact duplicates (order-preserving).
func (r UploadIssueDeliverablePRRequest) normalizedPRURLs() []string {
	seen := make(map[string]bool, len(r.PullRequestURLs)+1)
	out := make([]string, 0, len(r.PullRequestURLs)+1)
	for _, raw := range append([]string{r.PullRequestURL}, r.PullRequestURLs...) {
		link := strings.TrimSpace(raw)
		if link == "" || seen[link] {
			continue
		}
		seen[link] = true
		out = append(out, link)
	}
	return out
}

// UploadIssueDeliverablePR (POST /api/issues/{id}/deliverables/upload-pr) lets
// a member submit code deliverables for a member-assigned issue by pasting the
// pull/merge-request URLs they opened elsewhere. The server archives each link
// and records it on the pull_request-kind deliverable's submissions so the
// node can enter review — the manual counterpart to the agent's report-pr
// path. Issue without a workflow run → 409; node run already past the worker
// phase → 409; caller is not the node run's human worker (and not an
// owner/admin overriding) → 403.
func (h *Handler) UploadIssueDeliverablePR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	userID, ok := h.requireDeliverableUploadWorker(w, r, issue)
	if !ok {
		return
	}
	var req UploadIssueDeliverablePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	links := req.normalizedPRURLs()
	if len(links) == 0 {
		writeError(w, http.StatusBadRequest, "pull_request_urls is required")
		return
	}
	if req.DeliverableID != "" {
		if _, ok := parseUUIDOrBadRequest(w, req.DeliverableID, "deliverable_id"); !ok {
			return
		}
	}
	if err := h.WorkflowService.UploadMemberDeliverablePR(r.Context(), issue, links, req.DeliverableID, userID, req.Summary); err != nil {
		if errors.Is(err, service.ErrNodeRunNotInWorkerPhase) {
			writeError(w, http.StatusConflict, "node run is no longer accepting deliverable uploads")
			return
		}
		slog.Warn("member deliverable PR upload failed", "issue_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to upload deliverable PR")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// requireDeliverableUploadWorker gates a member deliverable upload on the
// caller being allowed to act as the node run's human worker, mirroring the
// frontend's getHumanNodeRunActionAccess: uploads go to the designated worker,
// to any active member when no worker is designated, or to an owner/admin
// overriding. (The worker-phase status half of the frontend gate is enforced
// by the service's pre-upload guard.) Returns the caller's user ID on success.
func (h *Handler) requireDeliverableUploadWorker(w http.ResponseWriter, r *http.Request, issue db.MulticaIssue) (string, bool) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return "", false
	}
	if !issue.WorkflowRunID.Valid {
		writeError(w, http.StatusConflict, "issue is not routed to a deliverable workflow")
		return "", false
	}
	member, err := h.getActiveWorkspaceMember(r.Context(), userID, util.UUIDToString(issue.WorkspaceID))
	if err != nil {
		writeError(w, http.StatusForbidden, "workspace membership required")
		return "", false
	}
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(r.Context(), issue.WorkflowRunID)
	if err != nil || len(nodeRuns) == 0 {
		writeError(w, http.StatusConflict, "issue workflow run has no node runs")
		return "", false
	}
	isAdmin := member.Role == "owner" || member.Role == "admin"
	if !deliverableUploadWorkerAllowed(nodeRuns[0], userID, util.UUIDToString(member.ID), isAdmin) {
		writeError(w, http.StatusForbidden, "only the node run's assigned worker can submit deliverables")
		return "", false
	}
	return userID, true
}

// deliverableUploadWorkerAllowed is the pure half of the worker gate (kept
// separate for unit tests): a human-worked node run accepts uploads from its
// designated worker, from anyone while undesignated, or from an
// owner/admin override. Agent/squad-worked runs take no member uploads.
func deliverableUploadWorkerAllowed(nodeRun db.MulticaWorkflowNodeRun, userID, memberID string, isAdmin bool) bool {
	if nodeRun.WorkerType != "human" {
		return false
	}
	if !nodeRun.WorkerID.Valid || isAdmin {
		return true
	}
	workerID := util.UUIDToString(nodeRun.WorkerID)
	// Human assignments normally store member_id, while role resolution may
	// write user_id. Accept both representations at this API boundary.
	return workerID == memberID || workerID == userID
}

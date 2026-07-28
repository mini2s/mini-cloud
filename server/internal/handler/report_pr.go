package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ReportDeliverablePRRequest is the body posted by the cs-workflow CLI (M3) after
// it opens a Gitea PR for a document deliverable.
type ReportDeliverablePRRequest struct {
	PullRequestURL string `json:"pull_request_url"`
}

// HandleReportDeliverablePR (POST /api/daemon/node-runs/{nodeRunId}/deliverables/{deliverableId}/report-pr)
// records the opened Gitea PR URL on the deliverable submission and flips its
// status to submitted. Daemon-authed (the route is mounted under /api/daemon).
func (h *Handler) HandleReportDeliverablePR(w http.ResponseWriter, r *http.Request) {
	nodeRunID := chi.URLParam(r, "nodeRunId")
	nrUUID, ok := parseUUIDOrBadRequest(w, nodeRunID, "node_run_id")
	if !ok {
		return
	}
	deliverableID := chi.URLParam(r, "deliverableId")
	dUUID, ok := parseUUIDOrBadRequest(w, deliverableID, "deliverable_id")
	if !ok {
		return
	}

	var req ReportDeliverablePRRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PullRequestURL == "" {
		writeError(w, http.StatusBadRequest, "pull_request_url is required")
		return
	}

	// Verify the node run exists and the daemon owns its workspace. Mirrors
	// BindNodeRunSession: the daemon token binds the caller to a single
	// workspace, and the node run's run must live in that same workspace,
	// otherwise a daemon could upsert submissions onto another workspace's
	// deliverable by guessing UUIDs.
	nodeRun, err := h.Queries.GetWorkflowNodeRun(r.Context(), nrUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nodeRun.WorkflowRunID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	if !h.requireDaemonWorkspaceAccess(w, r, uuidToString(run.WorkspaceID)) {
		return
	}
	_, err = h.Queries.GetNodeRunDeliverableRequirementForSubmission(r.Context(), db.GetNodeRunDeliverableRequirementForSubmissionParams{
		ID: dUUID, WorkflowNodeRunID: nodeRun.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "deliverable not found")
		return
	}

	sub, err := h.Queries.UpsertNodeRunDeliverableSubmission(r.Context(), db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nrUUID,
		DeliverableID:     dUUID,
		SubmittedByType:   "agent",
		Content:           "",
		PullRequestUrl:    req.PullRequestURL,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record deliverable PR")
		return
	}
	writeJSON(w, http.StatusOK, workflowNodeDeliverableSubmissionToResponse(sub))
}

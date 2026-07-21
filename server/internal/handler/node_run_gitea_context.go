package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// HandleGetNodeRunGiteaContext (GET /api/daemon/node-runs/{nodeRunId}/gitea-context)
// returns the Gitea deliverable context (owner/repo/clone_url/inst-branch +
// per-deliverable paths) for an arbitrary node-run. This lets an agent
// (cs-cloud) clone the run's inst branch and read that node's document
// deliverables — including nodes other than its own task's, which is required
// for "fetch any node's deliverables" in the new cs-cloud CLI.
//
// Daemon-authed and workspace-scoped: the daemon token binds the caller to one
// workspace, and the node-run's run must live in that workspace (same guard as
// HandleReportDeliverablePR). 404 when Gitea is dormant, the node-run doesn't
// exist, or the node has no document deliverables.
func (h *Handler) HandleGetNodeRunGiteaContext(w http.ResponseWriter, r *http.Request) {
	nrUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "nodeRunId"), "node_run_id")
	if !ok {
		return
	}
	nr, err := h.Queries.GetWorkflowNodeRun(r.Context(), nrUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	run, err := h.Queries.GetWorkflowRun(r.Context(), nr.WorkflowRunID)
	if err != nil {
		writeError(w, http.StatusNotFound, "node run not found")
		return
	}
	if !h.requireDaemonWorkspaceAccess(w, r, uuidToString(run.WorkspaceID)) {
		return
	}
	gctx := h.giteaContextForNodeRun(r.Context(), nrUUID)
	if gctx == nil {
		writeError(w, http.StatusNotFound, "no gitea deliverable context for this node run")
		return
	}
	writeJSON(w, http.StatusOK, gctx)
}

package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// IssueWorkflowTreeResponse is returned by GET
// /api/daemon/issues/{issue}/workflow-tree?descendants=true. It lists the
// issue (and optionally its descendants) with each one's workflow run + node
// run status tree, so an agent (cs-cloud) can read any issue's — or a whole
// sub-tree's — workflow progress by issue, never by node-run-id.
type IssueWorkflowTreeResponse struct {
	Issues []IssueWorkflowTreeNode `json:"issues"`
}

type IssueWorkflowTreeNode struct {
	IssueID     string              `json:"issue_id"`
	Number      int32               `json:"number"`
	Title       string              `json:"title"`
	Depth       int                 `json:"depth"`
	Status      string              `json:"status"`
	WorkflowRun *WorkflowRunSummary `json:"workflow_run"`
}

type WorkflowRunSummary struct {
	ID       string           `json:"id"`
	Status   string           `json:"status"`
	NodeRuns []NodeRunSummary `json:"node_runs"`
}

type NodeRunSummary struct {
	NodeID        string                  `json:"node_id"`
	Title         string                  `json:"title"`
	Status        string                  `json:"status"`
	RetryCount    int32                   `json:"retry_count"`
	WorkerID      string                  `json:"worker_id"`
	CriticID      string                  `json:"critic_id"`
	FailureReason string                  `json:"failure_reason"`
	Deliverables  []NodeDeliverableStatus `json:"deliverables"`
}

type NodeDeliverableStatus struct {
	DeliverableID    string `json:"deliverable_id"`
	Title            string `json:"title"`
	SubmissionStatus string `json:"submission_status"` // "" when not yet submitted
}

// HandleGetIssueWorkflowTree (GET /api/daemon/issues/{issue}/workflow-tree?descendants=true)
// resolves an issue by UUID or <PREFIX>-<number> within the daemon's workspace
// and returns its workflow run + node run status tree — and, with
// ?descendants=true, the same for every descendant issue (children,
// grandchildren, ...). This is the agent-facing read path: the agent asks by
// issue, the server resolves issue → workflow run → node runs → deliverable
// submission status. Daemon-authed; workspace is the daemon token's bound
// workspace (queries are workspace-scoped).
func (h *Handler) HandleGetIssueWorkflowTree(w http.ResponseWriter, r *http.Request) {
	workspaceIDStr := middleware.DaemonWorkspaceIDFromContext(r.Context())
	if workspaceIDStr == "" {
		workspaceIDStr = r.Header.Get("X-Workspace-ID")
	}
	if !h.requireDaemonWorkspaceAccess(w, r, workspaceIDStr) {
		return
	}
	workspaceID, err := util.ParseUUID(workspaceIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "daemon workspace not resolved")
		return
	}
	root, err := h.resolveIssueInWorkspace(r.Context(), workspaceID, chi.URLParam(r, "issue"))
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found: "+err.Error())
		return
	}

	// Targets: the requested issue (depth 0) + optionally all descendants.
	type target struct {
		id    pgtype.UUID
		depth int
	}
	targets := []target{{root.ID, 0}}
	if r.URL.Query().Get("descendants") == "true" || r.URL.Query().Get("descendants") == "1" {
		desc, err := h.Queries.ListIssueDescendants(r.Context(), db.ListIssueDescendantsParams{
			ParentIssueID: root.ID,
			WorkspaceID:   workspaceID,
		})
		if err == nil {
			for _, d := range desc {
				targets = append(targets, target{d.ID, int(d.Depth) + 1})
			}
		}
	}

	out := make([]IssueWorkflowTreeNode, 0, len(targets))
	for _, t := range targets {
		iss, err := h.Queries.GetIssue(r.Context(), t.id)
		if err != nil {
			continue
		}
		entry := IssueWorkflowTreeNode{
			IssueID: util.UUIDToString(iss.ID),
			Number:  iss.Number,
			Title:   iss.Title,
			Depth:   t.depth,
			Status:  iss.Status,
		}
		if iss.WorkflowRunID.Valid {
			entry.WorkflowRun = h.workflowRunSummary(r.Context(), iss.WorkflowRunID)
		}
		// When descending, skip child issues that never got a workflow run so
		// the agent only sees nodes with real progress. The single-issue case
		// is always included (even with a nil WorkflowRun) so the caller can
		// distinguish "no run yet" from "not found".
		if !iss.WorkflowRunID.Valid && len(targets) > 1 {
			continue
		}
		out = append(out, entry)
	}

	writeJSON(w, http.StatusOK, IssueWorkflowTreeResponse{Issues: out})
}

// workflowRunSummary loads a workflow run and its node runs (with each node's
// deliverable submission status) for the tree response. Returns nil if the run
// can't be loaded.
func (h *Handler) workflowRunSummary(ctx context.Context, runID pgtype.UUID) *WorkflowRunSummary {
	run, err := h.Queries.GetWorkflowRun(ctx, runID)
	if err != nil {
		return nil
	}
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		nodeRuns = nil
	}
	summaries := make([]NodeRunSummary, 0, len(nodeRuns))
	for _, nr := range nodeRuns {
		// Map deliverable_id -> latest submission status for this node run.
		subs, _ := h.Queries.ListNodeRunDeliverableSubmissions(ctx, nr.ID)
		subByDeliv := make(map[string]string, len(subs))
		for _, s := range subs {
			subByDeliv[util.UUIDToString(s.DeliverableID)] = s.Status
		}
		// Deliverable definitions defined on this node; each carries its
		// submission status ("" when not yet submitted).
		defs, _ := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
		dels := make([]NodeDeliverableStatus, 0, len(defs))
		for _, d := range defs {
			dels = append(dels, NodeDeliverableStatus{
				DeliverableID:    util.UUIDToString(d.ID),
				Title:            d.Title,
				SubmissionStatus: subByDeliv[util.UUIDToString(d.ID)],
			})
		}
		summaries = append(summaries, NodeRunSummary{
			NodeID:        util.UUIDToString(nr.ID),
			Title:         nr.NodeTitle,
			Status:        nr.Status,
			RetryCount:    nr.RetryCount,
			WorkerID:      util.UUIDToString(nr.WorkerID),
			CriticID:      util.UUIDToString(nr.CriticID),
			FailureReason: pgText(nr.FailureReason),
			Deliverables:  dels,
		})
	}
	return &WorkflowRunSummary{
		ID:       util.UUIDToString(run.ID),
		Status:   run.Status,
		NodeRuns: summaries,
	}
}

// pgText unwraps a pgtype.Text to its string value ("" when NULL/invalid).
func pgText(v pgtype.Text) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

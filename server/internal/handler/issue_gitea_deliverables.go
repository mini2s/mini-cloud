package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// IssueGiteaDeliverablesResponse is returned by GET
// /api/daemon/issues/{issue}/gitea-deliverables?descendants=true. It lists the
// issue (and optionally its descendants) with each one's Gitea deliverable
// context, so an agent (cs-cloud) can fetch any issue's — or a whole sub-tree's
// — workflow deliverables by issue, never by node-run-id.
type IssueGiteaDeliverablesResponse struct {
	Issues []IssueGiteaDeliverable `json:"issues"`
}

type IssueGiteaDeliverable struct {
	IssueID string             `json:"issue_id"` // UUID
	Number  int32              `json:"number"`   // human-facing issue number (e.g. 123 in MUL-123)
	Title   string             `json:"title"`
	Depth   int                `json:"depth"` // 0 = the requested issue, 1 = child, 2 = grandchild, ...
	Gitea   *IssueGiteaContext `json:"gitea,omitempty"`
}

// IssueGiteaContext is a run's Gitea topology + every document deliverable
// across its nodes (the inst branch carries them as nodes/<nr>/<deliv>.md).
type IssueGiteaContext struct {
	Owner        string                     `json:"owner"`
	Repo         string                     `json:"repo"`
	CloneURL     string                     `json:"clone_url"`
	InstBranch   string                     `json:"inst_branch"`
	Deliverables []IssueGiteaDeliverableRef `json:"deliverables"`
}

type IssueGiteaDeliverableRef struct {
	NodeTitle     string `json:"node_title"`
	DeliverableID string `json:"deliverable_id"`
	Title         string `json:"title"`
	Path          string `json:"path"`
}

// HandleGetIssueGiteaDeliverables (GET /api/daemon/issues/{issue}/gitea-deliverables?descendants=true)
// resolves an issue by UUID or <PREFIX>-<number> within the daemon's workspace
// and returns its workflow deliverable context — and, with ?descendants=true,
// the same for every descendant issue (children, grandchildren, ...). This is
// the agent-facing read path: the agent asks by issue, the server resolves
// issue → workflow run → Gitea topology. Daemon-authed; workspace is the
// daemon token's bound workspace (queries are workspace-scoped).
func (h *Handler) HandleGetIssueGiteaDeliverables(w http.ResponseWriter, r *http.Request) {
	workspaceIDStr := middleware.DaemonWorkspaceIDFromContext(r.Context())
	workspaceID, err := util.ParseUUID(workspaceIDStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "daemon workspace not resolved")
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

	out := make([]IssueGiteaDeliverable, 0, len(targets))
	for _, t := range targets {
		iss, err := h.Queries.GetIssue(r.Context(), t.id)
		if err != nil {
			continue
		}
		entry := IssueGiteaDeliverable{
			IssueID: util.UUIDToString(iss.ID),
			Number:  iss.Number,
			Title:   iss.Title,
			Depth:   t.depth,
		}
		if iss.WorkflowRunID.Valid {
			if gctx := h.giteaContextForRun(r.Context(), iss.WorkflowRunID); gctx != nil {
				entry.Gitea = gctx
			}
		}
		// Include issues even without a Gitea context when descending, so the
		// agent can see the sub-tree shape; omit bare-issue noise for the
		// single-issue (non-descendants) case when there's nothing to read.
		if !iss.WorkflowRunID.Valid && len(targets) > 1 {
			continue // skip child issues that never got a workflow run
		}
		out = append(out, entry)
	}

	writeJSON(w, http.StatusOK, IssueGiteaDeliverablesResponse{Issues: out})
}

// resolveIssueInWorkspace resolves a UUID or "<PREFIX>-<number>" (e.g. MUL-123)
// to the issue, scoped to workspaceID.
func (h *Handler) resolveIssueInWorkspace(ctx context.Context, workspaceID pgtype.UUID, ident string) (db.MulticaIssue, error) {
	ident = strings.TrimSpace(ident)
	if u, err := util.ParseUUID(ident); err == nil {
		iss, err := h.Queries.GetIssue(ctx, u)
		if err != nil {
			return db.MulticaIssue{}, err
		}
		if util.UUIDToString(iss.WorkspaceID) != util.UUIDToString(workspaceID) {
			return db.MulticaIssue{}, fmt.Errorf("issue not in workspace")
		}
		return iss, nil
	}
	if m := identifierNumberRe.FindStringSubmatch(ident); m != nil {
		num, err := strconv.Atoi(m[1])
		if err != nil {
			return db.MulticaIssue{}, fmt.Errorf("invalid issue number: %s", m[1])
		}
		return h.Queries.GetIssueByNumber(ctx, db.GetIssueByNumberParams{
			WorkspaceID: workspaceID,
			Number:      int32(num),
		})
	}
	return db.MulticaIssue{}, fmt.Errorf("issue must be a UUID or <PREFIX>-<number>")
}

// giteaContextForRun builds the Gitea context for a workflow run: topology
// (owner/repo/clone_url/inst_branch) + every document deliverable across the
// run's node-runs. Returns nil if Gitea is dormant, the run can't load, or it
// has no document deliverables.
func (h *Handler) giteaContextForRun(ctx context.Context, runID pgtype.UUID) *IssueGiteaContext {
	if !isGiteaConfigured() || !runID.Valid {
		return nil
	}
	run, err := h.Queries.GetWorkflowRun(ctx, runID)
	if err != nil {
		return nil
	}
	nodeRuns, err := h.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return nil
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := gitea.RepoName(util.UUIDToString(run.WorkflowID))
	gctx := &IssueGiteaContext{
		Owner:      owner,
		Repo:       repo,
		CloneURL:   strings.TrimRight(giteaPublicBaseURL(), "/") + "/" + owner + "/" + repo + ".git",
		InstBranch: gitea.InstBranch(util.UUIDToString(run.ID)),
	}
	for _, nr := range nodeRuns {
		deliverables, err := h.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
		if err != nil {
			continue
		}
		nrShort := util.UUIDToString(nr.ID)
		for _, d := range deliverables {
			if d.Kind != "document" {
				continue
			}
			gctx.Deliverables = append(gctx.Deliverables, IssueGiteaDeliverableRef{
				NodeTitle:     nr.NodeTitle,
				DeliverableID: util.UUIDToString(d.ID),
				Title:         d.Title,
				Path:          gitea.DeliverablePath(nrShort, util.UUIDToString(d.ID)),
			})
		}
	}
	if len(gctx.Deliverables) == 0 {
		return nil
	}
	return gctx
}

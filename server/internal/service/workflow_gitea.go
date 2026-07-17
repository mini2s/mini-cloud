package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// hasDocumentDeliverable reports whether the workflow has any document-type
// deliverable. Scaffolding only runs for document-bearing workflows;
// code-only workflows (no document deliverable) never touch Gitea.
func (s *WorkflowService) hasDocumentDeliverable(ctx context.Context, workflowID pgtype.UUID) (bool, error) {
	nodes, err := s.Queries.ListWorkflowNodes(ctx, workflowID)
	if err != nil {
		return false, fmt.Errorf("list nodes: %w", err)
	}
	for _, n := range nodes {
		deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, n.ID)
		if err != nil {
			return false, fmt.Errorf("list deliverables: %w", err)
		}
		for _, d := range deliverables {
			if d.Kind == "document" {
				return true, nil
			}
		}
	}
	return false, nil
}

// ScaffoldRunDeliverables scaffolds the run's deliverable org/repo/inst branch
// and (once per workspace) provisions the Gitea bot. Idempotent + retry-safe.
// Called after StartRun commits, ONLY when the workflow has a document
// deliverable AND Gitea is configured. Persistent failure transitions the run
// to failed (design §4.1: Gitea is a hard dependency for document workflows).
//
// ORDERING: scaffold FIRST (creates the org), then provision (the bot is added
// to the now-existing org). Reversing this leaves the bot with a PAT but no org
// membership — the daemon's first clone/push of a private repo would 403.
//
// Dormancy: when s.Gitea is nil (test that bypassed the router) or
// !s.Gitea.Configured() (GITEA_BASE_URL/GITEA_ADMIN_TOKEN unset at startup),
// this returns immediately without touching the DB or network.
func (s *WorkflowService) ScaffoldRunDeliverables(ctx context.Context, run db.MulticaWorkflowRun) {
	// Best-effort + fire-and-forget (called from a goroutine in StartWorkflowRun):
	// recover from any panic so a bug here cannot crash the server process. The
	// function crosses two external boundaries (DB + Gitea HTTP) and the gitea
	// package has panic-on-non-UUID paths (shortHex), so this guard is
	// load-bearing — a panic here would otherwise take down the whole server.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ScaffoldRunDeliverables",
				"run_id", util.UUIDToString(run.ID), "panic", r)
		}
	}()

	if s.Gitea == nil || !s.Gitea.Configured() {
		return // feature dormant
	}
	runIDStr := util.UUIDToString(run.ID)

	// NOTE: if the workflow lookup or the document-deliverable check fails (e.g.
	// a transient DB error), we return WITHOUT scaffolding and WITHOUT failing
	// the run. The run continues "running" with no Gitea repo, so the daemon's
	// first clone/push will 404 later. Intentional — we can't decide whether to
	// fail the run if we can't read the workflow — but it means a DB blip here
	// surfaces as a later clone failure, not a run failure.
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("gitea scaffold: get workflow", "run_id", runIDStr, "error", err)
		return
	}
	has, err := s.hasDocumentDeliverable(ctx, workflow.ID)
	if err != nil {
		slog.Warn("gitea scaffold: check deliverables", "run_id", runIDStr, "error", err)
		return
	}
	if !has {
		return // code-only workflow — no Gitea repo needed
	}

	// 1. Scaffold org/repo/inst (creates the org).
	if _, err := gitea.ScaffoldRunDeliverable(ctx, s.Gitea, gitea.ScaffoldParams{
		WorkspaceID:   util.UUIDToString(run.WorkspaceID),
		WorkflowID:    util.UUIDToString(workflow.ID),
		RunID:         runIDStr,
		WorkflowTitle: workflow.Title,
		// DefinitionSnapshot left empty for M2 (DB is source of truth).
	}); err != nil {
		slog.Error("gitea scaffold failed", "run_id", runIDStr, "error", err)
		s.failRun(ctx, run)
		return
	}

	// 2. Provision the workspace bot once — adds to the org that scaffold
	//    just created. Must run AFTER scaffold for the bot to gain membership.
	if err := s.provisionWorkspaceBotIfAbsent(ctx, run.WorkspaceID); err != nil {
		slog.Error("gitea provision bot failed",
			"workspace_id", util.UUIDToString(run.WorkspaceID), "error", err)
		s.failRun(ctx, run)
		return
	}
}

// provisionWorkspaceBotIfAbsent creates the workspace Gitea bot + PAT and
// persists them into workspace.settings — only if no gitea_pat is stored yet
// (lazy + once-per-workspace). Re-provisioning is intentionally NOT done here:
// re-runs reuse the stored PAT even if the bot user was somehow deleted from
// Gitea (a future task can add a re-provision + revoke flow if needed).
func (s *WorkflowService) provisionWorkspaceBotIfAbsent(ctx context.Context, workspaceID pgtype.UUID) error {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}
	settingsMap := map[string]any{}
	if len(ws.Settings) > 0 {
		if err := json.Unmarshal(ws.Settings, &settingsMap); err != nil {
			return fmt.Errorf("parse settings: %w", err)
		}
	}
	if pat, ok := settingsMap["gitea_pat"].(string); ok && pat != "" {
		return nil // already provisioned — do NOT re-mint
	}

	username, token, err := gitea.ProvisionWorkspaceBot(ctx, s.Gitea, gitea.BotParams{
		WorkspaceID: util.UUIDToString(workspaceID),
	})
	if err != nil {
		return fmt.Errorf("provision bot: %w", err)
	}
	settingsMap["gitea_bot_username"] = username
	settingsMap["gitea_pat"] = token

	raw, err := json.Marshal(settingsMap)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	if _, err := s.Queries.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{
		ID:       workspaceID,
		Settings: raw,
	}); err != nil {
		return fmt.Errorf("persist bot settings: %w", err)
	}
	return nil
}

// failRun transitions a running run to failed when a hard Gitea dependency
// can't be satisfied at run start. Best-effort: a status-update error is
// logged but does not mask the original scaffold/provision failure.
func (s *WorkflowService) failRun(ctx context.Context, run db.MulticaWorkflowRun) {
	if _, err := s.Queries.UpdateWorkflowRunStatus(ctx, db.UpdateWorkflowRunStatusParams{
		ID:     run.ID,
		Status: RunStatusFailed,
	}); err != nil {
		slog.Error("gitea: mark run failed after scaffold/provision failure",
			"run_id", util.UUIDToString(run.ID), "error", err)
	}
}

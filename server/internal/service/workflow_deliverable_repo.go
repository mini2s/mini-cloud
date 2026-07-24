package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/teamnamespace"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (s *WorkflowService) deliverableRepository() coderepo.RepositoryProvider {
	if s.RepositoryProvider != nil {
		return s.RepositoryProvider
	}
	return coderepo.GiteaAdapter{Client: s.Gitea}
}

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

func DeliverableRepoNameForWorkflow(workflow db.MulticaWorkflow) string {
	if workflow.IsDefault {
		// The archive repo is provisioned (by the team-namespace service and the
		// local mock) as gitea.RepoName of the archive slug — i.e. with the same
		// "wf-" prefix every workflow repo gets under WORKFLOW_REPO_PATH_ALGORITHM
		// v2. Returning the bare slug here caused the upload/clone paths to target
		// a non-existent "deliverable-archive" repo while the real repo lived at
		// "wf-deliverable-archive" (404 on member deliverable upload).
		return gitea.RepoName(gitea.DefaultArchiveRepoName())
	}
	return gitea.RepoName(util.UUIDToString(workflow.ID))
}

func deliverableScaffoldParams(run db.MulticaWorkflowRun, workflow db.MulticaWorkflow) gitea.ScaffoldParams {
	return gitea.ScaffoldParams{
		WorkspaceID:   util.UUIDToString(run.WorkspaceID),
		WorkflowID:    util.UUIDToString(workflow.ID),
		RepoName:      DeliverableRepoNameForWorkflow(workflow),
		RunID:         util.UUIDToString(run.ID),
		WorkflowTitle: workflow.Title,
		// DefinitionSnapshot left empty for M2 (DB is source of truth).
	}
}

func (s *WorkflowService) teamNamespaceConfigured() bool {
	return s.TeamNamespace != nil && s.TeamNamespace.Configured()
}

func userRefFromMember(m db.ListMembersWithUserRow) teamnamespace.UserRef {
	// Prefer the costrict universal_id (resolvable by @server via cs-user —
	// and by the local mock via dept). Fall back to the multica user_id only for
	// members without a dept identity (the mock can't resolve a bare user_id).
	if m.ExternalUniversalID.Valid && strings.TrimSpace(m.ExternalUniversalID.String) != "" {
		return teamnamespace.UserRef{UniversalID: strings.TrimSpace(m.ExternalUniversalID.String)}
	}
	if m.UserID.Valid {
		return teamnamespace.UserRef{UserID: util.UUIDToString(m.UserID)}
	}
	return teamnamespace.UserRef{}
}

func (s *WorkflowService) workspaceMemberRefs(ctx context.Context, workspaceID pgtype.UUID) ([]teamnamespace.UserRef, teamnamespace.UserRef, error) {
	members, err := s.Queries.ListMembersWithUser(ctx, workspaceID)
	if err != nil {
		return nil, teamnamespace.UserRef{}, err
	}
	refs := make([]teamnamespace.UserRef, 0, len(members))
	var creator teamnamespace.UserRef
	for _, m := range members {
		ref := userRefFromMember(m)
		if ref.UserID == "" && ref.UniversalID == "" {
			continue
		}
		refs = append(refs, ref)
		if creator.UserID == "" && creator.UniversalID == "" && m.Role == "owner" {
			creator = ref
		}
	}
	if creator.UserID == "" && creator.UniversalID == "" && len(refs) > 0 {
		creator = refs[0]
	}
	return refs, creator, nil
}

func (s *WorkflowService) persistTeamNamespaceSettings(ctx context.Context, workspaceID pgtype.UUID, patch map[string]any) error {
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
	for k, v := range patch {
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		settingsMap[k] = v
	}
	raw, err := json.Marshal(settingsMap)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	if _, err := s.Queries.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{
		ID:       workspaceID,
		Settings: raw,
	}); err != nil {
		return fmt.Errorf("persist settings: %w", err)
	}
	return nil
}

func (s *WorkflowService) ensureTeamNamespace(ctx context.Context, workspaceID pgtype.UUID) error {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}
	refs, creator, err := s.workspaceMemberRefs(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("list workspace members: %w", err)
	}
	if creator.UserID == "" && creator.UniversalID == "" {
		return fmt.Errorf("workspace has no syncable creator")
	}
	resp, err := s.TeamNamespace.CreateTeam(ctx, teamnamespace.CreateTeamRequest{
		TeamID:          util.UUIDToString(workspaceID),
		TeamDisplayName: ws.Name,
		Creator:         creator,
		InitialMembers:  refs,
	})
	if err != nil {
		return fmt.Errorf("create team namespace: %w", err)
	}
	patch := map[string]any{
		"team_ns_org":        resp.TeamNSOrg,
		"gitea_base_url":     resp.GiteaBaseURL,
		"gitea_bot_username": resp.Bot.GiteaUsername,
	}
	if resp.Bot.Token != "" {
		patch["gitea_pat"] = resp.Bot.Token
	}
	if resp.Bot.TokenSHA256 != "" {
		patch["gitea_pat_sha256"] = resp.Bot.TokenSHA256
	}
	return s.persistTeamNamespaceSettings(ctx, workspaceID, patch)
}

func (s *WorkflowService) initWorkflowNamespace(ctx context.Context, run db.MulticaWorkflowRun, workflow db.MulticaWorkflow) error {
	if err := s.ensureTeamNamespace(ctx, run.WorkspaceID); err != nil {
		return err
	}
	defSlug := shortHexSafe(util.UUIDToString(workflow.ID))
	if workflow.IsDefault {
		defSlug = gitea.DefaultArchiveRepoName()
	}
	resp, err := s.TeamNamespace.InitWorkflow(ctx, teamnamespace.WorkflowInitRequest{
		WorkflowDefSlug: defSlug,
		InstanceID:      util.UUIDToString(run.ID),
		TeamID:          util.UUIDToString(run.WorkspaceID),
	})
	if err != nil {
		return fmt.Errorf("init workflow namespace: %w", err)
	}
	patch := map[string]any{
		"last_wf_repo_path":     resp.WFRepoPath,
		"last_instance_branch":  resp.InstanceBranch,
		"gitea_bot_username":    resp.BotCredentials.GiteaUsername,
		"gitea_clone_url":       resp.WFCloneURL,
		"gitea_web_url":         resp.WFWebURL,
		"gitea_algorithm_ver":   resp.AlgorithmVersion,
		"gitea_team_ns_exists":  resp.TeamNSExists,
		"gitea_clone_url_token": resp.BotCredentials.CloneURLWithToken,
	}
	if resp.BotCredentials.Token != "" {
		patch["gitea_pat"] = resp.BotCredentials.Token
	}
	return s.persistTeamNamespaceSettings(ctx, run.WorkspaceID, patch)
}

// initDefaultArchiveRepo provisions the workspace's default deliverable-archive
// repo (wf-deliverable-archive) at workspace creation, by running the
// team-namespace InitWorkflow with the workspace's own ID as the stable
// instance. Best-effort: errors are logged and never block workspace setup.
// Idempotent — re-provisioning or a later default-workflow run finds the repo
// existing. (The archive repo is a multica orchestration concern; the mock
// stays a faithful /api/internal contract implementor.)
func (s *WorkflowService) initDefaultArchiveRepo(ctx context.Context, workspaceID pgtype.UUID) {
	wsIDStr := util.UUIDToString(workspaceID)
	resp, err := s.TeamNamespace.InitWorkflow(ctx, teamnamespace.WorkflowInitRequest{
		WorkflowDefSlug: gitea.DefaultArchiveRepoName(),
		InstanceID:      wsIDStr, // stable per-workspace instance
		TeamID:          wsIDStr,
	})
	if err != nil {
		slog.Warn("provision default archive repo", "workspace_id", wsIDStr, "error", err)
		return
	}
	slog.Info("provisioned default archive repo",
		"workspace_id", wsIDStr, "repo", resp.WFRepoPath, "branch", resp.InstanceBranch)
}

func (s *WorkflowService) UpdateTeamNamespace(ctx context.Context, workspaceID pgtype.UUID, name, description string) {
	if !s.teamNamespaceConfigured() {
		return
	}
	if err := s.TeamNamespace.UpdateTeam(ctx, util.UUIDToString(workspaceID), teamnamespace.UpdateTeamRequest{
		TeamDisplayName: strings.TrimSpace(name),
		Description:     description,
	}); err != nil {
		slog.Warn("team namespace update failed",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
	}
}

func (s *WorkflowService) DissolveTeamNamespace(ctx context.Context, workspaceID pgtype.UUID, actor teamnamespace.UserRef, reason string) {
	if !s.teamNamespaceConfigured() {
		return
	}
	if actor.UserID == "" && actor.UniversalID == "" {
		refs, creator, err := s.workspaceMemberRefs(ctx, workspaceID)
		if err == nil && (creator.UserID != "" || creator.UniversalID != "") {
			actor = creator
		} else if err == nil && len(refs) > 0 {
			actor = refs[0]
		}
	}
	if actor.UserID == "" && actor.UniversalID == "" {
		slog.Warn("team namespace dissolve skipped: no actor",
			"workspace_id", util.UUIDToString(workspaceID))
		return
	}
	if strings.TrimSpace(reason) == "" {
		reason = "workspace deleted"
	}
	if err := s.TeamNamespace.DissolveTeam(ctx, util.UUIDToString(workspaceID), teamnamespace.DissolveTeamRequest{
		Reason: reason,
		Actor:  actor,
	}); err != nil {
		slog.Warn("team namespace dissolve failed",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
	}
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

	if !s.teamNamespaceConfigured() && (s.Gitea == nil || !s.Gitea.Configured()) {
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

	if s.teamNamespaceConfigured() {
		if err := s.initWorkflowNamespace(ctx, run, workflow); err != nil {
			slog.Error("team namespace workflow init failed", "run_id", runIDStr, "error", err)
			s.failRun(ctx, run)
			return
		}
		s.syncWorkspaceMembers(ctx, run.WorkspaceID)
		return
	}

	// 1. Scaffold org/repo/inst (creates the org).
	if _, err := gitea.ScaffoldRunDeliverable(ctx, s.Gitea, deliverableScaffoldParams(run, workflow)); err != nil {
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

	// 3. Sync workspace members into the org (TEAM_NAMESPACE_API §1.1: org
	//    members = team members) so they can read/PR-review the org's repos.
	//    Best-effort + count-gated: never blocks the run, only re-provisions
	//    when the member count changes since the last sync.
	s.syncWorkspaceMembers(ctx, run.WorkspaceID)
}

// ensureNodeRunBranch creates the node-run branch when a node enters execution.
func (s *WorkflowService) ensureNodeRunBranch(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	repoProvider := s.deliverableRepository()
	if !s.teamNamespaceConfigured() && !repoProvider.Configured() {
		return nil
	}

	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	hasDocument := false
	for _, d := range deliverables {
		if d.Kind == "document" {
			hasDocument = true
			break
		}
	}
	if !hasDocument {
		return nil
	}

	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}

	if s.teamNamespaceConfigured() {
		if err := s.initWorkflowNamespace(ctx, run, workflow); err != nil {
			return err
		}
		if !repoProvider.Configured() {
			return nil
		}
	} else if _, err := gitea.ScaffoldRunDeliverable(ctx, s.Gitea, deliverableScaffoldParams(run, workflow)); err != nil {
		return fmt.Errorf("scaffold run deliverable: %w", err)
	}

	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get node: %w", err)
	}
	topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("node topo order: %w", err)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(topo[util.UUIDToString(node.ID)], util.UUIDToString(nodeRun.ID))
	if err := repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
		return fmt.Errorf("create node branch: %w", err)
	}
	return nil
}

// provisionWorkspaceBotIfAbsent creates the workspace Gitea bot + PAT and
// persists them into workspace.settings — only if no gitea_pat is stored yet
// (lazy + once-per-workspace). Re-provisioning is intentionally NOT done here:
// re-runs reuse the stored PAT even if the bot user was somehow deleted from
// Gitea (a future task can add a re-provision + revoke flow if needed).
func (s *WorkflowService) provisionWorkspaceBotIfAbsent(ctx context.Context, workspaceID pgtype.UUID) error {
	if s.teamNamespaceConfigured() {
		return s.ensureTeamNamespace(ctx, workspaceID)
	}
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

// syncWorkspaceMembers ensures every workspace member is a member of the
// workspace's Gitea org (TEAM_NAMESPACE_API §1.1: org members = team members),
// so members can read the org's repos / PRs (e.g. click a deliverable PR link +
// review it). Idempotent + count-gated: it records the synced member count in
// workspace.settings and only re-provisions when the count changes, so a steady
// membership costs nothing per run. Best-effort: errors are logged per-member
// and never block the run (view access is not a hard dependency like the bot's
// push access). Adding members is the common path; removal (dissolve / leave)
// is a separate follow-up.
func (s *WorkflowService) syncWorkspaceMembers(ctx context.Context, workspaceID pgtype.UUID) {
	if s.teamNamespaceConfigured() {
		refs, _, err := s.workspaceMemberRefs(ctx, workspaceID)
		if err != nil {
			slog.Warn("team namespace sync members: list",
				"workspace_id", util.UUIDToString(workspaceID), "error", err)
			return
		}
		if _, err := s.TeamNamespace.SyncMembers(ctx, util.UUIDToString(workspaceID), teamnamespace.SyncMembersRequest{
			Mode:       "full_sync",
			AddMembers: refs,
		}); err != nil {
			slog.Warn("team namespace sync members",
				"workspace_id", util.UUIDToString(workspaceID), "error", err)
		}
		return
	}

	members, err := s.Queries.ListMembersWithUser(ctx, workspaceID)
	if err != nil {
		slog.Warn("gitea sync members: list",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
		return
	}

	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		slog.Warn("gitea sync members: get workspace",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
		return
	}
	settingsMap := map[string]any{}
	if len(ws.Settings) > 0 {
		_ = json.Unmarshal(ws.Settings, &settingsMap) // best-effort
	}
	// count gate: skip when membership hasn't changed since the last sync.
	if n, _ := settingsMap["gitea_member_count_synced"].(float64); int(n) == len(members) && len(members) > 0 {
		return
	}

	wsIDStr := util.UUIDToString(workspaceID)
	wsUsernames := make(map[string]bool, len(members))
	for _, m := range members {
		if !m.UserID.Valid {
			continue
		}
		uname, err := gitea.ProvisionMember(ctx, s.Gitea, gitea.MemberParams{
			WorkspaceID: wsIDStr,
			UserID:      util.UUIDToString(m.UserID),
			Email:       m.UserEmail.String,
		})
		if err != nil {
			slog.Warn("gitea sync member: provision",
				"workspace_id", wsIDStr, "user_id", util.UUIDToString(m.UserID), "error", err)
		}
		if uname != "" {
			wsUsernames[uname] = true
		}
	}

	// Full-sync: remove Gitea org members who are no longer workspace members
	// (journey 2: 增删成员). Keep the bot + the Gitea admin.
	org := gitea.OrgName(wsIDStr)
	botName := gitea.BotUsername(wsIDStr)
	giteaMembers, err := s.deliverableRepository().ListOrgMembers(ctx, org)
	if err != nil {
		slog.Warn("gitea sync members: list org members", "error", err)
	} else {
		for _, gm := range giteaMembers {
			if gm.Login == botName || gm.Login == "multica-admin" {
				continue
			}
			if !wsUsernames[gm.Login] {
				if err := s.Gitea.RemoveOrgMember(ctx, org, gm.Login); err != nil {
					slog.Warn("gitea sync members: remove departed", "username", gm.Login, "error", err)
				} else {
					slog.Info("gitea sync members: removed departed member", "username", gm.Login)
				}
			}
		}
	}

	// record the synced count so the next run skips unless membership changed.
	settingsMap["gitea_member_count_synced"] = len(members)
	raw, err := json.Marshal(settingsMap)
	if err != nil {
		slog.Warn("gitea sync members: marshal settings", "error", err)
		return
	}
	if _, err := s.Queries.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{
		ID:       workspaceID,
		Settings: raw,
	}); err != nil {
		slog.Warn("gitea sync members: persist count", "error", err)
	}
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

// ProvisionWorkspaceGitea sets up the workspace's Gitea namespace on workspace
// creation: creates the team-ns org, provisions the bot (user + PAT, stored in
// workspace.settings), and syncs workspace members into the org. Best-effort +
// async (called from a goroutine): errors are logged, never block workspace
// creation. Dormant when Gitea is not configured.
func (s *WorkflowService) ProvisionWorkspaceGitea(ctx context.Context, workspaceID pgtype.UUID) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ProvisionWorkspaceGitea",
				"workspace_id", util.UUIDToString(workspaceID), "panic", r)
		}
	}()

	if !s.teamNamespaceConfigured() && (s.Gitea == nil || !s.Gitea.Configured()) {
		return
	}

	wsIDStr := util.UUIDToString(workspaceID)
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		slog.Warn("provision workspace gitea: get workspace",
			"workspace_id", wsIDStr, "error", err)
		return
	}

	if s.teamNamespaceConfigured() {
		if err := s.ensureTeamNamespace(ctx, workspaceID); err != nil {
			slog.Warn("provision workspace team namespace",
				"workspace_id", wsIDStr, "error", err)
			return
		}
		s.syncWorkspaceMembers(ctx, workspaceID)
		s.initDefaultArchiveRepo(ctx, workspaceID)
		slog.Info("provisioned workspace team namespace",
			"workspace_id", wsIDStr)
		return
	}

	// 1. Create the team-namespace org.
	if err := gitea.ScaffoldOrg(ctx, s.Gitea, wsIDStr, ws.Name); err != nil {
		slog.Warn("provision workspace gitea: scaffold org",
			"workspace_id", wsIDStr, "error", err)
		return
	}

	// 2. Create the workspace-level default deliverable archive repo.
	if err := gitea.ScaffoldWorkspaceArchiveRepo(ctx, s.Gitea, wsIDStr, ws.Name); err != nil {
		slog.Warn("provision workspace gitea: scaffold archive repo",
			"workspace_id", wsIDStr, "error", err)
		return
	}

	// 3. Provision the workspace bot (user + PAT + org membership).
	if err := s.provisionWorkspaceBotIfAbsent(ctx, workspaceID); err != nil {
		slog.Warn("provision workspace gitea: provision bot",
			"workspace_id", wsIDStr, "error", err)
		return
	}

	// 4. Sync workspace members into the org.
	s.syncWorkspaceMembers(ctx, workspaceID)

	slog.Info("provisioned workspace gitea",
		"workspace_id", wsIDStr, "org", gitea.OrgName(wsIDStr))
}

// ProvisionWorkflowRepo creates the workflow's type repo (wf-<wf[:8]>) with
// main + inst-* branch protection when the workflow is activated. Called from
// the UpdateWorkflow handler (status→active), not lazily on the first run.
// Best-effort + async.
func (s *WorkflowService) ProvisionWorkflowRepo(ctx context.Context, workflowID pgtype.UUID) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ProvisionWorkflowRepo", "workflow_id", util.UUIDToString(workflowID), "panic", r)
		}
	}()
	if s.teamNamespaceConfigured() {
		return
	}
	if s.Gitea == nil || !s.Gitea.Configured() {
		return
	}
	wf, err := s.Queries.GetWorkflow(ctx, workflowID)
	if err != nil {
		slog.Warn("provision workflow repo: get workflow", "error", err)
		return
	}
	// Only create the repo if the workflow has document deliverables (code-only
	// workflows don't need a Gitea repo).
	has, err := s.hasDocumentDeliverable(ctx, workflowID)
	if err != nil || !has {
		return
	}
	if err := gitea.ScaffoldWorkflowRepo(ctx, s.Gitea,
		util.UUIDToString(wf.WorkspaceID), util.UUIDToString(wf.ID), wf.Title); err != nil {
		slog.Warn("provision workflow repo: scaffold", "workflow_id", util.UUIDToString(workflowID), "error", err)
		return
	}
	slog.Info("provisioned workflow repo",
		"workflow_id", util.UUIDToString(workflowID),
		"repo", gitea.RepoName(util.UUIDToString(wf.ID)))
}

// ArchiveReviewComment archives the critic's review opinion into the run's Gitea
// repo (inst branch), co-located with the node's deliverables under
// nodes/<NN>-<nodeTitle>-<nodeRunShort>/reviews/<RR>-<reviewer>-<通过|驳回>.md. The
// review is authored in the multica UI; this is a best-effort, read-only audit
// copy — the approve/reject decision itself stays in multica (§3.3). Errors are
// logged, never block the review.
//
// Round derivation: RetryCount counts prior rejects. The current review number is
// RetryCount+1 on approve (the tx leaves RetryCount unchanged) and RetryCount on
// reject (the tx has already incremented it). Reviewer resolves from the assigned
// critic member's display name, falling back to "critic".
func (s *WorkflowService) ArchiveReviewComment(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, decision, comment string) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() || comment == "" {
		return
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("archive review comment: get run", "error", err)
		return
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("archive review comment: get workflow", "error", err)
		return
	}
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		slog.Warn("archive review comment: get node", "error", err)
		return
	}

	approved := decision == "approved"
	verdict := "驳回"
	if approved {
		verdict = "通过"
	}
	round := int(nodeRun.RetryCount)
	if approved {
		round++
	}
	reviewer := "critic"
	if nodeRun.CriticID.Valid {
		if m, err := s.Queries.GetMember(ctx, nodeRun.CriticID); err == nil && m.OrgDisplayName.Valid && m.OrgDisplayName.String != "" {
			reviewer = m.OrgDisplayName.String
		}
	}

	nodeRunIDStr := util.UUIDToString(nodeRun.ID)
	// Topological position for the <NN> prefix; fall back to sort_order if the
	// graph lookup fails so review archival is never skipped on a rare DB error.
	nodeSeq := int(node.SortOrder)
	if topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID); err == nil {
		nodeSeq = topo[util.UUIDToString(node.ID)]
	}
	path := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, nodeRunIDStr) + "/" +
		gitea.ReviewPath(round, reviewer, verdict)
	content := fmt.Sprintf("---\nround: %d\nverdict: %s\nreviewer: %s\nnode_run: %s\n---\n\n## 评审意见\n\n%s\n",
		round, decision, reviewer, nodeRunIDStr, comment)

	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	if err := repoProvider.UpsertFile(ctx, owner, repo, inst, path, content, "review: "+decision); err != nil {
		slog.Warn("archive review comment: write file", "node_run_id", nodeRunIDStr, "path", path, "error", err)
		return
	}
	slog.Info("archived review comment", "node_run_id", nodeRunIDStr, "round", round, "verdict", verdict, "path", path)
}

// shortHexSafe returns the first 8 hex chars of a UUID string, or the full
// string if shorter (defensive — the gitea package's shortHex panics on
// non-UUID, so we validate first).
func shortHexSafe(id string) string {
	if len(id) >= 8 {
		return id[:8]
	}
	return id
}

// mergeDeliverablePRs merges the Gitea PR behind every PR-backed deliverable
// submission (document deliverables uploaded as files AND pull_request
// deliverables whose pasted code link is wrapped in a node→inst PR), with
// bounded retry. Returns nil only if all such PRs merged; a non-nil error means
// at least one failed terminally (conflict) or after retries (transient) — the
// caller blocks the node run. Only called when s.Gitea is configured.
func (s *WorkflowService) mergeDeliverablePRs(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)

	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	// PR-backed kinds: document (file uploaded to a node→inst PR) and
	// pull_request (code link wrapped in a node→inst PR). Both open a Gitea PR
	// on submit, so both merge on approve.
	isPRBacked := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		if d.Kind == "document" || d.Kind == "pull_request" {
			isPRBacked[util.UUIDToString(d.ID)] = true
		}
	}

	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list submissions: %w", err)
	}
	for _, sub := range submissions {
		if !isPRBacked[util.UUIDToString(sub.DeliverableID)] || sub.PullRequestUrl == "" {
			continue
		}
		index, err := gitea.ParsePullRequestIndex(sub.PullRequestUrl)
		if err != nil {
			return fmt.Errorf("parse PR url %q: %w", sub.PullRequestUrl, err)
		}
		if err := retryMergeDocPR(ctx, s.deliverableRepository(), owner, repo, index); err != nil {
			return fmt.Errorf("merge PR #%d: %w", index, err)
		}
	}
	return nil
}

// retryMergeDocPR calls MergePR with bounded backoff. A 409 conflict
// (gitea.ErrMergeConflict) is terminal — returned immediately, no retry. Other
// errors (5xx, network) are retried up to maxAttempts with exponential backoff.
func retryMergeDocPR(ctx context.Context, provider coderepo.RepositoryProvider, owner, repo string, index int) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := provider.MergeReviewRequest(ctx, owner, repo, index)
		if err == nil {
			return nil
		}
		if errors.Is(err, gitea.ErrMergeConflict) {
			return err // terminal — don't retry a conflict
		}
		lastErr = err
		if attempt == maxAttempts-1 {
			break // last attempt — don't sleep before returning
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Second): // 1s, 2s backoff
		}
	}
	return lastErr
}

// markDeliverableSubmissionsApproved flips every PR-backed submission (document
// or pull_request) with a PR URL to status=approved (called after a successful
// merge). Best-effort: errors are logged, not returned — the merge already
// succeeded, so the node will complete regardless of a status-write hiccup
// here. The existing review_comment is preserved (the critic's comment lives on
// the node run, not the submission).
func (s *WorkflowService) markDeliverableSubmissionsApproved(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		slog.Warn("mark deliverable submissions approved: list deliverables", "error", err)
		return
	}
	isPRBacked := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		if d.Kind == "document" || d.Kind == "pull_request" {
			isPRBacked[util.UUIDToString(d.ID)] = true
		}
	}
	subs, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("mark deliverable submissions approved: list submissions", "error", err)
		return
	}
	for _, sub := range subs {
		if isPRBacked[util.UUIDToString(sub.DeliverableID)] && sub.PullRequestUrl != "" {
			if _, err := s.Queries.ReviewNodeRunDeliverableSubmission(ctx, db.ReviewNodeRunDeliverableSubmissionParams{
				ID:            sub.ID,
				Status:        "approved",
				ReviewComment: sub.ReviewComment, // preserve; critic comment is on the node run
			}); err != nil {
				slog.Warn("mark deliverable submission approved",
					"submission_id", util.UUIDToString(sub.ID), "error", err)
			}
		}
	}
}

// UploadMemberDeliverable is the server-side mirror of the agent's `cs-workflow
// gitea submit`: it writes a member-uploaded document to the issue's default-
// workflow Gitea repo (node branch off the inst branch), opens a node→inst PR,
// registers the PR URL on the submission, and advances the node-run to
// awaiting_critic — which dispatches the critic (the issue creator) so the
// deliverable enters the same review+merge path as agent-produced docs.
//
// SubmittedByID is the uploading member (issue.AssigneeID for a member-assigned
// issue). dormant: returns an error when Gitea is nil/unconfigured; the handler
// gates the endpoint on isGiteaConfigured() and never calls this otherwise.
// UploadMemberDeliverablePR handles a member-submitted code merge-request URL
// for the issue's pull_request-kind deliverable. It mirrors UploadMemberDeliverable:
// the link is archived as a file on the node branch, a Gitea PR (node -> inst) is
// opened, the PR URL is registered on the submission, and the node-run advances
// into review — keeping the code flow identical to the document flow (no direct
// merge to inst).
func (s *WorkflowService) UploadMemberDeliverablePR(ctx context.Context, issue db.MulticaIssue, pullRequestURL, userID string) error {
	if !issue.WorkflowRunID.Valid {
		return errors.New("issue has no workflow run (not routed to a deliverable workflow)")
	}
	run, err := s.Queries.GetWorkflowRun(ctx, issue.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return fmt.Errorf("list node runs: %w", err)
	}
	if len(nodeRuns) == 0 {
		return errors.New("run has no node runs")
	}
	nodeRun := nodeRuns[0]
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	var deliverableID pgtype.UUID
	var deliverableTitle string
	for _, d := range deliverables {
		if d.Kind == "pull_request" {
			deliverableID = d.ID
			deliverableTitle = d.Title
			break
		}
	}
	if !deliverableID.Valid {
		return errors.New("node has no pull_request deliverable")
	}

	// Mirror the document flow: archive the code link as a file on the node
	// branch + open a Gitea PR (node -> inst) so it goes through review like a
	// document deliverable (no direct merge to inst). The member's pasted URL is
	// the file body; the PR URL is what gets registered on the submission,
	// keeping the review surface consistent with document deliverables.
	var prURL string
	repoProvider := s.deliverableRepository()
	if repoProvider.Configured() {
		workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
		if err != nil {
			return fmt.Errorf("get workflow: %w", err)
		}
		node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
		if err != nil {
			return fmt.Errorf("get node: %w", err)
		}
		topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID)
		if err != nil {
			return fmt.Errorf("node topo order: %w", err)
		}
		nodeSeq := topo[util.UUIDToString(node.ID)]
		owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
		repo := DeliverableRepoNameForWorkflow(workflow)
		inst := gitea.InstBranch(util.UUIDToString(run.ID))
		nodeBranch := gitea.NodeBranch(nodeSeq, util.UUIDToString(nodeRun.ID))
		nodeDir := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID))
		path := nodeDir + "/" + sanitizeArchiveFileName(deliverableTitle) + ".md"
		content := fmt.Sprintf("# %s\n\n%s\n", deliverableTitle, pullRequestURL)
		if err := repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
			return fmt.Errorf("create node branch: %w", err)
		}
		if err := repoProvider.UpsertFile(ctx, owner, repo, nodeBranch, path, content, "code merge request link: "+pullRequestURL); err != nil {
			return fmt.Errorf("archive code link: %w", err)
		}
		prURL, err = repoProvider.OpenReviewRequest(ctx, owner, repo, nodeBranch, inst, "code deliverable "+util.UUIDToString(deliverableID))
		if err != nil {
			return fmt.Errorf("open PR: %w", err)
		}
	}

	submissionURL := prURL
	if submissionURL == "" {
		submissionURL = pullRequestURL // dormant fallback: no Gitea, just record the link
	}
	if _, err := s.Queries.UpsertNodeRunDeliverableSubmission(ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nodeRun.ID,
		DeliverableID:     deliverableID,
		SubmittedByType:   "member",
		PullRequestUrl:    submissionURL,
		SubmittedByID:     util.MustParseUUID(userID),
	}); err != nil {
		return fmt.Errorf("upsert deliverable submission: %w", err)
	}

	// Advance the node-run into review, mirroring UploadMemberDeliverable. (Like
	// the document path this fails if other required deliverables are unsubmitted.)
	if prURL != "" {
		output, _ := json.Marshal(map[string]any{"pull_request_url": prURL})
		if err := s.SubmitWorkerOutput(ctx, nodeRun.ID, output); err != nil {
			return fmt.Errorf("submit worker output: %w", err)
		}
	}
	slog.Info("member code deliverable uploaded",
		"issue_id", util.UUIDToString(issue.ID), "node_run_id", util.UUIDToString(nodeRun.ID), "pr_url", prURL)
	return nil
}

// MemberDeliverableFile is one uploaded document file. Content is the file
// bytes base64-encoded (so JSON transport is binary-safe — any format, not
// just text). Each file is archived to Gitea under the node directory using
// its original filename.
type MemberDeliverableFile struct {
	Name    string `json:"name"`    // original filename; archived under the node dir
	Content string `json:"content"` // base64-encoded file bytes
}

// sanitizeArchiveFileName returns a safe single-segment filename for archiving
// an uploaded file under the node directory: it keeps only the base name
// (stripping any directory components to prevent path traversal) and falls back
// to "untitled" when empty.
func sanitizeArchiveFileName(name string) string {
	base := path.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == ".." {
		return "untitled"
	}
	return base
}

func (s *WorkflowService) UploadMemberDeliverable(ctx context.Context, issue db.MulticaIssue, files []MemberDeliverableFile) error {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() {
		return errors.New("UploadMemberDeliverable: repository provider not configured")
	}
	if len(files) == 0 {
		return errors.New("no files to upload")
	}
	if !issue.WorkflowRunID.Valid {
		return errors.New("issue has no workflow run (not routed to the default workflow)")
	}
	run, err := s.Queries.GetWorkflowRun(ctx, issue.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, run.ID)
	if err != nil {
		return fmt.Errorf("list node runs: %w", err)
	}
	if len(nodeRuns) == 0 {
		return errors.New("run has no node runs")
	}
	nodeRun := nodeRuns[0]

	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	var deliverableID pgtype.UUID
	for _, d := range deliverables {
		if d.Kind == "document" {
			deliverableID = d.ID
			break
		}
	}
	if !deliverableID.Valid {
		return errors.New("node has no document deliverable")
	}

	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("get node: %w", err)
	}
	topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("node topo order: %w", err)
	}
	nodeSeq := topo[util.UUIDToString(node.ID)]
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(nodeSeq, util.UUIDToString(nodeRun.ID))
	nodeDir := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID))

	// Idempotent node branch (base = inst). CreateBranch is get-or-create
	// (handles the slash in node/<hex>, which GET /branches/{name} can't address).
	if err := repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
		return fmt.Errorf("create node branch: %w", err)
	}
	// Archive every uploaded file under the node directory, preserving each
	// file's original name + format (binary-safe via base64 → UpsertFile).
	for _, f := range files {
		raw, err := base64.StdEncoding.DecodeString(f.Content)
		if err != nil {
			return fmt.Errorf("decode file %q: %w", f.Name, err)
		}
		filePath := nodeDir + "/" + sanitizeArchiveFileName(f.Name)
		if err := repoProvider.UpsertFile(ctx, owner, repo, nodeBranch, filePath, string(raw), "deliverable upload: "+f.Name); err != nil {
			return fmt.Errorf("write deliverable file %q: %w", f.Name, err)
		}
	}
	prURL, err := repoProvider.OpenReviewRequest(ctx, owner, repo, nodeBranch, inst,
		"document deliverable "+util.UUIDToString(deliverableID))
	if err != nil {
		return fmt.Errorf("open PR: %w", err)
	}

	// Register the PR on the submission (status=submitted via the upsert query).
	if _, err := s.Queries.UpsertNodeRunDeliverableSubmission(ctx, db.UpsertNodeRunDeliverableSubmissionParams{
		WorkflowNodeRunID: nodeRun.ID,
		DeliverableID:     deliverableID,
		SubmittedByType:   "member",
		SubmittedByID:     issue.AssigneeID,
		Content:           "",
		PullRequestUrl:    prURL,
	}); err != nil {
		return fmt.Errorf("upsert submission: %w", err)
	}

	// Advance the node-run to awaiting_critic (dispatches the critic = creator).
	// SubmitWorkerOutput accepts the worker_assigned status the member run sits in.
	output, _ := json.Marshal(map[string]any{"pull_request_url": prURL})
	if err := s.SubmitWorkerOutput(ctx, nodeRun.ID, output); err != nil {
		return fmt.Errorf("submit worker output: %w", err)
	}
	slog.Info("member deliverable uploaded",
		"issue_id", util.UUIDToString(issue.ID), "node_run_id", util.UUIDToString(nodeRun.ID), "pr_url", prURL)
	return nil
}

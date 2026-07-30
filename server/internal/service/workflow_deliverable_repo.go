package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/coderepo"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/gitlab"
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

func (s *WorkflowService) hasRunAnyDeliverable(ctx context.Context, runID pgtype.UUID) (bool, error) {
	nodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, runID)
	if err != nil {
		return false, fmt.Errorf("list node runs: %w", err)
	}
	for _, nodeRun := range nodeRuns {
		requirements, err := s.Queries.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
		if err != nil {
			return false, fmt.Errorf("list deliverable requirements: %w", err)
		}
		if len(requirements) > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (s *WorkflowService) workflowFromRunSnapshot(ctx context.Context, run db.MulticaWorkflowRun) (db.MulticaWorkflow, error) {
	return workflowFromRunSnapshotWithQueries(ctx, s.Queries, run)
}

func workflowFromRunSnapshotWithQueries(ctx context.Context, q *db.Queries, run db.MulticaWorkflowRun) (db.MulticaWorkflow, error) {
	snapshot, err := (WorkflowRuntimeRepository{Queries: q}).GetRunDefinitionSnapshot(ctx, run.ID)
	if err != nil {
		return db.MulticaWorkflow{}, err
	}
	return db.MulticaWorkflow{
		ID: run.WorkflowID, WorkspaceID: run.WorkspaceID, Title: run.WorkflowTitle,
		IsDefault: snapshot.Workflow.IsDefault,
	}, nil
}

func DeliverableRepoNameForWorkflow(workflow db.MulticaWorkflow) string {
	return DeliverableRepoName(workflow.ID, workflow.IsDefault)
}

func DeliverableRepoName(workflowID pgtype.UUID, isDefault bool) string {
	if isDefault {
		// The archive repo is provisioned (by the team-namespace service and the
		// local mock) as gitea.RepoName of the archive slug — i.e. with the same
		// "wf-" prefix every workflow repo gets under WORKFLOW_REPO_PATH_ALGORITHM
		// v2. Returning the bare slug here caused the upload/clone paths to target
		// a non-existent "deliverable-archive" repo while the real repo lived at
		// "wf-deliverable-archive" (404 on member deliverable upload).
		return gitea.RepoName(gitea.DefaultArchiveRepoName())
	}
	return gitea.RepoName(util.UUIDToString(workflowID))
}

func (s *WorkflowService) teamNamespaceConfigured() bool {
	return s.TeamNamespace != nil && s.TeamNamespace.Configured()
}

func userRefFromMember(m db.ListMembersWithUserRow) teamnamespace.UserRef {
	// costrict-web resolves user_id as a cs-user subject_id (usr_<uuid>), so
	// prefer the member's subject_id (dept-sourced members) and fall back to
	// the joined user's subject_id (manual / email-invite members).
	if sid := strings.TrimSpace(m.SubjectID.String); m.SubjectID.Valid && sid != "" {
		return teamnamespace.UserRef{UserID: sid}
	}
	if sid := strings.TrimSpace(m.UserSubjectID.String); m.UserSubjectID.Valid && sid != "" {
		return teamnamespace.UserRef{UserID: sid}
	}
	return teamnamespace.UserRef{}
}

func (s *WorkflowService) workspaceMemberRefs(ctx context.Context, workspaceID pgtype.UUID) ([]teamnamespace.UserRef, teamnamespace.UserRef, error) {
	return workspaceMemberRefsForQueries(ctx, s.Queries, workspaceID)
}

// workspaceMemberRefsForQueries is the free-function form of
// WorkflowService.workspaceMemberRefs, extracted so TaskService.ensureDeliveryRepo
// can call the team-namespace provisioning sequence without importing
// WorkflowService (which already depends on TaskService — reverse import would
// be a cycle). The method wrapper above delegates here.
func workspaceMemberRefsForQueries(ctx context.Context, q *db.Queries, workspaceID pgtype.UUID) ([]teamnamespace.UserRef, teamnamespace.UserRef, error) {
	members, err := q.ListMembersWithUser(ctx, workspaceID)
	if err != nil {
		return nil, teamnamespace.UserRef{}, err
	}
	refs := make([]teamnamespace.UserRef, 0, len(members))
	var creator teamnamespace.UserRef
	for _, m := range members {
		ref := userRefFromMember(m)
		if ref.UserID == "" {
			continue
		}
		refs = append(refs, ref)
		if creator.UserID == "" && m.Role == "owner" {
			creator = ref
		}
	}
	if creator.UserID == "" && len(refs) > 0 {
		creator = refs[0]
	}
	// team-ns contract §1.5: the creator is passed separately and must NOT also
	// appear in initial_members — costrict-web's CreateTeam rejects the request
	// with INVALID_REQUEST when they overlap (validateCreateTeamRequest). Exclude
	// the chosen creator from the member list so the request is well-formed.
	initialMembers := make([]teamnamespace.UserRef, 0, len(refs))
	for _, r := range refs {
		if r.UserID != "" && r.UserID == creator.UserID {
			continue
		}
		initialMembers = append(initialMembers, r)
	}
	return initialMembers, creator, nil
}

func (s *WorkflowService) persistTeamNamespaceSettings(ctx context.Context, workspaceID pgtype.UUID, patch map[string]any) error {
	return persistTeamNamespaceSettings(ctx, s.Queries, workspaceID, patch)
}

// persistTeamNamespaceSettings is the free-function form of the identically
// named WorkflowService method. It merges patch into workspace.settings and
// persists via UpdateWorkspace. Empty-string patch values are skipped (treated
// as "no value yet" so they don't clobber existing data on a partial re-run).
func persistTeamNamespaceSettings(ctx context.Context, q *db.Queries, workspaceID pgtype.UUID, patch map[string]any) error {
	ws, err := q.GetWorkspace(ctx, workspaceID)
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
	if _, err := q.UpdateWorkspace(ctx, db.UpdateWorkspaceParams{
		ID:       workspaceID,
		Settings: raw,
	}); err != nil {
		return fmt.Errorf("persist settings: %w", err)
	}
	return nil
}

func (s *WorkflowService) ensureTeamNamespace(ctx context.Context, workspaceID pgtype.UUID) error {
	return ensureTeamNamespace(ctx, s.Queries, s.TeamNamespace, workspaceID)
}

// ensureTeamNamespace is the free-function form of the identically named
// WorkflowService method: CreateTeam (interface-8 team-ns) + persist bot
// credentials into workspace.settings. Idempotent — re-runs find the team
// existing and just re-record credentials.
func ensureTeamNamespace(ctx context.Context, q *db.Queries, tn *teamnamespace.Client, workspaceID pgtype.UUID) error {
	ws, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("get workspace: %w", err)
	}
	refs, creator, err := workspaceMemberRefsForQueries(ctx, q, workspaceID)
	if err != nil {
		return fmt.Errorf("list workspace members: %w", err)
	}
	if creator.UserID == "" {
		return fmt.Errorf("workspace has no syncable creator")
	}
	resp, err := tn.CreateTeam(ctx, teamnamespace.CreateTeamRequest{
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
	return persistTeamNamespaceSettings(ctx, q, workspaceID, patch)
}

func (s *WorkflowService) initWorkflowNamespace(ctx context.Context, run db.MulticaWorkflowRun, workflow db.MulticaWorkflow) error {
	return initWorkflowNamespace(ctx, s.Queries, s.TeamNamespace, run, workflow)
}

// initWorkflowNamespace is the free-function form of the identically named
// WorkflowService method: ensure team-ns exists, then InitWorkflow
// (interface-8 wf repo + inst branch), then persist bot_credentials + wf repo
// metadata into workspace.settings. Idempotent. Called from
// WorkflowService.ScaffoldRunDeliverables / ensureNodeRunBranch and from
// TaskService.ensureDeliveryRepo (the dispatch-time safety net).
func initWorkflowNamespace(ctx context.Context, q *db.Queries, tn *teamnamespace.Client, run db.MulticaWorkflowRun, workflow db.MulticaWorkflow) error {
	if err := ensureTeamNamespace(ctx, q, tn, run.WorkspaceID); err != nil {
		return err
	}
	defSlug := shortHexSafe(util.UUIDToString(workflow.ID))
	if workflow.IsDefault {
		defSlug = gitea.DefaultArchiveRepoName()
	}
	resp, err := tn.InitWorkflow(ctx, teamnamespace.WorkflowInitRequest{
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
	return persistTeamNamespaceSettings(ctx, q, run.WorkspaceID, patch)
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
		WorkflowDefSlug:    gitea.DefaultArchiveRepoName(),
		InstanceID:         wsIDStr, // stable per-workspace instance
		TeamID:             wsIDStr,
		SkipInstanceBranch: true, // no run yet — inst branch created at issue/run time
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
	if actor.UserID == "" {
		refs, creator, err := s.workspaceMemberRefs(ctx, workspaceID)
		if err == nil && (creator.UserID != "") {
			actor = creator
		} else if err == nil && len(refs) > 0 {
			actor = refs[0]
		}
	}
	if actor.UserID == "" {
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

	if !s.teamNamespaceConfigured() {
		return // feature dormant — deliverables require team-namespace (costrict-web)
	}
	runIDStr := util.UUIDToString(run.ID)

	// NOTE: if the run snapshot or the document-deliverable check fails (e.g.
	// a transient DB error), we return WITHOUT scaffolding and WITHOUT failing
	// the run. The run continues "running" with no Gitea repo, so the daemon's
	// first clone/push will 404 later. Intentional — we can't decide whether to
	// fail the run if we can't read the workflow — but it means a DB blip here
	// surfaces as a later clone failure, not a run failure.
	workflow, err := s.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		slog.Warn("gitea scaffold: get run snapshot", "run_id", runIDStr, "error", err)
		return
	}
	has, err := s.hasRunAnyDeliverable(ctx, run.ID)
	if err != nil {
		slog.Warn("gitea scaffold: check deliverables", "run_id", runIDStr, "error", err)
		return
	}
	if !has {
		return // deliverable-free workflow — no Gitea repo needed
	}

	if err := s.initWorkflowNamespace(ctx, run, workflow); err != nil {
		slog.Error("team namespace workflow init failed", "run_id", runIDStr, "error", err)
		s.failRun(ctx, run)
		return
	}
	s.syncWorkspaceMembers(ctx, run.WorkspaceID)
	// M5: register this child run's deliverable address into its parent issue's
	// Gitea repo (if this run's source issue is a split-out child). Best-effort,
	// async — never blocks scaffolding.
	go s.ArchiveSubIssueAddress(context.Background(), run)
}

// ensureNodeRunBranch creates the node-run branch when a node enters execution.
func (s *WorkflowService) ensureNodeRunBranch(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if !s.teamNamespaceConfigured() {
		return nil // deliverable provisioning requires team-namespace (costrict-web)
	}
	repoProvider := s.deliverableRepository()

	deliverables, err := s.Queries.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	if len(deliverables) == 0 {
		return nil
	}

	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	workflow, err := s.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		return fmt.Errorf("get run snapshot: %w", err)
	}

	if err := s.initWorkflowNamespace(ctx, run, workflow); err != nil {
		return err
	}
	if !repoProvider.Configured() {
		return nil
	}

	topo, err := RunNodeTopoOrder(ctx, s.Queries, run.ID)
	if err != nil {
		return fmt.Errorf("node topo order: %w", err)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(topo[util.UUIDToString(nodeRun.ID)], util.UUIDToString(nodeRun.ID))
	if err := repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
		return fmt.Errorf("create node branch: %w", err)
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
	if !s.teamNamespaceConfigured() {
		return
	}
	refs, creator, err := s.workspaceMemberRefs(ctx, workspaceID)
	if err != nil {
		slog.Warn("team namespace sync members: list",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
		return
	}
	// workspaceMemberRefs returns the workspace owner separately as `creator`
	// (excluded from refs) to satisfy the team-namespace §1.5 create-team
	// contract, where the creator is passed in its own field and must not
	// overlap with initial_members. The owner still belongs in the Gitea org,
	// though, so re-add them here — otherwise the creator is the one member
	// never synced into their own workspace's team namespace.
	members := refs
	if creator.UserID != "" {
		members = append(members, creator)
	}
	if _, err := s.TeamNamespace.SyncMembers(ctx, util.UUIDToString(workspaceID), teamnamespace.SyncMembersRequest{
		Mode:       "full_sync",
		AddMembers: members,
	}); err != nil {
		slog.Warn("team namespace sync members",
			"workspace_id", util.UUIDToString(workspaceID), "error", err)
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
// creation via costrict-web team-namespace: creates the org + bot, inits the
// default archive repo, and syncs workspace members into the org. Best-effort +
// async (called from a goroutine): errors are logged, never block workspace
// creation. Dormant when team-namespace is not configured.
func (s *WorkflowService) ProvisionWorkspaceGitea(ctx context.Context, workspaceID pgtype.UUID) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ProvisionWorkspaceGitea",
				"workspace_id", util.UUIDToString(workspaceID), "panic", r)
		}
	}()

	if !s.teamNamespaceConfigured() {
		return
	}

	wsIDStr := util.UUIDToString(workspaceID)
	if err := s.ensureTeamNamespace(ctx, workspaceID); err != nil {
		slog.Warn("provision workspace team namespace",
			"workspace_id", wsIDStr, "error", err)
		return
	}
	s.syncWorkspaceMembers(ctx, workspaceID)
	s.initDefaultArchiveRepo(ctx, workspaceID)
	slog.Info("provisioned workspace team namespace", "workspace_id", wsIDStr)
}

// ProvisionWorkflowRepo creates the workflow's type repo (wf-<wf[:8]>) with main
// branch protection when the workflow is activated. Called from the UpdateWorkflow
// handler (status→active), not lazily on the first run. Best-effort + async.
func (s *WorkflowService) ProvisionWorkflowRepo(ctx context.Context, workflowID pgtype.UUID) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in ProvisionWorkflowRepo", "workflow_id", util.UUIDToString(workflowID), "panic", r)
		}
	}()

	// team-namespace not configured → feature dormant.
	if !s.teamNamespaceConfigured() {
		return
	}

	wf, err := s.Queries.GetWorkflow(ctx, workflowID)
	if err != nil {
		slog.Warn("provision workflow repo: get workflow", "error", err)
		return
	}
	// The default workflow's archive repo (wf-deliverable-archive) is eagerly
	// provisioned at workspace creation (initDefaultArchiveRepo); never
	// re-provision it here.
	if wf.IsDefault {
		return
	}
	// Provision the repo for every activated workflow. The workflow repo is the
	// archive home for anything a run produces (documents, code MRs, reviews),
	// and downstream paths (run scaffolding, member uploads, sub-issue indexing)
	// key on its existence — so create it eagerly at activation regardless of
	// whether the workflow currently has any deliverable nodes.
	s.provisionTeamNamespaceWorkflowRepo(ctx, wf)
}

// provisionTeamNamespaceWorkflowRepo eagerly provisions the workflow's repo
// (wf-<workflow UUID prefix>) via the costrict-web internal API at activation
// time — the team-namespace counterpart of the Gitea-direct ScaffoldWorkflowRepo
// above. Mirrors initDefaultArchiveRepo: no run exists yet, so InstanceID uses
// the stable workflow UUID; idempotent (a later run's initWorkflowNamespace with
// InstanceID=runID finds the repo existing and only adds its per-run branch);
// best-effort, never blocks activation; does NOT persist run-scoped settings
// (that is initWorkflowNamespace's job at run time). The defSlug MUST equal
// initWorkflowNamespace's so activation and run-start target the same repo.
func (s *WorkflowService) provisionTeamNamespaceWorkflowRepo(ctx context.Context, wf db.MulticaWorkflow) {
	if err := s.ensureTeamNamespace(ctx, wf.WorkspaceID); err != nil {
		slog.Warn("provision workflow repo: ensure team namespace",
			"workflow_id", util.UUIDToString(wf.ID), "error", err)
		return
	}
	wfIDStr := util.UUIDToString(wf.ID)
	resp, err := s.TeamNamespace.InitWorkflow(ctx, teamnamespace.WorkflowInitRequest{
		WorkflowDefSlug:    shortHexSafe(wfIDStr), // must equal initWorkflowNamespace's defSlug
		InstanceID:         wfIDStr,               // stable per-workflow instance (no run yet)
		TeamID:             util.UUIDToString(wf.WorkspaceID),
		SkipInstanceBranch: true, // no run yet — inst branch created at issue/run time
	})
	if err != nil {
		slog.Warn("provision workflow repo: team-namespace init",
			"workflow_id", wfIDStr, "error", err)
		return
	}
	slog.Info("provisioned workflow repo via team namespace",
		"workflow_id", wfIDStr, "repo", resp.WFRepoPath, "branch", resp.InstanceBranch)
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
	workflow, err := s.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		slog.Warn("archive review comment: get run snapshot", "error", err)
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
	// Topological position for the <NN> prefix; fall back to 1 if the graph
	// lookup fails so review archival is never skipped on a rare DB error.
	nodeSeq := 1
	if topo, err := RunNodeTopoOrder(ctx, s.Queries, run.ID); err == nil {
		nodeSeq = topo[util.UUIDToString(nodeRun.ID)]
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

// ArchiveCodeDeliverable archives a code (GitLab MR) deliverable's pointer into
// the run's Gitea repo (inst branch), co-located with the node's other artifacts
// under nodes/<NN>-<nodeTitle>-<nodeRunShort>/code/<deliverableID>.md. The MR
// itself stays in GitLab (source of truth); this is a best-effort read-only audit
// copy so the Gitea repo is the unified archive of EVERYTHING a node produced
// (document + code + review + split). Errors are logged, never block submission.
//
// M5 simplification: the handler only has the MR URL (the worker's submission
// payload); codeRepoURL/branch/agentName come from the task payload and aren't
// threaded through yet, so those frontmatter fields stay empty for now. The MR
// URL is the key pointer — the rest is a follow-up.
func (s *WorkflowService) ArchiveCodeDeliverable(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, deliverable db.MulticaWorkflowNodeDeliverable, mrURL, codeRepoURL, codeBranch, agentName string) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() || mrURL == "" {
		return
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("archive code deliverable: get run", "error", err)
		return
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("archive code deliverable: get workflow", "error", err)
		return
	}
	node, err := s.Queries.GetWorkflowNode(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		slog.Warn("archive code deliverable: get node", "error", err)
		return
	}

	nodeRunIDStr := util.UUIDToString(nodeRun.ID)
	// Topological position for the <NN> prefix; fall back to sort_order if the
	// graph lookup fails so code archival is never skipped on a rare DB error
	// (mirrors ArchiveReviewComment's nodeSeq derivation).
	nodeSeq := int(node.SortOrder)
	if topo, err := NodeTopoOrder(ctx, s.Queries, run.WorkflowID); err == nil {
		nodeSeq = topo[util.UUIDToString(node.ID)]
	}
	path := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, nodeRunIDStr) + "/" +
		gitea.CodePath(util.UUIDToString(deliverable.ID))
	content := fmt.Sprintf("---\ndeliverable_id: %s\nmr_url: %s\ncode_repo: %s\nbranch: %s\nagent: %s\nnode_run: %s\n---\n\n## 代码 MR\n\n%s\n",
		util.UUIDToString(deliverable.ID), mrURL, codeRepoURL, codeBranch, agentName, nodeRunIDStr, mrURL)

	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	if err := repoProvider.UpsertFile(ctx, owner, repo, inst, path, content, "code deliverable: "+mrURL); err != nil {
		slog.Warn("archive code deliverable: write file", "node_run_id", nodeRunIDStr, "path", path, "error", err)
		return
	}
	slog.Info("archived code deliverable", "node_run_id", nodeRunIDStr, "deliverable_id", util.UUIDToString(deliverable.ID), "path", path)
}

// ArchiveSubIssueAddress registers a split-out child issue's deliverable-repo
// address into the PARENT issue's Gitea repo, under the split node's directory
// (nodes/<split-NN>-.../splits/<childIssueNumber>-<title>.md). Hooked at the
// child run's ScaffoldRunDeliverables (after the child's own repo is created),
// so the parent repo incrementally indexes each child's deliverable repo as
// children are provisioned — letting later nodes / humans discover children's
// deliverables by browsing the parent repo. Best-effort: skips silently when
// the child has no parent, the parent has no Gitea repo, or the parent run has
// no split node. Errors are logged, never block the child run.
func (s *WorkflowService) ArchiveSubIssueAddress(ctx context.Context, childRun db.MulticaWorkflowRun) {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() {
		return // feature dormant
	}
	if !childRun.SourceIssueID.Valid {
		return // run isn't tied to an issue — can't be a split child
	}

	// 1. childRun.SourceIssueID → child issue.
	childIssue, err := s.Queries.GetIssue(ctx, childRun.SourceIssueID)
	if err != nil {
		slog.Warn("archive sub-issue address: get child issue",
			"run_id", util.UUIDToString(childRun.ID), "error", err)
		return
	}
	// 2. Not a split child → no-op.
	if !childIssue.ParentIssueID.Valid {
		return
	}
	// 3. childIssue.ParentIssueID → parent issue (needed for Number + Title).
	parentIssue, err := s.Queries.GetIssue(ctx, childIssue.ParentIssueID)
	if err != nil {
		slog.Warn("archive sub-issue address: get parent issue",
			"child_issue_id", util.UUIDToString(childIssue.ID), "error", err)
		return
	}
	// 4. parent issue → parent run (latest run keyed by source_issue_id).
	parentRun, err := s.Queries.GetWorkflowRunBySourceIssue(ctx, childIssue.ParentIssueID)
	if err != nil {
		slog.Warn("archive sub-issue address: get parent run",
			"parent_issue_id", util.UUIDToString(parentIssue.ID), "error", err)
		return
	}
	// 5. parent run → node-runs → find the FIRST split node-run.
	parentNodeRuns, err := s.Queries.ListWorkflowNodeRunsByRun(ctx, parentRun.ID)
	if err != nil {
		slog.Warn("archive sub-issue address: list parent node runs",
			"parent_run_id", util.UUIDToString(parentRun.ID), "error", err)
		return
	}
	var splitNodeRun db.MulticaWorkflowNodeRun
	var splitNode db.MulticaWorkflowNode
	foundSplit := false
	for _, nr := range parentNodeRuns {
		node, err := s.Queries.GetWorkflowNode(ctx, nr.WorkflowNodeID)
		if err != nil {
			continue // best-effort: skip nodes we can't resolve
		}
		if workflowNodeType(node.FormatSchema) == "split" {
			splitNodeRun = nr
			splitNode = node
			foundSplit = true
			break
		}
	}
	if !foundSplit {
		return // parent run has no split node — nothing to index under
	}
	// 6. parent run → parent workflow (for DeliverableRepoNameForWorkflow).
	parentWorkflow, err := s.Queries.GetWorkflow(ctx, parentRun.WorkflowID)
	if err != nil {
		slog.Warn("archive sub-issue address: get parent workflow",
			"parent_run_id", util.UUIDToString(parentRun.ID), "error", err)
		return
	}
	// 7. Resolve split node's <NN> via topological order.
	topo, err := NodeTopoOrder(ctx, s.Queries, parentRun.WorkflowID)
	if err != nil {
		slog.Warn("archive sub-issue address: node topo order",
			"parent_workflow_id", util.UUIDToString(parentRun.WorkflowID), "error", err)
		return
	}
	splitSeq := topo[util.UUIDToString(splitNode.ID)]

	// 8. Build the in-repo path: <split NodeDir>/<SplitChildPath>.
	dir := gitea.NodeDir(splitSeq, splitNodeRun.NodeTitle, util.UUIDToString(splitNodeRun.ID))
	suffix := gitea.SplitChildPath(int(childIssue.Number), childIssue.Title)
	fullPath := dir + "/" + suffix

	// 9. Child's deliverable address: clone URL (from workspace.settings, the
	// canonical source — M2.5 lesson) + inst branch of the child run.
	childInst := gitea.InstBranch(util.UUIDToString(childRun.ID))
	childCloneURL, err := s.readGiteaCloneURL(ctx, childRun.WorkspaceID)
	if err != nil {
		slog.Warn("archive sub-issue address: read gitea_clone_url",
			"workspace_id", util.UUIDToString(childRun.WorkspaceID), "error", err)
		return
	}
	if childCloneURL == "" {
		slog.Warn("archive sub-issue address: no gitea_clone_url in workspace settings",
			"workspace_id", util.UUIDToString(childRun.WorkspaceID))
		return
	}

	// 10. PARENT repo coordinates (the child's address is written to the parent).
	owner := gitea.OrgName(util.UUIDToString(parentRun.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(parentWorkflow)
	inst := gitea.InstBranch(util.UUIDToString(parentRun.ID))

	// 11. UpsertFile — best-effort, never blocks.
	content := fmt.Sprintf("---\nchild_issue: %s\nchild_issue_number: %d\nchild_run: %s\nclone_url: %s\ninst_branch: %s\n---\n\n## 子任务交付仓库\n\n%s %s\n",
		util.UUIDToString(childIssue.ID), childIssue.Number,
		util.UUIDToString(childRun.ID), childCloneURL, childInst,
		childCloneURL, childInst)
	msg := "split child: " + fmt.Sprint(childIssue.Number)
	if err := repoProvider.UpsertFile(ctx, owner, repo, inst, fullPath, content, msg); err != nil {
		slog.Warn("archive sub-issue address: write file",
			"child_issue_id", util.UUIDToString(childIssue.ID), "path", fullPath, "error", err)
		return
	}
	slog.Info("archived sub-issue address",
		"child_issue_id", util.UUIDToString(childIssue.ID),
		"parent_run_id", util.UUIDToString(parentRun.ID), "path", fullPath)
}

// readGiteaCloneURL reads the Gitea clone URL from workspace.settings
// (gitea_clone_url), the canonical source per the M2.5 lesson. Returns empty
// string when the field is absent or the workspace has no settings.
func (s *WorkflowService) readGiteaCloneURL(ctx context.Context, workspaceID pgtype.UUID) (string, error) {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return "", fmt.Errorf("get workspace: %w", err)
	}
	var bundle struct {
		GiteaCloneURL string `json:"gitea_clone_url"`
	}
	if len(ws.Settings) > 0 {
		if err := json.Unmarshal(ws.Settings, &bundle); err != nil {
			return "", fmt.Errorf("parse settings: %w", err)
		}
	}
	return strings.TrimSpace(bundle.GiteaCloneURL), nil
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

// mergeDeliverablePRs merges the PR/MR behind every deliverable submission that
// carries a pull_request_url (a document uploaded as files becomes a node→inst
// PR; a code link is wrapped in a node→inst PR; a code MR is merged in place),
// with bounded retry. Returns nil only if all such PRs merged; a non-nil error
// means at least one failed terminally (conflict) or after retries (transient)
// — the caller blocks the node run. Only called when s.Gitea is configured.
func (s *WorkflowService) mergeDeliverablePRs(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	workflow, err := s.workflowFromRunSnapshot(ctx, run)
	if err != nil {
		return fmt.Errorf("get run snapshot: %w", err)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)

	deliverables, err := s.Queries.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	// Build a set of deliverable IDs belonging to this node run. A submission
	// is PR-backed when it has a non-empty PullRequestUrl — the kind column is
	// no longer consulted.
	deliverableIDs := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		deliverableIDs[util.UUIDToString(d.ID)] = true
	}

	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list submissions: %w", err)
	}
	for _, sub := range submissions {
		// Live rows only: a rejected link keeps its (never-closed) review PR,
		// and merging it would land work the critic turned down.
		if sub.Status == "missing" || sub.Status == "rejected" {
			continue
		}
		if !deliverableIDs[util.UUIDToString(sub.DeliverableID)] || sub.PullRequestUrl == "" {
			continue
		}
		if err := s.mergeReviewURL(ctx, run.WorkspaceID, owner, repo, sub.PullRequestUrl); err != nil {
			return fmt.Errorf("merge %q: %w", sub.PullRequestUrl, err)
		}
	}
	return nil
}

// mergeReviewURL merges a single deliverable review request by dispatching on
// its URL: a Gitea PR (multica-managed document deliverable) uses the admin
// client; a GitLab MR (worker code deliverable) uses the workspace's
// gitlab_access_token. Either platform is dormant (returns nil, no error) when
// its credential is absent — so a code-only workspace (Gitea nil) still merges
// GitLab MRs, and a document-only workspace (no GitLab PAT) still merges Gitea
// PRs. A URL that parses as neither returns an error (unrecognized).
func (s *WorkflowService) mergeReviewURL(ctx context.Context, workspaceID pgtype.UUID, owner, repo, rawURL string) error {
	if index, err := gitea.ParsePullRequestIndex(rawURL); err == nil {
		if s.Gitea == nil || !s.Gitea.Configured() {
			return nil // Gitea dormant
		}
		return retryMergeDocPR(ctx, s.deliverableRepository(), owner, repo, index)
	}
	ref, err := gitlab.ParseMergeRequestURL(rawURL)
	if err != nil {
		return fmt.Errorf("unrecognized review URL %q: %w", rawURL, err)
	}
	token, err := s.gitlabAccessToken(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("read gitlab access token: %w", err)
	}
	if token == "" {
		return nil // GitLab dormant
	}
	return retryGitlabMR(ctx, &gitlab.Client{}, ref, token)
}

// retryGitlabMR mirrors retryMergeDocPR: bounded 3-attempt backoff, with
// gitlab.ErrMergeConflict treated as terminal (no retry).
func retryGitlabMR(ctx context.Context, c *gitlab.Client, ref gitlab.MergeRequestRef, token string) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := c.MergeMR(ctx, ref, token)
		if err == nil {
			return nil
		}
		if errors.Is(err, gitlab.ErrMergeConflict) {
			return err
		}
		lastErr = err
		if attempt == maxAttempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Second):
		}
	}
	return lastErr
}

// gitlabAccessToken reads the per-workspace GitLab user PAT from
// workspace.settings (gitlab_access_token). Mirrors the inline read in
// task_cscloud_push.go. Empty when the workspace has no GitLab PAT configured.
func (s *WorkflowService) gitlabAccessToken(ctx context.Context, workspaceID pgtype.UUID) (string, error) {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return "", fmt.Errorf("get workspace: %w", err)
	}
	var settings struct {
		GitlabAccessToken string `json:"gitlab_access_token"`
	}
	if err := json.Unmarshal(ws.Settings, &settings); err != nil {
		return "", fmt.Errorf("parse workspace settings: %w", err)
	}
	return strings.TrimSpace(settings.GitlabAccessToken), nil
}

// closeDeliverableReviewRequests closes the node-run's Gitea PRs after a
// critic rejection, so a stale PR doesn't linger into the next retry round
// (the worker opens a fresh one). Dispatch is by URL host: if
// gitea.ParsePullRequestIndex succeeds the PR is Gitea-hosted and gets closed;
// GitLab MRs (and unparseable URLs) are deliberately NOT closed — the worker
// revises them in place across retries via findOpenPR. Best-effort: failures
// are logged and never block the rework/blocked transition (closing is
// cleanup, not a gate on the review outcome). Dormant when no provider is
// configured.
func (s *WorkflowService) closeDeliverableReviewRequests(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
	provider := s.deliverableRepository()
	if !provider.Configured() {
		return // dormant — nothing to close against
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("close deliverable PRs: get run", "error", err)
		return
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		slog.Warn("close deliverable PRs: get workflow", "error", err)
		return
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := DeliverableRepoNameForWorkflow(workflow)

	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("close deliverable PRs: list submissions", "error", err)
		return
	}
	for _, sub := range submissions {
		if sub.PullRequestUrl == "" {
			continue
		}
		index, err := gitea.ParsePullRequestIndex(sub.PullRequestUrl)
		if err != nil {
			// GitLab MR or unparseable URL — skip (worker revises in place).
			// Debug (not Warn): GitLab MR URLs always fail this parse, so Warn
			// would be noisy; Debug keeps a breadcrumb for genuinely malformed
			// Gitea URLs without spamming on every rejected code MR.
			slog.Debug("close deliverable PR: skip unparseable url", "url", sub.PullRequestUrl)
			continue
		}
		if err := provider.CloseReviewRequest(ctx, owner, repo, index); err != nil {
			slog.Warn("close deliverable PR failed (best-effort)", "index", index, "error", err)
		}
	}
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

// markDeliverableSubmissionsApproved flips every live submission with a PR URL
// to status=approved (called after a successful merge). Rejected rows stay
// rejected — a link the critic turned down in an earlier round must not be
// resurrected by a sibling's approval.
// Best-effort: errors are logged, not returned — the merge already
// succeeded, so the node will complete regardless of a status-write hiccup
// here. The existing review_comment is preserved (the critic's comment lives on
// the node run, not the submission).
func (s *WorkflowService) markDeliverableSubmissionsApproved(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
	deliverables, err := s.Queries.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("mark deliverable submissions approved: list deliverables", "error", err)
		return
	}
	deliverableIDs := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		deliverableIDs[util.UUIDToString(d.ID)] = true
	}
	subs, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("mark deliverable submissions approved: list submissions", "error", err)
		return
	}
	for _, sub := range subs {
		if sub.Status == "missing" || sub.Status == "rejected" {
			continue
		}
		if deliverableIDs[util.UUIDToString(sub.DeliverableID)] && sub.PullRequestUrl != "" {
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
// ErrNodeRunNotInWorkerPhase is returned by the member upload paths when the
// target node run has already left its worker phase (e.g. an earlier upload
// advanced it into review). The handler maps it to 409: a late or duplicate
// upload must not rewrite the node branch, reopen work, or reset a reviewed
// submission back to submitted.
var ErrNodeRunNotInWorkerPhase = errors.New("node run is not in worker phase")

type memberUploadOperation func(
	q *db.Queries,
	run db.MulticaWorkflowRun,
	nodeRun db.MulticaWorkflowNodeRun,
) (db.MulticaWorkflowNodeRun, bool, error)

// runLockedMemberUpload serializes every member upload for one node run. The
// row lock is acquired before repository side effects and held until the
// submission rows, readiness check, state transition, and critic dispatch are
// committed. This prevents two partial uploads from both missing each other,
// and prevents a late upload from changing files or resetting a reviewed
// submission after another request has advanced the node.
//
// Repository calls intentionally run while the transaction owns the row lock.
// They cannot be rolled back, but keeping them inside the serialized operation
// is what prevents a concurrent review/upload from observing half an upload.
func (s *WorkflowService) runLockedMemberUpload(ctx context.Context, issue db.MulticaIssue, operation memberUploadOperation) error {
	if !issue.WorkflowRunID.Valid {
		return errors.New("issue has no workflow run (not routed to a deliverable workflow)")
	}

	var changedNode db.MulticaWorkflowNodeRun
	changed := false
	run := func(q *db.Queries, lock bool) error {
		workflowRun, err := q.GetWorkflowRun(ctx, issue.WorkflowRunID)
		if err != nil {
			return fmt.Errorf("get run: %w", err)
		}
		nodeRuns, err := q.ListWorkflowNodeRunsByRun(ctx, workflowRun.ID)
		if err != nil {
			return fmt.Errorf("list node runs: %w", err)
		}
		if len(nodeRuns) == 0 {
			return errors.New("run has no node runs")
		}

		nodeRun := nodeRuns[0]
		if lock {
			nodeRun, err = q.GetWorkflowNodeRunForUpdate(ctx, nodeRun.ID)
		} else {
			nodeRun, err = q.GetWorkflowNodeRun(ctx, nodeRun.ID)
		}
		if err != nil {
			return fmt.Errorf("get node run: %w", err)
		}
		if nodeRun.Status != NodeRunStatusWorking && nodeRun.Status != NodeRunStatusWorkerAssigned {
			return ErrNodeRunNotInWorkerPhase
		}

		changedNode, changed, err = operation(q, workflowRun, nodeRun)
		return err
	}

	if s.TxStarter == nil {
		if err := run(s.Queries, false); err != nil {
			return err
		}
	} else {
		tx, err := s.TxStarter.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin member upload: %w", err)
		}
		defer tx.Rollback(ctx)
		if err := run(s.Queries.WithTx(tx), true); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit member upload: %w", err)
		}
	}

	if changed && s.OnNodeStatusChanged != nil {
		s.OnNodeStatusChanged(ctx, changedNode)
	}
	return nil
}

// resolveUploadDeliverable picks the deliverable a member upload targets: the
// explicitly requested deliverableID when given (validated to belong to the
// node run), otherwise the sole deliverable on the node — the legacy
// single-deliverable behavior (errors if there is not exactly one).
func resolveUploadDeliverable(deliverables []db.MulticaWorkflowNodeRunDeliverable, deliverableID string) (db.MulticaWorkflowNodeRunDeliverable, error) {
	if deliverableID != "" {
		for _, d := range deliverables {
			if util.UUIDToString(d.ID) == deliverableID {
				return d, nil
			}
		}
		return db.MulticaWorkflowNodeRunDeliverable{}, fmt.Errorf("deliverable %s not found on this node run", deliverableID)
	}
	switch len(deliverables) {
	case 0:
		return db.MulticaWorkflowNodeRunDeliverable{}, fmt.Errorf("node has no deliverables")
	case 1:
		return deliverables[0], nil
	default:
		return db.MulticaWorkflowNodeRunDeliverable{}, fmt.Errorf("multiple deliverables; specify deliverable_id")
	}
}

// recordMemberUploadAndAdvance records submissions using the transaction that
// already owns the node-run row lock. It advances exactly once when the full
// required set becomes visible.
func recordMemberUploadAndAdvance(
	ctx context.Context,
	q *db.Queries,
	nodeRun db.MulticaWorkflowNodeRun,
	submissions []db.UpsertNodeRunDeliverableSubmissionParams,
	output map[string]any,
) (db.MulticaWorkflowNodeRun, bool, error) {
	// Re-check before upserting for the TxStarter=nil test path. In production
	// the caller owns a FOR UPDATE lock from before repository side effects.
	fresh, err := q.GetWorkflowNodeRun(ctx, nodeRun.ID)
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("get node run: %w", err)
	}
	if fresh.Status != NodeRunStatusWorking && fresh.Status != NodeRunStatusWorkerAssigned {
		return db.MulticaWorkflowNodeRun{}, false, ErrNodeRunNotInWorkerPhase
	}
	for _, sub := range submissions {
		if _, err := q.UpsertNodeRunDeliverableSubmission(ctx, sub); err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("upsert submission: %w", err)
		}
	}
	satisfied, err := requiredDeliverablesSatisfiedWithQueries(ctx, q, fresh)
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("check deliverables: %w", err)
	}
	if !satisfied {
		return db.MulticaWorkflowNodeRun{}, false, nil
	}
	raw, err := json.Marshal(output)
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("marshal worker output: %w", err)
	}
	updated, err := q.SetWorkflowNodeRunWorkerOutputIfWorkerPhase(ctx, db.SetWorkflowNodeRunWorkerOutputIfWorkerPhaseParams{
		ID:           fresh.ID,
		WorkerOutput: raw,
		Status:       NodeRunStatusAwaitingCritic,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MulticaWorkflowNodeRun{}, false, ErrNodeRunNotInWorkerPhase
	}
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("set worker output: %w", err)
	}
	generation, err := NextWorkflowDispatchGeneration(ctx, q, fresh.ID, "critic")
	if err != nil {
		return db.MulticaWorkflowNodeRun{}, false, err
	}
	if err := EnqueueWorkflowDispatch(ctx, q, fresh.ID, "critic", generation); err != nil {
		return db.MulticaWorkflowNodeRun{}, false, err
	}
	return updated, true, nil
}

// linkArchiveHash returns a short stable hash of a member-submitted code link.
// It derives the per-link archive branch and file names so multiple links on
// one deliverable stay distinct, and a same-link resubmit lands on the same
// branch/file/PR (idempotent).
func linkArchiveHash(link string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(link)))
	return hex.EncodeToString(sum[:])[:8]
}

// UploadMemberDeliverablePR handles member-submitted code merge-request URLs
// for the issue's pull_request-kind deliverable. It mirrors
// UploadMemberDeliverable: each link is archived as a file on its own branch
// off inst, a Gitea PR (link branch -> inst) is opened per link, the PR URLs
// are registered on the deliverable's submissions (one row per link;
// re-submitting the same link is idempotent), and the node-run advances into
// review once every required deliverable is submitted — keeping the code flow
// identical to the document flow (no direct merge to inst). An optional
// summary rides into the worker output when the upload triggers the advance.
func (s *WorkflowService) UploadMemberDeliverablePR(ctx context.Context, issue db.MulticaIssue, pullRequestURLs []string, deliverableID, userID, summary string) error {
	if len(pullRequestURLs) == 0 {
		return errors.New("no pull request URLs to submit")
	}
	repoProvider := s.deliverableRepository()
	var uploadedNodeRunID pgtype.UUID
	err := s.runLockedMemberUpload(ctx, issue, func(q *db.Queries, run db.MulticaWorkflowRun, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaWorkflowNodeRun, bool, error) {
		uploadedNodeRunID = nodeRun.ID
		deliverables, err := q.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("list deliverables: %w", err)
		}
		deliverable, err := resolveUploadDeliverable(deliverables, deliverableID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, err
		}

		// Mirror the document flow: archive each code link as a file on its own
		// branch off inst and open a Gitea PR (link branch -> inst) so every link
		// goes through review like a document deliverable. Per-link branches keep
		// separate links independently reviewable and make retries idempotent.
		submissions := make([]db.UpsertNodeRunDeliverableSubmissionParams, 0, len(pullRequestURLs))
		var firstPRURL string
		if repoProvider.Configured() {
			workflow, err := workflowFromRunSnapshotWithQueries(ctx, q, run)
			if err != nil {
				return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("get run snapshot: %w", err)
			}
			topo, err := RunNodeTopoOrder(ctx, q, run.ID)
			if err != nil {
				return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("node topo order: %w", err)
			}
			nodeSeq := topo[util.UUIDToString(nodeRun.ID)]
			owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
			repo := DeliverableRepoNameForWorkflow(workflow)
			inst := gitea.InstBranch(util.UUIDToString(run.ID))
			nodeDir := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID))
			baseBranch := gitea.NodeBranch(nodeSeq, util.UUIDToString(nodeRun.ID))
			for _, link := range pullRequestURLs {
				hash := linkArchiveHash(link)
				branch := baseBranch + "-link-" + hash
				path := nodeDir + "/" + sanitizeArchiveFileName(deliverable.Title) + "-" + hash + ".md"
				content := fmt.Sprintf("# %s\n\n%s\n", deliverable.Title, link)
				if err := repoProvider.CreateBranch(ctx, owner, repo, branch, inst); err != nil {
					return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("create link branch: %w", err)
				}
				if err := repoProvider.UpsertFile(ctx, owner, repo, branch, path, content, "code merge request link: "+link); err != nil {
					return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("archive code link: %w", err)
				}
				prURL, err := repoProvider.OpenReviewRequest(ctx, owner, repo, branch, inst, "code deliverable "+util.UUIDToString(deliverable.ID))
				if err != nil {
					return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("open PR: %w", err)
				}
				if firstPRURL == "" {
					firstPRURL = prURL
				}
				submissions = append(submissions, db.UpsertNodeRunDeliverableSubmissionParams{
					WorkflowNodeRunID: nodeRun.ID,
					DeliverableID:     deliverable.ID,
					SubmittedByType:   "member",
					SubmittedByID:     util.MustParseUUID(userID),
					PullRequestUrl:    prURL,
				})
			}
		} else {
			// Dormant fallback: no Gitea — record the pasted links as-is.
			for _, link := range pullRequestURLs {
				submissions = append(submissions, db.UpsertNodeRunDeliverableSubmissionParams{
					WorkflowNodeRunID: nodeRun.ID,
					DeliverableID:     deliverable.ID,
					SubmittedByType:   "member",
					SubmittedByID:     util.MustParseUUID(userID),
					PullRequestUrl:    link,
				})
			}
		}

		return recordMemberUploadAndAdvance(ctx, q, nodeRun, submissions, workerOutputForAdvance(firstPRURL, summary))
	})
	if err != nil {
		return err
	}
	slog.Info("member code deliverable uploaded",
		"issue_id", util.UUIDToString(issue.ID), "node_run_id", util.UUIDToString(uploadedNodeRunID), "links", len(pullRequestURLs))
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

func (s *WorkflowService) UploadMemberDeliverable(ctx context.Context, issue db.MulticaIssue, files []MemberDeliverableFile, deliverableID, userID, summary string) error {
	repoProvider := s.deliverableRepository()
	if !repoProvider.Configured() {
		return errors.New("UploadMemberDeliverable: repository provider not configured")
	}
	if len(files) == 0 {
		return errors.New("no files to upload")
	}
	var uploadedNodeRunID pgtype.UUID
	var uploadedPRURL string
	err := s.runLockedMemberUpload(ctx, issue, func(q *db.Queries, run db.MulticaWorkflowRun, nodeRun db.MulticaWorkflowNodeRun) (db.MulticaWorkflowNodeRun, bool, error) {
		uploadedNodeRunID = nodeRun.ID
		workflow, err := workflowFromRunSnapshotWithQueries(ctx, q, run)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("get run snapshot: %w", err)
		}
		deliverables, err := q.ListNodeRunDeliverableRequirements(ctx, nodeRun.ID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("list deliverables: %w", err)
		}
		deliverable, err := resolveUploadDeliverable(deliverables, deliverableID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, err
		}

		topo, err := RunNodeTopoOrder(ctx, q, run.ID)
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("node topo order: %w", err)
		}
		nodeSeq := topo[util.UUIDToString(nodeRun.ID)]
		owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
		repo := DeliverableRepoNameForWorkflow(workflow)
		inst := gitea.InstBranch(util.UUIDToString(run.ID))
		deliverableSuffix := shortHexSafe(util.UUIDToString(deliverable.ID))
		nodeBranch := gitea.NodeBranch(nodeSeq, util.UUIDToString(nodeRun.ID)) + "-deliverable-" + deliverableSuffix
		nodeDir := gitea.NodeDir(nodeSeq, nodeRun.NodeTitle, util.UUIDToString(nodeRun.ID)) +
			"/deliverables/" + deliverableSuffix

		// Each document requirement owns a branch and archive directory. That
		// keeps same-named files and review PRs independent when a node defines
		// several document deliverables.
		if err := repoProvider.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("create node branch: %w", err)
		}
		for _, f := range files {
			raw, err := base64.StdEncoding.DecodeString(f.Content)
			if err != nil {
				return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("decode file %q: %w", f.Name, err)
			}
			filePath := nodeDir + "/" + sanitizeArchiveFileName(f.Name)
			if err := repoProvider.UpsertFile(ctx, owner, repo, nodeBranch, filePath, string(raw), "deliverable upload: "+f.Name); err != nil {
				return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("write deliverable file %q: %w", f.Name, err)
			}
		}
		prURL, err := repoProvider.OpenReviewRequest(ctx, owner, repo, nodeBranch, inst,
			"document deliverable "+util.UUIDToString(deliverable.ID))
		if err != nil {
			return db.MulticaWorkflowNodeRun{}, false, fmt.Errorf("open PR: %w", err)
		}
		uploadedPRURL = prURL

		submission := db.UpsertNodeRunDeliverableSubmissionParams{
			WorkflowNodeRunID: nodeRun.ID,
			DeliverableID:     deliverable.ID,
			SubmittedByType:   "member",
			SubmittedByID:     util.MustParseUUID(userID),
			Content:           "",
			PullRequestUrl:    prURL,
		}
		return recordMemberUploadAndAdvance(
			ctx,
			q,
			nodeRun,
			[]db.UpsertNodeRunDeliverableSubmissionParams{submission},
			workerOutputForAdvance(prURL, summary),
		)
	})
	if err != nil {
		return err
	}
	slog.Info("member deliverable uploaded",
		"issue_id", util.UUIDToString(issue.ID), "node_run_id", util.UUIDToString(uploadedNodeRunID), "pr_url", uploadedPRURL)
	return nil
}

// workerOutputForAdvance builds the worker output recorded when a member
// upload advances the node-run into review: the deliverable PR URL plus the
// member's optional execution summary.
func workerOutputForAdvance(prURL, summary string) map[string]any {
	output := map[string]any{"pull_request_url": prURL}
	if s := strings.TrimSpace(summary); s != "" {
		output["summary"] = s
	}
	return output
}

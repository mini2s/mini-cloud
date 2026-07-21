package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

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

	// 3. Sync workspace members into the org (TEAM_NAMESPACE_API §1.1: org
	//    members = team members) so they can read/PR-review the org's repos.
	//    Best-effort + count-gated: never blocks the run, only re-provisions
	//    when the member count changes since the last sync.
	s.syncWorkspaceMembers(ctx, run.WorkspaceID)
}

// ensureNodeRunBranch creates the node-run branch when a node enters execution.
func (s *WorkflowService) ensureNodeRunBranch(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	if s.Gitea == nil || !s.Gitea.Configured() {
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

	if _, err := gitea.ScaffoldRunDeliverable(ctx, s.Gitea, gitea.ScaffoldParams{
		WorkspaceID:   util.UUIDToString(run.WorkspaceID),
		WorkflowID:    util.UUIDToString(workflow.ID),
		RunID:         util.UUIDToString(run.ID),
		WorkflowTitle: workflow.Title,
	}); err != nil {
		return fmt.Errorf("scaffold run deliverable: %w", err)
	}

	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := gitea.RepoName(util.UUIDToString(run.WorkflowID))
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(util.UUIDToString(nodeRun.ID))
	if err := s.Gitea.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
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
	giteaMembers, err := s.Gitea.ListOrgMembers(ctx, org)
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

	if s.Gitea == nil || !s.Gitea.Configured() {
		return
	}

	wsIDStr := util.UUIDToString(workspaceID)
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		slog.Warn("provision workspace gitea: get workspace",
			"workspace_id", wsIDStr, "error", err)
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

// ArchiveReviewComment pushes the critic's review comment to the Gitea repo as
// a document (reviews/<nodeRunShort>/review.md on the inst branch), fulfilling
// the requirement that the review opinion is itself a deliverable archived to
// Gitea. Best-effort: errors are logged, never block the review.
func (s *WorkflowService) ArchiveReviewComment(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun, decision, comment string) {
	if s.Gitea == nil || !s.Gitea.Configured() || comment == "" {
		return
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		slog.Warn("archive review comment: get run", "error", err)
		return
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := gitea.RepoName(util.UUIDToString(run.WorkflowID))
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nrShort := shortHexSafe(util.UUIDToString(nodeRun.ID))
	path := "reviews/" + nrShort + "/review.md"
	content := fmt.Sprintf("# Review: %s\n\n**Decision:** %s\n\n**Comment:**\n\n%s\n", decision, decision, comment)
	if err := s.Gitea.CreateFile(ctx, owner, repo, inst, path, content, "review: "+decision); err != nil {
		slog.Warn("archive review comment: create file", "node_run_id", nrShort, "error", err)
		return
	}
	slog.Info("archived review comment", "node_run_id", nrShort, "decision", decision, "path", path)
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

// mergeDocumentDeliverables merges every document-type deliverable submission
// that has a pull_request_url, with bounded retry. Returns nil only if all such
// PRs merged; a non-nil error means at least one failed terminally (conflict) or
// after retries (transient) — the caller blocks the node run. Only called when
// s.Gitea is configured.
func (s *WorkflowService) mergeDocumentDeliverables(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) error {
	run, err := s.Queries.GetWorkflowRun(ctx, nodeRun.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get run: %w", err)
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := gitea.RepoName(util.UUIDToString(run.WorkflowID))

	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		return fmt.Errorf("list deliverables: %w", err)
	}
	isDoc := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		if d.Kind == "document" {
			isDoc[util.UUIDToString(d.ID)] = true
		}
	}

	submissions, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("list submissions: %w", err)
	}
	for _, sub := range submissions {
		if !isDoc[util.UUIDToString(sub.DeliverableID)] || sub.PullRequestUrl == "" {
			continue
		}
		index, err := gitea.ParsePullRequestIndex(sub.PullRequestUrl)
		if err != nil {
			return fmt.Errorf("parse PR url %q: %w", sub.PullRequestUrl, err)
		}
		if err := retryMergeDocPR(ctx, s.Gitea, owner, repo, index); err != nil {
			return fmt.Errorf("merge PR #%d: %w", index, err)
		}
	}
	return nil
}

// retryMergeDocPR calls MergePR with bounded backoff. A 409 conflict
// (gitea.ErrMergeConflict) is terminal — returned immediately, no retry. Other
// errors (5xx, network) are retried up to maxAttempts with exponential backoff.
func retryMergeDocPR(ctx context.Context, c *gitea.Client, owner, repo string, index int) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		err := c.MergePR(ctx, owner, repo, index)
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

// markDocumentSubmissionsApproved flips every document submission with a PR URL
// to status=approved (called after a successful merge). Best-effort: errors are
// logged, not returned — the merge already succeeded, so the node will complete
// regardless of a status-write hiccup here. The existing review_comment is
// preserved (the critic's comment lives on the node run, not the submission).
func (s *WorkflowService) markDocumentSubmissionsApproved(ctx context.Context, nodeRun db.MulticaWorkflowNodeRun) {
	deliverables, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nodeRun.WorkflowNodeID)
	if err != nil {
		slog.Warn("mark doc submissions approved: list deliverables", "error", err)
		return
	}
	isDoc := make(map[string]bool, len(deliverables))
	for _, d := range deliverables {
		if d.Kind == "document" {
			isDoc[util.UUIDToString(d.ID)] = true
		}
	}
	subs, err := s.Queries.ListNodeRunDeliverableSubmissions(ctx, nodeRun.ID)
	if err != nil {
		slog.Warn("mark doc submissions approved: list submissions", "error", err)
		return
	}
	for _, sub := range subs {
		if isDoc[util.UUIDToString(sub.DeliverableID)] && sub.PullRequestUrl != "" {
			if _, err := s.Queries.ReviewNodeRunDeliverableSubmission(ctx, db.ReviewNodeRunDeliverableSubmissionParams{
				ID:            sub.ID,
				Status:        "approved",
				ReviewComment: sub.ReviewComment, // preserve; critic comment is on the node run
			}); err != nil {
				slog.Warn("mark doc submission approved",
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
func (s *WorkflowService) UploadMemberDeliverable(ctx context.Context, issue db.MulticaIssue, content string) error {
	if s.Gitea == nil || !s.Gitea.Configured() {
		return errors.New("UploadMemberDeliverable: Gitea not configured")
	}
	if !issue.WorkflowRunID.Valid {
		return errors.New("issue has no workflow run (not routed to the default workflow)")
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
	for _, d := range deliverables {
		if d.Kind == "document" {
			deliverableID = d.ID
			break
		}
	}
	if !deliverableID.Valid {
		return errors.New("node has no document deliverable")
	}

	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	repo := gitea.RepoName(util.UUIDToString(run.WorkflowID))
	inst := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(util.UUIDToString(nodeRun.ID))
	path := gitea.DeliverablePath(util.UUIDToString(nodeRun.ID), util.UUIDToString(deliverableID))

	// Idempotent node branch (base = inst). CreateBranch is get-or-create
	// (handles the slash in node/<hex>, which GET /branches/{name} can't address).
	if err := s.Gitea.CreateBranch(ctx, owner, repo, nodeBranch, inst); err != nil {
		return fmt.Errorf("create node branch: %w", err)
	}
	if err := s.Gitea.CreateFile(ctx, owner, repo, nodeBranch, path, content, "deliverable upload"); err != nil {
		return fmt.Errorf("write deliverable file: %w", err)
	}
	prURL, err := s.Gitea.OpenPR(ctx, owner, repo, nodeBranch, inst,
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

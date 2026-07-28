package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/cloudruntime"
	"github.com/multica-ai/multica/server/internal/gitea"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	csCloudProvider             = "cs-cloud"
	failureReasonDispatchFailed = "dispatch_failed"
	csCloudPushTimeout          = 25 * time.Second
	csCloudAbortTimeout         = 10 * time.Second

	// promptMaxRunes limits the total prompt size sent to a cs-cloud device.
	// The gateway proxy body limit is not explicitly documented for the
	// internal route, so we stay conservative.
	promptMaxRunes = 64 * 1024
	// promptItemMaxRunes caps a single source (issue description, comment).
	promptItemMaxRunes = 32 * 1024
)

// csCloudTaskRunPayload is the JSON body posted to a cs-cloud device when a
// task is pushed. Fields are named to match cs-cloud's
// internal/workflow.TaskRunPayload with an additive kind field.
type csCloudTaskRunPayload struct {
	TaskID      string            `json:"task_id"`
	WorkspaceID string            `json:"workspace_id"`
	IssueID     string            `json:"issue_id,omitempty"`
	ProjectID   string            `json:"project_id,omitempty"`
	NodeRunID   string            `json:"node_run_id,omitempty"`
	AgentID     string            `json:"agent_id,omitempty"`
	Agent       string            `json:"agent"`
	Prompt      string            `json:"prompt"`
	Env         map[string]string `json:"env,omitempty"`
	// RepoURL is the workspace/project code repo the agent clones into its
	// worktree and develops in. Empty when the workspace has no code repo.
	RepoURL string `json:"repo_url,omitempty"`
	Kind    string `json:"kind,omitempty"`
}

// maybePushToCSCloud is called synchronously from notifyTaskAvailable. It
// spawns the actual push in a detached goroutine so the enqueueing HTTP
// request is not blocked by network IO.
func (s *TaskService) maybePushToCSCloud(task db.MulticaAgentTaskQueue) {
	if s.CSCloudPush == nil {
		// A nil client is a wiring bug, not a configuration choice — every
		// TaskService instance is expected to have one wired. Log loudly:
		// without this the task silently sits in 'queued' until the TTL
		// sweeper expires it (seen in production, took hours to diagnose).
		slog.Warn("cs-cloud push skipped: push client not wired",
			"task_id", util.UUIDToString(task.ID),
		)
		return
	}
	if !s.CSCloudPush.Enabled() {
		return // fleet URL not configured; cs-cloud push intentionally off
	}
	if !task.RuntimeID.Valid {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), csCloudPushTimeout)
		defer cancel()
		if err := s.dispatchTaskToCSCloud(ctx, task); err != nil {
			slog.Warn("cs-cloud push failed",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
		}
	}()
}

func (s *TaskService) dispatchTaskToCSCloud(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	runtime, err := s.Queries.GetAgentRuntime(ctx, task.RuntimeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // runtime gone; task will age out of queued
		}
		return fmt.Errorf("get runtime: %w", err)
	}
	if runtime.Provider != csCloudProvider {
		return nil
	}

	deviceID, err := csCloudDeviceID(runtime)
	if err != nil {
		return err
	}

	// Mark the task dispatched. If it left 'queued' (cancelled or claimed),
	// no row is returned and we abort the push.
	dispatched, err := s.Queries.MarkAgentTaskDispatched(ctx, task.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("mark dispatched: %w", err)
	}

	// Mirror the side effects of ClaimTask so UI/analytics see the same
	// task:dispatch flow as pull-based daemons.
	s.captureTaskDispatched(ctx, dispatched)
	s.ReconcileAgentStatus(ctx, dispatched.AgentID)
	s.broadcastTaskDispatch(ctx, dispatched)

	payload, err := s.buildCSCloudPayload(ctx, dispatched, runtime)
	if err != nil {
		// payload building is best-effort; if it fails we still failed
		// dispatch and should let auto-retry kick in.
		_, _ = s.FailTask(ctx, task.ID, "failed to build task payload: "+err.Error(), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("build payload: %w", err)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		_, _ = s.FailTask(ctx, task.ID, "failed to marshal task payload", "", "", failureReasonDispatchFailed)
		return fmt.Errorf("marshal payload: %w", err)
	}

	req := cloudruntime.Request{
		Method: http.MethodPost,
		Path:   fmt.Sprintf("/device/%s/proxy/api/v1/workflow/tasks/%s/run", deviceID, util.UUIDToString(task.ID)),
		Body:   body,
	}
	if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
		req.Headers = http.Header{}
		req.Headers.Set("X-Internal-Secret", secret)
	}

	resp, err := s.CSCloudPush.Do(ctx, req)
	if err != nil {
		_, _ = s.FailTask(ctx, task.ID, "push to device failed: "+err.Error(), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("push request: %w", err)
	}
	if resp.StatusCode >= 300 {
		bodySnippet := strings.TrimSpace(string(resp.Body))
		if len(bodySnippet) > 200 {
			bodySnippet = bodySnippet[:200] + "..."
		}
		_, _ = s.FailTask(ctx, task.ID, fmt.Sprintf("device returned %d: %s", resp.StatusCode, bodySnippet), "", "", failureReasonDispatchFailed)
		return fmt.Errorf("device returned %d", resp.StatusCode)
	}
	return nil
}

func (s *TaskService) buildCSCloudPayload(ctx context.Context, task db.MulticaAgentTaskQueue, runtime db.MulticaAgentRuntime) (csCloudTaskRunPayload, error) {
	kind := computeCSCloudTaskKind(task)
	prompt, err := s.buildCSCloudPrompt(ctx, task, kind)
	if err != nil {
		return csCloudTaskRunPayload{}, err
	}

	env := map[string]string{}
	if task.AgentID.Valid {
		agent, err := s.Queries.GetAgent(ctx, task.AgentID)
		if err == nil && len(agent.CustomEnv) > 0 {
			_ = json.Unmarshal(agent.CustomEnv, &env)
		}
	}
	// Gitea document-deliverable context (MULTICA_GITEA_*) + node-run/issue ids,
	// so the cs-cloud agent can run `cs-cloud workflow deliverable submit` / `gitea fetch`
	// inside the task. Dormant (no env injected) when Gitea isn't configured or
	// the node has no document deliverables — matches the claim-time context.
	repoEnv := s.repositoryDeliverableEnv(ctx, task)
	for k, v := range repoEnv {
		env[k] = v
	}
	if task.IssueID.Valid {
		env["MULTICA_ISSUE_ID"] = util.UUIDToString(task.IssueID)
	}
	phase := workflowPhaseFromTask(task)
	if phase == "critic" {
		prompt = appendCriticReviewPrompt(prompt)
	} else {
		if phase == "worker" {
			prompt = appendWorkerTaskPrompt(prompt)
		}
		if raw, ok := repoEnv["MULTICA_REPO_DELIVERABLES"]; ok {
			var refs []repositoryDeliverableRefJSON
			if json.Unmarshal([]byte(raw), &refs) == nil && len(refs) > 0 {
				prompt = appendDeliverablePrompt(prompt, refs)
			}
		}
		// Rework feedback: if this worker task is a retry (retry_count > 0),
		// surface the previous critic's rejection so the worker knows what to fix.
		if phase == "worker" && task.WorkflowNodeRunID.Valid {
			if nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID); err == nil && nr.RetryCount > 0 && nr.CriticComment.Valid {
				if fb := strings.TrimSpace(nr.CriticComment.String); fb != "" {
					prompt += fmt.Sprintf("\n\n---\n## 上一轮评审驳回意见（第 %d 轮）\n\n%s\n\n请针对以上评审意见修改后重新提交。\n", nr.RetryCount, fb)
				}
			}
		}
	}

	// Code repository: attach the workspace's code repo so cs-cloud clones it
	// into the worktree and the agent develops there. Worker phase only — the
	// critic/review phase doesn't code.
	codeRepoURL, projectID := "", ""
	if phase == "worker" {
		var gitlabToken string
		codeRepoURL, gitlabToken, projectID = s.resolveCodeRepoAndProject(ctx, task, runtime.WorkspaceID)
		if codeRepoURL != "" {
			env["MULTICA_CODE_REPO_URL"] = codeRepoURL
			if gitlabToken != "" {
				// GitLab PAT so cs-cloud can push + open the MR after coding.
				env["MULTICA_GITLAB_TOKEN"] = gitlabToken
			}
			prompt = appendCodeRepoPrompt(prompt, codeRepoURL)
		}
	}

	return csCloudTaskRunPayload{
		TaskID:      util.UUIDToString(task.ID),
		WorkspaceID: util.UUIDToString(runtime.WorkspaceID),
		IssueID:     util.UUIDToString(task.IssueID),
		ProjectID:   projectID,
		NodeRunID:   util.UUIDToString(task.WorkflowNodeRunID),
		AgentID:     util.UUIDToString(task.AgentID),
		Agent:       "csc",
		Prompt:      prompt,
		Env:         env,
		RepoURL:     codeRepoURL,
		Kind:        kind,
	}, nil
}

// resolveCodeRepoAndProject returns the workspace's first code repo URL (for
// cs-cloud to clone), the workspace's GitLab PAT (so cs-cloud can push + open
// the MR), and the issue's project ID. Best-effort: errors are logged and yield
// empty strings so a lookup hiccup never blocks dispatch.
func (s *TaskService) resolveCodeRepoAndProject(ctx context.Context, task db.MulticaAgentTaskQueue, workspaceID pgtype.UUID) (repoURL, gitlabToken, projectID string) {
	if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
		var repos []struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(ws.Repos, &repos) == nil {
			for _, r := range repos {
				if u := strings.TrimSpace(r.URL); u != "" {
					repoURL = u
					break
				}
			}
		}
		var settings struct {
			GitlabAccessToken string `json:"gitlab_access_token"`
		}
		if json.Unmarshal(ws.Settings, &settings) == nil {
			gitlabToken = strings.TrimSpace(settings.GitlabAccessToken)
		}
	} else {
		slog.Warn("cs-cloud code repo: get workspace", "error", err)
	}
	if task.IssueID.Valid {
		if issue, err := s.Queries.GetIssue(ctx, task.IssueID); err == nil && issue.ProjectID.Valid {
			projectID = util.UUIDToString(issue.ProjectID)
		}
	}
	return repoURL, gitlabToken, projectID
}

// appendCodeRepoPrompt tells the worker agent it is developing inside a cloned
// code repo and that the platform will push + open an MR from its changes.
func appendCodeRepoPrompt(prompt, repoURL string) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## 代码仓库开发\n\n")
	b.WriteString(fmt.Sprintf("你的工作树已 clone 了代码仓库 `%s`。请在该仓库内完成本次编码任务（直接编辑工作树中的文件即可，无需自行 clone）。\n", repoURL))
	b.WriteString("完成后平台会自动提交你的改动、推送源分支、开 Merge Request，并把 MR 链接上报到本节点的代码交付物。\n")
	b.WriteString("\n---\n\n")
	return b.String()
}

func appendWorkerTaskPrompt(prompt string) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## Workflow Worker Task\n\n")
	b.WriteString("You are the worker for this workflow node. Complete the assigned work and submit every required deliverable before finishing.\n")
	b.WriteString("Do NOT perform critic review. Do NOT approve or reject the work. If the issue text mentions a critic/reviewer, treat that as context for the later review phase, not your current task.\n")
	b.WriteString("\n---\n\n")
	return b.String()
}

// appendDeliverablePrompt adds a "Document Deliverables" section to the prompt.
// The deliverable repository is exposed to the agent as a normal git remote
// (authed clone URL in the task env), so reading/exploring is plain git; only
// the final submit — which opens the node->inst PR and registers it back here —
// goes through the `cs-cloud workflow deliverable submit` command.
func appendDeliverablePrompt(prompt string, refs []repositoryDeliverableRefJSON) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## Document Deliverables\n\n")
	b.WriteString("This node has document deliverables stored in the platform repository. The repository is exposed as a normal git remote: clone it with plain git using the authed URL in `$MULTICA_REPO_CLONE_URL_AUTHED` (credentials are already embedded, so clone/push just work; do not set up a separate credential helper). The instance branch is `$MULTICA_REPO_INST_BRANCH` and this node's branch is `$MULTICA_REPO_NODE_BRANCH`.\n\n")
	b.WriteString("For EACH deliverable below: write the document to a local file, then submit it with the CLI. The command pushes your file to the node branch, opens a review request (node -> inst), and registers the review URL back here. Do NOT use inline content upload for these; document deliverables go through git.\n\n")
	for _, d := range refs {
		fmt.Fprintf(&b, "- **%s** (id=%s): run `cs-cloud workflow deliverable submit --deliverable %s --file <local-path-to-your-document>`\n", d.Title, d.ID, d.ID)
	}
	b.WriteString("\nA deliverable is not considered submitted until its PR is registered. Complete every listed deliverable before finishing.\n\n")
	b.WriteString("### Reading the deliverable repository\n\n")
	b.WriteString("Use plain git to read or explore: `git clone $MULTICA_REPO_CLONE_URL_AUTHED` then `git checkout $MULTICA_REPO_INST_BRANCH` to see the current run's tree (this node's deliverables live under its node directory).\n\n")
	b.WriteString("To inspect the rest of the workflow chain — other issues' progress and their deliverable repositories — use the read commands instead of guessing URLs:\n")
	b.WriteString("- `cs-workflow issue workflow <issue-id> --descendants` — workflow run + node run status for this issue and its children.\n")
	b.WriteString("- `cs-workflow issue deliverables <issue-id> --descendants` — the Gitea repository address and deliverable list for this issue and its children; clone the inst branch to read another issue's documents.\n")
	b.WriteString("\n---\n\n")
	return b.String()
}

func appendCriticReviewPrompt(prompt string) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## Workflow Critic Review\n\n")
	b.WriteString("You are reviewing the worker's submitted deliverables for this workflow node. Inspect the issue context and deliverable PRs, then finish with a JSON object only:\n\n")
	b.WriteString("```json\n{\"approved\":true,\"comment\":\"short review opinion\"}\n```\n\n")
	b.WriteString("Use `approved:false` when the work needs rework, and put the actionable rejection reason in `comment`.\n\n")
	b.WriteString("---\n\n")
	return b.String()
}

func workflowPhaseFromTask(task db.MulticaAgentTaskQueue) string {
	if len(task.Context) == 0 {
		return ""
	}
	var payload struct {
		Phase string `json:"phase"`
	}
	if err := json.Unmarshal(task.Context, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.Phase)
}

// repositoryDeliverableRefJSON is the per-deliverable shape cs-cloud's
// `repo submit` reads from MULTICA_REPO_DELIVERABLES.
type repositoryDeliverableRefJSON struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

type giteaDeliverableRefJSON = repositoryDeliverableRefJSON

// giteaDeliverableEnv builds the MULTICA_GITEA_* env vars for a task's
// node-run, mirroring handler.giteaContextForNodeRun but in the service layer
// (the cs-cloud push path lives here, separate from claim). Returns nil when
// Gitea is dormant or the node has no document deliverables — the caller then
// injects nothing and the cs-cloud `gitea submit` command is simply unusable
// for this task (by design).
func (s *TaskService) repositoryDeliverableEnv(ctx context.Context, task db.MulticaAgentTaskQueue) map[string]string {
	base := strings.TrimSpace(os.Getenv("GITEA_BASE_URL"))
	if strings.TrimSpace(os.Getenv("GITEA_ADMIN_TOKEN")) == "" || base == "" || !task.WorkflowNodeRunID.Valid {
		return nil
	}
	nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		return nil
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nr.WorkflowRunID)
	if err != nil {
		return nil
	}
	deliverables, err := s.Queries.ListNodeRunDeliverableRequirements(ctx, nr.ID)
	if err != nil {
		return nil
	}
	// Use the node's topological position (not raw sort_order) so the <NN>
	// prefix reflects execution order even when sort_order wasn't set.
	topo, err := RunNodeTopoOrder(ctx, s.Queries, run.ID)
	if err != nil {
		return nil
	}
	nodeSeq := topo[util.UUIDToString(nr.ID)]
	nodeRunIDStr := util.UUIDToString(nr.ID)
	var refs []repositoryDeliverableRefJSON
	for _, d := range deliverables {
		if d.Kind != "document" {
			continue
		}
		refs = append(refs, giteaDeliverableRefJSON{
			ID:    util.UUIDToString(d.ID),
			Title: d.Title,
			Path:  gitea.DeliverablePath(nodeSeq, nr.NodeTitle, nodeRunIDStr, d.Title),
		})
	}
	if len(refs) == 0 {
		return nil
	}
	publicBase := strings.TrimSpace(os.Getenv("GITEA_PUBLIC_BASE_URL"))
	if publicBase == "" {
		publicBase = base
	}
	owner := gitea.OrgName(util.UUIDToString(run.WorkspaceID))
	snapshot, err := (WorkflowRuntimeRepository{Queries: s.Queries}).GetRunDefinitionSnapshot(ctx, run.ID)
	if err != nil {
		return nil
	}
	repo := DeliverableRepoName(run.WorkflowID, snapshot.Workflow.IsDefault)
	refsJSON, _ := json.Marshal(refs)
	// Bot PAT + Gitea base URL are pushed down so cs-cloud's `deliverable submit`
	// can push the document + open a PR against Gitea directly, without relaying
	// back through multica to fetch credentials. The PAT lives in workspace
	// settings (minted by the team-namespace provisioning flow).
	pat := ""
	botUser := ""
	if ws, err := s.Queries.GetWorkspace(ctx, run.WorkspaceID); err == nil && len(ws.Settings) > 0 {
		settingsMap := map[string]any{}
		if json.Unmarshal(ws.Settings, &settingsMap) == nil {
			if v, ok := settingsMap["gitea_pat"].(string); ok {
				pat = v
			}
			if v, ok := settingsMap["gitea_bot_username"].(string); ok {
				botUser = v
			}
		}
	}
	cloneURL := strings.TrimRight(publicBase, "/") + "/" + owner + "/" + repo + ".git"
	baseURL := strings.TrimRight(publicBase, "/")
	authedCloneURL := injectGiteaToken(cloneURL, botUser, pat)
	instBranch := gitea.InstBranch(util.UUIDToString(run.ID))
	nodeBranch := gitea.NodeBranch(nodeSeq, nodeRunIDStr)
	out := map[string]string{
		"MULTICA_NODE_RUN_ID":           nodeRunIDStr,
		"MULTICA_REPO_PROVIDER":         "gitea",
		"MULTICA_REPO_OWNER":            owner,
		"MULTICA_REPO_NAME":             repo,
		"MULTICA_REPO_BASE_URL":         baseURL,
		"MULTICA_REPO_TOKEN":            pat,
		"MULTICA_REPO_CLONE_URL":        cloneURL,
		"MULTICA_REPO_CLONE_URL_AUTHED": authedCloneURL,
		"MULTICA_REPO_INST_BRANCH":      instBranch,
		"MULTICA_REPO_NODE_BRANCH":      nodeBranch,
		"MULTICA_REPO_DELIVERABLES":     string(refsJSON),
	}
	for oldKey, newKey := range map[string]string{
		"MULTICA_GITEA_OWNER":            "MULTICA_REPO_OWNER",
		"MULTICA_GITEA_REPO":             "MULTICA_REPO_NAME",
		"MULTICA_GITEA_BASE_URL":         "MULTICA_REPO_BASE_URL",
		"MULTICA_GITEA_TOKEN":            "MULTICA_REPO_TOKEN",
		"MULTICA_GITEA_CLONE_URL":        "MULTICA_REPO_CLONE_URL",
		"MULTICA_GITEA_CLONE_URL_AUTHED": "MULTICA_REPO_CLONE_URL_AUTHED",
		"MULTICA_GITEA_INST_BRANCH":      "MULTICA_REPO_INST_BRANCH",
		"MULTICA_GITEA_NODE_BRANCH":      "MULTICA_REPO_NODE_BRANCH",
		"MULTICA_GITEA_DELIVERABLES":     "MULTICA_REPO_DELIVERABLES",
	} {
		out[oldKey] = out[newKey]
	}
	return out
}

func (s *TaskService) giteaDeliverableEnv(ctx context.Context, task db.MulticaAgentTaskQueue) map[string]string {
	return s.repositoryDeliverableEnv(ctx, task)
}

// injectGiteaToken embeds the bot credential into a Gitea clone URL so the
// agent can git clone/push without a separate credential step. It uses the bot
// username when known, falling back to the "oauth2" pseudo-user that Gitea
// accepts for any PAT. Returns the URL unchanged when the token is empty.
func injectGiteaToken(cloneURL, botUser, token string) string {
	if strings.TrimSpace(token) == "" {
		return cloneURL
	}
	u, err := url.Parse(strings.TrimSpace(cloneURL))
	if err != nil || u.Host == "" {
		return cloneURL
	}
	user := strings.TrimSpace(botUser)
	if user == "" {
		user = "oauth2"
	}
	u.User = url.UserPassword(user, token)
	return u.String()
}

func computeCSCloudTaskKind(task db.MulticaAgentTaskQueue) string {
	if util.UUIDToString(task.ChatSessionID) != "" {
		return "chat"
	}
	if util.UUIDToString(task.AutopilotRunID) != "" {
		return "autopilot"
	}
	if util.UUIDToString(task.IssueID) == "" {
		return "quick_create"
	}
	if util.UUIDToString(task.TriggerCommentID) != "" {
		return "comment"
	}
	return "direct"
}

func (s *TaskService) buildCSCloudPrompt(ctx context.Context, task db.MulticaAgentTaskQueue, kind string) (string, error) {
	switch kind {
	case "chat":
		return s.buildChatPrompt(ctx, task)
	case "quick_create":
		if qc, ok := s.parseQuickCreateContext(task); ok {
			return qc.Prompt, nil
		}
		return "", nil
	case "autopilot":
		return s.buildAutopilotPrompt(ctx, task)
	case "comment":
		return s.buildIssueCommentPrompt(ctx, task)
	default:
		// direct / fallback
		return s.buildIssuePrompt(ctx, task)
	}
}

func (s *TaskService) buildIssuePrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.IssueID.Valid {
		return "", nil
	}
	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		return "", fmt.Errorf("get issue: %w", err)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Issue: %s\n", issue.Title)
	if issue.Description.Valid {
		b.WriteString("\n")
		b.WriteString(truncatePromptItem(issue.Description.String))
		b.WriteString("\n")
	}
	return truncatePrompt(b.String()), nil
}

func (s *TaskService) buildIssueCommentPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	issuePrompt, err := s.buildIssuePrompt(ctx, task)
	if err != nil {
		return "", err
	}
	if !task.TriggerCommentID.Valid {
		return issuePrompt, nil
	}
	comment, err := s.Queries.GetComment(ctx, task.TriggerCommentID)
	if err != nil {
		// Comment missing/deleted is not fatal; fall back to the issue prompt.
		return issuePrompt, nil
	}
	var b strings.Builder
	b.WriteString(issuePrompt)
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	fmt.Fprintln(&b, "New comment:")
	b.WriteString(truncatePromptItem(comment.Content))
	b.WriteString("\n")
	return truncatePrompt(b.String()), nil
}

func (s *TaskService) buildChatPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.ChatSessionID.Valid {
		return "", nil
	}
	msgs, err := s.Queries.ListChatMessages(ctx, task.ChatSessionID)
	if err != nil {
		return "", fmt.Errorf("list chat messages: %w", err)
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return truncatePrompt(fmt.Sprintf("You are a coding assistant in a Multica chat session.\n\n%s", msgs[i].Content)), nil
		}
	}
	return "", nil
}

func (s *TaskService) buildAutopilotPrompt(ctx context.Context, task db.MulticaAgentTaskQueue) (string, error) {
	if !task.AutopilotRunID.Valid {
		return "", nil
	}
	run, err := s.Queries.GetAutopilotRun(ctx, task.AutopilotRunID)
	if err != nil {
		return "", fmt.Errorf("get autopilot run: %w", err)
	}
	var b strings.Builder
	if run.IssueID.Valid {
		issue, err := s.Queries.GetIssue(ctx, run.IssueID)
		if err == nil {
			fmt.Fprintf(&b, "Issue: %s\n", issue.Title)
			if issue.Description.Valid {
				b.WriteString("\n")
				b.WriteString(truncatePromptItem(issue.Description.String))
				b.WriteString("\n")
			}
		}
	}
	if run.TriggerPayload != nil {
		var payload map[string]any
		if err := json.Unmarshal(run.TriggerPayload, &payload); err == nil {
			b.WriteString("\nTrigger: ")
			enc := json.NewEncoder(&b)
			enc.SetEscapeHTML(false)
			_ = enc.Encode(payload)
		}
	}
	return truncatePrompt(b.String()), nil
}

func csCloudDeviceID(runtime db.MulticaAgentRuntime) (string, error) {
	if len(runtime.Metadata) > 0 {
		var meta map[string]any
		if err := json.Unmarshal(runtime.Metadata, &meta); err == nil {
			if id, _ := meta["device_id"].(string); id != "" {
				return id, nil
			}
		}
	}
	if runtime.DaemonID.Valid && runtime.DaemonID.String != "" {
		return runtime.DaemonID.String, nil
	}
	return "", fmt.Errorf("cs-cloud runtime %s has no device_id", util.UUIDToString(runtime.ID))
}

// truncatePromptItem caps a single prompt source, keeping the head.
func truncatePromptItem(s string) string {
	if len(s) <= promptItemMaxRunes {
		return s
	}
	return string([]rune(s)[:promptItemMaxRunes]) + "\n... (truncated)"
}

// truncatePrompt caps the total prompt size, keeping the head and marking
// truncation clearly.
func truncatePrompt(s string) string {
	runes := []rune(s)
	if len(runes) <= promptMaxRunes {
		return s
	}
	return string(runes[:promptMaxRunes]) + "\n... (truncated)"
}

// maybeAbortOnDevice pushes an abort request to a cs-cloud device when a
// dispatched or running task is cancelled. It is best-effort: a missed abort
// leaves the agent running at most until its own timeout, and its completion
// callback will be ignored by an already-finalized task.
func (s *TaskService) maybeAbortOnDevice(task db.MulticaAgentTaskQueue) {
	if s.CSCloudPush == nil || !s.CSCloudPush.Enabled() {
		return
	}
	if task.Status != "dispatched" && task.Status != "running" {
		return
	}
	if !task.RuntimeID.Valid {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), csCloudAbortTimeout)
		defer cancel()

		runtime, err := s.Queries.GetAgentRuntime(ctx, task.RuntimeID)
		if err != nil || runtime.Provider != csCloudProvider {
			return
		}
		deviceID, err := csCloudDeviceID(runtime)
		if err != nil {
			slog.Warn("cs-cloud abort: no device id",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
			return
		}

		req := cloudruntime.Request{
			Method: http.MethodPost,
			Path:   fmt.Sprintf("/device/%s/proxy/api/v1/workflow/tasks/%s/abort", deviceID, util.UUIDToString(task.ID)),
		}
		if secret := os.Getenv("COSTRICT_INTERNAL_SECRET"); secret != "" {
			req.Headers = http.Header{}
			req.Headers.Set("X-Internal-Secret", secret)
		}
		if _, err := s.CSCloudPush.Do(ctx, req); err != nil {
			slog.Warn("cs-cloud abort failed",
				"task_id", util.UUIDToString(task.ID),
				"error", err,
			)
		}
	}()
}

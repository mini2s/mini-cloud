package service

import (
	"bytes"
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
	"github.com/multica-ai/multica/server/internal/plugincatalog"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	// csCloudProvider identifies a cs-cloud device runtime for task dispatch
	// (dispatchTaskToCSCloud / maybeAbortOnDevice gate on runtime.Provider ==
	// this value). It MUST stay equal to csCloudRuntimeProvider in
	// internal/handler/issue_conversation.go and to the provider value cs-cloud
	// registers (internal/workflowrunner/driver.go, const providerCSCloud, in
	// the cs-cloud repo). "csc" is the agent CLI name, NOT this provider value.
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

// csCloudRepoSpec describes one repository the agent may work in.
type csCloudRepoSpec struct {
	URL        string `json:"url"`
	Provider   string `json:"provider"`            // "gitlab" | "gitea"
	Role       string `json:"role"`                // "code" | "delivery"
	BaseBranch string `json:"base_branch"`         // code=remote default; delivery=inst branch
	Alias      string `json:"alias,omitempty"`     // semantic label for the agent
	BotToken   string `json:"bot_token,omitempty"` // delivery only (Gitea team bot); code omits (CLI reads live)
}

// csCloudDeliverableSpec is one deliverable contract for the node.
type csCloudDeliverableSpec struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`                 // "document" | "pull_request"
	RepoAlias string            `json:"repo_alias,omitempty"` // maps to repos[].alias
	Report    csCloudReportSpec `json:"report"`
}

// csCloudReportSpec describes the HTTP endpoint where a deliverable result is posted.
type csCloudReportSpec struct {
	Endpoint  string `json:"endpoint"`
	Method    string `json:"method"`
	BodyField string `json:"body_field"`
}

// csCloudAgentPlugin mirrors cs-cloud's workflow.PluginSpec: the plugin bound
// to an agent, installed by cs-cloud into the task workdir before the csc
// session runs. Nil/empty in the payload means no plugin.
type csCloudAgentPlugin struct {
	ID      string                `json:"id"`
	Name    string                `json:"name"`
	Install *csCloudPluginInstall `json:"install,omitempty"`
}

// csCloudPluginInstall describes how to install a plugin from a marketplace.
// Mirrors cs-cloud's workflow.PluginInstallSpec / multica's plugincatalog.PluginInstall.
type csCloudPluginInstall struct {
	Method              string `json:"method"`
	Marketplace         string `json:"marketplace"`
	PluginName          string `json:"plugin_name"`
	MarketplaceName     string `json:"marketplace_name"`
	MarketplaceRepo     string `json:"marketplace_repo"`
	MarketplaceVerified bool   `json:"marketplace_verified"`
}

// csCloudCloudSkillInstall mirrors cs-cloud's workflow.CloudSkillInstall: a
// cloud catalog skill binding cs-cloud installs via `csc skill install`.
type csCloudCloudSkillInstall struct {
	ID          string                        `json:"id"`
	Slug        string                        `json:"slug,omitempty"`
	Name        string                        `json:"name"`
	Description string                        `json:"description"`
	Install     *csCloudCloudSkillInstallSpec `json:"install"`
	Position    int32                         `json:"position"`
}

// csCloudCloudSkillInstallSpec is the executable subset of cloud skill install
// metadata. Mirrors cs-cloud's workflow.CloudSkillInstallSpec. Only the
// allowlisted keys {method, spec, skill_id, source_url, verified} are kept
// (matching handler.allowlistedCatalogSkillInstall).
type csCloudCloudSkillInstallSpec struct {
	Method    string `json:"method,omitempty"`
	Spec      string `json:"spec,omitempty"`
	SkillID   string `json:"skill_id,omitempty"`
	SourceURL string `json:"source_url,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
}

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
	// deprecated: Task 3 uses Repos instead.
	RepoURL string `json:"repo_url,omitempty"`
	Kind    string `json:"kind,omitempty"`
	// PriorSessionID is the csc session id of the last task on the same
	// (agent, issue), so cs-cloud resumes the conversation context. Empty on
	// first round, manual rerun, or runtime mismatch (session is device-scoped).
	PriorSessionID string `json:"prior_session_id,omitempty"`
	// PriorWorkDir is the workdir of the last task on the same (agent, issue),
	// so cs-cloud reuses (resets) the same checkout. Empty on first round.
	PriorWorkDir string                   `json:"prior_work_dir,omitempty"`
	Repos        []csCloudRepoSpec        `json:"repos,omitempty"`
	Deliverables []csCloudDeliverableSpec `json:"deliverables,omitempty"`
	// Plugin is the agent's bound plugin for cs-cloud to install before the
	// session runs. Nil when the agent has no plugin.
	Plugin *csCloudAgentPlugin `json:"plugin,omitempty"`
	// CloudSkills are the agent's cloud catalog skill bindings for cs-cloud to
	// install before the session runs. Empty when the agent has none.
	CloudSkills []csCloudCloudSkillInstall `json:"cloud_skills,omitempty"`
}

// shouldSkipPriorTaskState reports whether the task should start a fresh
// session/workdir instead of resuming the prior (agent, issue) conversation.
// Mirrors handler.shouldSkipPriorTaskState but lives in the service package
// (cross-package import is not allowed). The handler's split_chat check is
// omitted here because split tasks are daemon-only and never dispatched to
// cs-cloud, so only the manual-rerun (ForceFreshSession) gate remains.
func shouldSkipPriorTaskState(t db.MulticaAgentTaskQueue) bool {
	return t.ForceFreshSession
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

	// Hoist phase + deliverables so the Task-2 safety net can fire BEFORE
	// env/repos[] assembly — that way the just-provisioned settings are visible
	// to repositoryDeliverableEnv (CS_CLOUD_REPO_* env) and resolveDeliveryRepo
	// (repos[] role=delivery) on the CURRENT dispatch, not just the next one.
	// Deliverables stays empty for non-worker (critic) phases: critic tasks
	// review, they don't submit, so they must not emit a Deliverables slice.
	phase := workflowPhaseFromTask(task)
	deliverables := []csCloudDeliverableSpec{}
	if phase == "worker" {
		deliverables = s.deliverableSpecsForTask(ctx, task)
	}
	// Any deliverable (document OR pull_request): ensure Gitea wf repo + inst
	// branch exist (safety net if run-start ScaffoldRunDeliverables
	// failed/skipped). M5 decision ① widens this from document-only to any
	// deliverable — code-only runs get a Gitea repo too, so Task 3's
	// ArchiveCodeDeliverable has a place to write. Idempotent — re-running
	// initWorkflowNamespace on an already-provisioned workspace is a no-op.
	// Best-effort: errors are logged, never block dispatch (the payload still
	// goes out; a later re-run or member upload recovers).
	if phase == "worker" && hasAnyDeliverableSpec(deliverables) && s.teamNamespaceConfigured() && s.settingsLackGiteaData(ctx, runtime.WorkspaceID) {
		if err := s.ensureDeliveryRepo(ctx, task); err != nil {
			slog.Warn("cs-cloud dispatch: ensure delivery repo",
				"task_id", util.UUIDToString(task.ID), "error", err)
		}
	}

	env := map[string]string{}
	var agentPluginID pgtype.Text
	if task.AgentID.Valid {
		agent, err := s.Queries.GetAgent(ctx, task.AgentID)
		if err == nil {
			agentPluginID = agent.PluginID
			if len(agent.CustomEnv) > 0 {
				_ = json.Unmarshal(agent.CustomEnv, &env)
			}
		}
	}
	// Gitea document-deliverable context (CS_CLOUD_REPO_*) + node-run/issue ids,
	// so the cs-cloud agent can run `cs-cloud workflow deliverable submit` /
	// `gitea fetch` inside the task. Dormant (no env injected) when Gitea isn't
	// configured or the node has no document deliverables — matches the
	// claim-time context. Runs AFTER the safety net so it picks up freshly
	// provisioned settings on the triggering dispatch.
	repoEnv := s.repositoryDeliverableEnv(ctx, task)
	for k, v := range repoEnv {
		env[k] = v
	}
	if task.IssueID.Valid {
		env["CS_CLOUD_ISSUE_ID"] = util.UUIDToString(task.IssueID)
	}
	if phase == "critic" {
		prompt = appendCriticReviewPrompt(prompt)
	} else {
		if phase == "worker" {
			prompt = appendWorkerTaskPrompt(prompt)
		}
		if raw, ok := repoEnv["CS_CLOUD_REPO_DELIVERABLES"]; ok {
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

	// Repos: code repos (workspace/project, role=code) + the Gitea delivery
	// repo (role=delivery). Worker phase only — the critic/review phase doesn't
	// code or submit documents.
	repos := []csCloudRepoSpec{}
	projectID := ""
	var gitlabToken string
	if phase == "worker" {
		repos, gitlabToken, projectID = s.resolveCodeRepoAndProject(ctx, task, runtime.WorkspaceID)
		if len(repos) > 0 {
			if gitlabToken != "" {
				env["CS_CLOUD_GITLAB_TOKEN"] = gitlabToken
			}
			prompt = appendCodeRepoPrompt(prompt, repos)
		}
		// Append the Gitea wf delivery repo (inst base branch + bot PAT) when
		// the workspace has been provisioned. The agent checks it out via
		// `cs-cloud repo checkout <url>` (Task 7's prompt) and uses it for
		// document deliverables. Separate from code repos — has its own alias
		// ("delivery") so appendCodeRepoPrompt's listing is unaffected.
		if dr, ok := s.resolveDeliveryRepo(ctx, runtime.WorkspaceID); ok {
			repos = append(repos, dr)
		}
	}

	// Plugin + CloudSkills: resolve the agent's bound plugin (catalog fetch +
	// server-owned marketplace identity) and snapshot its cloud skills, so
	// cs-cloud installs them in the task workdir before the csc session runs.
	// Worker phase only — critic/review doesn't need them. Best-effort plugin
	// resolution: a catalog hiccup leaves Plugin nil and dispatch proceeds.
	var plugin *csCloudAgentPlugin
	var cloudSkills []csCloudCloudSkillInstall
	if phase != "critic" && task.AgentID.Valid {
		plugin, cloudSkills = s.resolveCSCloudAddons(ctx, task.AgentID, agentPluginID)
	}

	// Diagnostic: plugin resolution has four serial gates (phase, agent
	// plugin_id, BuiltinPluginAPIBaseURL, catalog fetch) and three of them fail
	// SILENTLY — a nil plugin reaches cs-cloud with no backend log, so plugin=none
	// is impossible to root-cause from logs alone. Surface the inputs + outcome
	// here so the next dispatch self-diagnoses which gate dropped it. Info, not
	// Warn: a legitimately plugin-less agent is normal; filter on the message.
	agentPluginIDStr := ""
	if agentPluginID.Valid {
		agentPluginIDStr = agentPluginID.String
	}
	slog.Info("cs-cloud dispatch: plugin/skill resolution",
		"task_id", util.UUIDToString(task.ID),
		"agent_id", util.UUIDToString(task.AgentID),
		"phase", phase,
		"agent_plugin_id", agentPluginIDStr,
		"base_url_configured", s.BuiltinPluginAPIBaseURL != "",
		"plugin_resolved", plugin != nil,
		"cloud_skills", len(cloudSkills),
	)

	// Prior (agent, issue) session/workdir so cs-cloud resumes the conversation
	// and reuses the checkout. Ported from the pull path (handler/daemon.go).
	// PriorSessionID is device-scoped: a csc session on device A cannot be
	// resumed on device B, so forward it only when the prior task ran on the
	// same runtime. PriorWorkDir is forwarded regardless — a missing dir on a
	// different device just makes cs-cloud fall back to a fresh Prepare.
	priorSessionID, priorWorkDir := "", ""
	if !shouldSkipPriorTaskState(task) && task.AgentID.Valid && task.IssueID.Valid {
		if prior, err := s.Queries.GetLastTaskSession(ctx, db.GetLastTaskSessionParams{
			AgentID: task.AgentID,
			IssueID: task.IssueID,
		}); err == nil && prior.SessionID.Valid {
			if prior.RuntimeID == task.RuntimeID {
				priorSessionID = prior.SessionID.String
			}
			if prior.WorkDir.Valid {
				priorWorkDir = prior.WorkDir.String
			}
		}
	}

	// Workflow node-run handback: if GetLastTaskSession missed (no issue, or no
	// matching prior), fall back to the node-run's bound CSC session. Lets
	// workflow tasks (issue_id NULL) continue via the node-run session binding.
	// Runtime must match — a session can only resume on the runtime that owns it.
	// Ported from handler/daemon.go (pull path).
	if !shouldSkipPriorTaskState(task) && priorSessionID == "" && task.WorkflowNodeRunID.Valid {
		if nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID); err == nil {
			if nr.SessionID.Valid && nr.RuntimeID.Valid && nr.RuntimeID == task.RuntimeID {
				priorSessionID = nr.SessionID.String
			}
		}
	}

	return csCloudTaskRunPayload{
		TaskID:         util.UUIDToString(task.ID),
		WorkspaceID:    util.UUIDToString(runtime.WorkspaceID),
		IssueID:        util.UUIDToString(task.IssueID),
		ProjectID:      projectID,
		NodeRunID:      util.UUIDToString(task.WorkflowNodeRunID),
		AgentID:        util.UUIDToString(task.AgentID),
		Agent:          "csc",
		Prompt:         prompt,
		Env:            env,
		Repos:          repos,
		Deliverables:   deliverables,
		Plugin:         plugin,
		CloudSkills:    cloudSkills,
		Kind:           kind,
		PriorSessionID: priorSessionID,
		PriorWorkDir:   priorWorkDir,
	}, nil
}

// resolveCodeRepoAndProject returns all code repos for the task's issue,
// the workspace's GitLab PAT, and the issue's project ID.
//
// Project-bound github_repo resources take priority (all collected). If the
// issue's project has no github_repo resources, falls back to all non-empty
// workspace repos. Best-effort: errors are logged and yield empty results so a
// lookup hiccup never blocks dispatch.
func (s *TaskService) resolveCodeRepoAndProject(ctx context.Context, task db.MulticaAgentTaskQueue, workspaceID pgtype.UUID) (repos []csCloudRepoSpec, gitlabToken, projectID string) {
	// 1. Try project github_repo resources (override workspace repos).
	if task.IssueID.Valid {
		if issue, err := s.Queries.GetIssue(ctx, task.IssueID); err == nil && issue.ProjectID.Valid {
			projectID = util.UUIDToString(issue.ProjectID)
			rows, err := s.Queries.ListProjectResources(ctx, issue.ProjectID)
			if err == nil {
				for _, row := range rows {
					if row.ResourceType != "github_repo" {
						continue
					}
					var ref struct {
						URL string `json:"url"`
					}
					if json.Unmarshal(row.ResourceRef, &ref) == nil && strings.TrimSpace(ref.URL) != "" {
						repos = append(repos, csCloudRepoSpec{
							URL:      strings.TrimSpace(ref.URL),
							Provider: "gitlab",
							Role:     "code",
						})
					}
				}
			}
		}
	}

	// 2. Read workspace settings (gitlab token needed regardless of repo path).
	if ws, err := s.Queries.GetWorkspace(ctx, workspaceID); err == nil {
		var settings struct {
			GitlabAccessToken string `json:"gitlab_access_token"`
		}
		if json.Unmarshal(ws.Settings, &settings) == nil {
			gitlabToken = strings.TrimSpace(settings.GitlabAccessToken)
		}

		// 3. Fallback: if project had no github_repo resources, use all workspace repos.
		if len(repos) == 0 {
			var wsRepos []struct {
				URL string `json:"url"`
			}
			if json.Unmarshal(ws.Repos, &wsRepos) == nil {
				for _, r := range wsRepos {
					if u := strings.TrimSpace(r.URL); u != "" {
						repos = append(repos, csCloudRepoSpec{
							URL:      u,
							Provider: "gitlab",
							Role:     "code",
						})
					}
				}
			}
		}
	} else {
		slog.Warn("cs-cloud code repo: get workspace", "error", err)
	}
	return repos, gitlabToken, projectID
}

// resolveDeliveryRepo reads the Gitea delivery repo bundle from workspace.settings
// (gitea_clone_url + last_instance_branch + gitea_pat), written by the
// team-namespace interface-8 InitWorkflow path, and assembles a csCloudRepoSpec
// with role="delivery" + alias="delivery". Returns ok=false when the workspace
// lacks a complete bundle (any of the three fields missing/empty); completeness
// is judged by giteaProvisioningBundle.complete, shared with settingsLackGiteaData
// so the two helpers can never disagree on "Gitea data present".
//
// The agent authenticates via the CS_CLOUD_REPO_TOKEN env (already injected by
// repositoryDeliverableEnv from the same settings), so the URL stays plain
// (no embedded creds) and gitea_bot_username is not needed here. BotToken is
// populated in the spec for forward-compat — cs-cloud's RepoSpec currently
// consumes URL/Provider/Role/BaseBranch/Alias only, but a future change may
// read bot_token for checkout auth.
func (s *TaskService) resolveDeliveryRepo(ctx context.Context, workspaceID pgtype.UUID) (csCloudRepoSpec, bool) {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return csCloudRepoSpec{}, false
	}
	if len(ws.Settings) == 0 {
		return csCloudRepoSpec{}, false
	}
	var bundle giteaProvisioningBundle
	if err := json.Unmarshal(ws.Settings, &bundle); err != nil {
		return csCloudRepoSpec{}, false
	}
	if !bundle.complete() {
		return csCloudRepoSpec{}, false
	}
	return csCloudRepoSpec{
		URL:        rewriteGiteaHostToPublic(bundle.GiteaCloneURL),
		Provider:   "gitea",
		Role:       "delivery",
		BaseBranch: strings.TrimSpace(bundle.InstBranch),
		Alias:      "delivery",
		BotToken:   strings.TrimSpace(bundle.GiteaPAT),
	}, true
}

// resolveCSCloudAddons resolves an agent's bound plugin and cloud-skill bindings
// into the cs-cloud payload shape, so cs-cloud can install them in the task
// workdir before the csc session runs. This is the server-side (backend)
// equivalent of the daemon claim path's plugin/skill resolution — the daemon is
// not involved.
//
// Plugin resolution is best-effort (mirrors the claim path): a catalog miss or
// unreachable API returns a nil plugin and a warning, never blocking dispatch.
// The marketplace identity is server-owned (CSCPluginMarketplaceName/Repo) and
// stamped here regardless of what the catalog returned — identical to
// handler/daemon.go claim-time behavior.
//
// Cloud skills are snapshotted in multica_agent_cloud_skill (written by the
// agent-cloud-skill handler); the stored install JSONB is already allowlisted
// to {method, spec, skill_id, source_url, verified}, matching cs-cloud's
// CloudSkillInstallSpec field names, so it is passed through verbatim.
func (s *TaskService) resolveCSCloudAddons(ctx context.Context, agentID pgtype.UUID, pluginID pgtype.Text) (*csCloudAgentPlugin, []csCloudCloudSkillInstall) {
	var plugin *csCloudAgentPlugin
	if pluginID.Valid && strings.TrimSpace(pluginID.String) != "" && s.BuiltinPluginAPIBaseURL != "" {
		pd := plugincatalog.Fetch(ctx, s.BuiltinPluginAPIBaseURL, pluginID.String)
		if pd != nil && pd.Info != nil {
			info := pd.Info
			// Marketplace identity is server-owned, not catalog-owned. Override
			// whatever the catalog returned; an empty config value is delivered
			// as-is and cs-cloud falls back to its built-in github default.
			install := csCloudPluginInstall{
				Method:              info.Install.Method,
				Marketplace:         info.Install.Marketplace,
				PluginName:          info.Install.PluginName,
				MarketplaceName:     s.CSCPluginMarketplaceName,
				MarketplaceRepo:     s.CSCPluginMarketplaceRepo,
				MarketplaceVerified: info.Install.MarketplaceVerified,
			}
			plugin = &csCloudAgentPlugin{ID: info.ID, Name: info.Name, Install: &install}
		} else {
			slog.Warn("cs-cloud dispatch: plugin not resolved from catalog",
				"plugin_id", pluginID.String)
		}
	}

	var cloudSkills []csCloudCloudSkillInstall
	if rows, err := s.Queries.ListAgentCloudSkills(ctx, agentID); err == nil {
		for _, r := range rows {
			cloudSkills = append(cloudSkills, csCloudCloudSkillInstall{
				ID:          r.CloudSkillID,
				Slug:        r.Slug,
				Name:        r.Name,
				Description: r.Description,
				Install:     cloudSkillInstallFromDB(r.Install),
				Position:    r.Position,
			})
		}
	} else {
		slog.Warn("cs-cloud dispatch: list agent cloud skills", "error", err)
	}
	return plugin, cloudSkills
}

// cloudSkillInstallFromDB decodes a stored cloud-skill install JSONB snapshot
// into the cs-cloud payload shape. The stored object is already allowlisted to
// {method, spec, skill_id, source_url, verified} by the agent-cloud-skill
// handler, matching cs-cloud's CloudSkillInstallSpec json tags. Returns nil
// when the snapshot is missing/empty or fails to parse (best-effort).
func cloudSkillInstallFromDB(raw []byte) *csCloudCloudSkillInstallSpec {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	var spec csCloudCloudSkillInstallSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		slog.Warn("cs-cloud dispatch: parse cloud skill install metadata", "error", err)
		return nil
	}
	return &spec
}

// deliverableSpecsForTask builds the deliverable contract list for the task's
// workflow node run (pull_request -> /submit endpoint; document -> /report-pr).
// Document deliverables are tagged with repo_alias="delivery" so cs-cloud maps
// them to the repos[] entry whose alias is "delivery" (the Gitea wf repo);
// pull_request deliverables keep repo_alias empty (they target a code repo).
func (s *TaskService) deliverableSpecsForTask(ctx context.Context, task db.MulticaAgentTaskQueue) []csCloudDeliverableSpec {
	if !task.WorkflowNodeRunID.Valid {
		return nil
	}
	nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		return nil
	}
	rows, err := s.Queries.ListWorkflowNodeDeliverables(ctx, nr.WorkflowNodeID)
	if err != nil {
		return nil
	}
	nid := util.UUIDToString(nr.ID)
	var out []csCloudDeliverableSpec
	for _, d := range rows {
		spec := csCloudDeliverableSpec{
			ID:   util.UUIDToString(d.ID),
			Kind: d.Kind,
		}
		switch d.Kind {
		case "pull_request":
			spec.Report = csCloudReportSpec{
				Endpoint:  "/api/node-runs/" + nid + "/deliverables/" + util.UUIDToString(d.ID) + "/submit",
				Method:    "POST",
				BodyField: "pull_request_url",
			}
		case "document":
			spec.Report = csCloudReportSpec{
				Endpoint:  "/api/daemon/node-runs/" + nid + "/deliverables/" + util.UUIDToString(d.ID) + "/report-pr",
				Method:    "POST",
				BodyField: "pull_request_url",
			}
			// Map this document deliverable to the repos[] entry whose
			// alias == "delivery" (the Gitea wf repo). pull_request keeps
			// repo_alias empty — it targets a code repo, not the delivery repo.
			spec.RepoAlias = "delivery"
		}
		out = append(out, spec)
	}
	return out
}

// appendCodeRepoPrompt tells the worker agent which code repos are available
// and instructs it to open MRs via CLI (not via platform auto-MR).
func appendCodeRepoPrompt(prompt string, repos []csCloudRepoSpec) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## 代码仓库开发\n\n")
	b.WriteString("你的任务根目录是 $CS_CLOUD_WORKTREE。用原生 git clone 把要改的代码仓库拉到任务根目录下：clone 时把仓库 URL 的 `https://` 换成 `https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@` 来鉴权（token 在环境变量里），然后 cd 进去建分支开发。例如：`git clone https://oauth2:${CS_CLOUD_GITLAB_TOKEN}@<host>/<group>/<repo>.git $CS_CLOUD_WORKTREE/<repo> && cd $CS_CLOUD_WORKTREE/<repo>`。\n")
	b.WriteString("可选的代码仓库：\n")
	for _, r := range repos {
		label := r.Alias
		if label == "" {
			label = r.URL
		}
		fmt.Fprintf(&b, "- %s (`%s`)\n", label, r.URL)
	}
	b.WriteString("\n完成编码后，在仓库目录内 `git add/commit`，然后运行 `cs-cloud workflow deliverable submit --repo <url> --deliverable <id> --mr` 开 Merge Request 并自动上报 MR 链接（务必在仓库目录内运行该命令）。\n")
	b.WriteString("Token 从环境变量 `$CS_CLOUD_GITLAB_TOKEN` 读取，无需自己找。**不要**等平台自动开 MR——你自己用 CLI 开。\n")
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
// The delivery repository is accessed via a managed worktree created by
// `cs-cloud repo checkout` (NOT a plain git clone): cs-cloud matches the
// passed URL against payload.Repos[] to pick the role, injects the auth token
// from $CS_CLOUD_REPO_TOKEN, and places the worktree on this node's branch.
// The agent then writes each document into the worktree and finalizes via
// `cs-cloud workflow deliverable submit`, which pushes the node branch, opens
// the node->inst review PR, and registers the review URL back here.
func appendDeliverablePrompt(prompt string, refs []repositoryDeliverableRefJSON) string {
	var b strings.Builder
	b.WriteString(prompt)
	if prompt != "" && !strings.HasSuffix(prompt, "\n") {
		b.WriteByte('\n')
	}
	b.WriteString("\n---\n## Document Deliverables\n\n")
	b.WriteString("This node has document deliverables stored in the platform Gitea repository. Clone it into your task root and switch to this node's branch: `git clone $CS_CLOUD_REPO_CLONE_URL_AUTHED $CS_CLOUD_WORKTREE/delivery && cd $CS_CLOUD_WORKTREE/delivery && git checkout $CS_CLOUD_REPO_NODE_BRANCH`. ($CS_CLOUD_REPO_CLONE_URL_AUTHED already embeds the auth token, so use it verbatim.)\n\n")
	b.WriteString("For EACH deliverable below: write the document to a local file, then run the submit command FROM INSIDE the cloned repo. The CLI writes your file into the repo at the right path, pushes this node's branch, opens a review request (node -> inst), and registers the review URL back here. Do NOT use inline content upload for these; document deliverables go through git.\n\n")
	for _, d := range refs {
		fmt.Fprintf(&b, "- **%s** (id=%s): run `cs-cloud workflow deliverable submit --deliverable %s --file <local-path-to-your-document>`\n", d.Title, d.ID, d.ID)
	}
	b.WriteString("\nA deliverable is not considered submitted until its PR is registered. Complete every listed deliverable before finishing.\n\n")
	b.WriteString("### Reading the deliverable repository\n\n")
	b.WriteString("You already cloned the repo (on this node's branch). To READ files from the inst branch (e.g. another node's documents), fetch and show them inside the repo: `git fetch origin && git show origin/$CS_CLOUD_REPO_INST_BRANCH:<path>`. For a different issue's repo, `git clone` its authed URL into another directory under $CS_CLOUD_WORKTREE.\n\n")
	b.WriteString("To inspect the rest of the workflow chain — other issues' progress and their deliverable repositories — use the read commands instead of guessing URLs:\n")
	b.WriteString("- `cs-workflow issue workflow <issue-id> --descendants` — workflow run + node run status for this issue and its children.\n")
	b.WriteString("- `cs-workflow issue deliverables <issue-id> --descendants` — the Gitea repository address and deliverable list for this issue and its children; use it to find another issue's repo URL before checking it out.\n")
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
// `repo submit` reads from CS_CLOUD_REPO_DELIVERABLES.
type repositoryDeliverableRefJSON struct {
	ID    string `json:"deliverable_id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

type giteaDeliverableRefJSON = repositoryDeliverableRefJSON

// giteaDeliverableEnv builds the CS_CLOUD_GITEA_* env vars for a task's
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
	// We ALSO read gitea_clone_url / last_instance_branch / gitea_web_url from
	// the SAME settings bundle and prefer them over the GITEA_PUBLIC_BASE_URL
	// self-assembly below. This is a cross-repo contract: cs-cloud's lookupRepoRole
	// matches the checkout URL against payload.Repos[].URL by EXACT equality, and
	// resolveDeliveryRepo puts settings.gitea_clone_url into repos[].URL. If the
	// env's CS_CLOUD_REPO_CLONE_URL diverges (e.g. GITEA_PUBLIC_BASE_URL points at
	// a different host than the tenant-scoped Gitea), cs-cloud silently downgrades
	// delivery → code → wrong token (GitLab PAT) → Gitea clone 401. Reading both
	// URLs from the same settings field guarantees they stay identical.
	pat := ""
	botUser := ""
	settingsCloneURL := ""
	settingsInstBranch := ""
	settingsWebURL := ""
	if ws, err := s.Queries.GetWorkspace(ctx, run.WorkspaceID); err == nil && len(ws.Settings) > 0 {
		settingsMap := map[string]any{}
		if json.Unmarshal(ws.Settings, &settingsMap) == nil {
			if v, ok := settingsMap["gitea_pat"].(string); ok {
				pat = v
			}
			if v, ok := settingsMap["gitea_bot_username"].(string); ok {
				botUser = v
			}
			if v, ok := settingsMap["gitea_clone_url"].(string); ok {
				settingsCloneURL = v
			}
			if v, ok := settingsMap["last_instance_branch"].(string); ok {
				settingsInstBranch = v
			}
			if v, ok := settingsMap["gitea_web_url"].(string); ok {
				settingsWebURL = v
			}
		}
	}
	// Clone URL: prefer settings value (== repos[].URL) so cs-cloud's role lookup
	// matches; fall back to self-assembly only when pre-provisioning.
	var cloneURL string
	if strings.TrimSpace(settingsCloneURL) != "" {
		cloneURL = rewriteGiteaHostToPublic(settingsCloneURL)
	} else {
		cloneURL = strings.TrimRight(publicBase, "/") + "/" + owner + "/" + repo + ".git"
	}
	// Base URL: prefer settings gitea_web_url (the Gitea web/API root cs-cloud's
	// PR API targets); fall back to GITEA_PUBLIC_BASE_URL.
	var baseURL string
	if strings.TrimSpace(settingsWebURL) != "" {
		baseURL = strings.TrimRight(rewriteGiteaHostToPublic(settingsWebURL), "/")
	} else {
		baseURL = strings.TrimRight(publicBase, "/")
	}
	authedCloneURL := injectGiteaToken(cloneURL, botUser, pat)
	// Inst branch: prefer settings last_instance_branch (matches repos[].BaseBranch);
	// fall back to the deterministic run-ID derivation.
	var instBranch string
	if strings.TrimSpace(settingsInstBranch) != "" {
		instBranch = strings.TrimSpace(settingsInstBranch)
	} else {
		instBranch = gitea.InstBranch(util.UUIDToString(run.ID))
	}
	nodeBranch := gitea.NodeBranch(nodeSeq, nodeRunIDStr)
	out := map[string]string{
		"CS_CLOUD_NODE_RUN_ID":           nodeRunIDStr,
		"CS_CLOUD_REPO_PROVIDER":         "gitea",
		"CS_CLOUD_REPO_OWNER":            owner,
		"CS_CLOUD_REPO_NAME":             repo,
		"CS_CLOUD_REPO_BASE_URL":         baseURL,
		"CS_CLOUD_REPO_TOKEN":            pat,
		"CS_CLOUD_REPO_CLONE_URL":        cloneURL,
		"CS_CLOUD_REPO_CLONE_URL_AUTHED": authedCloneURL,
		"CS_CLOUD_REPO_INST_BRANCH":      instBranch,
		"CS_CLOUD_REPO_NODE_BRANCH":      nodeBranch,
		"CS_CLOUD_REPO_DELIVERABLES":     string(refsJSON),
	}
	// CROSS-REPO CONTRACT: cs-cloud's deliverable-submit CLI (internal/cli/gitea.go
	// readGiteaContext) reads ONLY the legacy CS_CLOUD_GITEA_* names; the aliasing
	// below is the sole bridge between the renamed CS_CLOUD_REPO_* env and that
	// legacy reader. Do NOT remove this aliasing without migrating cs-cloud to
	// read CS_CLOUD_REPO_* directly.
	for oldKey, newKey := range map[string]string{
		"CS_CLOUD_GITEA_OWNER":            "CS_CLOUD_REPO_OWNER",
		"CS_CLOUD_GITEA_REPO":             "CS_CLOUD_REPO_NAME",
		"CS_CLOUD_GITEA_BASE_URL":         "CS_CLOUD_REPO_BASE_URL",
		"CS_CLOUD_GITEA_TOKEN":            "CS_CLOUD_REPO_TOKEN",
		"CS_CLOUD_GITEA_CLONE_URL":        "CS_CLOUD_REPO_CLONE_URL",
		"CS_CLOUD_GITEA_CLONE_URL_AUTHED": "CS_CLOUD_REPO_CLONE_URL_AUTHED",
		"CS_CLOUD_GITEA_INST_BRANCH":      "CS_CLOUD_REPO_INST_BRANCH",
		"CS_CLOUD_GITEA_NODE_BRANCH":      "CS_CLOUD_REPO_NODE_BRANCH",
		"CS_CLOUD_GITEA_DELIVERABLES":     "CS_CLOUD_REPO_DELIVERABLES",
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

// rewriteGiteaHostToPublic swaps a Gitea URL's scheme+host+port from the
// container-internal GITEA_BASE_URL to the caller-reachable
// GITEA_PUBLIC_BASE_URL, preserving the path. costrict-web's team-namespace
// service emits wf_clone_url using its single (internal) tenant git-server
// endpoint, and cs-cloud runs where that internal host is unreachable, so
// multica rewrites the host at the dispatch boundary. This mirrors
// handler.giteaPublicBaseURL (the daemon credential endpoint's split) on the
// cs-cloud path.
//
// Only URLs that actually point at the internal Gitea host (matching
// scheme+host) are rewritten; an unknown host is left untouched. Returns the
// input unchanged when GITEA_PUBLIC_BASE_URL is unset (single-host deploy),
// when GITEA_BASE_URL is unset (nothing to match), or on any parse failure.
// Both resolveDeliveryRepo (repos[].URL) and repositoryDeliverableEnv
// (CS_CLOUD_REPO_CLONE_URL) run settings.gitea_clone_url through this helper,
// so the cross-repo EXACT-equality contract (cs-cloud lookupRepoRole) is
// preserved: both sides get the SAME rewritten public URL.
func rewriteGiteaHostToPublic(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	publicBase := strings.TrimSpace(os.Getenv("GITEA_PUBLIC_BASE_URL"))
	internalBase := strings.TrimSpace(os.Getenv("GITEA_BASE_URL"))
	if rawURL == "" || publicBase == "" || internalBase == "" {
		return rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return rawURL
	}
	in, err := url.Parse(internalBase)
	if err != nil || in.Scheme == "" || in.Host == "" {
		return rawURL
	}
	// Only rewrite URLs that point at the internal Gitea. url.Host includes the
	// port, so the comparison is exact — :33000 can't prefix-match :330000.
	if u.Scheme != in.Scheme || u.Host != in.Host {
		return rawURL
	}
	pub, err := url.Parse(publicBase)
	if err != nil || pub.Scheme == "" || pub.Host == "" {
		return rawURL
	}
	u.Scheme = pub.Scheme
	u.Host = pub.Host
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

// --- Document-deliverable dispatch-time safety net (M2.5 Task 2) ---
//
// The run-start ScaffoldRunDeliverables path occasionally fails or is skipped
// (transient DB error, team-namespace hiccup, goroutine panic). Without a
// safety net, the cs-cloud device gets a task whose workspace has no Gitea wf
// repo + inst branch and no bot credentials in settings — so the agent's first
// `gitea submit` / clone 404s and the run fails for a fixable reason. This
// safety net runs at dispatch time, inside buildCSCloudPayload: if the task is
// a document-deliverable worker AND the workspace lacks Gitea data, re-fire
// the interface-8 InitWorkflow (idempotent) before the payload goes out. See
// docs/superpowers/cs-cloud-delivery-m2.5-plan.md §Task 2.

// teamNamespaceConfigured mirrors WorkflowService.teamNamespaceConfigured:
// TeamNamespace client wired (post-router) and Configured() (base URL + token
// present). Read by buildCSCloudPayload to gate the safety net.
func (s *TaskService) teamNamespaceConfigured() bool {
	return s.TeamNamespace != nil && s.TeamNamespace.Configured()
}

// hasAnyDeliverableSpec reports whether the deliverable slice has ANY entry
// (document OR pull_request). M5 decision ①: the dispatch safety net fires for
// any deliverable-bearing worker task, so code-only runs also get a Gitea repo
// provisioned (for code-MR archiving).
func hasAnyDeliverableSpec(deliverables []csCloudDeliverableSpec) bool {
	return len(deliverables) > 0
}

// giteaProvisioningBundle is the subset of workspace.settings written by
// initWorkflowNamespace (interface-8): the wf repo clone URL, the run's inst
// branch, and the bot PAT. All three fields are written atomically, so in
// practice they're all-present or all-absent; the complete() method below is
// the single source of truth for "Gitea data present" shared by the dispatch
// safety net (settingsLackGiteaData) and the delivery-repo resolver
// (resolveDeliveryRepo). Keeping the two helpers aligned avoids a partial-state
// gap where the safety net skips but resolveDeliveryRepo returns false (or vice
// versa) and the agent silently loses the repos[] role=delivery entry.
type giteaProvisioningBundle struct {
	GiteaCloneURL string `json:"gitea_clone_url"`
	InstBranch    string `json:"last_instance_branch"`
	GiteaPAT      string `json:"gitea_pat"`
}

// complete reports whether the bundle carries all three fields needed to act.
// A delivery repo without a PAT is useless — the agent authenticates via
// CS_CLOUD_REPO_TOKEN=pat — so PAT presence is required even though the spec's
// URL/BaseBranch/Alias don't directly carry it.
func (b giteaProvisioningBundle) complete() bool {
	return strings.TrimSpace(b.GiteaCloneURL) != "" &&
		strings.TrimSpace(b.GiteaPAT) != "" &&
		strings.TrimSpace(b.InstBranch) != ""
}

// settingsLackGiteaData reports whether workspace.settings are missing the
// Gitea provisioning bundle. Returns true (fire safety net) on any read/parse
// error or when the bundle is incomplete — partial state also triggers
// re-provisioning (initWorkflowNamespace is idempotent). Completeness is
// judged by giteaProvisioningBundle.complete, shared with resolveDeliveryRepo.
func (s *TaskService) settingsLackGiteaData(ctx context.Context, workspaceID pgtype.UUID) bool {
	ws, err := s.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return true
	}
	if len(ws.Settings) == 0 {
		return true
	}
	var bundle giteaProvisioningBundle
	if err := json.Unmarshal(ws.Settings, &bundle); err != nil {
		return true
	}
	return !bundle.complete()
}

// ensureDeliveryRepo walks task → node run → run → workflow and fires the
// team-namespace interface-8 InitWorkflow via the free initWorkflowNamespace
// helper (which itself runs ensureTeamNamespace → CreateTeam first, then
// InitWorkflow, then persists bot_credentials + wf repo metadata into
// workspace.settings). Idempotent; safe to call on every dispatch.
//
// Returns an error only when a hard provisioning step fails; the caller
// (buildCSCloudPayload) logs and continues — the payload still goes out and
// the run is not failed for a fixable provisioning gap (a later re-run or
// member upload path can also recover).
//
// Timing: buildCSCloudPayload runs the safety net BEFORE env/repos[] assembly,
// so when provisioning succeeds here, the current dispatch's repositoryDeliverableEnv
// (CS_CLOUD_REPO_* env) and resolveDeliveryRepo (repos[] role=delivery) read the
// just-persisted settings on the SAME dispatch — no stale-credentials gap. The
// idempotent re-run on retry / next round is a harmless no-op.
func (s *TaskService) ensureDeliveryRepo(ctx context.Context, task db.MulticaAgentTaskQueue) error {
	if !task.WorkflowNodeRunID.Valid {
		return nil
	}
	nr, err := s.Queries.GetWorkflowNodeRun(ctx, task.WorkflowNodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}
	run, err := s.Queries.GetWorkflowRun(ctx, nr.WorkflowRunID)
	if err != nil {
		return fmt.Errorf("get workflow run: %w", err)
	}
	workflow, err := s.Queries.GetWorkflow(ctx, run.WorkflowID)
	if err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}
	return initWorkflowNamespace(ctx, s.Queries, s.TeamNamespace, run, workflow)
}

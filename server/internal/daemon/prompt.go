package daemon

import (
	"fmt"
	"strings"

	"github.com/multica-ai/multica/server/internal/daemon/execenv"
)

// BuildPrompt constructs the task prompt for an agent CLI.
// Keep this minimal — detailed instructions live in CLAUDE.md / AGENTS.md
// injected by execenv.InjectRuntimeConfig. The provider string is used by
// comment-triggered tasks: Codex's per-turn reply template needs the
// platform-aware "stdin or file" variant, every other provider gets a
// lightweight inline template (or Windows file for any provider on
// Windows).
func BuildPrompt(task Task, provider string) string {
	if task.WorkflowPhase == "split_chat" {
		return buildSplitChatPrompt(task)
	}
	if task.ChatSessionID != "" {
		return buildChatPrompt(task)
	}
	if task.WorkflowPhase == "split" {
		return buildSplitPrompt(task)
	}
	if task.TriggerCommentID != "" {
		return buildCommentPrompt(task, provider)
	}
	if task.AutopilotRunID != "" {
		return buildAutopilotPrompt(task)
	}
	if task.QuickCreatePrompt != "" {
		return buildQuickCreatePrompt(task)
	}
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n\n")
	fmt.Fprintf(&b, "Your assigned issue ID is: %s\n\n", task.IssueID)

	if task.WorkflowPhase == "critic" {
		b.WriteString("## Workflow Critic Review\n\n")
		b.WriteString("You are reviewing the worker's submitted deliverables for this workflow node. Inspect the issue context and deliverable PRs, then finish with a JSON object only:\n\n")
		b.WriteString("```json\n{\"approved\":true,\"comment\":\"short review opinion\"}\n```\n\n")
		b.WriteString("Use `approved:false` when the work needs rework, and put the actionable rejection reason in `comment`.\n\n")
		b.WriteString("---\n\n")
	} else if task.WorkflowPhase == "worker" {
		b.WriteString("## Workflow Worker Task\n\n")
		b.WriteString("You are the worker for this workflow node. Complete the assigned work and submit every required deliverable before finishing.\n")
		b.WriteString("Do NOT perform critic review. Do NOT approve or reject the work. If the issue text mentions a critic/reviewer, treat that as context for the later review phase, not your current task.\n\n")
		b.WriteString("---\n\n")
	}

	// Inject upstream-stage context so the agent reads prior-stage sub-issues
	// and downloads their attachments before proceeding.
	if len(task.UpstreamStageContext) > 0 {
		b.WriteString("## Upstream Stage Context\n\n")
		b.WriteString("The following upstream workflow stages have already completed. Read their sub-issues and attachments to understand the full context before starting your own task.\n\n")
		for _, up := range task.UpstreamStageContext {
			fmt.Fprintf(&b, "- **%s** (sub-issue: %s)\n", up.NodeTitle, up.IssueID)
			if up.LatestComment != "" {
				fmt.Fprintf(&b, "  Latest output: %s\n", up.LatestComment)
			}
			if len(up.Attachments) > 0 {
				b.WriteString("  Attachments:\n")
				for _, a := range up.Attachments {
					if a.ContentType != "" {
						fmt.Fprintf(&b, "    - id=%s filename=%q content_type=%s\n", a.ID, a.Filename, a.ContentType)
					} else {
						fmt.Fprintf(&b, "    - id=%s filename=%q\n", a.ID, a.Filename)
					}
				}
				b.WriteString("  Use `cs-workflow attachment download <id>` to fetch each file locally before referring to it.\n")
			}
			fmt.Fprintf(&b, "  Read the full sub-issue: `cs-workflow issue get %s --output json`\n", up.IssueID)
			fmt.Fprintf(&b, "  Read comments: `cs-workflow issue comment list %s --output json`\n\n", up.IssueID)
		}
		b.WriteString("---\n\n")
	}

	// Document deliverables: instruct the agent to produce each doc and submit
	// it via the Gitea CLI (which creates a node branch off the run's instance
	// branch, pushes the file, opens a Gitea PR, and registers the PR back
	// here). Only present when Gitea is configured for this run.
	if task.WorkflowPhase != "critic" && task.GiteaDeliverables != nil {
		b.WriteString("## Document Deliverables\n\n")
		b.WriteString("This node has document deliverables stored in the platform git server. For EACH deliverable below: write the document to a local file, then submit it with the CLI — the command creates a node branch off the run's instance branch, pushes your file, opens a Gitea PR, and registers the PR back here. Do NOT use inline content upload for these; document deliverables go through git.\n\n")
		for _, d := range task.GiteaDeliverables.Deliverables {
			fmt.Fprintf(&b, "- **%s** (id=%s): run `cs-workflow gitea submit --deliverable %s --file <local-path-to-your-document>`\n", d.Title, d.ID, d.ID)
		}
		b.WriteString("A deliverable is not considered submitted until its PR is registered. Complete every listed deliverable before finishing.\n\n")
		b.WriteString("---\n\n")
	}

	// Code deliverables (pull_request kind): tell the agent how to push a branch
	// to GitLab, open an MR, and submit the MR URL back as the deliverable.
	// Document deliverables are covered above (GiteaDeliverables -> gitea submit);
	// this covers the code path. Generic (not gated on a context field) so it
	// shows for code nodes that have no Gitea context.
	if task.WorkflowPhase != "critic" {
		b.WriteString("## Code Deliverables (pull_request)\n\n")
		b.WriteString("If this node has a code deliverable (kind=pull_request), you MUST report it — the node is not complete until the PR/MR URL is submitted:\n")
		b.WriteString("1. List the node's deliverables: `curl -s -H \"Authorization: Bearer $MULTICA_TOKEN\" -H \"X-Workspace-ID: $MULTICA_WORKSPACE_ID\" $MULTICA_SERVER_URL/api/node-runs/$MULTICA_NODE_RUN_ID/deliverables` — note the `id` and `kind` of each.\n")
		b.WriteString("2. For each `kind=pull_request` deliverable: push a branch to the linked Git repo and open a Merge Request with `cs-workflow mr create --source-branch <branch> --title \"<title>\" --push` (run inside a checkout whose `origin` points at the GitLab repo; the CLI reads the GitLab PAT from the workspace).\n")
		b.WriteString("3. Submit the MR web URL back: `curl -X POST -H \"Authorization: Bearer $MULTICA_TOKEN\" -H \"X-Workspace-ID: $MULTICA_WORKSPACE_ID\" -H \"Content-Type: application/json\" -d '{\"pull_request_url\":\"<MR URL>\"}' $MULTICA_SERVER_URL/api/node-runs/$MULTICA_NODE_RUN_ID/deliverables/<deliverable_id>/submit`.\n")
		b.WriteString("A deliverable is not submitted until its PR/MR URL is registered. Complete every required deliverable before finishing.\n\n")
		b.WriteString("---\n\n")
	}

	fmt.Fprintf(&b, "Start by running `cs-workflow issue get %s --output json` to understand your task, then complete it.\n", task.IssueID)
	fmt.Fprintf(&b, "For comment history, follow the rule in your runtime workflow file (assignment-triggered tasks treat the read as mandatory). `cs-workflow issue comment list %s --output json` returns all comments for the issue (server caps at 2000). On long-running issues use `--recent 20 --output json` to read the 20 most recently active threads, then page older threads via the stderr `Next thread cursor: ...` line and the matching `--before` / `--before-id` until you have enough history. `--since <RFC3339>` is still available for incremental polling and may combine with `--recent`.\n", task.IssueID)
	return b.String()
}

func buildSplitPrompt(task Task) string {
	var b strings.Builder
	if task.WorkflowSplitRepair {
		b.WriteString("You are repairing a failed split draft generation for a Multica workflow.\n\n")
		fmt.Fprintf(&b, "Source task ID: %s\n\n", task.WorkflowSplitRepairSourceTaskID)
		if strings.TrimSpace(task.WorkflowSplitRepairSourceOutput) != "" {
			b.WriteString("The failed task produced this final output. Use it as one recovery source, but verify against the split planning issue, comments, and attachments before submitting drafts:\n\n")
			fmt.Fprintf(&b, "```\n%s\n```\n\n", strings.TrimSpace(task.WorkflowSplitRepairSourceOutput))
		}
		b.WriteString("Your job is to recover usable draft tasks and submit them for human review.\n\n")
	} else {
		b.WriteString("You are running as a dynamic split-task generator for a Multica workflow.\n\n")
	}
	if task.WorkflowNodeRunID != "" {
		fmt.Fprintf(&b, "Workflow node run ID: %s\n", task.WorkflowNodeRunID)
	}
	if task.WorkflowSplitParentIssueID != "" {
		fmt.Fprintf(&b, "Parent issue ID: %s\n", task.WorkflowSplitParentIssueID)
	}
	if task.WorkflowSplitParentIssueTitle != "" {
		fmt.Fprintf(&b, "Parent issue title: %s\n", task.WorkflowSplitParentIssueTitle)
	}
	if strings.TrimSpace(task.WorkflowSplitParentIssueDescription) != "" {
		fmt.Fprintf(&b, "\nParent issue description:\n%s\n", strings.TrimSpace(task.WorkflowSplitParentIssueDescription))
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "Read the split planning issue with `cs-workflow issue get %s --output json` and inspect comments only if they are needed for context.\n\n", task.IssueID)
	b.WriteString("Your job is to propose child tasks for human review. The platform will create the actual child issues later after review.\n\n")
	b.WriteString("The backend applies the configured default issue workflow to every draft. Do NOT output workflow_id. Reviewers change execution workflow later in Multica.\n\n")
	b.WriteString("Hard rules:\n")
	b.WriteString("- Do NOT create issues.\n")
	b.WriteString("- Do NOT change issue status.\n")
	b.WriteString("- Do NOT post comments.\n")
	b.WriteString("- Do NOT modify code, docs, or repository files.\n")
	b.WriteString("- Do NOT use an issue ID as the node run ID.\n")
	b.WriteString("- Submit draft tasks through the split draft CLI; the platform will route them to human review.\n\n")
	b.WriteString("Primary success path:\n")
	b.WriteString("1. Write each draft task description to a UTF-8 markdown file.\n")
	b.WriteString("2. Add each draft with `cs-workflow workflow split draft add <node-run-id> --key <stable-key> --title \"...\" --description-file <file>`.\n")
	b.WriteString("3. Use `--depends-on <stable-key>` for each dependency on a previously added draft task.\n")
	if task.WorkflowNodeRunID != "" {
		fmt.Fprintf(&b, "4. When all drafts are added, run `cs-workflow workflow split draft submit %s --output json`.\n\n", task.WorkflowNodeRunID)
		fmt.Fprintf(&b, "After `cs-workflow workflow split draft submit %s --output json` succeeds, stop.\n\n", task.WorkflowNodeRunID)
	} else {
		b.WriteString("4. When all drafts are added, run `cs-workflow workflow split draft submit <node-run-id> --output json`.\n\n")
		b.WriteString("After `cs-workflow workflow split draft submit <node-run-id> --output json` succeeds, stop.\n\n")
	}
	b.WriteString("Use the exact workflow node run ID from the task context files.\n\n")
	b.WriteString("Fallback only: if the draft CLI is unavailable, return a clear Markdown task breakdown. The server will attempt recovery, but CLI submission is more reliable.\n")
	return b.String()
}

func buildSplitChatPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a split review adjustment agent for a Multica workflow.\n\n")
	b.WriteString("A user reviewed the current split draft tasks and requested an adjustment. Update the draft set for human review; the platform will create child issues later.\n\n")
	fmt.Fprintf(&b, "Workflow node run ID: %s\n", task.WorkflowNodeRunID)
	if task.WorkflowSplitParentIssueID != "" {
		fmt.Fprintf(&b, "Parent issue ID: %s\n", task.WorkflowSplitParentIssueID)
	}
	if task.WorkflowSplitParentIssueTitle != "" {
		fmt.Fprintf(&b, "Parent issue title: %s\n", task.WorkflowSplitParentIssueTitle)
	}
	if strings.TrimSpace(task.WorkflowSplitParentIssueDescription) != "" {
		fmt.Fprintf(&b, "\nParent issue description:\n%s\n", strings.TrimSpace(task.WorkflowSplitParentIssueDescription))
	}
	fmt.Fprintf(&b, "\nUser requested:\n%s\n\n", strings.TrimSpace(task.ChatMessage))
	if len(task.ChatMessageAttachments) > 0 {
		b.WriteString("Attachments on this message:\n")
		for _, a := range task.ChatMessageAttachments {
			if a.ContentType != "" {
				fmt.Fprintf(&b, "- id=%s filename=%q content_type=%s\n", a.ID, a.Filename, a.ContentType)
			} else {
				fmt.Fprintf(&b, "- id=%s filename=%q\n", a.ID, a.Filename)
			}
		}
		b.WriteString("Use `cs-workflow attachment download <id>` to fetch each file locally before referring to it.\n\n")
	}
	if strings.TrimSpace(string(task.WorkflowSplitCurrentDrafts)) != "" {
		fmt.Fprintf(&b, "Current draft tasks:\n```json\n%s\n```\n\n", strings.TrimSpace(string(task.WorkflowSplitCurrentDrafts)))
	}
	if strings.TrimSpace(string(task.WorkflowSplitConfig)) != "" {
		fmt.Fprintf(&b, "Split config:\n```json\n%s\n```\n\n", strings.TrimSpace(string(task.WorkflowSplitConfig)))
	}
	b.WriteString("Hard rules:\n")
	b.WriteString("- Do NOT create issues.\n")
	b.WriteString("- Do NOT change issue status.\n")
	b.WriteString("- Do NOT post comments.\n")
	b.WriteString("- Do NOT modify code, docs, or repository files.\n")
	b.WriteString("- Do not treat this as a normal chat response; update the split draft set through the draft CLI.\n\n")
	b.WriteString("Never answer that the task is already complete or that no further operation is needed unless the user's request explicitly asks for no change. A successful run must leave a durable draft update: use the draft CLI, or as a fallback output a clear Markdown task breakdown that the server can recover into draft tasks.\n\n")
	b.WriteString("Primary success path:\n")
	b.WriteString("1. Decide which existing drafts to keep, discard or replace based on the user request.\n")
	b.WriteString("2. Use `cs-workflow workflow split draft delete <node-run-id> <draft-task-id>` to discard drafts that should be removed.\n")
	b.WriteString("3. Write each new or replacement draft task description to a UTF-8 markdown file.\n")
	b.WriteString("4. Add or replace drafts with `cs-workflow workflow split draft add <node-run-id> --key <stable-key> --title \"...\" --description-file <file>`.\n")
	b.WriteString("5. Use `--depends-on <stable-key>` only when a dependency is real and refers to a kept or newly added draft.\n")
	b.WriteString("6. When the adjusted draft set is complete, run `cs-workflow workflow split draft submit <node-run-id>`.\n\n")
	b.WriteString("If the user asks to simplify, prefer fewer clearer drafts over preserving every existing draft. Your final assistant output can be brief; the durable result is the submitted draft set.\n")
	return b.String()
}

// buildQuickCreatePrompt constructs a prompt for quick-create tasks. The
// user typed a single natural-language sentence in the create-issue modal;
// the agent's job is to translate it into one `cs-workflow issue create` CLI
// invocation, using its judgment to decide whether fetching referenced URLs
// would produce a better issue. No issue exists yet, so the agent must NOT
// call `cs-workflow issue get` or attempt to comment — there's nothing to read
// or reply to.
func buildQuickCreatePrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a quick-create assistant for a Multica workspace.\n\n")
	b.WriteString("A user captured the following input via the quick-create modal. There is NO existing issue. Your job is to create a well-formed issue from this input with a single `cs-workflow issue create` command.\n\n")
	fmt.Fprintf(&b, "User input:\n> %s\n\n", task.QuickCreatePrompt)

	b.WriteString("Field rules:\n\n")

	// title
	b.WriteString("- **title**: required. A concise but semantically rich summary. If the input references external resources (PRs, issues, URLs), use your judgment on whether fetching the resource would produce a meaningfully better title — e.g. \"review PR #123\" → \"Review PR #123: Refactor auth module to OAuth2\". Strip filler words but preserve key semantic information.\n\n")

	// description — the core optimization
	b.WriteString("- **description**: The description is the executing agent's primary context. Aim for high fidelity — they should grasp the user's intent as if they had read the raw input themselves. Use a two-section structure:\n\n")
	b.WriteString("  1. **User request** — Faithfully restate what the user wants in their own words. Preserve specific names, identifiers, file paths, code snippets, and technical terms verbatim. Strip non-spec material before writing it (this is removal, not paraphrasing): verbal routing wrappers about creating the issue or routing it (e.g. \"create an issue\", \"分配给 X\", \"让 @X 处理\") and pure conversational fillers (e.g. \"对吧？\"). When in doubt, keep it.\n\n")
	b.WriteString("     CC exception: `cs-workflow issue create` has no `--subscriber` flag, and the platform auto-subscribes members whose `[@Name](mention://member/<uuid>)` link appears in the description. When the user wrote \"cc @Y\", strip the verbal \"cc\" wrapper from the User request body and append a final `CC: <mention link(s)>` line to the description so the cc routing still fires.\n\n")
	b.WriteString("  2. **Context** — include ONLY when the input cited external resources AND you successfully fetched them AND they produced verifiable facts worth recording. Summarize facts only (e.g. \"PR #45 changes auth to JWT\"), not interpretation or unsolicited reference implementations. If you have nothing factual to add, omit the section entirely — never use it as an apology log for resources you could not fetch.\n\n")
	b.WriteString("  Hard rules: never invent requirements, implementation details, or acceptance criteria the user did not express; never reduce multi-sentence input to a single vague sentence; never echo the title.\n\n")

	// priority
	b.WriteString("- **priority**: one of `urgent`, `high`, `medium`, `low`, or omit. Map P0/P1 → urgent/high; \"asap\" → urgent. If unspecified, omit.\n\n")

	// assignee
	b.WriteString("- **assignee**:\n")
	b.WriteString("    - When the user names someone (\"assign to X\" / \"@X\"), call `cs-workflow workspace member list --output json`, `cs-workflow agent list --output json`, and `cs-workflow squad list --output json` and find the matching entity by display name. Squads are first-class assignees too — a squad name (e.g. \"Super Human\") routes work to the squad leader, who then delegates. On a clean unambiguous match, prefer `--assignee-id <uuid>` using the `user_id` (member) or `id` (agent or squad) from that JSON — UUID matching is exact and robust to name collisions in workspaces with overlapping names. `--assignee <name>` (fuzzy) is acceptable as a fallback when names are unambiguous. On no match or ambiguous match, do NOT pass either flag — instead append a final line to the description: `Unrecognized assignee: X`.\n")
	b.WriteString("    - Treat bare @-routing as an assignee directive even when the user did not write the English word \"assign\". This includes Chinese imperatives like `让 @独立团 review 这个 PR`, `给 @X 处理`, or `交给 @X`; strip the leading `@`/`＠` before matching display names. Do not keep that routing wrapper or `@Name` in the description unless it is a true CC-style notification rather than ownership. If the matched entity is a squad, pass the squad's `id` as `--assignee-id`, not the leader agent's id.\n")
	agentID := ""
	agentName := ""
	if task.Agent != nil {
		agentID = task.Agent.ID
		agentName = task.Agent.Name
	}
	switch {
	case task.SquadID != "":
		// The user opened quick-create with a SQUAD selected. The task
		// runs on the squad's leader agent, but the squad is the expected
		// owner — assigning to the leader would mask the squad's
		// delegation flow. Always point the default at the squad UUID.
		if task.SquadName != "" {
			fmt.Fprintf(&b, "    - When the user did NOT name an assignee, default to the picker SQUAD %q: pass `--assignee-id %q` (the squad's UUID). The user opened quick-create with the squad selected; you (the leader agent) are running on the squad's behalf, so the squad — not you — is the expected owner. Never leave the issue unassigned, and do not assign it to your own agent UUID.\n\n", task.SquadName, task.SquadID)
		} else {
			fmt.Fprintf(&b, "    - When the user did NOT name an assignee, default to the picker SQUAD: pass `--assignee-id %q` (the squad's UUID). The user opened quick-create with the squad selected; you (the leader agent) are running on the squad's behalf, so the squad — not you — is the expected owner. Never leave the issue unassigned, and do not assign it to your own agent UUID.\n\n", task.SquadID)
		}
	case agentID != "":
		fmt.Fprintf(&b, "    - When the user did NOT name an assignee, default to YOURSELF: pass `--assignee-id %q` (your agent UUID). The picker agent is the expected owner because the user opened quick-create with you selected — never leave the issue unassigned. Use the UUID flag, not `--assignee <name>`, so the assignment is unambiguous even when other agents share part of your name.\n\n", agentID)
	case agentName != "":
		fmt.Fprintf(&b, "    - When the user did NOT name an assignee, default to YOURSELF: pass `--assignee %q`. The picker agent is the expected owner because the user opened quick-create with you selected — never leave the issue unassigned.\n\n", agentName)
	default:
		b.WriteString("    - When the user did NOT name an assignee, default to YOURSELF (the picker agent): pass `--assignee-id <your agent UUID>` (preferred) or `--assignee <your agent name>`. Never leave the issue unassigned.\n\n")
	}

	// project — pinned by the modal when the user picked one, otherwise
	// omitted so the platform routes to the workspace default. Always pass
	// the UUID (never a name) so the issue lands in the right project even
	// when several share a title.
	if task.ProjectID != "" {
		if task.ProjectTitle != "" {
			fmt.Fprintf(&b, "- **project**: required for this run. Pass `--project %q` so the new issue lands in project %q (the user picked it in the quick-create modal). Do not infer a different project from the prompt text — the modal selection is authoritative.\n", task.ProjectID, task.ProjectTitle)
		} else {
			fmt.Fprintf(&b, "- **project**: required for this run. Pass `--project %q` so the new issue lands in the project the user picked in the quick-create modal. Do not infer a different project from the prompt text — the modal selection is authoritative.\n", task.ProjectID)
		}
	} else {
		b.WriteString("- **project**: omit. The platform will route the issue to the workspace default.\n")
	}
	b.WriteString("- **status**: omit (defaults to `todo`).\n")
	b.WriteString("- **attachments**: do NOT pass `--attachment`. The flag only accepts LOCAL file paths. Any image URL in the user input is already markdown — keep it inline in `--description` instead.\n\n")

	// output format
	b.WriteString("Output format:\n")
	b.WriteString("- Run exactly one `cs-workflow issue create --output json` invocation. Do not retry for any reason — even on non-zero exit. The issue may already exist; another attempt would create a duplicate.\n")
	b.WriteString("- Parse the JSON response to read the created issue's `identifier` (preferred) or `id` (fallback). Do not scrape human output and do not assume any workspace issue prefix such as `MUL-`; workspaces can use custom prefixes.\n")
	b.WriteString("- After success, print exactly one line: `Created <identifier-or-id>: <title>` and exit. No commentary, no follow-up tool calls.\n")
	b.WriteString("- Do NOT call `cs-workflow issue get` or `cs-workflow issue comment add` — there is no issue to query or comment on.\n")
	b.WriteString("- On CLI error or JSON parse error, exit with the error as the only output. The platform writes a failure notification automatically.\n")
	return b.String()
}

// buildCommentPrompt constructs a prompt for comment-triggered tasks.
// The triggering comment content is embedded directly so the agent cannot
// miss it, even when stale output files exist in a reused workdir.
// The reply instructions (including the current TriggerCommentID as --parent)
// are re-emitted on every turn so resumed sessions cannot carry forward a
// previous turn's --parent UUID.
func buildCommentPrompt(task Task, provider string) string {
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n\n")
	fmt.Fprintf(&b, "Your assigned issue ID is: %s\n\n", task.IssueID)
	if task.TriggerCommentContent != "" {
		authorLabel := "A user"
		if task.TriggerAuthorType == "agent" {
			name := task.TriggerAuthorName
			if name == "" {
				name = "another agent"
			}
			authorLabel = fmt.Sprintf("Another agent (%s)", name)
		}
		fmt.Fprintf(&b, "[NEW COMMENT] %s just left a new comment. Focus on THIS comment — do not confuse it with previous ones:\n\n", authorLabel)
		fmt.Fprintf(&b, "> %s\n\n", task.TriggerCommentContent)
		if task.TriggerAuthorType == "agent" {
			b.WriteString("⚠️ The triggering comment was posted by another agent. Decide whether a reply is warranted. If you produced actual work this turn (investigated, fixed something, answered a real question), post the result as a normal reply — that is NOT a noise comment, and the standard rule that final results must be delivered via comment still applies. If the triggering comment was a pure acknowledgment, thanks, or sign-off AND you produced no work this turn, do NOT reply — and do NOT post a comment saying 'No reply needed' or similar. Simply exit with no output. Silence is the preferred way to end agent-to-agent threads. If you do reply, do not @mention the other agent as a sign-off (that re-triggers them and starts a loop).\n\n")
		}
		if task.Agent != nil && strings.Contains(task.Agent.Instructions, "## Squad Operating Protocol") {
			fmt.Fprintf(&b, "⚠️ **Squad leader no_action rule:** If you decide no action is needed, call `cs-workflow squad activity %s no_action --reason \"...\"` and EXIT. DO NOT post any comment — not even one that says \"no action needed\" or \"exiting silently\". The squad activity call records your decision; a comment is redundant noise.\n\n", task.IssueID)
		}
	}
	fmt.Fprintf(&b, "Start by running `cs-workflow issue get %s --output json` to understand your task, then decide how to proceed.\n\n", task.IssueID)
	fmt.Fprintf(&b, "For comment history, read the triggering thread first: `cs-workflow issue comment list %s --thread %s --tail 30 --output json` returns the root + the 30 most recent replies in that thread (root is always included, even at `--tail 0`, so you keep the \"what is this about\" context without dragging hundreds of replies into your prompt). If 30 replies aren't enough, walk older replies in the same thread one page at a time by passing the stderr `Next reply cursor: --before <ts> --before-id <reply-id>` line back as `--before <ts> --before-id <reply-id>` on the next call. If you also need cross-thread background, `cs-workflow issue comment list %s --recent 20 --output json` pulls the 20 most recently active threads on the issue; under `--recent` the same `--before` / `--before-id` flags walk older *threads* (stderr label: `Next thread cursor`) instead of older replies. Avoid the unfiltered `--output json` form on long-running issues; it dumps the full flat timeline (cap 2000) and wastes context. `--since <RFC3339>` is still available for incremental polling and may combine with `--thread --tail` or `--recent`.\n\n", task.IssueID, task.TriggerCommentID, task.IssueID)
	b.WriteString(execenv.BuildCommentReplyInstructions(provider, task.IssueID, task.TriggerCommentID))
	return b.String()
}

// buildChatPrompt constructs a prompt for interactive chat tasks.
func buildChatPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a chat assistant for a Multica workspace.\n")
	b.WriteString("A user is chatting with you directly. Respond to their message.\n\n")
	fmt.Fprintf(&b, "User message:\n%s\n", task.ChatMessage)
	// List attachments by id + filename so the agent can fetch them via
	// the CLI. We deliberately do NOT inline the URL: chat attachments
	// live behind a signed CDN with a short TTL, so by the time the agent
	// has finished thinking the URL embedded in the markdown body may
	// have expired. `cs-workflow attachment download <id>` re-signs at click
	// time and is the only reliable path.
	if len(task.ChatMessageAttachments) > 0 {
		b.WriteString("\nAttachments on this message:\n")
		for _, a := range task.ChatMessageAttachments {
			if a.ContentType != "" {
				fmt.Fprintf(&b, "- id=%s filename=%q content_type=%s\n", a.ID, a.Filename, a.ContentType)
			} else {
				fmt.Fprintf(&b, "- id=%s filename=%q\n", a.ID, a.Filename)
			}
		}
		b.WriteString("Use `cs-workflow attachment download <id>` to fetch each file locally before referring to it.\n")
	}
	return b.String()
}

// buildAutopilotPrompt constructs a prompt for run_only autopilot tasks.
func buildAutopilotPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n\n")
	b.WriteString("This task was triggered by an Autopilot in run-only mode. There is no assigned Multica issue for this run.\n\n")
	fmt.Fprintf(&b, "Autopilot run ID: %s\n", task.AutopilotRunID)
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Autopilot ID: %s\n", task.AutopilotID)
	}
	if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "Autopilot title: %s\n", task.AutopilotTitle)
	}
	if task.AutopilotSource != "" {
		fmt.Fprintf(&b, "Trigger source: %s\n", task.AutopilotSource)
	}
	if strings.TrimSpace(string(task.AutopilotTriggerPayload)) != "" {
		fmt.Fprintf(&b, "Trigger payload:\n%s\n", strings.TrimSpace(string(task.AutopilotTriggerPayload)))
	}
	b.WriteString("\nAutopilot instructions:\n")
	if strings.TrimSpace(task.AutopilotDescription) != "" {
		b.WriteString(task.AutopilotDescription)
		b.WriteString("\n\n")
	} else if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "%s\n\n", task.AutopilotTitle)
	} else {
		b.WriteString("No additional autopilot instructions were provided. Inspect the autopilot configuration before proceeding.\n\n")
	}
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Start by running `cs-workflow autopilot get %s --output json` if you need the full autopilot configuration, then complete the instructions above.\n", task.AutopilotID)
	} else {
		b.WriteString("Complete the instructions above.\n")
	}
	b.WriteString("Do not run `cs-workflow issue get`; this run does not have an issue ID.\n")
	return b.String()
}

# Deliverable-Only Agent Surface

**Date:** 2026-07-23
**Branch:** `feat/deliverable-manual-upload`
**Status:** Design — pending implementation

## Problem

The cs-cloud agent runtime currently has **three parallel channels** for reporting
work back to multica:

1. **Comment** — the in-task agent posts/reads issue comments via CLI
   (`cs-workflow issue comment …`, and a duplicate `cs-cloud workflow issue comment …`).
2. **Attachment** — the agent uploads/downloads multica attachments via CLI
   (`cs-workflow attachment download`, `UploadFile` → `/api/upload-file`).
3. **Deliverable** — the agent opens a Gitea PR and reports it back
   (`cs-workflow repo submit --deliverable --file`).

The team is consolidating on the **deliverable PR** as the single way an agent
submits work. The comment and attachment channels for the agent must go, and the
deliverable channel must be promoted to a first-class, self-service surface.

Concretely the agent must be able to (the three capabilities):

1. **Read the workflow chain** for itself **and its sub/grandchild issues**
   (statuses of the workflow run and every node run).
2. **Read the deliverable repo address** for itself **and its sub/grandchild
   issues** (Gitea owner/repo/clone URL/branch + deliverable list).
3. **Submit a deliverable** (already works).

Today capability 3 works, capability 2 has a ready endpoint but no CLI, and
capability 1 is almost entirely missing.

## Goals

- Remove the agent-facing **comment** and **attachment** channels.
- Expose capabilities 1, 2, 3 through **`cs-workflow` (multica) as the sole
  agent-facing CLI**, with sub/grandchild-issue (descendants) support.
- Collapse the duplicate/stale agent CLI in the cs-cloud daemon repo.

## Non-Goals

- The **human-facing** comment and attachment features in multica stay untouched.
  `/api/issues/{id}/comments`, `/api/comments/{id}`, `/api/upload-file`,
  `/api/attachments/*` are all used by the web/desktop UI and are **not** removed.
- The cs-cloud daemon **localserver attachment cache**
  (`/api/v1/attachments*`, URL rewrite, `cs-cloud gc`) stays — it powers web UI
  prompt file attachments, which is a different concern from agent reporting.
- Comment-triggered agent tasks (`buildIssueCommentPrompt` / `TriggerCommentID`)
  stay — a human comment can still wake an agent.
- `cs-cloud workflow workspace/project` CLI commands are out of scope for this
  change (not part of the comment/attachment/deliverable channels).

## Confirmed Decisions

| Decision | Choice |
|---|---|
| Agent-facing CLI surface | **`cs-workflow` (multica) only.** cs-cloud daemon's parallel agent CLI is removed. |
| Removal depth | **Hard delete** (product not live; per CLAUDE.md prefer removing old paths). |
| Backend endpoint removal on multica side | **None.** All endpoints shared with human UI stay; removal is CLI-only. |
| Read-surface shape | **Two independent commands** (capability 1 = new endpoint; capability 2 = reuse existing endpoint). |
| Read-command output | **Human-readable text by default**, `--json` for machine format. |

## Current State (from exploration)

### What exists

- **DB descendants recursion is complete:** `ListIssueDescendants`
  ([issue.sql:266](../../../server/pkg/db/queries/issue.sql#L266)) — recursive CTE,
  tenant-guarded, ordered by `depth DESC`.
- **Deliverable-repo read endpoint exists and is daemon-auth reachable:**
  `GET /api/daemon/issues/{issue}/gitea-deliverables?descendants=true`
  ([issue_gitea_deliverables.go:60](../../../server/internal/handler/issue_gitea_deliverables.go#L60)).
  Returns per-issue `{owner, repo, clone_url, inst_branch, deliverables[]}` for
  self + all descendants. No `node_branch` (by design — node_branch is per
  node-run, not per issue).
- **Submit works:** `cs-workflow repo submit --deliverable <id> --file <path>`
  ([cmd_repo_submit.go](../../../server/cmd/cs-workflow/cmd_repo_submit.go)).
- **task env injection** ([task_cscloud_push.go:290-393](../../../server/internal/service/task_cscloud_push.go#L290))
  injects `MULTICA_REPO_*` (and legacy `MULTICA_GITEA_*`) for the current node-run.

### What's missing / broken

- **Capability 1 (workflow chain) almost entirely missing.** No endpoint joins
  "issue → its + descendants' workflow run + node runs status tree". daemon-auth
  can't even read its own issue's workflow run (only gets a `workflow_run_id`).
  No CLI command reads workflow status.
- **Capability 2 has an endpoint but no CLI wrapper.** The agent cannot fetch
  another/descendant issue's repo address from within a task; the prompt
  ([task_cscloud_push.go:241-243](../../../server/internal/service/task_cscloud_push.go#L241))
  currently tells the agent to "ask the user".
- **Duplicate/stale agent CLI in cs-cloud daemon.** `cs-cloud workflow issue
  get/list/create/status` hit routes that do not exist in multica
  (`/api/workspaces/%s/issues`) → 404. `cs-cloud workflow deliverable submit` is
  a stale duplicate that only reads legacy `MULTICA_GITEA_*` keys and reads the
  PAT from env. The multica prompt points agents at `cs-workflow`, not this.

## Detailed Design

### Part 1 — Removal

#### 1a. multica / `cs-workflow` (CLI commands only; endpoints stay)

Delete these agent CLI commands and their tests:

- `cs-workflow issue comment add/list/delete`
  ([cmd_issue.go:923/1055/1129](../../../server/cmd/cs-workflow/cmd_issue.go)),
  including the `--attachment` flag and its `UploadFile` usage.
- `cs-workflow attachment download` — delete the whole
  [cmd_attachment.go](../../../server/cmd/cs-workflow/cmd_attachment.go).
- In [server/internal/cli/client.go](../../../server/internal/cli/client.go), remove
  `UploadFile` / `UploadFileWithURL` **only if** no other non-removed command
  references them (verify during implementation).

**Keep** (shared with human UI, verified used by 23 frontend files):
`/api/issues/{id}/comments`, `/api/comments/{id}`, `/api/upload-file`,
`/api/attachments/*`.

#### 1b. cs-cloud daemon repo (`e:\Projects\cs-cloud`) — dead/duplicate code

Delete:

- `cs-cloud workflow issue comment add/list` **and** the rest of the dead
  `workflow issue get/list/create/status` family (`internal/cli/workflow_issue.go`).
- `cs-cloud workflow deliverable submit` (`internal/cli/gitea.go`) — stale
  duplicate of `cs-workflow repo submit`.
- Dead client surface in `internal/workflowrunner/client.go`:
  `CreateIssueComment`, `ListIssueComments`, `GetAttachment`.
- Dead protocol constants in `internal/workflow/protocol.go`:
  `MulticaIssueCommentsEndpoint`, `MulticaAttachmentEndpoint`.
- Dead models in `internal/workflow/models.go`: `Comment`, `Attachment`.
- Associated tests (`workflow_issue_test.go`, `gitea_test.go`, etc.).

**Keep:** the `localserver` attachment cache
(`/api/v1/attachments*`, `attachment_url_rewrite.go`, `cs-cloud gc`),
`cs-cloud workflow workspace/project`, and the workflow task/conversation
internal endpoints.

### Part 2 — Capability 1: workflow chain (with descendants)

**New endpoint** `GET /api/daemon/issues/{issue}/workflow-tree?descendants=true`
(daemon-auth, workspace-bound via daemon token).

- `resolveIssueInWorkspace` accepts UUID or `<PREFIX>-<number>` (e.g. `MUL-123`),
  mirroring `HandleGetIssueGiteaDeliverables`.
- targets = `[root (depth=0)]`; when `descendants=true|1`, append
  `ListIssueDescendants` rows (depth = CTE depth + 1).
- For each target issue with a `WorkflowRunID`, fetch the workflow run + its node
  runs + each node's deliverable submissions, reusing existing sqlc queries (the
  same data `GetWorkflowRun`/`ListWorkflowNodeRuns` already assemble for the
  user-auth side).
- Skip issues with no workflow run when `len(targets) > 1` (same rule as the
  deliverables endpoint).

Response shape (consistent with the gitea-deliverables endpoint's `issues[] +
depth` structure):

```json
{
  "issues": [
    {
      "issue_id": "uuid",
      "number": "MUL-123",
      "title": "…",
      "depth": 0,
      "status": "in_progress",
      "workflow_run": {
        "id": "uuid",
        "status": "running",
        "node_runs": [
          {
            "node_id": "uuid",
            "title": "Design spec",
            "status": "awaiting_critic",
            "display_status": "Awaiting review",
            "worker_agent_id": "uuid",
            "critic_agent_id": "uuid",
            "failure_reason": "",
            "deliverables": [
              { "deliverable_id": "uuid", "title": "spec.md", "submission_status": "submitted" }
            ]
          }
        ]
      }
    }
  ]
}
```

Issues with no workflow run get `"workflow_run": null`.

**New CLI** `cs-workflow issue workflow <id> [--descendants] [--json]` wraps it.

Default text output (tree):

```
MUL-123 (depth 0) [in_progress] Title…
  workflow run: running
    node 1 "Design spec"      [awaiting_critic] Awaiting review
      deliverable: spec.md    [submitted]
    node 2 "Implementation"   [pending]
MUL-124 (depth 1) [todo] Child Title
  (no workflow run)
```

### Part 3 — Capability 2: deliverable repo address (with descendants)

**Endpoint unchanged:** `GET /api/daemon/issues/{issue}/gitea-deliverables?descendants=true`.

**New CLI** `cs-workflow issue deliverables <id> [--descendants] [--json]` wraps it.

Default text output:

```
MUL-123 (depth 0) Title…
  repo:   owner/repo
  inst:   inst-<runid>
  clone:  https://gitea…/owner/repo.git
  deliverables:
    d1 "spec.md"  path: docs/spec.md
    d2 "impl.md"  path: docs/impl.md
MUL-124 (depth 1) Child Title
  repo:   owner/repo
  …
```

Note: the response has no `node_branch`. To read a descendant issue's
deliverables the agent clones `inst_branch` (plain git, no submit). Submitting is
always against the agent's own node-run via `repo submit`.

### Part 4 — Capability 3: submit deliverable

Unchanged: `cs-workflow repo submit --deliverable <id> --file <path>` remains the
single submit path. The cs-cloud daemon duplicate is removed in Part 1b.

### Part 5 — task prompt update

In [task_cscloud_push.go](../../../server/internal/service/task_cscloud_push.go)
`appendDeliverablePrompt`:

- Replace the "ask the user for another issue's repo URL" guidance with
  self-service instructions: use `cs-workflow issue deliverables <id>
  --descendants` for repo addresses and `cs-workflow issue workflow <id>
  --descendants` for chain status.
- Audit the prompt for any guidance that tells the agent to post issue comments
  or upload attachments, and remove/replace it. (The critic
  `{"approved": …, "comment": …}` JSON is an internal review field, not the
  comment channel — it stays.)

### Part 6 — Shared helper (light refactor)

`HandleGetIssueGiteaDeliverables` and the new `workflow-tree` handler iterate
descendants and resolve issues identically. Factor that loop (resolve root +
`ListIssueDescendants` + per-issue workspace resolution) into a small shared
helper in the handler package, used by both. Scoped; no broad refactor.

## Testing

- **New endpoint** (Go test in `server/internal/handler/`): daemon-auth gating;
  `descendants=true` recurses correctly; issues without a workflow run are
  skipped when descendants requested; single-issue (no descendants) returns just
  the root.
- **New CLI commands** (`server/cmd/cs-workflow/`): wrap the endpoint correctly;
  `--descendants` and `--json` flags behave; text output is readable.
- **Defensive parsing:** the Go CLI structs ignore unknown fields and default
  missing fields (so a future endpoint addition does not break an older CLI
  build talking to a newer server).
- **Deletions:** remove the now-orphaned tests
  (`cmd_issue` comment tests, `cmd_attachment` test, cs-cloud
  `workflow_issue_test.go` / `gitea_test.go`).
- **`make check`** green (typecheck, TS tests, Go tests).

## Risks / Open Items

- **`UploadFile`/`UploadFileWithURL` dependency check:** confirm no surviving
  cs-workflow command references them before deleting; otherwise keep the client
  helper and only delete the comment/attachment commands.
- **`cs-cloud workflow workspace/project`:** left in place; if also dead, that is
  a separate cleanup.
- **Deploy assumption:** the design assumes `cs-workflow` is the binary on the
  agent's PATH inside the cs-cloud environment (the prompt already instructs the
  agent to use it). If deployment actually ships the `cs-cloud` daemon CLI
  instead, the surface choice must be revisited — but the 404s on
  `cs-cloud workflow issue *` indicate those are not in active use.

## Summary of Surface After Change

| Capability | CLI command | Endpoint |
|---|---|---|
| Read workflow chain (+ descendants) | `cs-workflow issue workflow <id> [--descendants]` | `GET /api/daemon/issues/{id}/workflow-tree?descendants=true` (new) |
| Read deliverable repo address (+ descendants) | `cs-workflow issue deliverables <id> [--descendants]` | `GET /api/daemon/issues/{id}/gitea-deliverables?descendants=true` (existing) |
| Submit deliverable | `cs-workflow repo submit --deliverable <id> --file <path>` | `POST /api/daemon/node-runs/{nr}/deliverables/{d}/report-pr` (existing) |

Comment and attachment channels for the agent are gone; humans keep theirs.

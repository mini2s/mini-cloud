# Dynamic Task Splitting Success-First Design

## Background

Dynamic task splitting currently depends on an agent returning a strict JSON payload such as `{"tasks":[...]}`. Real execution showed this is fragile: the split task was executed like a normal issue assignment, the agent posted a comment, uploaded documents, changed the child issue status, and returned a natural-language summary instead of machine-readable tasks. The result was a failed split node and no `multica_workflow_split_task` rows, even though the agent produced useful task breakdown material.

The product goal is not to punish invalid output. The goal is to create usable split-task drafts as often as possible, keep risk in review, and give users a clear intervention path.

## Goals

- Maximize the chance that a split node reaches `awaiting_split_review` with editable draft tasks.
- Keep the existing Workflow `Worker` / `Critic` mental model.
- Avoid relying on final assistant text as the only source of truth.
- Prevent destructive or state-machine-breaking side effects from split generation.
- Preserve human review before child issues are created.
- Make progress, status, recovery options, and child issue links visible in the node details panel.

## Non-Goals

- Do not introduce parallel `planner_agent` / `reviewer` concepts.
- Do not auto-create child issues from unreviewed recovered text.
- Do not parse arbitrary natural language directly into active child issues.
- Do not make prompt wording the only reliability mechanism.

## Core Product Semantics

Split nodes continue to use existing Workflow fields:

- `Worker` means: who generates the split draft.
- `Critic` means: who reviews the split draft before child issue creation.

For split nodes:

```text
Worker = split draft generator
Critic = split draft reviewer
```

The default Worker should be a built-in split-specialized agent. The Critic should be required.

## Key Decisions

### 1. Default Worker Uses a Built-In Split Agent

Split nodes should keep `worker_type` / `worker_id`, but the default should be a dedicated built-in split agent rather than a general-purpose worker.

Suggested built-in split agents:

- `split-planner-general`
- `split-planner-code`
- `split-planner-design`
- `split-planner-test`

Default selection can be automatic:

```text
coding workflow/template -> split-planner-code
design/spec workflow/template -> split-planner-design
test/qa workflow/template -> split-planner-test
fallback -> split-planner-general
```

Users may override the Worker, but preflight should warn when a split node uses a non-specialized agent.

### 2. Critic Is Required

Split nodes should require a valid Critic. This keeps the current Worker/Critic model and makes review explicit before child issues are created.

Recommended v1 behavior:

- Default `critic_type = human`.
- Default critic is the workflow creator or current editor when available.
- Missing or invalid Critic blocks workflow activation/run start.
- Agent/API critics may be allowed later as advanced auto-review modes, but should show a risk warning.

### 3. Structured Draft Submission Is the Primary Success Path

The agent should not be required to make its final assistant response the authoritative task payload. Instead, provide a dedicated draft submission path.

Example CLI shape:

```bash
cs-workflow workflow split draft add <node-run-id> \
  --key html-shell \
  --title "Project scaffold and HTML shell" \
  --assignee agent:<uuid> \
  --description-file docs/split/html-shell.md \
  --depends-on setup

cs-workflow workflow split draft submit <node-run-id>
```

The server validates and stores draft rows in `multica_workflow_split_task`.

Validation rules:

- Request `X-Task-ID` must identify a running task for the same node run.
- Task context must be `{"type":"workflow","phase":"split"}`.
- Title and description are required.
- Assignee type must be `agent` or `member`.
- Assignee ID must belong to the workspace.
- Dependency keys must refer to submitted draft tasks.
- Dependency graph must be acyclic.
- Submit requires at least one valid task.

### 4. Completion Consumes Draft Rows First

When a split generation task completes, `SplitOrchestrator.HandleTaskCompletion` should prefer already-submitted draft rows.

```text
if submitted draft rows exist:
  transition node_run -> awaiting_split_review
else:
  run recovery pipeline
```

This makes CLI/API-submitted drafts the system truth.

### 5. Recovery Pipeline Prioritizes Success

If the agent does not use the draft CLI/API, the system should try to recover useful draft tasks before failing the node.

Recovery order:

1. Parse final task result as strict `{"tasks":[...]}`.
2. Parse wrapped task result output.
3. Parse common Markdown task breakdown formats:
   - numbered sections like `任务 1：...`
   - headings like `## Task 1`
   - tables with title/description/dependency columns
4. Inspect the agent's comments created during the task.
5. Inspect attachments uploaded by the agent during the task, especially files like `task-breakdown.md`.
6. If local extraction fails, dispatch a lightweight repair agent.

Recovered tasks must be marked as draft and routed to `awaiting_split_review`, not directly materialized as child issues.

### 6. Repair Agent Is the Last Automatic Fallback

The repair agent receives:

- Original final output.
- Agent comments created during the split task.
- Uploaded attachment text.
- Parent issue and split sub-issue context.
- The desired draft-task schema.

The repair agent should submit through the same draft CLI/API. Only if repair fails should the split node become `failed`.

## State Flow

```text
format_ok
  -> splitting
  -> worker generates draft tasks
  -> draft rows submitted or recovered
  -> awaiting_split_review
  -> critic approves/edits/rejects
  -> split_active
  -> child tasks execute
  -> completed
```

Failure should occur only after all success paths are exhausted:

```text
structured draft API failed or unused
  -> local result/comment/attachment recovery failed
  -> repair agent failed
  -> failed
```

## Split Phase Side-Effect Policy

Prompt instructions alone are not sufficient. The platform should use `X-Task-ID` to identify split-phase requests and control side effects.

Recommended policy:

- Allow read-only issue, comment, metadata, workspace, member, agent, and attachment operations.
- Allow split draft commands.
- Block issue status changes.
- Block issue creation/update/assignment from split-phase tasks.
- Treat accidental comments/attachments as recovery sources rather than as authoritative completion.

This protects the workflow state machine while preserving useful generated material.

## Frontend Requirements

### Node Config

Split node configuration should show existing fields with split-specific labels:

- Worker: "Split draft generator"
- Critic: "Split draft reviewer"

Required checks:

- Worker is required.
- Critic is required.
- Sub-template is required.
- Nested split in child template is invalid.

Warnings:

- Worker is not a built-in split planner.
- Critic is agent/API based and may auto-approve.

### Preflight

Workflow preflight should block:

- Split node without Worker.
- Split node without Critic.
- Split node with invalid Worker/Critic references.
- Split node without `sub_template_id`.
- Split node whose sub-template contains another split node.

Preflight should warn:

- Split node Worker is not a specialized split planner.
- Split node Critic is automated.

### Node Details Panel

The node details panel must expose the whole lifecycle:

- `splitting`: show active task, transcript entry, and generation progress.
- `awaiting_split_review`: show draft task list, edit controls, and approve/reject actions.
- `split_active`: show split task progress and child issue links.
- `failed`: show failure reason plus recovery actions:
  - regenerate
  - recover from output/comment/attachments
  - manually add draft task

## Backend Requirements

### Workflow Phase Propagation

The task claim response must expose `workflow_phase`, derived from task context. The daemon must receive it and render split-specific prompt/context files.

### Draft API

Add server endpoints for draft submission. Exact route can follow existing workflow split route style, for example:

```text
POST /api/node-runs/{nodeRunId}/split/draft-tasks
POST /api/node-runs/{nodeRunId}/split/draft-submit
DELETE /api/node-runs/{nodeRunId}/split/draft-tasks/{taskId}
```

The API should be idempotent enough for agent retries:

- `add` can upsert by `key`.
- `submit` can be called more than once when no materialized child issues exist.
- Existing draft tasks can be replaced before review approval.

### Split Orchestrator

`SplitOrchestrator.HandleTaskCompletion` should:

1. Verify task context is split phase.
2. Check whether valid draft tasks already exist.
3. If yes, transition to `awaiting_split_review`.
4. If no, run recovery.
5. If recovery creates tasks, transition to `awaiting_split_review`.
6. If recovery fails, dispatch repair.
7. If repair fails, mark node run `failed`.

### Approval

Approval continues to create child issues from draft rows. The draft review screen remains the human safety gate.

## Testing Strategy

Backend targeted tests:

- Claim response includes `workflow_phase=split`.
- Split daemon prompt/context does not contain normal assignment workflow.
- Split draft API accepts valid draft tasks from the matching split task.
- Split draft API rejects mismatched `X-Task-ID`.
- Split draft API rejects invalid dependencies and invalid assignees.
- Completion transitions to `awaiting_split_review` when draft rows exist.
- Completion recovers from Markdown breakdown output.
- Completion recovers from agent comment/attachment content.
- Split phase blocks issue status changes.

Frontend targeted tests:

- Split node config requires Worker and Critic.
- Preflight blocks missing Worker/Critic/sub-template.
- Preflight warns for non-specialized Worker.
- Node details panel shows split status, draft tasks, recovery actions, and child issue links.

## Rollout Plan

1. Fix `workflow_phase` propagation and split-specific daemon context.
2. Add built-in split planner agents and default split Worker selection.
3. Require Critic for split nodes in frontend preflight and backend run validation.
4. Add split draft API/CLI.
5. Update split completion to consume draft rows before parsing final output.
6. Add local recovery from output/comment/attachments.
7. Add repair agent fallback.
8. Improve node details panel for status, progress, review, and recovery.

## Open Questions

- Should split-phase comments be fully blocked or allowed as recovery material? Recommended v1: allow comments as recovery material, but block status changes and issue creation.
- Should automated critics be allowed in v1? Recommended v1: allow only with explicit warning or advanced setting.
- Should recovered tasks carry a visible "recovered" badge in review? Recommended: yes, so reviewers understand confidence level.

## Success Criteria

- A split generation task that produces a useful Markdown breakdown can still reach `awaiting_split_review`.
- A split generation task that uses the draft CLI reaches `awaiting_split_review` without parsing final output.
- A split generation task cannot change issue status or create child issues before review approval.
- Users can inspect, edit, approve, regenerate, or manually recover split drafts from the node details panel.

# Split Planner Efficiency Design

## Goal

Make dynamic split generation deterministic, faster, and easier to understand. The split planner should receive exact workflow context and default child assignment from the platform instead of discovering IDs, agents, and routing rules through exploratory CLI calls.

## Problem Summary

Issue `12f9b869-ef16-454e-b4bc-3b5a03cb0b34` showed a split generation phase that appeared stuck because the planner task took about 5 minutes 53 seconds and the frontend did not make progress visible enough.

Database and task-message evidence showed that the workflow editor worker configuration did take effect:

- The split node worker was `Split Planner (Code)`.
- The workflow node run copied that same worker.
- The actual split generation agent task ran as `Split Planner (Code)`.
- The generated draft tasks were assigned to `Code Developer`.

The inefficient part was not worker dispatch. The planner did extra work because the system did not provide enough structured split context:

- It searched for the workflow node run ID.
- It briefly tried the split planning issue ID as the node run ID.
- It ran `cs-workflow agent list --output json` to choose an assignee.
- It retried `draft submit` because `submit` did not support `--output`.
- It posted a comment and changed issue status even though split generation should stop after draft submission.

## Concepts

The product should treat these as separate concepts:

- `planner worker`: the agent or squad that generates draft child tasks for a split node.
- `default child assignee`: the assignee to use for generated child issues unless the planner has a stronger reason to override.
- `child workflow workers`: the workers configured inside the child workflow that execute the approved child issues after creation.

The workflow editor and backend should not overload a generic "worker" label for all three.

## Design Principles

- Prefer structured data over prompt guessing.
- Avoid requiring the planner to discover IDs that the backend already knows.
- Keep split generation write scope narrow: create/update draft tasks, submit drafts, then stop.
- Make long-running generation visible in the frontend with elapsed time and actor names.
- Keep existing workflow and split semantics intact unless a field is explicitly introduced.

## Backend Data Model

Add `default_child_assignee` to split node config:

```json
{
  "type": "split",
  "split_config": {
    "child_workflow_id": "a4e585da-be10-4edb-87f8-b4646e9e680a",
    "mode": "pipeline",
    "max_concurrency": 3,
    "max_failures": 0,
    "default_child_assignee": {
      "type": "agent",
      "id": "320436db-37ef-4356-8e64-80d8ccb98850"
    }
  }
}
```

Rules:

- `default_child_assignee.type` accepts `agent` and `member`.
- The selected assignee must exist in the same workspace.
- The split planner worker must not be used as an implicit fallback.
- If the field is missing, generation should still work for existing data, but new or edited split nodes should surface a preflight warning.
- The backend may fill missing draft assignees from `default_child_assignee`; if neither is present, it should return a clear error.

## Split Generation Context

The backend should include the following structured values in the split generation task context and daemon context file:

- `workflow_node_run_id`
- `parent_issue_id`
- `parent_issue_title`
- `parent_issue_description`
- `split_config`
- `planner_worker`
- `default_child_assignee`
- `child_workflow_summary`
- `draft_cli_examples`

The prompt should use exact values:

```text
Workflow node run ID: 4bb65e00-9136-4639-aac2-f8e2fe06e4a8
Default child assignee: agent:320436db-37ef-4356-8e64-80d8ccb98850 (Code Developer)
```

The prompt should explicitly say:

- Do not run `agent list` unless the default child assignee is absent and the task requires a different assignee.
- Do not use an issue ID as the node run ID.
- Do not post comments.
- Do not change issue status.
- After `workflow split draft submit <node-run-id>` succeeds, stop.

## CLI Changes

Make split draft CLI behavior consistent and planner-friendly:

- `workflow split draft submit` accepts `--output json`.
- `workflow split draft add` may omit `--assignee` when the node run has a valid `default_child_assignee`.
- `workflow split draft add` still accepts explicit `--assignee agent:<uuid>` or `member:<uuid>` for deliberate overrides.
- Error messages should distinguish invalid node run ID, missing default child assignee, and invalid assignee.

## Draft Assignee Source

The system should record or derive the source of a draft task assignee:

- `default_config`: filled from split config.
- `agent_override`: explicitly supplied by the planner.
- `human_edit`: changed during review.

Persisting this source requires a migration-backed slice. The first implementation may infer source from request path if adding a column is too large for the initial compatibility slice.

## Frontend UX

Use a quiet, operational interface. The split experience should look like a workflow control surface, not a marketing card.

Required states:

- While node run status is `splitting`, show `Generating draft tasks`.
- Show elapsed time once generation starts.
- After 60 seconds, show a restrained hint: `Planner is still generating drafts. Larger splits can take a few minutes.`
- Show `Planner: Split Planner (Code)`.
- Show `Default child assignee: Code Developer`.
- Show draft count as drafts appear.
- In review state, make it clear that drafts are awaiting human approval.

Workflow editor labels:

- `Planner agent`
- `Default child assignee`
- `Child workflow`
- `Mode`
- `Max concurrency`
- `Failure policy`

Preflight should distinguish:

- Missing planner agent.
- Missing default child assignee.
- Missing child workflow.
- Child workflow node workers that are not configured.

## Observability

Add structured events or logs for the split lifecycle:

- `split_generation_dispatched`
- `split_context_rendered`
- `split_draft_added`
- `split_draft_submit_failed`
- `split_draft_submitted`
- `split_review_ready`
- `split_approved`
- `split_child_issue_created`

Each event should include:

- `workflow_node_run_id`
- `workflow_run_id`
- `agent_task_id` when present
- `planner_agent_id`
- `default_child_assignee_id`
- `elapsed_ms` when meaningful

## Implementation Slices

### Slice 1: Remove Known Waste

- Inject exact node run ID into split generation prompt and context.
- Inject default child assignee when available.
- Make `draft submit --output json` valid.
- Tighten prompt rules so the planner stops after successful submit.
- Keep frontend generating state visible.

### Slice 2: Make Child Assignee Explicit

- Add `default_child_assignee` to split config parsing and validation.
- Add workflow editor controls for default child assignee.
- Add preflight warning for split nodes without a default child assignee.
- Let `draft add` omit `--assignee` when the default exists.

### Slice 3: Improve Review and Diagnostics

- Surface planner and child assignee in split runtime cards and review panel.
- Add structured split lifecycle events.
- Add duration summaries for split generation tasks.

## Testing Strategy

Backend:

- Test split runtime prompt includes exact `workflow_node_run_id`.
- Test split context file includes parent issue and default child assignee.
- Test `draft submit --output json` succeeds.
- Test `draft add` uses default child assignee when `--assignee` is omitted.
- Test missing default child assignee returns a clear error when no assignee is provided.
- Test approval creates child issues using draft assignee.

Frontend:

- Test split runtime card renders generating state for `splitting`.
- Test planner and default child assignee labels render distinctly.
- Test preflight flags missing split default child assignee separately from missing planner worker.
- Test long generation hint appears after the elapsed threshold.

Manual verification:

- Start a split node with `Split Planner (Code)` and `Code Developer`.
- Confirm the planner does not call `agent list`.
- Confirm it uses the exact node run ID.
- Confirm drafts are generated with `Code Developer`.
- Confirm frontend shows progress instead of appearing stuck.

## Non-Goals

- Do not redesign the entire workflow editor.
- Do not change child workflow execution semantics.
- Do not make the split planner create real child issues directly.
- Do not infer a default child assignee from the planner worker.
- Do not require full test-suite execution for this change; use targeted tests per touched module.

## Risks

- Existing split nodes may not have `default_child_assignee`. The first backend slice must preserve compatibility.
- If the UI label is unclear, users may still confuse planner worker with child assignee.
- If prompt and backend defaults disagree, generated drafts may look correct but be hard to audit.
- Adding a persisted assignee-source field may require a migration; defer unless needed for the first implementation.

## Acceptance Criteria

- A split generation task can add and submit drafts without discovering node run ID or agent ID through exploratory CLI calls.
- The UI distinguishes planner worker from default child assignee.
- Draft child tasks use `Code Developer` through deterministic configuration for the target issue scenario.
- The frontend shows useful progress while generation is running for multiple minutes.
- Targeted backend and frontend tests pass.

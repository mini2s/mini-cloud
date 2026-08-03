# Split Draft Batch Assignment Design

## Goal

Reduce the effort of assigning multiple split drafts while preserving all-or-nothing updates and keeping child issue creation behind the existing approval transaction.

## Scope

This change adds multi-selection and batch assignee updates to the split review panel. It does not create child issues, dispatch agent tasks, or start workflows when an assignee is selected. Those effects remain exclusive to split approval.

The existing single-draft assignee picker remains available and may override a previous batch result.

## User Experience

### Selection bar

Show a compact selection bar above the draft ledger when the current user can edit the split review and at least one active draft exists:

```text
[select all] Selected X/Y                         [Assignee]
```

- `Y` counts drafts whose status is `draft`.
- Discarded drafts do not count toward `Y`, do not participate in select all, and do not show a checkbox.
- Already assigned drafts remain selectable so users can reassign them in a batch.
- The select-all checkbox supports unchecked, indeterminate, and checked states.
- The assignee picker is disabled when `X` is zero or a batch request is pending.
- Choosing an assignee submits immediately. There is no batch mode, apply button, or confirmation dialog.
- The selection bar remains visible with `Selected 0/Y` after a successful update so the next group can be selected.
- For long ledgers, the selection bar remains visible at the top of the scrolling draft area.

On desktop, each draft's sequence-number position changes to a checkbox on hover or while selected. On touch layouts, the checkbox stays visible. This preserves title width and avoids adding a separate selection column.

### Selection lifecycle

Selection is initialized only once per node run during the lifetime of the execution panorama page:

- An uninitialized node run selects every unassigned active draft when its first non-empty draft response arrives.
- After initialization, user actions are authoritative. Query refreshes never add task IDs to the selection.
- Refreshes remove task IDs that no longer exist or are no longer active drafts.
- Closing and reopening the detail panel restores the previous selection, including an explicitly empty selection.
- A successful batch update clears the selection and shows `Updated X drafts`.
- A failed batch update retains task IDs that are still valid so the user can retry.
- Leaving the execution panorama page may discard the selection. It is not browser-persisted or server-persisted.

The execution panorama page owns a selection map keyed by node run ID. An absent entry means "not initialized"; an empty set means "initialized and explicitly empty." This keeps the state across detail-panel unmounts without introducing a global Zustand store.

### Single-draft assignment

The existing assignee picker remains on every editable active draft. It writes through the existing single-draft endpoint and can override a batch result. Both single and batch updates refresh the same split-task query data.

## Batch Assignee API

Add the endpoint:

```http
PATCH /api/node-runs/{nodeRunId}/split/draft-tasks/assignees
```

Request body:

```json
{
  "assignee_type": "agent",
  "assignee_id": "b1b73f57-7240-4b43-9d62-f4f100e5efca",
  "tasks": [
    {
      "task_id": "2d2e9686-88ef-48f9-bb50-4f019cf230cf",
      "expected_version": 3
    }
  ]
}
```

The response uses the existing `SplitTasksResponse` contract.

Reject an empty task list, duplicate task IDs, invalid UUIDs, missing assignee fields, or versions below one. The endpoint accepts the same assignee types as the single-draft endpoint: `member`, `agent`, `squad`, and `workflow`.

## Transaction Semantics

The handler parses boundary inputs and delegates the domain operation to the split service. The service performs the following work in one database transaction:

1. Lock the workflow node run and require status `awaiting_split_review`.
2. Resolve and verify that the acting user is still the configured split reviewer.
3. Load and lock every requested split draft.
4. Verify that every task belongs to the node run, has status `draft`, and matches its `expected_version`.
5. Validate the shared assignee with the existing issue assignment service and the transaction-scoped queries.
6. Update each task's assignee and increment its version.
7. Reload the node run's split tasks and commit.

Executing the existing row update once per task inside the transaction is sufficient. A dedicated JSONB or dynamically generated bulk SQL statement is unnecessary because any error rolls back all row updates.

The single-draft endpoint remains available. Shared validation should be factored only far enough to prevent the single and batch paths from drifting.

## Approval Version Check

The current approval transaction already locks the node run, validates the complete active draft set, revalidates every assignee, creates child issues, and schedules ready work. Extend its request with an optional version snapshot while retaining `approved_task_ids`:

```json
{
  "approved_task_ids": [
    "2d2e9686-88ef-48f9-bb50-4f019cf230cf"
  ],
  "expected_versions": {
    "2d2e9686-88ef-48f9-bb50-4f019cf230cf": 4
  }
}
```

The new frontend always sends one expected version for every approved task. When `expected_versions` is present, the server requires an exact key match with `approved_task_ids` and compares every version after locking the current drafts. A mismatch returns `draft_task_conflict` before tasks are approved or child issues are created.

The field is optional at the API boundary for installed desktop compatibility:

- Older clients can continue sending only `approved_task_ids` to a newer server.
- Newer clients can send `expected_versions` to an older server because Go's decoder ignores unknown fields on the existing approval endpoint.
- All clients still receive the existing transaction-time assignee and active-draft validation.

## Errors And Recovery

- `400 invalid_split_request`: malformed input, empty tasks, duplicate tasks, incomplete approval version snapshot, or an invalid node-run state.
- `403 split_reviewer_required`: the acting user is not the configured reviewer.
- `409 draft_task_conflict`: any requested draft or approval snapshot has a stale version.
- `422 invalid_split_task_assignee`: the assignee is missing, invalid, inactive, or forbidden for the reviewer.
- `404`: the node run is unavailable to the current workspace member.

For batch `409` and `422` responses, the frontend refreshes split tasks and assignee option queries, displays the existing assignment-conflict message, and prunes only selections that are no longer valid. Other failures show a generic batch-assignment error and retain the selection.

No WebSocket event is required for a draft-only update. The successful mutation writes the returned `SplitTasksResponse` into the scoped React Query cache and invalidates it on settlement, matching the single-assignee mutation.

## Component Boundaries

- `ExecutionPanoramaPage` owns the node-run-keyed ephemeral selection map so panel close/open cycles retain user intent.
- `SplitReviewPanel` owns the batch mutation, error recovery, toast, and translation between selected IDs and versioned task requests.
- `SplitDraftLedger` renders controlled selection state, the selection bar, row checkboxes, and the existing per-row picker.
- `packages/core` defines API types, parses the response through the existing split-task schema, and exposes the React Query mutation.
- The Go handler owns HTTP parsing and error translation; the split service owns transaction and authorization semantics.

## Accessibility And Responsive Behavior

- The select-all and row checkboxes have task-specific accessible labels.
- Indeterminate state is exposed through the checkbox component rather than visual styling alone.
- The assignee picker retains keyboard navigation and announces its batch purpose.
- Pending controls remain dimensionally stable and use disabled state instead of replacing labels with loading text.
- On narrow layouts, the selection count and assignee picker may wrap to separate lines without overlapping draft content.

## Related Verification

Run only the affected module tests.

### Backend

- A valid batch updates all requested drafts and increments every version.
- A stale version on any task rolls back all assignee updates.
- An invalid assignee rolls back all assignee updates.
- A duplicate, foreign, discarded, or non-draft task is rejected without changes.
- A non-reviewer and a node run outside `awaiting_split_review` cannot update drafts.
- Approval with a stale expected version creates no child issues, changes no task status, and dispatches no work.
- Approval without `expected_versions` retains compatibility behavior.

### Core

- The API client sends the dedicated batch request and parses the response with `SplitTasksResponseSchema`.
- A malformed or partial response falls back without throwing into the UI.
- The mutation updates and then invalidates the node-run-scoped split-task query.
- Approval includes the expected-version snapshot.

### Views

- First entry selects all unassigned active drafts once.
- Closing and reopening restores non-empty and explicitly empty selections.
- Query refreshes prune invalid selections without adding new ones.
- Select all and indeterminate states exclude discarded drafts.
- Assigned drafts can be selected and reassigned.
- A successful batch displays the updated count and clears selection.
- A failed batch retains valid selection and refreshes conflict-sensitive data.
- The existing single-draft picker can override a batch result.

## Out Of Scope

- Persisting checkbox selection across page reloads or application restarts.
- Creating, assigning, or dispatching real child issues before approval.
- Replacing the existing single-draft assignee endpoint.
- Generalizing the existing workflow-ID batch patch endpoint.
- Adding drag-and-drop assignment, a batch modal, or a separate batch-selection mode.

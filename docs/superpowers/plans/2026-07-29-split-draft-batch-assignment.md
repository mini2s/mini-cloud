# Split Draft Batch Assignment Implementation Plan

> **Execution:** Implement inline in the current session. Do not use subagents, `executing-plans`, or create commits.

**Goal:** Add an accessible batch-assignee workflow for split drafts with all-or-nothing updates and approval-time version conflict protection.

**Architecture:** A dedicated HTTP endpoint delegates single and batch assignee changes to one transaction-scoped split service. React Query owns returned draft data, while `ExecutionPanoramaPage` retains only the ephemeral checkbox selection across detail-panel close/open cycles.

**Tech Stack:** Go, pgx/sqlc, PostgreSQL, TypeScript, React, TanStack Query, Vitest, Testing Library, i18next.

## Global Constraints

- Run only related Go, Core, and Views tests; do not run the full repository test suite.
- Do not commit any design, plan, or implementation changes.
- Preserve the existing single-draft assignee endpoint and installed desktop API compatibility.
- Keep server data in React Query and checkbox selection in React component state.
- Use existing UI primitives and semantic design tokens; add no dependency.
- Keep code comments in English and UI copy in both English and Simplified Chinese locales.

---

### Task 1: Transactional assignee domain operation

**Files:**
- Modify: `server/pkg/db/queries/workflow_split_task.sql`
- Regenerate: `server/pkg/db/generated/workflow_split_task.sql.go`
- Modify: `server/internal/service/workflow_split.go`
- Test: `server/internal/handler/workflow_split_test.go`

**Interfaces:**
- Produce `ListSplitTasksByNodeRunForUpdate(ctx, nodeRunID)` to lock draft rows.
- Produce `SplitDraftAssigneeUpdate{TaskID pgtype.UUID, ExpectedVersion int64}`.
- Produce `SplitDraftBatchAssigneeRequest{AssigneeType string, AssigneeID pgtype.UUID, Tasks []SplitDraftAssigneeUpdate}`.
- Produce `SplitOrchestrator.UpdateSplitDraftAssignees(ctx, nodeRun, actorUserID, request) error`.

- [ ] Add failing integration tests for a successful multi-row update, stale-version rollback, invalid-assignee rollback, duplicate IDs, foreign/discarded drafts, non-reviewer access, and invalid node-run status.
- [ ] Run `cd server; go test ./internal/handler -run 'TestPatchSplit(TaskAssignee|DraftTaskAssignees)'` and confirm the new batch tests fail because the endpoint/service is absent.
- [ ] Add this sqlc query next to `ListSplitTasksByNodeRun`:

```sql
-- name: ListSplitTasksByNodeRunForUpdate :many
SELECT * FROM multica_workflow_split_task
WHERE node_run_id = $1
ORDER BY sort_order ASC, created_at ASC
FOR UPDATE;
```

- [ ] Run `make sqlc` and confirm the generated query is available.
- [ ] Implement `UpdateSplitDraftAssignees` with `runInTx`: lock the node run, verify `awaiting_split_review`, resolve the reviewer in the transaction, reject duplicate or missing tasks, lock the node run's split tasks, validate task membership/status/version, call `Assignments.ValidateAssignee`, and execute `SetSplitTaskAssignee` for every requested row.
- [ ] Return existing typed split errors: `invalid_split_request`, `split_reviewer_required`, `draft_task_conflict`, and `invalid_split_task_assignee`.
- [ ] Run the focused handler tests and confirm transaction rollback leaves every assignee and version unchanged after any failed row.

### Task 2: HTTP endpoints and approval version snapshot

**Files:**
- Modify: `server/internal/handler/workflow_split.go`
- Modify: `server/cmd/server/router.go`
- Modify: `server/internal/service/workflow_split.go`
- Test: `server/internal/handler/workflow_split_test.go`

**Interfaces:**
- Add `PATCH /api/node-runs/{nodeRunId}/split/draft-tasks/assignees`.
- Request `{assignee_type, assignee_id, tasks: [{task_id, expected_version}]}`.
- Extend `SplitApproveRequest` with `ExpectedVersions map[string]int64 \`json:"expected_versions,omitempty"\``.

- [ ] Add failing handler tests for malformed/empty batch payloads, unknown fields, UUID parsing, and successful `SplitTasksResponse` output.
- [ ] Add a failing approval test that sends a stale `expected_versions` map and asserts zero approved tasks, zero child issues, and zero dispatches.
- [ ] Add compatibility tests showing approval without `expected_versions` still succeeds and a provided map must exactly match `approved_task_ids` with versions greater than zero.
- [ ] Implement `BatchPatchSplitTaskAssignees`: decode with `DisallowUnknownFields`, validate boundary UUIDs and versions, delegate to `UpdateSplitDraftAssignees`, reload tasks, and return `SplitTasksResponse`.
- [ ] Refactor `PatchSplitTaskAssignee` to delegate a one-item request to the same service so single and batch updates share locks, authorization, validation, and error behavior.
- [ ] Register the plural `assignees` route before the `{taskId}` route.
- [ ] In `ApproveSplit`, use `ListSplitTasksByNodeRunForUpdate`; when `expected_versions` is present, validate exact task-ID coverage and compare every locked draft version before `MarkSplitTasksApproved`.
- [ ] Run `cd server; go test ./internal/handler -run 'Test.*Split.*(Assignee|Approve|Approval|Draft)'` and confirm all related tests pass.

### Task 3: Core API contract and mutations

**Files:**
- Modify: `packages/core/types/workflow.ts`
- Modify: `packages/core/api/client.ts`
- Modify: `packages/core/workflows/queries.ts`
- Test: `packages/core/workflows/queries.test.ts`
- Test: `packages/core/api/schemas.test.ts`

**Interfaces:**
- Add `BatchPatchSplitTaskAssigneesRequest` with one assignee and versioned tasks.
- Extend `ApproveSplitRequest` with `expected_versions?: Record<string, number>`.
- Add `api.batchPatchSplitTaskAssignees(nodeRunId, request)`.
- Add `useBatchPatchSplitTaskAssignees(wsId)`.

- [ ] Add failing query tests that assert the dedicated endpoint receives the exact request and successful data replaces `workflowKeys.splitTasks(wsId, nodeRunId)` before invalidation.
- [ ] Extend schema tests with a malformed batch response passed through the existing `SplitTasksResponseSchema` fallback path.
- [ ] Add the request types and client method using `parseWithFallback(raw, SplitTasksResponseSchema, EMPTY_SPLIT_TASKS_RESPONSE, ...)`.
- [ ] Implement the mutation with the same cache-write and settle-invalidation policy as `usePatchSplitTaskAssignee`.
- [ ] Update approval request construction types to accept the additive version snapshot without removing `approved_task_ids`.
- [ ] Run `pnpm --filter @multica/core exec vitest run workflows/queries.test.ts api/schemas.test.ts` and confirm passing results.

### Task 4: Controlled draft selection and batch interaction

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/workflows/components/split/split-review-panel.tsx`
- Modify: `packages/views/workflows/components/split/split-draft-ledger.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`
- Test: `packages/views/workflows/components/split/split-review-panel.test.tsx`
- Test: `packages/views/workflows/components/split/split-draft-ledger.test.tsx`

**Interfaces:**
- `ExecutionPanoramaPage` passes `selectedDraftTaskIds?: string[]` and `onSelectedDraftTaskIdsChange(ids: string[])` for the selected node run.
- `SplitReviewPanel` derives the first-entry default, prunes invalid IDs, builds versioned batch requests, and handles success/conflict toasts.
- `SplitDraftLedger` receives controlled selection, renders the selection bar, and emits row/select-all/batch-assignee actions.

- [ ] Add failing panel tests for first non-empty response selecting only unassigned active drafts, preserving explicit empty selection, pruning removed/discarded IDs without adding new IDs, building batch requests with current versions, success clearing, and failure retention.
- [ ] Add failing ledger tests for checked/indeterminate/all states, assigned rows remaining selectable, discarded rows lacking checkboxes, disabled picker at zero selection, pending controls, and the existing single-row picker remaining usable.
- [ ] Add a node-run-keyed selection record in `ExecutionPanoramaPage`. Store only defined arrays so a missing key means uninitialized and `[]` means explicitly empty.
- [ ] In `SplitReviewPanel`, derive default selected IDs while the controlled value is undefined, persist them after the first non-empty task response, and prune controlled IDs against tasks whose status is `draft`.
- [ ] Build approval payloads with both `approved_task_ids` and an `expected_versions` record from the same active task snapshot.
- [ ] Wire `useBatchPatchSplitTaskAssignees`; on success show `Updated {{count}} drafts` and set selection to `[]`; on `409/422`, refetch split tasks and all assignee option queries while retaining valid IDs.
- [ ] Render a sticky compact selection bar in `SplitDraftLedger` using the shared Checkbox and AssigneePicker. Reuse the row-number position for the checkbox on hover/selection and keep it visible for touch layouts.
- [ ] Add English and Chinese keys for selected count, select all, batch assignee label, success, and generic failure.
- [ ] Run `pnpm --filter @multica/views exec vitest run workflows/components/split/split-review-panel.test.tsx workflows/components/split/split-draft-ledger.test.tsx` and confirm passing results.

### Task 5: Focused verification and review

**Files:**
- Review all files changed by Tasks 1-4.

- [x] Run `gofmt` on modified Go files and regenerate sqlc output once more.
- [x] Run the focused Go handler tests from Tasks 1-2.
- [x] Run the focused Core tests from Task 3.
- [x] Run the focused Views tests from Task 4.
- [x] Run targeted type checks for affected packages: `pnpm --filter @multica/core typecheck` and `pnpm --filter @multica/views typecheck` when those scripts are available; otherwise run the nearest workspace typecheck command and report its scope.
- [x] Run `git diff --check` and inspect `git diff` for accidental unrelated changes, response parsing casts, package-boundary violations, selection reinitialization, and missing rollback coverage.
- [x] Confirm `git status` contains no new commit and report any tests that could not run.

# Workflow Run New Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy workflow run detail DAG and node list with the shared read-only execution panorama while preserving run controls and role assignment.

**Architecture:** `WorkflowRunPage` remains responsible for run-level state, cancellation, and role resolution. Its content area composes the existing `ExecutionPanoramaPage`, which owns all runtime canvas rendering and node detail interactions; React Query deduplicates the shared node-run query key.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Testing Library, XYFlow

## Global Constraints

- Keep all server state in TanStack Query; do not copy API data into Zustand.
- Keep `packages/views/` free of `next/*` and `react-router-dom` imports.
- Reuse the existing `ExecutionPanoramaPage`; do not introduce a second runtime canvas abstraction.
- Preserve run status, runtime policy, cancellation, role assignment, optimistic-lock conflict handling, and role retry behavior.
- Remove the legacy `DAGCanvas`, `NodeRunCard` list, and page-owned `SplitReviewPanel` path from `WorkflowRunPage`.
- Do not change APIs, routes, localization strings, or `ExecutionPanoramaPage` behavior.

---

### Task 1: Switch workflow run detail to the execution panorama

**Files:**
- Modify: `packages/views/workflows/components/workflow-run-page.test.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.roles.test.tsx`
- Modify: `packages/views/workflows/components/workflow-run-page.tsx`

**Interfaces:**
- Consumes: `ExecutionPanoramaPageProps` with `workflowId: string`, `runId: string | null`, `wsId: string`, optional `issueId?: string`, and optional `fillAvailableHeight?: boolean`.
- Produces: `WorkflowRunPage({ workflowId, runId })` with unchanged public props and unchanged run-level controls.

- [ ] **Step 1: Replace legacy canvas tests with failing panorama composition tests**

In `workflow-run-page.test.tsx`, mock `../../issues/components/execution` and capture the received props:

```tsx
const mocks = vi.hoisted(() => ({
  // existing run/query mutation fixtures
  executionPanoramaProps: null as null | {
    workflowId: string;
    runId: string | null;
    wsId: string;
    issueId?: string;
    fillAvailableHeight?: boolean;
  },
}));

vi.mock("../../issues/components/execution", () => ({
  ExecutionPanoramaPage: (props: NonNullable<typeof mocks.executionPanoramaProps>) => {
    mocks.executionPanoramaProps = props;
    return <div data-testid="execution-panorama" />;
  },
}));
```

Replace the old DAG status, boundary-node, split-panel, node-list, and deliverable tests with these assertions:

```tsx
it("renders the shared execution panorama with run context", () => {
  mocks.run = {
    ...(mocks.run as Record<string, unknown>),
    input: { issue_id: "issue-1" },
  };

  render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

  expect(screen.getByTestId("execution-panorama")).toBeInTheDocument();
  expect(mocks.executionPanoramaProps).toEqual({
    workflowId: "wf-1",
    runId: "run-1",
    wsId: "ws-1",
    issueId: "issue-1",
    fillAvailableHeight: true,
  });
  expect(screen.queryByTestId("legacy-dag-canvas")).not.toBeInTheDocument();
  expect(screen.queryByTestId("legacy-node-run-card")).not.toBeInTheDocument();
});

it("omits a malformed issue id from the panorama context", () => {
  mocks.run = {
    ...(mocks.run as Record<string, unknown>),
    input: { issue_id: 42 },
  };

  render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

  expect(mocks.executionPanoramaProps).toEqual(expect.objectContaining({
    issueId: undefined,
  }));
});
```

Keep the existing cancellation confirmation test. Mock legacy `DAGCanvas` and `NodeRunCard` with the test IDs above so the absence assertions detect accidental rendering.

In `workflow-run-page.roles.test.tsx`, mock `ExecutionPanoramaPage` as a simple `<div data-testid="execution-panorama" />` and keep all six role assignment tests unchanged.

- [ ] **Step 2: Run the focused tests and verify the new composition test fails**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/workflow-run-page.test.tsx workflows/components/workflow-run-page.roles.test.tsx
```

Expected: FAIL because `WorkflowRunPage` still renders `DAGCanvas` and never renders the mocked `ExecutionPanoramaPage`.

- [ ] **Step 3: Implement the minimal page composition change**

In `workflow-run-page.tsx`:

1. Import `ExecutionPanoramaPage` from `../../issues/components/execution`.
2. Remove `workflowNodesOptions`, `workflowEdgesOptions`, `DAGCanvas`, `ReactFlowProvider`, `NodeRunCard`, `SplitReviewPanel`, `parseNodeFormat`, `NodeRunStatus`, `RUNNING_STATES`, `STATUS_COLOR`, `formatNodeRunStatus`, node/edge queries, node status derivations, split selection state, and split click handlers.
3. Keep the run, node-run, resolution, and member queries. Continue deriving `issueId` defensively from `run.input`.
4. Set the loading condition to `runLoading || nodeRunsLoading`.
5. Render the new main content as:

```tsx
<div className="flex min-h-0 flex-1">
  <div className="min-w-0 flex-1">
    <ExecutionPanoramaPage
      workflowId={workflowId}
      runId={runId}
      wsId={wsId}
      issueId={issueId}
      fillAvailableHeight
    />
  </div>
  {resolutions.length > 0 ? (
    <aside className="w-96 shrink-0 overflow-y-auto border-l bg-card p-3">
      {/* Preserve the existing role assignment section without the node-run list. */}
    </aside>
  ) : null}
</div>
```

6. Keep the cancellation dialog after the content area unchanged.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/workflow-run-page.test.tsx workflows/components/workflow-run-page.roles.test.tsx
```

Expected: 2 test files pass with all updated panorama, cancellation, and role assignment tests green.

- [ ] **Step 5: Run package type checking and diff validation**

Run:

```bash
pnpm --filter @multica/views typecheck
git diff --check
```

Expected: both commands exit with code 0 and report no TypeScript or whitespace errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add packages/views/workflows/components/workflow-run-page.tsx \
  packages/views/workflows/components/workflow-run-page.test.tsx \
  packages/views/workflows/components/workflow-run-page.roles.test.tsx
git commit -m "feat(workflows): use execution panorama for run history"
```

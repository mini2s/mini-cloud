# Workflow Split Node UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Project instructions require inline execution and disable subagent-driven-development and executing-plans by default.

**Goal:** Make the workflow editor split node use the same title, type badge, description, and two-column metadata hierarchy as other editor nodes without changing runtime split cards.

**Architecture:** Keep `WorkflowCanvasNodeShell` as the shared surface. Replace only the split branch inside `CompactWorkerNode` with editor-specific markup and localized metadata; leave `SplitNodeCard` unchanged for runtime-oriented states.

**Tech Stack:** React, TypeScript, Tailwind CSS, i18next selector API, Vitest, Testing Library, React Flow.

## Global Constraints

- Do not change split configuration, runtime behavior, canvas layout, node size, handles, or edges.
- Keep runtime `SplitNodeCard` unchanged.
- Add visible copy to both English and Simplified Chinese workflow locale files.
- Run only the relevant `@multica/views` test module, not the full test suite.

---

### Task 1: Align Split Editor Node Content

**Files:**
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: `parseNodeFormat(node.format_schema)`, `WorkflowCanvasNodeShell`, and the existing `useT("workflows")` selector API.
- Produces: editor-only split markup with `data-testid="compact-worker-node-badge-<id>"` and `data-testid="compact-worker-node-meta-<id>"`; no new exported API.

- [ ] **Step 1: Write the failing split layout test**

Update the existing split test to require a `Split` type badge, the shared bottom metadata separator, localized child workflow and policy labels, and the existing mode, concurrency, and failure values.

```tsx
expect(screen.getByTestId("compact-worker-node-badge-split-1")).toHaveTextContent("Split");
expect(screen.getByTestId("compact-worker-node-meta-split-1")).toHaveClass("border-t", "grid-cols-2");
expect(screen.getByText("Child workflow")).toBeInTheDocument();
expect(screen.getByText("Execution policy")).toBeInTheDocument();
expect(screen.getByText("barrier")).toBeInTheDocument();
expect(screen.getByText("Concurrency 5 · Max failures 0")).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx
```

Expected: the split test fails because the current branch has no type badge or shared metadata labels.

- [ ] **Step 3: Implement the editor-specific split layout**

Remove the `SplitNodeCard` import from `compact-worker-node.tsx`. Render split nodes through the same header structure as other nodes, with localized `Split` badge text and optional description. Render a bottom two-column metadata area: child workflow on the left and execution policy on the right. Use the existing format values and omit maximum failures from the policy summary for `pipeline` mode.

Add these keys under `panorama.card` in both locale files:

```json
{
  "split_badge": "Split",
  "split_child_workflow_label": "Child workflow",
  "split_policy_label": "Execution policy",
  "split_policy_summary": "Concurrency {{concurrency}} · Max failures {{maxFailures}}",
  "split_pipeline_policy_summary": "Concurrency {{concurrency}}"
}
```

Use corresponding Simplified Chinese values: `拆分`, `子 workflow`, `执行策略`, `并发 {{concurrency}} · 最多失败 {{maxFailures}}`, and `并发 {{concurrency}}`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: the compact worker node test file passes with no warnings or failures.

- [ ] **Step 5: Verify formatting and TypeScript impact**

Run:

```bash
git diff --check
pnpm --filter @multica/views typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Inspect the editor visually**

Start the existing web development server, open a workflow editor containing ordinary and split nodes, and capture a desktop screenshot. Confirm the cards share the same title, badge, separator, metadata typography, and fixed dimensions, with no clipped or overlapping text.

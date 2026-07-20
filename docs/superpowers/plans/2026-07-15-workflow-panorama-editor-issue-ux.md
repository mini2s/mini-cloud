# Workflow Panorama Editor Issue UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved UX spec for the workflow editor, issue execution panorama, split child issue progress, and runtime detail panels.

**Architecture:** Keep the existing ReactFlow/XYFlow canvas and panel architecture. Improve shared canvas primitives and data mapping first, then layer editor-specific configuration UX and runtime-specific progress/detail UX on top. Split review remains the richer workbench mode defined by the dynamic task splitting frontend spec.

**Tech Stack:** React, TypeScript, @xyflow/react, TanStack Query, Zustand editor store, Vitest + Testing Library, existing shadcn/Base UI wrappers, `packages/views` i18n JSON resources.

## Global Constraints

- Only cover actually used components: `WorkflowPanoramaPage`, `WorkflowCanvasCore` model/edge/node types, `NodeConfigPanel`, `ExecutionPanoramaPage`, `GlobalNotificationBar`, `ExecutionDetailPanel`, `SplitReviewPanel`, split child issue components.
- Do not implement node ID numbering such as `#1-1`.
- Do not map ordinary workflow nodes to issues; only Split Node child tasks produce child issue navigation.
- Do not add a global Dify-style Variable Inspector; keep raw JSON/logs behind Evidence/Transcript/Session entries.
- Do not rewrite split review into manual field editing, DAG editing, drag sorting, or multiselect batch operations.
- Use existing visual tokens, existing UI components, existing app fonts, and existing rounded/shadow conventions.
- Default verification is targeted module tests, not full test suite.
- Preserve unrelated working tree changes. Stage only files touched by the current task.

---

## File Structure

- `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx`
  - Owns shared panorama edge rendering, visibility, labels, delete control, and runtime tone classes.
- `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`
  - Verifies edge stroke/opacity/tone/label behavior.
- `packages/views/workflows/components/canvas/workflow-canvas-model.ts`
  - Converts workflow nodes/edges to ReactFlow models. Stop generating critic badge nodes/edges for actual panorama usage.
- `packages/views/workflows/components/canvas/workflow-canvas-model.test.ts`
  - Verifies critic badge defaults and explicit legacy behavior if retained.
- `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
  - Editor node card. Add internal Worker/Critic role rows.
- `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
  - Verifies merged role display and no separate critic node reliance.
- `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
  - Passes critic names into editor node data and opts out of critic badge nodes.
- `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`
  - Verifies editor creates one node per workflow node and opens config panel from merged node.
- `packages/views/workflows/components/node-config-panel.tsx`
  - Reorders configuration panel into Readiness, Node intent, Worker/Critic, Split behavior, Connections, Actions.
- `packages/views/workflows/components/node-config-panel.test.tsx`
  - Verifies field order, readiness, split behavior copy, and actions.
- `packages/views/workflows/components/split/split-config-panel.tsx`
  - Updates split behavior labels/copy to user-facing barrier/pipeline/concurrency/failure wording.
- `packages/views/workflows/components/split/split-config-panel.test.tsx`
  - Create if no focused test exists; verifies split behavior copy and disabled/onChange behavior.
- `packages/views/issues/components/execution/global-notification-bar.tsx`
  - Evolves into global run progress summary, still includes action-needed chips.
- `packages/views/issues/components/execution/global-notification-bar.test.tsx`
  - Verifies counts, current node, elapsed fallback, and notification priority.
- `packages/views/issues/components/execution/execution-panorama-page.tsx`
  - Adds runtime edge tones/labels, passes runtime summary to the progress bar, preserves split child issue panel navigation.
- `packages/views/issues/components/execution/execution-panorama-page.test.tsx`
  - Verifies runtime edge data, child issue click behavior, and no direct navigation from child node click.
- `packages/views/issues/components/execution/execution-detail-panel.tsx`
  - Reorders ordinary and child issue runtime detail into receipt modes; hides raw outputs behind evidence preview.
- `packages/views/issues/components/execution/execution-detail-panel.test.tsx`
  - Verifies ordinary receipt mode, child issue mode, actions, and hidden raw output behavior.
- `packages/views/workflows/components/split/split-review-panel.tsx`
  - Preserve split workbench mode; fix visible mojibake copy and ensure mode remains richer than ordinary detail panel.
- `packages/views/workflows/components/split/split-review-panel.test.tsx`
  - Verifies Verdict, Draft plan, Dependencies, Ask agent, Transcript, sticky footer, and no manual editing controls.
- `packages/views/locales/en/issues.json`
- `packages/views/locales/zh-Hans/issues.json`
- `packages/views/locales/en/workflows.json`
- `packages/views/locales/zh-Hans/workflows.json`
  - Add/adjust UI strings used by the new panel labels and progress summary.
- `packages/views/locales/parity.test.ts`
  - Existing parity test should continue passing.

---

### Task 1: Shared Canvas Edge Visibility and Runtime Edge Data

**Files:**
- Modify: `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.ts`
- Modify: `packages/views/workflows/components/canvas/workflow-canvas-model.test.ts`

**Interfaces:**
- Consumes: `Edge.data` from `workflowEdgesToReactFlowEdges`.
- Produces:
  - `PanoramaEdgeData.edgeTone?: "data" | "condition" | "error" | "rework" | "critic" | "success" | "running" | "blocked" | "waiting"`
  - `PanoramaEdgeData.edgeLabel?: string`
  - `workflowNodesToReactFlowNodes(... includeCriticBadges?: boolean)` defaults to `false`.
  - `workflowEdgesToReactFlowEdges(... includeCriticEdges?: boolean)` defaults to `false`.

- [ ] **Step 1: Write failing tests for stronger edge visibility**

Add to `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`:

```tsx
it("renders default panorama edges with readable opacity and stroke width", () => {
  renderEdge({ id: "edge-1", selected: false, data: { edgeTone: "data" } });

  const path = screen.getByTestId("rf__edge-path-edge-1");
  expect(path).toHaveStyle({ strokeWidth: "2.75", opacity: "0.72" });
});

it("renders selected edges with stronger primary emphasis", () => {
  renderEdge({ id: "edge-1", selected: true, data: { edgeTone: "data" } });

  const path = screen.getByTestId("rf__edge-path-edge-1");
  expect(path).toHaveStyle({ strokeWidth: "3.5", opacity: "0.95" });
});

it("renders business labels for runtime edge data", () => {
  renderEdge({
    id: "edge-1",
    selected: false,
    sourceX: 20,
    sourceY: 30,
    targetX: 120,
    targetY: 30,
    data: { edgeTone: "running", edgeLabel: "4 child issues" },
  });

  expect(screen.getByTestId("panorama-edge-label-edge-1")).toHaveTextContent("4 child issues");
});
```

If the test helper is named differently, keep its existing setup and pass the same props. The expected failure is that current defaults are `strokeWidth: 1.5`, `opacity: 0.28`, and no label exists.

- [ ] **Step 2: Run edge tests and verify failure**

Run:

```bash
pnpm --filter @multica/views test packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx
```

Expected: FAIL on opacity/stroke width and missing `panorama-edge-label-edge-1`.

- [ ] **Step 3: Implement stronger edge rendering and labels**

In `panorama-edge.tsx`, update types and rendering:

```tsx
type PanoramaEdgeTone =
  | "data"
  | "condition"
  | "error"
  | "rework"
  | "critic"
  | "success"
  | "running"
  | "blocked"
  | "waiting";

type PanoramaEdgeData = {
  stageColorIndex?: number;
  sameStage?: boolean;
  edgeKind?: "data" | "condition" | "error" | "rework" | "critic";
  edgeTone?: PanoramaEdgeTone;
  edgeLabel?: string;
  onDeleteEdge?: (edgeId: string) => void;
  deleteButtonPosition?: { x: number; y: number };
};

function toneClass(tone: PanoramaEdgeData["edgeTone"]): string {
  if (tone === "condition" || tone === "running") return "text-blue-500";
  if (tone === "error" || tone === "blocked") return "text-red-500";
  if (tone === "rework" || tone === "critic") return "text-amber-500";
  if (tone === "success") return "text-emerald-500";
  if (tone === "waiting") return "text-slate-500";
  return "";
}
```

Update the `BaseEdge` style:

```tsx
style={{
  stroke: "currentColor",
  strokeWidth: selected ? 3.5 : 2.75,
  opacity: selected ? 0.95 : edgeData?.edgeTone === "waiting" ? 0.7 : 0.72,
  strokeDasharray: edgeData?.edgeTone === "blocked" ? "7 5" : style?.strokeDasharray,
  ...style,
}}
```

Render the label before the delete button:

```tsx
{edgeData?.edgeLabel ? (
  <EdgeLabelRenderer>
    <div
      data-testid={`panorama-edge-label-${id}`}
      className="nodrag nopan pointer-events-none absolute inline-flex h-5 items-center rounded-full border border-border bg-background px-2 text-[10px] font-medium text-muted-foreground shadow-sm"
      style={{
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
      }}
    >
      {edgeData.edgeLabel}
    </div>
  </EdgeLabelRenderer>
) : null}
```

- [ ] **Step 4: Write failing tests for critic node defaults**

Add to `workflow-canvas-model.test.ts`:

```ts
it("does not create critic badge nodes by default", () => {
  const rfNodes = workflowNodesToReactFlowNodes({
    nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
    stages: [],
    nodeType: "compactWorker",
    makeNodeData: (node) => ({ node }),
  });

  expect(rfNodes.map((node) => node.id)).toEqual(["node-1"]);
});

it("does not create critic edges by default", () => {
  const rfEdges = workflowEdgesToReactFlowEdges({
    edges: [],
    nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
    stages: [],
  });

  expect(rfEdges).toEqual([]);
});
```

Expected failure: current defaults are `includeCriticBadges = true` and `includeCriticEdges = true`.

- [ ] **Step 5: Update canvas model defaults**

In `workflow-canvas-model.ts`, change defaults:

```ts
includeCriticBadges = false,
```

and:

```ts
includeCriticEdges = false,
```

Keep explicit `includeCriticBadges: true` and `includeCriticEdges: true` behavior working for any legacy tests that intentionally cover old badge behavior.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @multica/views test packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx packages/views/workflows/components/canvas/workflow-canvas-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx packages/views/workflows/components/canvas/workflow-canvas-model.ts packages/views/workflows/components/canvas/workflow-canvas-model.test.ts
git commit -m "feat(workflow): improve panorama edge visibility"
```

---

### Task 2: Editor Node Card Worker/Critic Role Merge

**Files:**
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Modify: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`

**Interfaces:**
- Consumes: `CompactWorkerNodeData.workerName`, `CompactWorkerNodeData.criticName`, `workerConfigured`, `criticConfigured`.
- Produces:
  - `CompactWorkerNodeData.criticName?: string`
  - DOM test ids:
    - `compact-worker-node-worker-role-${id}`
    - `compact-worker-node-critic-role-${id}`

- [ ] **Step 1: Write failing CompactWorkerNode test**

Add to `compact-worker-node.test.tsx`:

```tsx
it("renders worker and critic as internal roles on one node", () => {
  renderCompactWorkerNode({
    id: "node-1",
    data: {
      node: makeNode({
        id: "node-1",
        title: "Implement API",
        worker_type: "agent",
        worker_id: "agent-1",
        critic_type: "human",
        critic_id: "member-1",
      }),
      stage_id: "stage-1",
      stageColorIndex: 0,
      workerName: "Builder Agent",
      criticName: "Reviewer",
      workerConfigured: true,
      criticConfigured: true,
    },
  });

  expect(screen.getByTestId("compact-worker-node-worker-role-node-1")).toHaveTextContent("Builder Agent");
  expect(screen.getByTestId("compact-worker-node-critic-role-node-1")).toHaveTextContent("Reviewer");
});
```

Expected: FAIL because the editor node currently only renders a single metadata row.

- [ ] **Step 2: Implement internal role rows**

In `compact-worker-node.tsx`, add `criticName` to `CompactWorkerNodeData`:

```ts
criticName?: string;
```

Add helpers:

```tsx
function RoleSlot({
  testId,
  label,
  value,
  configured,
  icon,
}: {
  testId: string;
  label: string;
  value: string;
  configured: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="min-w-0 space-y-0.5">
      <span className="block text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[10px] leading-4">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            configured ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" : "bg-muted-foreground/45",
          )}
        />
        <span className={cn("truncate font-medium", configured ? "text-foreground/85" : "text-muted-foreground")}>
          {value}
        </span>
        {icon}
      </span>
    </div>
  );
}
```

Replace the old bottom metadata row for non-split, non-gateway nodes with:

```tsx
<div className="grid grid-cols-2 gap-2 border-t border-border/45 pt-2">
  <RoleSlot
    testId={`compact-worker-node-worker-role-${id}`}
    label="Worker"
    value={workerLabel ?? "Not configured"}
    configured={workerConfigured}
    icon={workerLabel ? <WorkerIcon type={nodeData.node.worker_type} /> : null}
  />
  <RoleSlot
    testId={`compact-worker-node-critic-role-${id}`}
    label="Critic"
    value={
      nodeData.criticName ??
      (nodeData.criticConfigured ? "Configured" : "Optional")
    }
    configured={nodeData.criticConfigured === true}
    icon={<UserRound className="size-3 shrink-0 text-muted-foreground/75" strokeWidth={1.8} />}
  />
</div>
```

Keep annotation, gateway, and split node existing specialized rendering.

- [ ] **Step 3: Pass criticName from WorkflowPanoramaPage**

In `workflow-panorama-page.tsx`, inside `makeNodeData`, add:

```ts
criticName: node.critic_id
  ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined
  : node.critic_api_url
    ? "API review"
    : undefined,
```

Ensure the call to `workflowNodesToReactFlowNodes` passes:

```ts
includeCriticBadges: false,
```

- [ ] **Step 4: Write panorama page test for one node per workflow node**

Add to `workflow-panorama-page.test.tsx` near existing ReactFlow node assertions:

```tsx
it("renders configured critic inside the worker node instead of a separate critic badge node", () => {
  mocks.nodesData = [
    makeNode({
      id: "node-1",
      title: "Implement API",
      worker_id: "agent-1",
      critic_id: "agent-2",
      critic_type: "agent",
    }),
  ];

  render(<WorkflowPanoramaPage workflowId="wf-1" />);

  const renderedNodes = mocks.reactFlowProps?.nodes ?? [];
  expect(renderedNodes.map((node) => node.id)).toEqual(expect.arrayContaining(["node-1"]));
  expect(renderedNodes.some((node) => node.id === "node-1:critic")).toBe(false);
});
```

Expected before Step 3: FAIL if critic badges are still emitted.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @multica/views test packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
git commit -m "feat(workflow): merge worker and critic in editor nodes"
```

---

### Task 3: Workflow Node Configuration Panel Reordering

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`
- Modify: `packages/views/workflows/components/node-config-panel.test.tsx`
- Modify: `packages/views/workflows/components/split/split-config-panel.tsx`
- Create: `packages/views/workflows/components/split/split-config-panel.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Produces panel sections in this order:
  - `readiness`
  - `primary`
  - `worker-critic`
  - `split-behavior` for split nodes
  - `connections`
  - `actions`
- Produces split copy labels:
  - `split_release_mode_label`
  - `split_release_after_finish`
  - `split_release_after_created`
  - `split_concurrency_question`
  - `split_failure_tolerance_label`

- [ ] **Step 1: Write failing section-order test**

In `node-config-panel.test.tsx`, add:

```tsx
it("orders the config panel around readiness, intent, roles, split behavior, connections, and actions", () => {
  renderPanel({
    node: makeNode({
      id: "split-1",
      title: "Split work",
      format_schema: {
        type: "split",
        split_config: {
          child_workflow_id: "child-wf-1",
          mode: "barrier",
          max_concurrency: 5,
          max_failures: 1,
        },
      },
      worker_type: "agent",
      worker_id: "agent-1",
      critic_type: "human",
      critic_id: null,
    }),
  });

  expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
    "readiness",
    "primary",
    "worker-critic",
    "split-behavior",
    "connections",
    "actions",
  ]);
});
```

Expected: FAIL because `NodeDetailSectionId` does not include these new ids and current order differs.

- [ ] **Step 2: Extend section id type**

In `packages/views/common/workflow-node-detail-panel-shell.tsx`, extend `NodeDetailSectionId`:

```ts
export type NodeDetailSectionId =
  | "readiness"
  | "primary"
  | "worker-critic"
  | "split-behavior"
  | "runtime"
  | "connections"
  | "actions"
  | "agent-operations";
```

Update connector line hiding if needed:

```tsx
{sectionId !== "actions" && sectionId !== "agent-operations" ? (
  <span ... />
) : null}
```

No visual change required beyond supporting new ids.

- [ ] **Step 3: Add readiness section**

In `node-config-panel.tsx`, compute readiness:

```ts
const readinessItems = [
  workerConfigured
    ? { key: "worker", tone: "success" as const, label: t(($) => $.detail_panel.readiness_worker_ready) }
    : { key: "worker", tone: "warning" as const, label: t(($) => $.detail_panel.readiness_worker_missing) },
  criticConfigured || (!isSplit && !node.critic_id && !node.critic_api_url)
    ? { key: "critic", tone: "success" as const, label: criticConfigured ? t(($) => $.detail_panel.readiness_critic_ready) : t(($) => $.detail_panel.readiness_critic_optional) }
    : { key: "critic", tone: "warning" as const, label: t(($) => $.detail_panel.readiness_critic_missing) },
  isSplit && !splitConfig.child_workflow_id
    ? { key: "child-workflow", tone: "warning" as const, label: t(($) => $.detail_panel.readiness_child_workflow_missing) }
    : { key: "child-workflow", tone: "success" as const, label: t(($) => $.detail_panel.readiness_child_workflow_ready) },
].filter((item) => item.key !== "child-workflow" || isSplit);
```

Render first:

```tsx
<NodeDetailSection
  sectionId="readiness"
  icon={<AlertTriangle className="size-4" />}
  title={t(($) => $.detail_panel.section_readiness)}
  subtitle={t(($) => $.detail_panel.section_readiness_desc)}
>
  <div className="space-y-1.5">
    {readinessItems.map((item) => (
      <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
        <span>{item.label}</span>
        <StatusBadge tone={item.tone}>{item.tone === "success" ? t(($) => $.detail_panel.badge_configured) : t(($) => $.detail_panel.badge_needs_assignee)}</StatusBadge>
      </div>
    ))}
  </div>
</NodeDetailSection>
```

- [ ] **Step 4: Group Worker and Critic in one section**

Replace separate worker/critic `AssignmentCard` placement with one `NodeDetailSection`:

```tsx
<NodeDetailSection
  sectionId="worker-critic"
  icon={<Bot className="size-4" />}
  title={t(($) => $.detail_panel.section_worker_critic)}
  subtitle={t(($) => $.detail_panel.section_worker_critic_desc)}
>
  <div className="space-y-3">
    {/* existing Worker AssignmentCard */}
    {/* existing divider */}
    {/* existing Critic AssignmentCard */}
  </div>
</NodeDetailSection>
```

Keep existing `AssignmentCard` internals and mutation handlers.

- [ ] **Step 5: Move split config into split-behavior section**

For split nodes, wrap `SplitConfigPanel`:

```tsx
{isSplit ? (
  <NodeDetailSection
    sectionId="split-behavior"
    icon={<GitBranch className="size-4" />}
    title={t(($) => $.detail_panel.section_split_behavior)}
    subtitle={t(($) => $.detail_panel.section_split_behavior_desc)}
  >
    <SplitConfigPanel
      config={splitConfig}
      childWorkflows={activeWorkflows}
      currentWorkflowId={workflowId}
      disabled={disabled}
      onChange={handleSplitConfigChange}
    />
  </NodeDetailSection>
) : null}
```

Remove the nested header inside `SplitConfigPanel` after Step 6 so the panel does not show duplicated titles.

- [ ] **Step 6: Update SplitConfigPanel copy**

In `split-config-panel.tsx`, change labels:

```tsx
<Label className="text-xs text-muted-foreground">
  {t(($) => $.detail_panel.split_release_mode_label)}
</Label>
...
{ value: "barrier", label: t(($) => $.detail_panel.split_release_after_finish) },
{ value: "pipeline", label: t(($) => $.detail_panel.split_release_after_created) },
...
<Label htmlFor="split-max-concurrency" className="text-xs text-muted-foreground">
  {t(($) => $.detail_panel.split_concurrency_question)}
</Label>
...
<Label htmlFor="split-max-failures" className="text-xs text-muted-foreground">
  {t(($) => $.detail_panel.split_failure_tolerance_label)}
</Label>
```

Keep the existing `onChange` payload shape unchanged.

- [ ] **Step 7: Add locale keys**

In `packages/views/locales/en/workflows.json` under `detail_panel`:

```json
"section_readiness": "Configuration readiness",
"section_readiness_desc": "Resolve missing choices before saving or testing this node.",
"section_worker_critic": "Worker and critic",
"section_worker_critic_desc": "Configure the two roles inside this workflow step.",
"section_split_behavior": "Child task behavior",
"section_split_behavior_desc": "Define how this split node creates and releases child issues.",
"readiness_worker_ready": "Worker is configured",
"readiness_worker_missing": "Choose who does the work",
"readiness_critic_ready": "Critic is configured",
"readiness_critic_optional": "Critic is optional",
"readiness_critic_missing": "Choose who confirms the result",
"readiness_child_workflow_ready": "Child workflow is selected",
"readiness_child_workflow_missing": "Choose a child workflow",
"split_release_mode_label": "When can downstream continue?",
"split_release_after_finish": "After child issues finish",
"split_release_after_created": "After child issues are created",
"split_concurrency_question": "How much work can start at once?",
"split_failure_tolerance_label": "Failure tolerance"
```

Add equivalent Chinese strings in `zh-Hans/workflows.json`.

- [ ] **Step 8: Add SplitConfigPanel focused test**

Create `split-config-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitConfigPanel } from "./split-config-panel";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (selector: (resources: any) => string) => selector({
      detail_panel: {
        split_child_workflow_label: "Child workflow",
        split_child_workflow_placeholder: "Select a child workflow...",
        split_review_required_title: "Human review is required",
        split_review_required_hint: "Generated split tasks stop for human review.",
        split_release_mode_label: "When can downstream continue?",
        split_release_after_finish: "After child issues finish",
        split_release_after_created: "After child issues are created",
        split_mode_hint: "Barrier waits; pipeline releases after creation.",
        split_concurrency_question: "How much work can start at once?",
        split_concurrency_hint: "Run at most this many child workflows at once.",
        split_failure_tolerance_label: "Failure tolerance",
        split_max_failures_hint: "Stop parent when failures exceed this number.",
      },
    }),
  }),
}));

describe("SplitConfigPanel", () => {
  it("uses user-facing split behavior labels", () => {
    render(
      <SplitConfigPanel
        config={{ child_workflow_id: "child-1", mode: "barrier", max_concurrency: 5, max_failures: 1 }}
        childWorkflows={[{ id: "child-1", title: "Child workflow", status: "active" } as any]}
        currentWorkflowId="wf-1"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("When can downstream continue?")).toBeInTheDocument();
    expect(screen.getByText("After child issues finish")).toBeInTheDocument();
    expect(screen.getByText("After child issues are created")).toBeInTheDocument();
    expect(screen.getByText("How much work can start at once?")).toBeInTheDocument();
    expect(screen.getByText("Failure tolerance")).toBeInTheDocument();
  });

  it("updates release mode without changing other split settings", () => {
    const onChange = vi.fn();
    render(
      <SplitConfigPanel
        config={{ child_workflow_id: "child-1", mode: "barrier", max_concurrency: 5, max_failures: 1 }}
        childWorkflows={[{ id: "child-1", title: "Child workflow", status: "active" } as any]}
        currentWorkflowId="wf-1"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("After child issues are created"));
    expect(onChange).toHaveBeenCalledWith({
      child_workflow_id: "child-1",
      mode: "pipeline",
      max_concurrency: 5,
      max_failures: 1,
    });
  });
});
```

- [ ] **Step 9: Run tests**

```bash
pnpm --filter @multica/views test packages/views/workflows/components/node-config-panel.test.tsx packages/views/workflows/components/split/split-config-panel.test.tsx packages/views/locales/parity.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/views/common/workflow-node-detail-panel-shell.tsx packages/views/workflows/components/node-config-panel.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/workflows/components/split/split-config-panel.tsx packages/views/workflows/components/split/split-config-panel.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflow): reorganize node configuration panel"
```

---

### Task 4: Runtime Global Progress Summary

**Files:**
- Modify: `packages/views/issues/components/execution/global-notification-bar.tsx`
- Modify: `packages/views/issues/components/execution/global-notification-bar.test.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/locales/en/issues.json`
- Modify: `packages/views/locales/zh-Hans/issues.json`

**Interfaces:**
- Consumes: `nodeRunMap: Map<string, WorkflowNodeRun>`.
- Produces:
  - `deriveRunProgress(nodeRunMap): RunProgressSummary`
  - Props:
    - `currentNodeId?: string | null`
    - `currentNodeTitle?: string | null`
  - test ids:
    - `run-progress-summary`
    - `run-progress-meter`
    - `run-progress-current`

- [ ] **Step 1: Write failing progress tests**

In `global-notification-bar.test.tsx`, add:

```tsx
it("renders global run progress counts even when no action notification exists", () => {
  const nodeRunMap = new Map([
    ["n1", makeNodeRun({ id: "r1", workflow_node_id: "n1", status: "completed" })],
    ["n2", makeNodeRun({ id: "r2", workflow_node_id: "n2", status: "working" })],
    ["n3", makeNodeRun({ id: "r3", workflow_node_id: "n3", status: "pending" })],
  ]);

  render(
    <GlobalNotificationBar
      nodeRunMap={nodeRunMap}
      currentNodeTitle="Build API"
      onScrollToNode={vi.fn()}
    />,
  );

  expect(screen.getByTestId("run-progress-summary")).toHaveTextContent("Completed1");
  expect(screen.getByTestId("run-progress-summary")).toHaveTextContent("Running1");
  expect(screen.getByTestId("run-progress-summary")).toHaveTextContent("Waiting1");
  expect(screen.getByTestId("run-progress-current")).toHaveTextContent("Build API");
});
```

Expected: FAIL because the current bar returns null with no notification items.

- [ ] **Step 2: Implement progress derivation**

In `global-notification-bar.tsx`, add:

```ts
export interface RunProgressSummary {
  completed: number;
  running: number;
  blocked: number;
  waiting: number;
  total: number;
}

export function deriveRunProgress(nodeRunMap: Map<string, WorkflowNodeRun>): RunProgressSummary {
  const runs = [...nodeRunMap.values()];
  return runs.reduce<RunProgressSummary>((summary, run) => {
    summary.total += 1;
    if (run.status === "completed" || run.status === "critic_approved" || run.status === "format_ok") {
      summary.completed += 1;
    } else if (
      run.status === "working" ||
      run.status === "worker_assigned" ||
      run.status === "critic_reviewing" ||
      run.status === "awaiting_critic" ||
      run.status === "awaiting_input" ||
      run.status === "splitting" ||
      run.status === "split_active"
    ) {
      summary.running += 1;
    } else if (
      run.status === "blocked" ||
      run.status === "failed" ||
      run.status === "format_failed" ||
      run.status === "critic_rework"
    ) {
      summary.blocked += 1;
    } else {
      summary.waiting += 1;
    }
    return summary;
  }, { completed: 0, running: 0, blocked: 0, waiting: 0, total: 0 });
}
```

Update props:

```ts
export interface GlobalNotificationBarProps {
  nodeRunMap: Map<string, WorkflowNodeRun>;
  currentNodeTitle?: string | null;
  onScrollToNode: (nodeId: string) => void;
}
```

- [ ] **Step 3: Render summary even without notifications**

Replace early return:

```tsx
const progress = useMemo(() => deriveRunProgress(nodeRunMap), [nodeRunMap]);
if (progress.total === 0 && items.length === 0) return null;
```

Render before notification rail:

```tsx
<div data-testid="run-progress-summary" className="flex min-w-0 flex-wrap items-center gap-1.5">
  <span className="inline-flex h-6 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">
    {t(($) => $.execution.progress.completed)}<span className="ml-1 tabular-nums">{progress.completed}</span>
  </span>
  <span className="inline-flex h-6 items-center rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-medium text-blue-700">
    {t(($) => $.execution.progress.running)}<span className="ml-1 tabular-nums">{progress.running}</span>
  </span>
  <span className="inline-flex h-6 items-center rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700">
    {t(($) => $.execution.progress.blocked)}<span className="ml-1 tabular-nums">{progress.blocked}</span>
  </span>
  <span className="inline-flex h-6 items-center rounded-md border border-border bg-muted/35 px-2 text-[11px] font-medium text-muted-foreground">
    {t(($) => $.execution.progress.waiting)}<span className="ml-1 tabular-nums">{progress.waiting}</span>
  </span>
</div>
```

Render meter:

```tsx
<div data-testid="run-progress-meter" className="grid h-1.5 w-full grid-cols-[var(--completed)_var(--running)_var(--blocked)_var(--waiting)] gap-0.5 overflow-hidden rounded-full bg-muted">
  <span className="bg-emerald-500" style={{ gridColumn: "span 1" }} />
  <span className="bg-blue-500" style={{ gridColumn: "span 1" }} />
  <span className="bg-red-500" style={{ gridColumn: "span 1" }} />
  <span className="bg-muted-foreground/40" style={{ gridColumn: "span 1" }} />
</div>
```

Use inline style variables on the parent:

```tsx
style={{
  ["--completed" as string]: Math.max(progress.completed, 0),
  ["--running" as string]: Math.max(progress.running, 0),
  ["--blocked" as string]: Math.max(progress.blocked, 0),
  ["--waiting" as string]: Math.max(progress.waiting, 0),
}}
```

Render current node:

```tsx
{currentNodeTitle ? (
  <span data-testid="run-progress-current" className="inline-flex h-6 max-w-full items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground">
    {t(($) => $.execution.progress.current)} <span className="ml-1 truncate text-foreground">{currentNodeTitle}</span>
  </span>
) : null}
```

- [ ] **Step 4: Pass current node from ExecutionPanoramaPage**

In `ExecutionPanoramaCanvasProps` add:

```ts
currentNodeTitle?: string | null;
```

Pass to `GlobalNotificationBar`:

```tsx
<GlobalNotificationBar
  nodeRunMap={nodeRunMap}
  currentNodeTitle={currentNodeTitle}
  onScrollToNode={scrollToNode}
/>
```

In `ExecutionPanoramaPage`, derive:

```ts
const currentNodeTitle = useMemo(() => {
  const activeStatuses = new Set(["working", "worker_assigned", "critic_reviewing", "awaiting_critic", "awaiting_input", "splitting", "split_active"]);
  const activeRun = [...nodeRunMap.entries()].find(([, run]) => activeStatuses.has(run.status));
  if (!activeRun) return null;
  return allNodes.find((node) => node.id === activeRun[0])?.title ?? null;
}, [allNodes, nodeRunMap]);
```

Pass `currentNodeTitle={currentNodeTitle}` to `ExecutionPanoramaCanvas`.

- [ ] **Step 5: Add locale keys**

In `packages/views/locales/en/issues.json` under `execution`:

```json
"progress": {
  "completed": "Completed",
  "running": "Running",
  "blocked": "Blocked",
  "waiting": "Waiting",
  "current": "Current:"
}
```

Add matching Chinese keys in `zh-Hans/issues.json`.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @multica/views test packages/views/issues/components/execution/global-notification-bar.test.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/locales/parity.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/views/issues/components/execution/global-notification-bar.tsx packages/views/issues/components/execution/global-notification-bar.test.tsx packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/locales/en/issues.json packages/views/locales/zh-Hans/issues.json
git commit -m "feat(execution): show workflow run progress on canvas"
```

---

### Task 5: Runtime Edge Tones, Labels, and Split Child Issue Semantics

**Files:**
- Modify: `packages/views/issues/components/execution/execution-panorama-page.tsx`
- Modify: `packages/views/issues/components/execution/execution-panorama-page.test.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.tsx`
- Modify: `packages/views/issues/components/execution/runtime-node-card.test.tsx`

**Interfaces:**
- Produces:
  - `decorateRuntimeEdges(baseEdges, nodeRunMap, runtimeSummaryMap, splitTasksByNodeId): Edge[]`
  - Edge data labels: `edgeLabel?: string`
  - Edge tones: `success`, `running`, `blocked`, `waiting`

- [ ] **Step 1: Write failing runtime edge data test**

In `execution-panorama-page.test.tsx`, add:

```tsx
it("adds runtime tones and labels to key workflow edges", () => {
  mocks.isLoading = false;
  mocks.nodesData = [
    makeNode({ id: "n1", title: "Plan" }),
    makeNode({ id: "n2", title: "Build" }),
  ];
  mocks.edgesData = [makeEdge({ id: "e1", source_node_id: "n1", target_node_id: "n2" })];
  mocks.nodeRunsData = [
    makeNodeRun({ workflow_node_id: "n1", status: "completed", worker_output: { artifact_count: 2 } }),
    makeNodeRun({ workflow_node_id: "n2", status: "working" }),
  ];

  renderWithClient(<ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />);

  const edge = mocks.reactFlowProps?.edges.find((item) => item.id === "e1");
  expect(edge?.data).toMatchObject({ edgeTone: "success", edgeLabel: "2 artifacts" });
});
```

Expected: FAIL because runtime edges currently use base data only.

- [ ] **Step 2: Add runtime edge decoration helper**

In `execution-panorama-page.tsx`, add above `ExecutionPanoramaPage`:

```ts
function runtimeToneForEdge(
  sourceRun: WorkflowNodeRun | undefined,
  targetRun: WorkflowNodeRun | undefined,
): "success" | "running" | "blocked" | "waiting" {
  if (targetRun?.status === "blocked" || targetRun?.status === "failed" || targetRun?.status === "format_failed") {
    return "blocked";
  }
  if (targetRun?.status === "working" || targetRun?.status === "worker_assigned" || targetRun?.status === "critic_reviewing") {
    return "running";
  }
  if (sourceRun?.status === "completed" || sourceRun?.status === "critic_approved") {
    return "success";
  }
  return "waiting";
}

function edgeLabelForSource(
  sourceNodeId: string,
  sourceRun: WorkflowNodeRun | undefined,
  splitTasksByNodeId: Map<string, SplitTask[]>,
): string | undefined {
  const childIssueCount = (splitTasksByNodeId.get(sourceNodeId) ?? []).filter((task) => task.issue_id).length;
  if (childIssueCount > 0) return `${childIssueCount} child issues`;
  const output = sourceRun?.worker_output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const artifactCount = Number((output as Record<string, unknown>).artifact_count ?? 0);
    if (artifactCount > 0) return `${artifactCount} artifacts`;
  }
  if (sourceRun?.status === "blocked" || sourceRun?.status === "failed") return "blocked";
  return undefined;
}

export function decorateRuntimeEdges({
  edges,
  nodeRunMap,
  splitTasksByNodeId,
}: {
  edges: Edge[];
  nodeRunMap: Map<string, WorkflowNodeRun>;
  splitTasksByNodeId: Map<string, SplitTask[]>;
}): Edge[] {
  return edges.map((edge) => {
    const sourceRun = nodeRunMap.get(edge.source);
    const targetRun = nodeRunMap.get(edge.target);
    return {
      ...edge,
      data: {
        ...(edge.data ?? {}),
        edgeTone: runtimeToneForEdge(sourceRun, targetRun),
        edgeLabel: edgeLabelForSource(edge.source, sourceRun, splitTasksByNodeId),
      },
    };
  });
}
```

- [ ] **Step 3: Apply decoration before rendering**

Replace:

```ts
const rfEdges = [...baseRfEdges, ...splitChildEdges];
```

with:

```ts
const rfEdges = [
  ...decorateRuntimeEdges({
    edges: baseRfEdges,
    nodeRunMap,
    splitTasksByNodeId,
  }),
  ...splitChildEdges,
];
```

For split child edges, set `edgeLabel` on direct parent-to-child edges:

```ts
data: {
  edgeKind: "data",
  edgeTone: childRuntimeSummary.display_status === "blocked" ? "blocked" : "running",
  edgeLabel: splitTaskDisplayStatus(task.status) === "blocked" ? "blocked" : undefined,
  stageColorIndex: 0,
  sameStage: true,
},
```

- [ ] **Step 4: Write runtime node card test for split summary**

In `runtime-node-card.test.tsx`, add:

```tsx
it("uses split child progress as the single expansion control", () => {
  renderRuntimeNodeCard({
    node: makeSplitNode(),
    nodeRun: makeNodeRun({ status: "split_active" }),
    runtimeSummary: {
      workflow_node_id: "split-1",
      display_status: "in_progress",
      split_progress: { total: 4, done: 1, running: 2, failed: 1, created: 0, skipped: 0, cancelled: 0 },
    } as any,
    splitChildCount: 4,
    onSplitNodeToggle: vi.fn(),
  });

  expect(screen.getByRole("button", { name: /expand 4 child issue nodes/i })).toHaveTextContent("4 issues");
  expect(screen.getByRole("button", { name: /expand 4 child issue nodes/i })).toHaveTextContent("1 done");
  expect(screen.queryByText("4 issues")).toBeInTheDocument();
});
```

Expected: PASS if current behavior already matches; if it fails due copy, update only copy/accessibility.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @multica/views test packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/issues/components/execution/runtime-node-card.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/issues/components/execution/runtime-node-card.tsx packages/views/issues/components/execution/runtime-node-card.test.tsx
git commit -m "feat(execution): add runtime edge progress cues"
```

---

### Task 6: Runtime Detail Panel Receipt and Child Issue Modes

**Files:**
- Modify: `packages/views/issues/components/execution/execution-detail-panel.tsx`
- Modify: `packages/views/issues/components/execution/execution-detail-panel.test.tsx`
- Modify: `packages/views/locales/en/issues.json`
- Modify: `packages/views/locales/zh-Hans/issues.json`

**Interfaces:**
- Produces:
  - `ExecutionDetailPanelProps.isChildIssue?: boolean`
  - `ExecutionDetailPanelProps.parentSplitTitle?: string | null`
  - `ExecutionDetailPanelProps.childWorkflowName?: string | null`
  - Primary sections ordered as receipt mode:
    - status-next-step
    - deliverables
    - worker-critic
    - runtime-facts
    - evidence-preview

- [ ] **Step 1: Write failing ordinary receipt test**

In `execution-detail-panel.test.tsx`, add:

```tsx
it("renders ordinary node details as a receipt without raw JSON by default", () => {
  renderPanel({
    node: makeNode({ title: "Build API", worker_id: "agent-1", critic_id: "agent-2" }),
    nodeRun: makeNodeRun({
      status: "completed",
      worker_output: { nested: { raw: true } },
      critic_output: { approved: true },
    }),
    workerName: "Builder",
    criticName: "Reviewer",
  });

  const sections = screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"));
  expect(sections).toEqual(["status-next-step", "deliverables", "worker-critic", "runtime-facts", "evidence-preview"]);
  expect(screen.queryByText(/"nested"/)).not.toBeInTheDocument();
  expect(screen.getByText("View evidence")).toBeInTheDocument();
});
```

Expected: FAIL because current panel shows primary/agent-operations/runtime and raw `pre`.

- [ ] **Step 2: Extend section id type again**

In `WorkflowNodeDetailPanelShell`, extend `NodeDetailSectionId`:

```ts
| "status-next-step"
| "deliverables"
| "worker-critic"
| "runtime-facts"
| "evidence-preview"
| "child-progress"
```

If Task 3 already added `worker-critic`, only add the missing ids.

- [ ] **Step 3: Add child issue props**

In `ExecutionDetailPanelProps`:

```ts
isChildIssue?: boolean;
parentSplitTitle?: string | null;
childWorkflowName?: string | null;
```

Update destructuring:

```ts
isChildIssue = false,
parentSplitTitle,
childWorkflowName,
```

- [ ] **Step 4: Replace raw runtime layout with receipt sections**

In `ExecutionDetailPanel`, keep existing session/retry/unblock logic, but render sections in this order:

```tsx
<NodeDetailSection
  sectionId="status-next-step"
  icon={<Activity className="size-4" />}
  title={t(($) => $.execution.detail_panel.section_status_next_step)}
>
  <div className="space-y-2">
    <p className="text-sm font-medium">{displayStatusLabel}</p>
    {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
    <div className="flex flex-wrap gap-2">
      {onOpenIssue ? (
        <button type="button" onClick={onOpenIssue} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted">
          <ExternalLink className="h-3.5 w-3.5" />
          {isChildIssue ? t(($) => $.execution.detail_panel.open_child_issue) : t(($) => $.execution.detail_panel.view_full_issue)}
        </button>
      ) : null}
      {canRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition-colors hover:bg-red-100">
          <RotateCcw className="h-3.5 w-3.5" />
          {t(($) => $.execution.detail_panel.retry)}
        </button>
      ) : null}
    </div>
  </div>
</NodeDetailSection>
```

Deliverables:

```tsx
<NodeDetailSection sectionId="deliverables" icon={<ExternalLink className="size-4" />} title={t(($) => $.execution.detail_panel.section_deliverables)}>
  <div className="flex flex-wrap gap-2">
    {canOpenSession ? <button ...>{t(($) => $.execution.detail_panel.open_session)}</button> : null}
    {onOpenIssue ? <button ...>{isChildIssue ? t(($) => $.execution.detail_panel.open_child_issue) : t(($) => $.execution.detail_panel.view_full_issue)}</button> : null}
  </div>
</NodeDetailSection>
```

Child progress, only when `isChildIssue`:

```tsx
{isChildIssue ? (
  <NodeDetailSection sectionId="child-progress" icon={<GitFork className="size-4" />} title={t(($) => $.execution.detail_panel.section_child_progress)}>
    <dl className="space-y-1 text-xs">
      {parentSplitTitle ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.parent_split)}</dt><dd>{parentSplitTitle}</dd></div> : null}
      {childWorkflowName ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.child_workflow)}</dt><dd>{childWorkflowName}</dd></div> : null}
      {errorMessage ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.reason)}</dt><dd className="text-destructive">{errorMessage}</dd></div> : null}
    </dl>
  </NodeDetailSection>
) : null}
```

Evidence preview:

```tsx
<NodeDetailSection sectionId="evidence-preview" icon={<MessageSquare className="size-4" />} title={t(($) => $.execution.detail_panel.section_evidence_preview)}>
  <details className="text-xs">
    <summary className="cursor-pointer text-primary">{t(($) => $.execution.detail_panel.view_evidence)}</summary>
    <div className="mt-2 space-y-2">
      {nodeRun?.worker_output != null ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{formatJson(nodeRun.worker_output)}</pre> : null}
      {nodeRun?.critic_output != null ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{formatJson(nodeRun.critic_output)}</pre> : null}
    </div>
  </details>
</NodeDetailSection>
```

- [ ] **Step 5: Pass child issue props from ExecutionPanoramaPage**

In `ExecutionPanoramaPage`, when rendering `ExecutionDetailPanel`, pass:

```tsx
isChildIssue={Boolean(selectedChildDetail)}
parentSplitTitle={
  selectedChildDetail
    ? allNodes.find((node) => createSplitChildNodeId(node.id, selectedNodeId.split(SPLIT_CHILD_NODE_ID_PART)[1] ?? "") === selectedNodeId)?.title ?? null
    : null
}
childWorkflowName={selectedChildDetail ? "Child workflow" : null}
```

If exact child workflow name is not available in current data, pass `null` and do not invent a name. Keep `Open child issue` available through `onOpenIssue`.

- [ ] **Step 6: Add locale keys**

In `packages/views/locales/en/issues.json` under `execution.detail_panel`:

```json
"section_status_next_step": "Status and next step",
"section_deliverables": "Deliverables and links",
"section_worker_critic": "Worker and critic",
"section_runtime_facts": "Runtime facts",
"section_evidence_preview": "Evidence preview",
"section_child_progress": "Child progress",
"open_child_issue": "Open child issue",
"view_evidence": "View evidence",
"parent_split": "Parent split",
"child_workflow": "Child workflow",
"reason": "Reason"
```

Add matching Chinese keys in `zh-Hans/issues.json`.

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @multica/views test packages/views/issues/components/execution/execution-detail-panel.test.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/locales/parity.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/views/common/workflow-node-detail-panel-shell.tsx packages/views/issues/components/execution/execution-detail-panel.tsx packages/views/issues/components/execution/execution-detail-panel.test.tsx packages/views/issues/components/execution/execution-panorama-page.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/locales/en/issues.json packages/views/locales/zh-Hans/issues.json
git commit -m "feat(execution): clarify runtime detail panel modes"
```

---

### Task 7: Split Review Panel Copy Cleanup and Integration Verification

**Files:**
- Modify: `packages/views/workflows/components/split/split-review-panel.tsx`
- Modify: `packages/views/workflows/components/split/split-review-panel.test.tsx`
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Produces i18n-backed split panel strings for all visible labels currently hard-coded or mojibake.
- Keeps these split workbench sections:
  - Verdict
  - Draft plan
  - Dependencies
  - Ask agent to adjust
  - Agent transcript if present
  - Sticky footer

- [ ] **Step 1: Write failing test for readable split panel labels**

In `split-review-panel.test.tsx`, add:

```tsx
it("renders split review workbench with readable labels and no mojibake", () => {
  renderPanel({
    nodeRun: makeNodeRun({ status: "awaiting_split_review" }),
    splitTasks: {
      tasks: [makeSplitTask({ title: "Migrate API contract", status: "draft" })],
      progress: { total: 1, created: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 },
    },
  });

  expect(screen.getByText("Verdict")).toBeInTheDocument();
  expect(screen.getByText("Draft plan")).toBeInTheDocument();
  expect(screen.getByText("Dependencies")).toBeInTheDocument();
  expect(screen.getByText("Ask agent to adjust")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Confirm create 1/i })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/[�]|鈥|涓|鎷|鍙|纭/);
});
```

Expected: FAIL because current file contains mojibake strings in visible labels.

- [ ] **Step 2: Add split review locale keys**

In `packages/views/locales/en/workflows.json` under `detail_panel`:

```json
"split_review_eyebrow": "Split review",
"split_progress_eyebrow": "Split progress",
"split_verdict_title": "Verdict",
"split_ready_to_create": "Ready to create",
"split_needs_adjustment": "Needs adjustment",
"split_generating_draft": "Generating draft",
"split_failed": "Split failed",
"split_running_children": "Running child issues",
"split_completed": "Completed",
"split_no_blocking_risk": "No blocking risk",
"split_missing_assignees_one": "{{count}} child issue needs an assignee",
"split_missing_assignees_other": "{{count}} child issues need assignees",
"split_settings_summary": "View run settings",
"split_draft_plan": "Draft plan",
"split_dependencies": "Dependencies",
"split_ask_agent": "Ask agent to adjust",
"split_loading_draft": "Loading child issue draft...",
"split_loading_dependencies": "Loading dependencies...",
"split_generate_draft": "Generate draft",
"split_regenerate_draft": "Regenerate draft",
"split_generating": "Generating...",
"split_recover_outputs": "Recover existing output",
"split_recovering": "Recovering...",
"split_cancel": "Cancel split",
"split_cancelling": "Cancelling...",
"split_confirm_create": "Confirm create {{count}}",
"split_creating": "Creating...",
"split_no_creatable_tasks": "No child issues are ready to create yet",
"split_approve_dialog_title": "Create child issues?",
"split_approve_dialog_description": "This will create {{count}} child issues and start their workflows.",
"split_cancel_dialog_title": "Cancel split?",
"split_cancel_dialog_description": "This will stop unfinished child tasks and cancel their child issues.",
"split_keep_running": "Keep running",
"split_confirm_cancel": "Confirm cancel"
```

Add equivalent Chinese strings under `zh-Hans/workflows.json`.

- [ ] **Step 3: Replace mojibake/hard-coded visible strings**

In `split-review-panel.tsx`, import `useT`:

```ts
import { useT } from "../../../i18n";
```

Inside `SplitReviewPanel`:

```ts
const { t } = useT("workflows");
```

Update `SplitVerdictSummary` to accept `t`:

```ts
function SplitVerdictSummary({ nodeRun, tasks, progress, splitConfig, isChatPending, t }: { ...; t: ReturnType<typeof useT<"workflows">>["t"] }) {
```

Replace `verdictTitle` with:

```ts
function verdictTitle(t: ReturnType<typeof useT<"workflows">>["t"], status: string | null | undefined, tasks: SplitTask[]): string {
  if (status === "failed") return t(($) => $.detail_panel.split_failed);
  if (status === "split_active") return t(($) => $.detail_panel.split_running_children);
  if (status === "completed") return t(($) => $.detail_panel.split_completed);
  if (status === "splitting") return t(($) => $.detail_panel.split_generating_draft);
  if (creatableTasks(tasks).length > 0) return t(($) => $.detail_panel.split_ready_to_create);
  return t(($) => $.detail_panel.split_needs_adjustment);
}
```

Replace visible strings:

```tsx
eyebrow={nodeRun?.status === "split_active" ? t(($) => $.detail_panel.split_progress_eyebrow) : t(($) => $.detail_panel.split_review_eyebrow)}
...
title={t(($) => $.detail_panel.split_verdict_title)}
...
title={t(($) => $.detail_panel.split_draft_plan)}
...
title={t(($) => $.detail_panel.split_dependencies)}
...
title={t(($) => $.detail_panel.split_ask_agent)}
...
{isLoading ? <p className="text-sm text-muted-foreground">{t(($) => $.detail_panel.split_loading_draft)}</p> : ...}
...
{approveMutation.isPending ? t(($) => $.detail_panel.split_creating) : t(($) => $.detail_panel.split_confirm_create, { count: creatableCount })}
```

Replace all strings matching mojibake characters with the new keys.

- [ ] **Step 4: Run focused split tests**

```bash
pnpm --filter @multica/views test packages/views/workflows/components/split/split-review-panel.test.tsx packages/views/workflows/components/split/split-draft-ledger.test.tsx packages/views/workflows/components/split/split-dependency-note.test.tsx packages/views/workflows/components/split/split-chat-review.test.tsx packages/views/locales/parity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run integrated targeted tests**

```bash
pnpm --filter @multica/views test packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx packages/views/workflows/components/canvas/workflow-canvas-model.test.ts packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx packages/views/workflows/components/node-config-panel.test.tsx packages/views/issues/components/execution/global-notification-bar.test.tsx packages/views/issues/components/execution/execution-panorama-page.test.tsx packages/views/issues/components/execution/execution-detail-panel.test.tsx packages/views/workflows/components/split/split-review-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck views package**

```bash
pnpm --filter @multica/views typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/components/split/split-review-panel.tsx packages/views/workflows/components/split/split-review-panel.test.tsx packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflow): polish split review panel copy"
```

---

## Self-Review

**Spec coverage**

- Edge visibility: Task 1.
- Worker/Critic merge: Task 2.
- Runtime global progress: Task 4.
- Runtime detail panel modes: Task 6.
- Editor/runtime canvas consistency: Tasks 1, 2, 4, 5.
- Config panel UX: Task 3.
- Split child issue progress and navigation: Tasks 5 and 6.
- Split review workbench preservation: Task 7.

**Placeholder scan**

- This plan contains no `TODO`, `TBD`, or “implement later” instructions.
- Every code-changing step names the file and shows the intended code shape.

**Type consistency**

- `edgeTone` additions are introduced in Task 1 before runtime edge decoration uses them in Task 5.
- New `NodeDetailSectionId` values are introduced before panel tasks use them.
- `isChildIssue`, `parentSplitTitle`, and `childWorkflowName` are introduced in Task 6 and only consumed in the same task.


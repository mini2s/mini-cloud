# Workflow Canvas Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Workflow canvas frontend infrastructure so the editor and Issue runtime panorama consume a shared canvas model while keeping editor interactions ReactFlow-based.

**Architecture:** Add pure canvas model/layout/preflight helpers under `packages/core/workflows/canvas`, then introduce shared view-layer canvas components under `packages/views/workflows/canvas`. Migrate the existing `DAGCanvas` to a compatibility wrapper around the new `ReactFlowSurface`, then migrate the existing Stage Lane/SVG overlay runtime view to consume the same model.

**Tech Stack:** TypeScript, React, Zustand, TanStack Query, `@xyflow/react`, Vitest, Testing Library, pnpm workspaces.

---

## Scope Check

This plan covers one subsystem: frontend Workflow canvas infrastructure. It intentionally excludes AI Workflow creation, AI Schema generation, backend runtime snapshot implementation, and standalone Workflow-side live Run panorama.

## File Structure

Create:

- `packages/core/workflows/canvas/types.ts` — shared canvas type definitions.
- `packages/core/workflows/canvas/build-canvas-model.ts` — pure conversion from API data plus optional overlays to `CanvasModel`.
- `packages/core/workflows/canvas/layout.ts` — pure layout and edge-handle helpers.
- `packages/core/workflows/canvas/preflight.ts` — pure publish preflight checks.
- `packages/core/workflows/canvas/runtime-overlay.ts` — pure NodeRun-to-runtime-card mapping.
- `packages/core/workflows/canvas/index.ts` — barrel export.
- `packages/core/workflows/canvas/*.test.ts` — core unit tests.
- `packages/views/workflows/canvas/workflow-canvas-shell.tsx` — shared shell and mode/capability routing.
- `packages/views/workflows/canvas/workflow-node-card.tsx` — shared definition/runtime node card.
- `packages/views/workflows/canvas/preflight-bar.tsx` — preflight issue list and locate callback.
- `packages/views/workflows/canvas/canvas-inspector.tsx` — right-side inspector frame.
- `packages/views/workflows/canvas/reactflow-surface.tsx` — extracted ReactFlow editor surface.
- `packages/views/workflows/canvas/stage-lane-surface.tsx` — Stage Lane + SVG overlay surface.
- `packages/views/workflows/canvas/index.ts` — barrel export.
- `packages/views/workflows/canvas/*.test.tsx` — view component tests.

Modify:

- `packages/core/workflows/store.ts` — keep existing store, only add small selectors/types if a task needs them.
- `packages/views/workflows/components/dag-canvas.tsx` — turn into compatibility wrapper.
- `packages/views/workflows/components/workflow-detail-page.tsx` — consume `WorkflowCanvasShell` and `ReactFlowSurface` after wrapper is stable.
- `packages/views/workflows/components/index.ts` — export new canvas primitives as needed.
- `packages/views/workflows/components/overview/workflow-panorama-page.tsx` — consume `buildCanvasModel` and `StageLaneSurface`.
- `packages/views/workflows/components/overview/*` — migrate existing Stage Lane/Card/SVG pieces only after tests lock behavior.

---

### Task 1: Core Canvas Types And Model Builder

**Files:**
- Create: `packages/core/workflows/canvas/types.ts`
- Create: `packages/core/workflows/canvas/build-canvas-model.ts`
- Create: `packages/core/workflows/canvas/index.ts`
- Test: `packages/core/workflows/canvas/build-canvas-model.test.ts`

- [ ] **Step 1: Write failing model-builder tests**

Create `packages/core/workflows/canvas/build-canvas-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeRun, WorkflowStage } from "../../types";
import { buildCanvasModel } from "./build-canvas-model";

function node(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "workflow-1",
    title: "Node",
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stage(overrides: Partial<WorkflowStage>): WorkflowStage {
  return {
    id: "stage-1",
    workflow_id: "workflow-1",
    name: "Stage",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function edge(overrides: Partial<WorkflowEdge>): WorkflowEdge {
  return {
    id: "edge-1",
    workflow_id: "workflow-1",
    source_node_id: "node-1",
    target_node_id: "node-2",
    condition: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function nodeRun(overrides: Partial<WorkflowNodeRun>): WorkflowNodeRun {
  return {
    id: "node-run-1",
    workflow_run_id: "run-1",
    workflow_node_id: "node-1",
    node_title: "Node",
    status: "pending",
    retry_count: 0,
    worker_type: "agent",
    worker_id: null,
    worker_output: null,
    worker_agent_task_id: null,
    critic_type: "human",
    critic_id: null,
    critic_output: null,
    critic_comment: "",
    critic_agent_task_id: null,
    agent_task_id: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildCanvasModel", () => {
  it("sorts stages and nodes into a stable canvas model", () => {
    const model = buildCanvasModel({
      stages: [stage({ id: "s2", name: "Build", sort_order: 2 }), stage({ id: "s1", name: "Plan", sort_order: 1 })],
      nodes: [
        node({ id: "n2", title: "Second", stage_id: "s1", sort_order: 2, position_x: 200, position_y: 20 }),
        node({ id: "n1", title: "First", stage_id: "s1", sort_order: 1, position_x: 100, position_y: 20 }),
      ],
      edges: [edge({ id: "e1", source_node_id: "n1", target_node_id: "n2" })],
    });

    expect(model.stages.map((s) => s.id)).toEqual(["s1", "s2", "__unassigned__"]);
    expect(model.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(model.edges[0]).toMatchObject({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" });
  });

  it("applies node draft overlays without mutating server nodes", () => {
    const serverNode = node({ id: "n1", title: "Server", position_x: 10, position_y: 20 });
    const model = buildCanvasModel({
      stages: [],
      nodes: [serverNode],
      edges: [],
      draft: {
        nodeEdits: {
          n1: { title: "Draft", position_x: 30 },
        },
        deletedNodeIds: [],
      },
    });

    expect(model.nodes[0]).toMatchObject({ id: "n1", title: "Draft", position: { x: 30, y: 20 } });
    expect(serverNode.title).toBe("Server");
    expect(serverNode.position_x).toBe(10);
  });

  it("filters draft-deleted nodes and dangling edges", () => {
    const model = buildCanvasModel({
      stages: [],
      nodes: [node({ id: "n1" }), node({ id: "n2" })],
      edges: [edge({ id: "e1", source_node_id: "n1", target_node_id: "n2" })],
      draft: { nodeEdits: {}, deletedNodeIds: ["n2"] },
    });

    expect(model.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(model.edges).toEqual([]);
  });

  it("attaches runtime overlays by workflow node id", () => {
    const model = buildCanvasModel({
      stages: [],
      nodes: [node({ id: "n1" })],
      edges: [],
      nodeRuns: [nodeRun({ workflow_node_id: "n1", status: "working", retry_count: 2 })],
    });

    expect(model.nodes[0]?.runtime).toMatchObject({
      nodeRunId: "node-run-1",
      status: "working",
      retryCount: 2,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @multica/core exec vitest run workflows/canvas/build-canvas-model.test.ts
```

Expected: FAIL because `./build-canvas-model` does not exist.

- [ ] **Step 3: Add shared canvas types**

Create `packages/core/workflows/canvas/types.ts`:

```ts
import type {
  CriticType,
  NodeRunStatus,
  NodeShape,
  WorkerType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowStage,
} from "../../types";

export type CanvasMode = "edit" | "readonly-definition" | "readonly-runtime";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasStage {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  sortOrder: number;
  nodeCount: number;
  source: WorkflowStage | null;
  isVirtual: boolean;
}

export interface RuntimeNodeOverlay {
  nodeRunId: string;
  workflowRunId: string;
  status: NodeRunStatus;
  retryCount: number;
  workerOutput: unknown;
  criticOutput: unknown;
  criticComment: string;
  startedAt: string | null;
  completedAt: string | null;
  sessionId: string | null;
  runtimeId: string | null;
  deviceId: string | null;
}

export interface CanvasNode {
  id: string;
  workflowId: string;
  title: string;
  description: string;
  position: CanvasPoint;
  sortOrder: number;
  stageId: string | null;
  shape: NodeShape;
  formatSchema: unknown;
  workerType: WorkerType;
  workerId: string | null;
  criticType: CriticType;
  criticId: string | null;
  criticApiUrl: string | null;
  source: WorkflowNode;
  runtime: RuntimeNodeOverlay | null;
}

export interface CanvasEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: unknown;
  source: WorkflowEdge;
}

export interface CanvasSelection {
  nodeIds: string[];
  edgeId: string | null;
}

export interface CanvasDraftOverlay {
  nodeEdits: Record<string, Partial<WorkflowNode>>;
  deletedNodeIds: string[];
}

export interface BuildCanvasModelInput {
  stages: WorkflowStage[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  draft?: CanvasDraftOverlay;
  nodeRuns?: Array<{
    id: string;
    workflow_run_id: string;
    workflow_node_id: string;
    status: NodeRunStatus;
    retry_count: number;
    worker_output: unknown;
    critic_output: unknown;
    critic_comment: string;
    started_at: string | null;
    completed_at: string | null;
    session_id: string | null;
    runtime_id: string | null;
    device_id: string | null;
  }>;
}

export interface CanvasModel {
  stages: CanvasStage[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  nodesById: Map<string, CanvasNode>;
  edgesById: Map<string, CanvasEdge>;
}

export const UNASSIGNED_STAGE_ID = "__unassigned__";
```

- [ ] **Step 4: Add model builder implementation**

Create `packages/core/workflows/canvas/build-canvas-model.ts`:

```ts
import { parseNodeShape } from "../../types";
import type { WorkflowNode } from "../../types";
import {
  UNASSIGNED_STAGE_ID,
  type BuildCanvasModelInput,
  type CanvasEdge,
  type CanvasModel,
  type CanvasNode,
  type CanvasStage,
  type RuntimeNodeOverlay,
} from "./types";

function sortByOrderThenName<T extends { sortOrder: number; name?: string; title?: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    return (a.name ?? a.title ?? a.id).localeCompare(b.name ?? b.title ?? b.id);
  });
}

function mergeNodeDraft(node: WorkflowNode, edit: Partial<WorkflowNode> | undefined): WorkflowNode {
  if (!edit) return node;
  return {
    ...node,
    ...edit,
    id: node.id,
    workflow_id: node.workflow_id,
    created_at: node.created_at,
    updated_at: edit.updated_at ?? node.updated_at,
  };
}

function toRuntimeOverlay(run: NonNullable<BuildCanvasModelInput["nodeRuns"]>[number]): RuntimeNodeOverlay {
  return {
    nodeRunId: run.id,
    workflowRunId: run.workflow_run_id,
    status: run.status,
    retryCount: run.retry_count,
    workerOutput: run.worker_output,
    criticOutput: run.critic_output,
    criticComment: run.critic_comment,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    sessionId: run.session_id,
    runtimeId: run.runtime_id,
    deviceId: run.device_id,
  };
}

export function buildCanvasModel(input: BuildCanvasModelInput): CanvasModel {
  const deleted = new Set(input.draft?.deletedNodeIds ?? []);
  const runtimeByNodeId = new Map((input.nodeRuns ?? []).map((run) => [run.workflow_node_id, toRuntimeOverlay(run)]));

  const stages: CanvasStage[] = sortByOrderThenName(
    input.stages.map((stage) => ({
      id: stage.id,
      workflowId: stage.workflow_id,
      name: stage.name,
      description: stage.description,
      sortOrder: stage.sort_order,
      nodeCount: stage.node_count,
      source: stage,
      isVirtual: false,
    })),
  );

  const nodes: CanvasNode[] = sortByOrderThenName(
    input.nodes
      .filter((node) => !deleted.has(node.id))
      .map((node) => mergeNodeDraft(node, input.draft?.nodeEdits[node.id]))
      .map((node) => ({
        id: node.id,
        workflowId: node.workflow_id,
        title: node.title,
        description: node.description,
        position: { x: node.position_x, y: node.position_y },
        sortOrder: node.sort_order,
        stageId: node.stage_id,
        shape: parseNodeShape(node.format_schema),
        formatSchema: node.format_schema,
        workerType: node.worker_type,
        workerId: node.worker_id,
        criticType: node.critic_type,
        criticId: node.critic_id,
        criticApiUrl: node.critic_api_url,
        source: node,
        runtime: runtimeByNodeId.get(node.id) ?? null,
      })),
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = input.edges
    .filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id))
    .map((edge) => ({
      id: edge.id,
      workflowId: edge.workflow_id,
      sourceNodeId: edge.source_node_id,
      targetNodeId: edge.target_node_id,
      condition: edge.condition,
      source: edge,
    }));

  const unassignedCount = nodes.filter((node) => node.stageId === null).length;
  stages.push({
    id: UNASSIGNED_STAGE_ID,
    workflowId: input.nodes[0]?.workflow_id ?? input.stages[0]?.workflow_id ?? "",
    name: "Unassigned",
    description: "",
    sortOrder: Number.MAX_SAFE_INTEGER,
    nodeCount: unassignedCount,
    source: null,
    isVirtual: true,
  });

  return {
    stages,
    nodes,
    edges,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    edgesById: new Map(edges.map((edge) => [edge.id, edge])),
  };
}
```

- [ ] **Step 5: Add barrel export**

Create `packages/core/workflows/canvas/index.ts`:

```ts
export * from "./types";
export * from "./build-canvas-model";
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @multica/core exec vitest run workflows/canvas/build-canvas-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/workflows/canvas
git commit -m "feat(workflows): add shared canvas model"
```

---

### Task 2: Core Layout, Preflight, And Runtime Overlay Helpers

**Files:**
- Create: `packages/core/workflows/canvas/layout.ts`
- Create: `packages/core/workflows/canvas/preflight.ts`
- Create: `packages/core/workflows/canvas/runtime-overlay.ts`
- Modify: `packages/core/workflows/canvas/index.ts`
- Modify: `packages/core/types/workflow.ts`
- Test: `packages/core/workflows/canvas/layout.test.ts`
- Test: `packages/core/workflows/canvas/preflight.test.ts`
- Test: `packages/core/workflows/canvas/runtime-overlay.test.ts`

- [ ] **Step 1: Write layout tests**

Create `packages/core/workflows/canvas/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseEdgeHandles, layoutNodesByStage } from "./layout";
import type { CanvasNode, CanvasStage } from "./types";

function canvasNode(id: string, stageId: string | null, x: number, y: number, sortOrder = 0): CanvasNode {
  return {
    id,
    workflowId: "workflow-1",
    title: id,
    description: "",
    position: { x, y },
    sortOrder,
    stageId,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: null,
    criticType: "human",
    criticId: null,
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
  };
}

function canvasStage(id: string, sortOrder: number): CanvasStage {
  return {
    id,
    workflowId: "workflow-1",
    name: id,
    description: "",
    sortOrder,
    nodeCount: 0,
    source: null,
    isVirtual: false,
  };
}

describe("chooseEdgeHandles", () => {
  it("uses right-to-left handles for mostly horizontal edges", () => {
    expect(chooseEdgeHandles({ x: 0, y: 0 }, { x: 200, y: 20 })).toEqual({
      sourceHandle: "right",
      targetHandle: "left",
    });
  });

  it("uses bottom-to-top handles for mostly vertical edges", () => {
    expect(chooseEdgeHandles({ x: 0, y: 0 }, { x: 20, y: 200 })).toEqual({
      sourceHandle: "bottom",
      targetHandle: "top",
    });
  });
});

describe("layoutNodesByStage", () => {
  it("places nodes by stage order and node sort order", () => {
    const result = layoutNodesByStage({
      stages: [canvasStage("s2", 2), canvasStage("s1", 1)],
      nodes: [
        canvasNode("n2", "s1", 0, 0, 2),
        canvasNode("n1", "s1", 0, 0, 1),
        canvasNode("n3", "s2", 0, 0, 1),
      ],
    });

    expect(result.map((item) => [item.nodeId, item.x, item.y])).toEqual([
      ["n1", 160, 120],
      ["n2", 360, 120],
      ["n3", 160, 280],
    ]);
  });
});
```

- [ ] **Step 2: Write preflight tests**

Create `packages/core/workflows/canvas/preflight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runCanvasPreflight } from "./preflight";
import type { CanvasEdge, CanvasModel, CanvasNode } from "./types";

function node(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: "n1",
    workflowId: "workflow-1",
    title: "Node",
    description: "",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId: "stage-1",
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: "agent-1",
    criticType: "human",
    criticId: "member-1",
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
    ...overrides,
  };
}

function edge(sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id: `${sourceNodeId}-${targetNodeId}`,
    workflowId: "workflow-1",
    sourceNodeId,
    targetNodeId,
    condition: null,
    source: {} as CanvasEdge["source"],
  };
}

function model(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasModel {
  return {
    stages: [],
    nodes,
    edges,
    nodesById: new Map(nodes.map((item) => [item.id, item])),
    edgesById: new Map(edges.map((item) => [item.id, item])),
  };
}

describe("runCanvasPreflight", () => {
  it("reports missing worker and critic references", () => {
    const issues = runCanvasPreflight(model([
      node({ id: "n1", workerId: null, criticId: null }),
    ], []));

    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_worker",
      "missing_critic",
      "isolated_node",
    ]);
  });

  it("reports cycles", () => {
    const issues = runCanvasPreflight(model([
      node({ id: "n1" }),
      node({ id: "n2" }),
    ], [edge("n1", "n2"), edge("n2", "n1")]));

    expect(issues.some((issue) => issue.code === "cycle_detected")).toBe(true);
  });

  it("reports unreachable nodes when a graph has a distinct source", () => {
    const issues = runCanvasPreflight(model([
      node({ id: "n1" }),
      node({ id: "n2" }),
      node({ id: "n3" }),
    ], [edge("n1", "n2")]));

    expect(issues).toContainEqual(expect.objectContaining({
      code: "unreachable_node",
      nodeId: "n3",
    }));
  });
});
```

- [ ] **Step 3: Write runtime overlay tests**

Create `packages/core/workflows/canvas/runtime-overlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getRuntimeNodePresentation } from "./runtime-overlay";
import type { RuntimeNodeOverlay } from "./types";

function overlay(status: RuntimeNodeOverlay["status"]): RuntimeNodeOverlay {
  return {
    nodeRunId: "node-run-1",
    workflowRunId: "run-1",
    status,
    retryCount: 0,
    workerOutput: null,
    criticOutput: null,
    criticComment: "",
    startedAt: null,
    completedAt: null,
    sessionId: null,
    runtimeId: null,
    deviceId: null,
  };
}

describe("getRuntimeNodePresentation", () => {
  it("marks working nodes as active and non-actionable", () => {
    expect(getRuntimeNodePresentation(overlay("working"))).toEqual({
      tone: "active",
      label: "working",
      isRunning: true,
      isAwaitingInput: false,
      actions: [],
    });
  });

  it("exposes review actions for awaiting critic nodes", () => {
    expect(getRuntimeNodePresentation(overlay("awaiting_critic")).actions).toEqual(["approve", "reject", "skip"]);
  });

  it("exposes recovery actions for blocked nodes", () => {
    expect(getRuntimeNodePresentation(overlay("blocked")).actions).toEqual(["takeover", "handback", "complete", "skip"]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
pnpm --filter @multica/core exec vitest run workflows/canvas/layout.test.ts workflows/canvas/preflight.test.ts workflows/canvas/runtime-overlay.test.ts
```

Expected: FAIL because helper files do not exist.

- [ ] **Step 5: Implement layout helpers**

Create `packages/core/workflows/canvas/layout.ts`:

```ts
import type { CanvasNode, CanvasPoint, CanvasStage } from "./types";

export type CanvasHandle = "top" | "right" | "bottom" | "left";

export interface EdgeHandlePair {
  sourceHandle: CanvasHandle;
  targetHandle: CanvasHandle;
}

export interface LayoutInput {
  stages: CanvasStage[];
  nodes: CanvasNode[];
}

export interface NodeLayoutPosition {
  nodeId: string;
  x: number;
  y: number;
}

const STAGE_TOP = 120;
const STAGE_GAP_Y = 160;
const NODE_LEFT = 160;
const NODE_GAP_X = 200;

export function chooseEdgeHandles(source: CanvasPoint, target: CanvasPoint): EdgeHandlePair {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { sourceHandle: "right", targetHandle: "left" };
  }
  return { sourceHandle: "bottom", targetHandle: "top" };
}

export function layoutNodesByStage(input: LayoutInput): NodeLayoutPosition[] {
  const stages = [...input.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageIndex = new Map(stages.map((stage, index) => [stage.id, index]));

  const grouped = new Map<string | null, CanvasNode[]>();
  for (const node of input.nodes) {
    const key = node.stageId;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }

  const result: NodeLayoutPosition[] = [];
  for (const [stageId, nodes] of grouped) {
    const yIndex = stageId ? (stageIndex.get(stageId) ?? stages.length) : stages.length;
    const sortedNodes = [...nodes].sort((a, b) => {
      const byOrder = a.sortOrder - b.sortOrder;
      if (byOrder !== 0) return byOrder;
      return a.title.localeCompare(b.title);
    });
    sortedNodes.forEach((node, index) => {
      result.push({
        nodeId: node.id,
        x: NODE_LEFT + index * NODE_GAP_X,
        y: STAGE_TOP + yIndex * STAGE_GAP_Y,
      });
    });
  }

  return result.sort((a, b) => {
    const nodeA = input.nodes.find((node) => node.id === a.nodeId);
    const nodeB = input.nodes.find((node) => node.id === b.nodeId);
    const stageA = nodeA?.stageId ? (stageIndex.get(nodeA.stageId) ?? stages.length) : stages.length;
    const stageB = nodeB?.stageId ? (stageIndex.get(nodeB.stageId) ?? stages.length) : stages.length;
    if (stageA !== stageB) return stageA - stageB;
    return a.x - b.x;
  });
}
```

- [ ] **Step 6: Implement preflight helpers**

Create `packages/core/workflows/canvas/preflight.ts`:

```ts
import type { CanvasModel } from "./types";

export type PreflightIssueCode =
  | "missing_worker"
  | "missing_critic"
  | "isolated_node"
  | "unreachable_node"
  | "cycle_detected";

export interface CanvasPreflightIssue {
  code: PreflightIssueCode;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

function hasCycle(model: CanvasModel): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of model.nodes) adjacency.set(node.id, []);
  for (const edge of model.edges) adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return model.nodes.some((node) => visit(node.id));
}

function reachableNodeIds(model: CanvasModel): Set<string> {
  const incoming = new Map(model.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(model.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of model.edges) {
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
    adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const sources = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const reachable = new Set<string>();
  const queue = [...sources];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(adjacency.get(id) ?? []));
  }
  return reachable;
}

export function runCanvasPreflight(model: CanvasModel): CanvasPreflightIssue[] {
  const issues: CanvasPreflightIssue[] = [];

  for (const node of model.nodes) {
    if (!node.workerId) {
      issues.push({
        code: "missing_worker",
        nodeId: node.id,
        message: `Node "${node.title}" is missing a worker.`,
      });
    }
    if (!node.criticId && !node.criticApiUrl) {
      issues.push({
        code: "missing_critic",
        nodeId: node.id,
        message: `Node "${node.title}" is missing a critic.`,
      });
    }
  }

  const connected = new Set<string>();
  for (const edge of model.edges) {
    connected.add(edge.sourceNodeId);
    connected.add(edge.targetNodeId);
  }
  for (const node of model.nodes) {
    if (!connected.has(node.id)) {
      issues.push({
        code: "isolated_node",
        nodeId: node.id,
        message: `Node "${node.title}" is not connected.`,
      });
    }
  }

  if (hasCycle(model)) {
    issues.push({
      code: "cycle_detected",
      message: "Workflow contains a cycle.",
    });
  }

  const reachable = reachableNodeIds(model);
  for (const node of model.nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: "unreachable_node",
        nodeId: node.id,
        message: `Node "${node.title}" is unreachable from the workflow start.`,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 7: Implement runtime overlay helper**

Modify `packages/core/types/workflow.ts` so `NodeRunStatus` includes the MVP state from `docs/workflow-prd.md`:

```ts
export type NodeRunStatus =
  | "pending" | "format_checking" | "format_ok" | "format_failed"
  | "worker_assigned" | "working" | "awaiting_input" | "awaiting_critic"
  | "critic_reviewing" | "critic_approved" | "critic_rework"
  | "self_recovering"
  | "completed" | "failed" | "blocked" | "skipped" | "cancelled";
```

Create `packages/core/workflows/canvas/runtime-overlay.ts`:

```ts
import type { RuntimeNodeOverlay } from "./types";

export type RuntimeNodeTone = "muted" | "active" | "attention" | "danger" | "blocked" | "success";
export type RuntimeNodeAction = "approve" | "reject" | "retry" | "skip" | "takeover" | "handback" | "complete";

export interface RuntimeNodePresentation {
  tone: RuntimeNodeTone;
  label: string;
  isRunning: boolean;
  isAwaitingInput: boolean;
  actions: RuntimeNodeAction[];
}

export function getRuntimeNodePresentation(runtime: RuntimeNodeOverlay | null): RuntimeNodePresentation {
  if (!runtime) {
    return { tone: "muted", label: "not started", isRunning: false, isAwaitingInput: false, actions: [] };
  }

  switch (runtime.status) {
    case "format_checking":
    case "working":
    case "critic_reviewing":
    case "self_recovering":
      return { tone: "active", label: runtime.status, isRunning: true, isAwaitingInput: false, actions: [] };
    case "awaiting_input":
      return { tone: "attention", label: runtime.status, isRunning: false, isAwaitingInput: true, actions: [] };
    case "awaiting_critic":
      return { tone: "attention", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["approve", "reject", "skip"] };
    case "failed":
      return { tone: "danger", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["retry", "skip", "complete"] };
    case "blocked":
      return { tone: "blocked", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: ["takeover", "handback", "complete", "skip"] };
    case "completed":
    case "critic_approved":
      return { tone: "success", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: [] };
    default:
      return { tone: "muted", label: runtime.status, isRunning: false, isAwaitingInput: false, actions: [] };
  }
}
```

- [ ] **Step 8: Export new helpers**

Modify `packages/core/workflows/canvas/index.ts`:

```ts
export * from "./types";
export * from "./build-canvas-model";
export * from "./layout";
export * from "./preflight";
export * from "./runtime-overlay";
```

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm --filter @multica/core exec vitest run workflows/canvas/
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/workflows/canvas packages/core/types/workflow.ts
git commit -m "feat(workflows): add canvas layout and validation helpers"
```

---

### Task 3: Shared View Canvas Shell, Node Card, Inspector, And Preflight Bar

**Files:**
- Create: `packages/views/workflows/canvas/workflow-canvas-shell.tsx`
- Create: `packages/views/workflows/canvas/workflow-node-card.tsx`
- Create: `packages/views/workflows/canvas/preflight-bar.tsx`
- Create: `packages/views/workflows/canvas/canvas-inspector.tsx`
- Create: `packages/views/workflows/canvas/index.ts`
- Modify: `packages/views/workflows/components/index.ts`
- Test: `packages/views/workflows/canvas/workflow-node-card.test.tsx`
- Test: `packages/views/workflows/canvas/preflight-bar.test.tsx`
- Test: `packages/views/workflows/canvas/workflow-canvas-shell.test.tsx`

- [ ] **Step 1: Write node-card tests**

Create `packages/views/workflows/canvas/workflow-node-card.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { CanvasNode } from "@multica/core/workflows/canvas";

function node(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "n1",
    workflowId: "workflow-1",
    title: "Plan work",
    description: "Describe plan",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId: null,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: "agent-1",
    criticType: "human",
    criticId: "member-1",
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
    ...overrides,
  };
}

describe("WorkflowNodeCard", () => {
  it("renders definition node title and actor labels", () => {
    renderWithI18n(<WorkflowNodeCard node={node()} variant="definition" selected={false} />);
    expect(screen.getByText("Plan work")).toBeTruthy();
    expect(screen.getByText("agent worker")).toBeTruthy();
    expect(screen.getByText("human critic")).toBeTruthy();
  });

  it("renders runtime status and actions", () => {
    renderWithI18n(
      <WorkflowNodeCard
        node={node({
          runtime: {
            nodeRunId: "nr1",
            workflowRunId: "run1",
            status: "awaiting_critic",
            retryCount: 0,
            workerOutput: null,
            criticOutput: null,
            criticComment: "",
            startedAt: null,
            completedAt: null,
            sessionId: null,
            runtimeId: null,
            deviceId: null,
          },
        })}
        variant="runtime"
        selected={false}
      />,
    );
    expect(screen.getByText("awaiting_critic")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(<WorkflowNodeCard node={node()} variant="definition" selected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Plan work/ }));
    expect(onSelect).toHaveBeenCalledWith("n1");
  });
});
```

- [ ] **Step 2: Write preflight bar tests**

Create `packages/views/workflows/canvas/preflight-bar.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { PreflightBar } from "./preflight-bar";

describe("PreflightBar", () => {
  it("renders success state when there are no issues", () => {
    renderWithI18n(<PreflightBar issues={[]} onIssueClick={() => undefined} />);
    expect(screen.getByText("Ready to publish")).toBeTruthy();
  });

  it("renders issues and calls locate callback", () => {
    const onIssueClick = vi.fn();
    renderWithI18n(
      <PreflightBar
        issues={[{ code: "missing_worker", nodeId: "n1", message: "Node is missing a worker." }]}
        onIssueClick={onIssueClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Node is missing a worker." }));
    expect(onIssueClick).toHaveBeenCalledWith({ code: "missing_worker", nodeId: "n1", message: "Node is missing a worker." });
  });
});
```

- [ ] **Step 3: Write shell tests**

Create `packages/views/workflows/canvas/workflow-canvas-shell.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowCanvasShell } from "./workflow-canvas-shell";
import type { CanvasModel } from "@multica/core/workflows/canvas";

const model: CanvasModel = {
  stages: [],
  nodes: [],
  edges: [],
  nodesById: new Map(),
  edgesById: new Map(),
};

describe("WorkflowCanvasShell", () => {
  it("passes edit capability to children", () => {
    renderWithI18n(
      <WorkflowCanvasShell mode="edit" model={model}>
        {({ capabilities }) => <span>{capabilities.canEditDefinition ? "editable" : "readonly"}</span>}
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("editable")).toBeTruthy();
  });

  it("passes runtime capability in readonly runtime mode", () => {
    renderWithI18n(
      <WorkflowCanvasShell mode="readonly-runtime" model={model}>
        {({ capabilities }) => <span>{capabilities.canRunActions ? "runtime" : "no-runtime"}</span>}
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("runtime")).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/workflow-node-card.test.tsx workflows/canvas/preflight-bar.test.tsx workflows/canvas/workflow-canvas-shell.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 5: Implement shared shell**

Create `packages/views/workflows/canvas/workflow-canvas-shell.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import type { CanvasMode, CanvasModel } from "@multica/core/workflows/canvas";

export interface CanvasCapabilities {
  canEditDefinition: boolean;
  canMoveNodes: boolean;
  canConnectNodes: boolean;
  canDeleteElements: boolean;
  canRunActions: boolean;
}

export interface WorkflowCanvasShellRenderArgs {
  model: CanvasModel;
  mode: CanvasMode;
  capabilities: CanvasCapabilities;
}

export interface WorkflowCanvasShellProps {
  mode: CanvasMode;
  model: CanvasModel;
  children: (args: WorkflowCanvasShellRenderArgs) => ReactNode;
}

export function getCanvasCapabilities(mode: CanvasMode): CanvasCapabilities {
  return {
    canEditDefinition: mode === "edit",
    canMoveNodes: mode === "edit",
    canConnectNodes: mode === "edit",
    canDeleteElements: mode === "edit",
    canRunActions: mode === "readonly-runtime",
  };
}

export function WorkflowCanvasShell({ mode, model, children }: WorkflowCanvasShellProps) {
  return (
    <div data-testid="workflow-canvas-shell" data-mode={mode} className="relative flex min-h-0 flex-1">
      {children({ mode, model, capabilities: getCanvasCapabilities(mode) })}
    </div>
  );
}
```

- [ ] **Step 6: Implement node card**

Create `packages/views/workflows/canvas/workflow-node-card.tsx`:

```tsx
"use client";

import type { CanvasNode } from "@multica/core/workflows/canvas";
import { getRuntimeNodePresentation, type RuntimeNodeAction } from "@multica/core/workflows/canvas";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";

export interface WorkflowNodeCardProps {
  node: CanvasNode;
  variant: "definition" | "runtime";
  selected: boolean;
  onSelect?: (nodeId: string) => void;
  onRuntimeAction?: (nodeRunId: string, action: RuntimeNodeAction) => void;
}

const ACTION_LABELS: Record<RuntimeNodeAction, string> = {
  approve: "Approve",
  reject: "Reject",
  retry: "Retry",
  skip: "Skip",
  takeover: "Take over",
  handback: "Hand back",
  complete: "Complete",
};

export function WorkflowNodeCard({ node, variant, selected, onSelect, onRuntimeAction }: WorkflowNodeCardProps) {
  const runtime = getRuntimeNodePresentation(node.runtime);
  const toneClass =
    runtime.tone === "success"
      ? "border-emerald-300 bg-emerald-50"
      : runtime.tone === "danger"
        ? "border-red-300 bg-red-50"
        : runtime.tone === "attention"
          ? "border-amber-300 bg-amber-50"
          : runtime.tone === "blocked"
            ? "border-violet-300 bg-violet-50"
            : runtime.tone === "active"
              ? "border-blue-300 bg-blue-50"
              : "border-border bg-card";

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={node.title}
      onClick={() => onSelect?.(node.id)}
      className={cn(
        "flex min-h-[76px] w-[168px] flex-col items-start justify-between rounded-lg border p-3 text-left text-sm transition-colors",
        variant === "runtime" ? toneClass : "border-border bg-card",
        selected && "ring-2 ring-ring",
      )}
    >
      <span className="max-w-full truncate font-medium">{node.title}</span>
      {variant === "definition" ? (
        <span className="text-xs text-muted-foreground">
          {node.workerType} worker · {node.criticType} critic
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{runtime.label}</span>
      )}
      {variant === "runtime" && node.runtime && runtime.actions.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {runtime.actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onRuntimeAction?.(node.runtime!.nodeRunId, action);
              }}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 7: Implement preflight bar**

Create `packages/views/workflows/canvas/preflight-bar.tsx`:

```tsx
"use client";

import type { CanvasPreflightIssue } from "@multica/core/workflows/canvas";
import { Button } from "@multica/ui/components/ui/button";

export interface PreflightBarProps {
  issues: CanvasPreflightIssue[];
  onIssueClick: (issue: CanvasPreflightIssue) => void;
}

export function PreflightBar({ issues, onIssueClick }: PreflightBarProps) {
  if (issues.length === 0) {
    return (
      <div className="border-t bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        Ready to publish
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t bg-red-50 px-3 py-2">
      <span className="shrink-0 text-sm font-medium text-red-700">{issues.length} issue(s)</span>
      {issues.map((issue, index) => (
        <Button
          key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 border-red-200 bg-white text-xs text-red-700"
          onClick={() => onIssueClick(issue)}
        >
          {issue.message}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Implement inspector frame**

Create `packages/views/workflows/canvas/canvas-inspector.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Button } from "@multica/ui/components/ui/button";

export interface CanvasInspectorProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function CanvasInspector({ title, onClose, children }: CanvasInspectorProps) {
  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l bg-background">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </aside>
  );
}
```

- [ ] **Step 9: Add barrel exports**

Create `packages/views/workflows/canvas/index.ts`:

```ts
export * from "./workflow-canvas-shell";
export * from "./workflow-node-card";
export * from "./preflight-bar";
export * from "./canvas-inspector";
```

Modify `packages/views/workflows/components/index.ts` by adding:

```ts
export * from "../canvas";
```

- [ ] **Step 10: Run tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/views/workflows/canvas packages/views/workflows/components/index.ts
git commit -m "feat(workflows): add shared canvas view primitives"
```

---

### Task 4: Extract ReactFlow Surface And Keep DAGCanvas Compatible

**Files:**
- Create: `packages/views/workflows/canvas/reactflow-surface.tsx`
- Modify: `packages/views/workflows/canvas/index.ts`
- Modify: `packages/views/workflows/components/dag-canvas.tsx`
- Test: `packages/views/workflows/components/dag-canvas.test.tsx`
- Test: `packages/views/workflows/canvas/reactflow-surface.test.tsx`

- [ ] **Step 1: Create ReactFlow surface test by copying current DAGCanvas expectations**

Create `packages/views/workflows/canvas/reactflow-surface.test.tsx` by copying `packages/views/workflows/components/dag-canvas.test.tsx`, then change the import:

```tsx
import { ReactFlowSurface } from "./reactflow-surface";
```

Change render calls from:

```tsx
renderWithI18n(<WorkflowCanvas nodes={nodes} edges={[]} />);
```

to:

```tsx
renderWithI18n(<ReactFlowSurface nodes={nodes} edges={[]} />);
```

Keep the existing ReactFlow and store mocks. Keep expectations for node counts, edge counts, mode-based draggability, handle selection, and callbacks.

- [ ] **Step 2: Run copied test to verify it fails**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/reactflow-surface.test.tsx
```

Expected: FAIL because `reactflow-surface.tsx` does not exist.

- [ ] **Step 3: Move current WorkflowCanvas implementation into ReactFlowSurface**

Create `packages/views/workflows/canvas/reactflow-surface.tsx` by moving the current implementation from `packages/views/workflows/components/dag-canvas.tsx`.

Use these exact public names:

```tsx
export interface ReactFlowSurfaceProps {
  nodes: WorkflowNodeType[];
  edges: WorkflowEdgeType[];
  onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
  onEdgeCreate?: (sourceNodeId: string, targetNodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeCreate?: (type: string, x: number, y: number) => void;
  nodeStatusColors?: Record<string, string>;
  nodeStatuses?: Record<string, { status: string; isRunning: boolean; isAwaitingInput?: boolean }>;
  showMiniMap?: boolean;
}

export function ReactFlowSurface(props: ReactFlowSurfaceProps) {
  // Body is the current WorkflowCanvas implementation moved from dag-canvas.tsx.
}
```

While moving, update relative imports:

```tsx
import {
  WorkflowNode,
  AnnotationNode,
  WorkflowEdge as WorkflowEdgeComponent,
  AnnotationConnectorEdge,
  ANNO_WIDTH,
  ANNO_HEIGHT,
  NODE_WIDTH,
  NODE_HEIGHT,
  DIAMOND_SIZE,
  HEXAGON_SIZE,
  type WorkflowNodeData,
} from "../components/reactflow-nodes";
import { computeAlignmentSnap, type AlignmentGuide } from "../components/alignment-snap";
```

Keep `@xyflow/react/dist/style.css` import in `reactflow-surface.tsx`.

- [ ] **Step 4: Replace DAGCanvas with a wrapper**

Replace `packages/views/workflows/components/dag-canvas.tsx` with:

```tsx
"use client";

import {
  ReactFlowSurface,
  type ReactFlowSurfaceProps,
} from "../canvas/reactflow-surface";

export type WorkflowCanvasProps = ReactFlowSurfaceProps;

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowSurface {...props} />;
}

/** @deprecated Use WorkflowCanvas or ReactFlowSurface instead. */
export const DAGCanvas = WorkflowCanvas;
```

- [ ] **Step 5: Export ReactFlowSurface**

Modify `packages/views/workflows/canvas/index.ts`:

```ts
export * from "./workflow-canvas-shell";
export * from "./workflow-node-card";
export * from "./preflight-bar";
export * from "./canvas-inspector";
export * from "./reactflow-surface";
```

- [ ] **Step 6: Run DAGCanvas and ReactFlowSurface tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/dag-canvas.test.tsx workflows/canvas/reactflow-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/views/workflows/canvas/reactflow-surface.tsx packages/views/workflows/canvas/reactflow-surface.test.tsx packages/views/workflows/canvas/index.ts packages/views/workflows/components/dag-canvas.tsx packages/views/workflows/components/dag-canvas.test.tsx
git commit -m "refactor(workflows): extract reactflow canvas surface"
```

---

### Task 5: Wire WorkflowDetailPage Through Canvas Shell

**Files:**
- Modify: `packages/views/workflows/components/workflow-detail-page.tsx`
- Test: `packages/views/workflows/components/workflow-detail-page.test.tsx` if one exists; otherwise add `packages/views/workflows/components/workflow-detail-page.canvas.test.tsx`

- [ ] **Step 1: Write a shell integration test**

If `workflow-detail-page.test.tsx` does not exist, create `packages/views/workflows/components/workflow-detail-page.canvas.test.tsx` with the project’s existing query mocks copied from nearby Workflow page tests. The test must assert the canvas shell is present when workflow data loads:

```tsx
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowDetailPage } from "./workflow-detail-page";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReactFlow: () => <div data-testid="reactflow" />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }) }),
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/paths", () => ({ useWorkspacePaths: () => ({ workflows: () => "/workflows" }) }));
vi.mock("../../navigation", () => ({ useNavigation: () => ({ push: vi.fn() }) }));
vi.mock("@multica/core/auth", () => ({ useAuthStore: (selector: any) => selector({ user: { id: "user-1" } }) }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey ?? []);
      if (key.includes("\"nodes\"")) return { data: [], isLoading: false };
      if (key.includes("\"edges\"")) return { data: [], isLoading: false };
      if (key.includes("\"stages\"")) return { data: [], isLoading: false };
      if (key.includes("workflow-admins")) return { data: [{ id: "user-1" }], isLoading: false };
      return {
        data: {
          id: "workflow-1",
          title: "Workflow",
          description: "",
          status: "draft",
          is_template: false,
        },
        isLoading: false,
      };
    },
    useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  };
});

vi.mock("@multica/core/workflows/queries", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/workflows/queries")>("@multica/core/workflows/queries");
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    ...actual,
    workflowDetailOptions: () => ({ queryKey: ["workflow-detail"] }),
    workflowNodesOptions: () => ({ queryKey: ["workflow-detail", "nodes"] }),
    workflowEdgesOptions: () => ({ queryKey: ["workflow-detail", "edges"] }),
    workflowStagesOptions: () => ({ queryKey: ["workflow-detail", "stages"] }),
    useCreateNode: mutation,
    useUpdateNode: mutation,
    useCreateEdge: mutation,
    useUpdateWorkflow: mutation,
    useDeleteWorkflow: mutation,
    useDeleteEdge: mutation,
    useDeleteNode: mutation,
    useToggleWorkflowTemplate: mutation,
    useWorkflowAdmins: () => ({ data: [{ id: "user-1" }] }),
  };
});

describe("WorkflowDetailPage canvas shell", () => {
  it("renders the shared canvas shell area", () => {
    renderWithI18n(<WorkflowDetailPage workflowId="workflow-1" />);
    expect(screen.getByTestId("workflow-canvas-shell")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/workflow-detail-page.canvas.test.tsx
```

Expected: FAIL because `WorkflowDetailPage` does not render `workflow-canvas-shell`.

- [ ] **Step 3: Build a CanvasModel inside WorkflowDetailPage**

Modify `packages/views/workflows/components/workflow-detail-page.tsx` imports:

```tsx
import { buildCanvasModel } from "@multica/core/workflows/canvas";
import { WorkflowCanvasShell, ReactFlowSurface } from "../canvas";
```

After `displayNodes` is computed, add:

```tsx
const canvasModel = useMemo(
  () =>
    buildCanvasModel({
      stages,
      nodes: displayNodes,
      edges,
      draft: {
        nodeEdits,
        deletedNodeIds,
      },
    }),
  [stages, displayNodes, edges, nodeEdits, deletedNodeIds],
);
```

- [ ] **Step 4: Wrap the existing ReactFlow area in WorkflowCanvasShell**

Replace only the non-empty canvas branch:

```tsx
<ReactFlowProvider>
  <DAGCanvas
    nodes={displayNodes}
    edges={edges}
    onNodeDragStop={handleNodeMoved}
    onEdgeCreate={handleEdgeCreate}
    onEdgeDelete={handleEdgeDelete}
    onNodeCreate={handleAddNode}
  />
</ReactFlowProvider>
```

with:

```tsx
<WorkflowCanvasShell mode={mode === "edit" ? "edit" : "readonly-definition"} model={canvasModel}>
  {() => (
    <ReactFlowProvider>
      <ReactFlowSurface
        nodes={displayNodes}
        edges={edges}
        onNodeDragStop={handleNodeMoved}
        onEdgeCreate={handleEdgeCreate}
        onEdgeDelete={handleEdgeDelete}
        onNodeCreate={handleAddNode}
      />
    </ReactFlowProvider>
  )}
</WorkflowCanvasShell>
```

Do not change save, delete, undo, redo, or config panel behavior in this task.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/workflow-detail-page.canvas.test.tsx workflows/components/dag-canvas.test.tsx workflows/canvas/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/workflow-detail-page.tsx packages/views/workflows/components/workflow-detail-page.canvas.test.tsx
git commit -m "refactor(workflows): route editor through canvas shell"
```

---

### Task 6: Add Stage Lane Runtime Surface

**Files:**
- Create: `packages/views/workflows/canvas/stage-lane-surface.tsx`
- Modify: `packages/views/workflows/canvas/index.ts`
- Test: `packages/views/workflows/canvas/stage-lane-surface.test.tsx`

- [ ] **Step 1: Write StageLaneSurface tests**

Create `packages/views/workflows/canvas/stage-lane-surface.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { StageLaneSurface } from "./stage-lane-surface";
import type { CanvasModel, CanvasNode, CanvasStage } from "@multica/core/workflows/canvas";

function stage(id: string): CanvasStage {
  return {
    id,
    workflowId: "workflow-1",
    name: id,
    description: "",
    sortOrder: 0,
    nodeCount: 1,
    source: null,
    isVirtual: false,
  };
}

function node(id: string, stageId: string): CanvasNode {
  return {
    id,
    workflowId: "workflow-1",
    title: id,
    description: "",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: null,
    criticType: "human",
    criticId: null,
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
  };
}

function model(): CanvasModel {
  const stages = [stage("stage-1")];
  const nodes = [node("node-1", "stage-1")];
  return {
    stages,
    nodes,
    edges: [],
    nodesById: new Map(nodes.map((item) => [item.id, item])),
    edgesById: new Map(),
  };
}

describe("StageLaneSurface", () => {
  it("renders stages and nodes", () => {
    renderWithI18n(<StageLaneSurface model={model()} variant="definition" selectedNodeId={null} />);
    expect(screen.getByText("stage-1")).toBeTruthy();
    expect(screen.getByText("node-1")).toBeTruthy();
  });

  it("calls onNodeSelect when a node is clicked", () => {
    const onNodeSelect = vi.fn();
    renderWithI18n(<StageLaneSurface model={model()} variant="definition" selectedNodeId={null} onNodeSelect={onNodeSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /node-1/ }));
    expect(onNodeSelect).toHaveBeenCalledWith("node-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/stage-lane-surface.test.tsx
```

Expected: FAIL because `stage-lane-surface.tsx` does not exist.

- [ ] **Step 3: Implement StageLaneSurface**

Create `packages/views/workflows/canvas/stage-lane-surface.tsx`:

```tsx
"use client";

import type { CanvasModel } from "@multica/core/workflows/canvas";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { RuntimeNodeAction } from "@multica/core/workflows/canvas";

export interface StageLaneSurfaceProps {
  model: CanvasModel;
  variant: "definition" | "runtime";
  selectedNodeId: string | null;
  onNodeSelect?: (nodeId: string) => void;
  onRuntimeAction?: (nodeRunId: string, action: RuntimeNodeAction) => void;
}

export function StageLaneSurface({
  model,
  variant,
  selectedNodeId,
  onNodeSelect,
  onRuntimeAction,
}: StageLaneSurfaceProps) {
  return (
    <div data-testid="stage-lane-surface" className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-muted/30 p-3">
      <div className="flex min-w-[960px] flex-col rounded-xl border bg-background">
        {model.stages.map((stage) => {
          const stageNodes = model.nodes.filter((node) => node.stageId === stage.id || (stage.isVirtual && node.stageId === null));
          if (stage.isVirtual && stageNodes.length === 0) return null;
          return (
            <section key={stage.id} data-testid={`stage-lane-${stage.id}`} className="border-b p-3 last:border-b-0">
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{stage.name}</div>
              {stageNodes.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No nodes in this stage</div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {stageNodes.map((node) => (
                    <WorkflowNodeCard
                      key={node.id}
                      node={node}
                      variant={variant}
                      selected={selectedNodeId === node.id}
                      onSelect={onNodeSelect}
                      onRuntimeAction={onRuntimeAction}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export StageLaneSurface**

Modify `packages/views/workflows/canvas/index.ts`:

```ts
export * from "./workflow-canvas-shell";
export * from "./workflow-node-card";
export * from "./preflight-bar";
export * from "./canvas-inspector";
export * from "./reactflow-surface";
export * from "./stage-lane-surface";
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/stage-lane-surface.test.tsx workflows/canvas/workflow-node-card.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/canvas/stage-lane-surface.tsx packages/views/workflows/canvas/stage-lane-surface.test.tsx packages/views/workflows/canvas/index.ts
git commit -m "feat(workflows): add stage lane canvas surface"
```

---

### Task 7: Migrate Workflow Panorama Page To Shared Canvas Model

**Files:**
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Test: `packages/views/workflows/components/overview/panorama-page.test.tsx`

- [ ] **Step 1: Add or update panorama test for shared surface**

Modify `packages/views/workflows/components/overview/panorama-page.test.tsx` to assert the shared surface is present after data loads:

```tsx
expect(screen.getByTestId("stage-lane-surface")).toBeTruthy();
```

Keep existing assertions for page header, detail panel behavior, and node selection.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/panorama-page.test.tsx
```

Expected: FAIL because the page still renders `workflow-panorama-canvas` instead of `stage-lane-surface`.

- [ ] **Step 3: Build CanvasModel in WorkflowPanoramaPage**

Modify imports in `packages/views/workflows/components/overview/workflow-panorama-page.tsx`:

```tsx
import { buildCanvasModel } from "@multica/core/workflows/canvas";
import { StageLaneSurface, WorkflowCanvasShell } from "../../canvas";
```

After data queries and before render, add:

```tsx
const canvasModel = useMemo(
  () =>
    buildCanvasModel({
      stages,
      nodes,
      edges,
    }),
  [stages, nodes, edges],
);
```

- [ ] **Step 4: Replace StageLane map with StageLaneSurface**

Replace the existing `workflow-panorama-canvas` body with:

```tsx
<WorkflowCanvasShell mode="readonly-definition" model={canvasModel}>
  {({ model }) => (
    <StageLaneSurface
      model={model}
      variant="definition"
      selectedNodeId={selectedCard?.nodeId ?? null}
      onNodeSelect={(nodeId) => handleCardClick(nodeId, "worker")}
    />
  )}
</WorkflowCanvasShell>
```

Do not remove `ArchitectureDetailPanel` in this task. Keep existing selected panel data logic so clicking a node still opens the panel.

- [ ] **Step 5: Run panorama tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run workflows/components/overview/panorama-page.test.tsx workflows/canvas/stage-lane-surface.test.tsx
```

Expected: PASS. If tests fail because they assert old `workflow-panorama-canvas` test ids, update those assertions to `stage-lane-surface` only when they are testing container presence, not behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/panorama-page.test.tsx
git commit -m "refactor(workflows): migrate panorama to shared canvas model"
```

---

### Task 8: Add Readonly Runtime Canvas Adapter For Issue Workflow Viewer

**Files:**
- Modify: `packages/views/issues/components/workflow-dag-viewer.tsx`
- Test: `packages/views/issues/components/workflow-dag-viewer.test.tsx` if one exists; otherwise create `packages/views/issues/components/workflow-dag-viewer.canvas.test.tsx`

- [ ] **Step 1: Write Issue viewer read-only canvas test**

Create `packages/views/issues/components/workflow-dag-viewer.canvas.test.tsx` using the existing test mock style in `packages/views/issues/components/`:

```tsx
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getRuntimeNodePresentation } from "@multica/core/workflows/canvas";

describe("workflow runtime canvas adapter", () => {
  it("maps awaiting critic state to review actions", () => {
    const presentation = getRuntimeNodePresentation({
      nodeRunId: "nr1",
      workflowRunId: "run1",
      status: "awaiting_critic",
      retryCount: 0,
      workerOutput: null,
      criticOutput: null,
      criticComment: "",
      startedAt: null,
      completedAt: null,
      sessionId: null,
      runtimeId: null,
      deviceId: null,
    });

    expect(presentation.actions).toEqual(["approve", "reject", "skip"]);
  });
});
```

This first test is intentionally pure. Add render-level tests only after the existing `WorkflowDagViewer` mocks are understood.

- [ ] **Step 2: Run test**

Run:

```bash
pnpm --filter @multica/views exec vitest run issues/components/workflow-dag-viewer.canvas.test.tsx
```

Expected: PASS if Task 2 runtime overlay helper exists.

- [ ] **Step 3: Build CanvasModel inside WorkflowDagViewer**

Modify `packages/views/issues/components/workflow-dag-viewer.tsx` imports:

```tsx
import { buildCanvasModel } from "@multica/core/workflows/canvas";
import { StageLaneSurface, WorkflowCanvasShell } from "../../workflows/canvas";
```

After `nodeRuns` and workflow definition data are loaded, add:

```tsx
const canvasModel = useMemo(
  () =>
    buildCanvasModel({
      stages: [],
      nodes,
      edges,
      nodeRuns,
    }),
  [nodes, edges, nodeRuns],
);
```

Use `[]` for stages in this task because `WorkflowDagViewer` currently fetches workflow detail, nodes, edges, and node runs, but not stages. The virtual unassigned stage keeps every node visible. A later UI polish task can add `workflowStagesOptions` once the runtime canvas is stable.

- [ ] **Step 4: Add a readonly runtime surface behind an internal flag**

To keep blast radius controlled, introduce a local constant near the render body:

```tsx
const useSharedRuntimeCanvas = true;
```

Replace only the existing DAG canvas render branch with:

```tsx
{useSharedRuntimeCanvas ? (
  <WorkflowCanvasShell mode="readonly-runtime" model={canvasModel}>
    {({ model }) => (
      <StageLaneSurface
        model={model}
        variant="runtime"
        selectedNodeId={selectedNodeId}
        onNodeSelect={setSelectedNodeId}
      />
    )}
  </WorkflowCanvasShell>
) : (
  <ReactFlowProvider>
    <DAGCanvas nodes={nodes} edges={edges} nodeStatuses={nodeStatuses} nodeStatusColors={nodeStatusColors} />
  </ReactFlowProvider>
)}
```

Do not wire card-level runtime actions in this task. `workflow-dag-viewer.tsx` already renders `NodeRunControlActions` in the selected node detail panel, and that remains the single runtime action surface until a later task explicitly moves actions into cards.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm --filter @multica/views exec vitest run issues/components/workflow-dag-viewer.canvas.test.tsx workflows/canvas/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/views/issues/components/workflow-dag-viewer.tsx packages/views/issues/components/workflow-dag-viewer.canvas.test.tsx
git commit -m "refactor(issues): use shared workflow runtime canvas"
```

---

### Task 9: Remove Deprecated Duplicates After Callers Migrate

**Files:**
- Modify: `packages/views/workflows/components/dag-canvas.tsx`
- Modify: `packages/views/workflows/components/overview/index.ts`
- Modify: `packages/views/workflows/components/overview/*`
- Modify: `packages/views/workflows/components/index.ts`

- [ ] **Step 1: Find old direct imports**

Run:

```bash
rg -n "DAGCanvas|WorkflowCanvas|PanoramaSvgOverlay|CompactNodeCard|StageLane" packages/views apps/web apps/desktop
```

Expected: only compatibility exports and migrated callers remain.

- [ ] **Step 2: Remove unused old overview internals**

Delete files only when `rg` confirms no imports remain:

```bash
git rm packages/views/workflows/components/overview/panorama-svg-overlay.tsx
git rm packages/views/workflows/components/overview/compact-node-card.tsx
```

If `StageLane` is still used by tests or other pages, keep it and re-export from `packages/views/workflows/canvas/stage-lane-surface.tsx` instead of deleting.

- [ ] **Step 3: Keep DAGCanvas wrapper for one release**

Do not delete `packages/views/workflows/components/dag-canvas.tsx` in this task. Leave the wrapper and deprecation comment because external internal callers may still import it.

- [ ] **Step 4: Run import and type checks**

Run:

```bash
pnpm typecheck
pnpm --filter @multica/views exec vitest run workflows/canvas/ workflows/components/dag-canvas.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows packages/views/issues apps/web apps/desktop
git commit -m "refactor(workflows): remove duplicate canvas internals"
```

---

### Task 10: Final Verification

**Files:**
- No planned source edits unless verification finds issues.

- [ ] **Step 1: Run core tests**

```bash
pnpm --filter @multica/core exec vitest run workflows/canvas/
```

Expected: PASS.

- [ ] **Step 2: Run views workflow tests**

```bash
pnpm --filter @multica/views exec vitest run workflows/canvas/ workflows/components/dag-canvas.test.tsx workflows/components/overview/panorama-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full verification**

```bash
make check
```

Expected: PASS. If this fails in unrelated existing tests, record exact failing command and failure summary before handing off.

- [ ] **Step 5: Commit any verification fixes**

Only if fixes were needed:

```bash
git add packages/core/workflows/canvas packages/core/types/workflow.ts packages/views/workflows/canvas packages/views/workflows/components packages/views/issues/components
git commit -m "fix(workflows): stabilize shared canvas refactor"
```

---

## Self-Review Notes

- Spec coverage: Tasks 1-2 cover shared core model/layout/preflight/runtime overlay. Tasks 3-6 cover shared view shell, node card, inspector, ReactFlow surface, and Stage surface. Tasks 7-8 cover Workflow panorama and Issue runtime consumers. Task 9 covers duplicate cleanup. Task 10 covers verification.
- Non-goals preserved: no task implements AI Workflow creation, AI Proposal, AI Schema generation, backend runtime snapshot, or standalone Workflow-side live Run panorama.
- Package boundaries preserved: core tasks use pure TypeScript only; views tasks use React UI; app routes are not changed unless import cleanup reveals stale references.

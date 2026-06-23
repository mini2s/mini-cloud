# Workflow Swimlane View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new swimlane (泳道图) view as the default entry for `/workflows/[id]` — horizontal lanes per stage, nodes auto-laid out within lanes via dagre, cross-lane edges with orthogonal routing, read-only with click-to-inspect detail panel.

**Architecture:** ReactFlow canvas with a custom SVG overlay for lane backgrounds/headers. Nodes use existing custom shapes from `reactflow-nodes.tsx`. Layout is a pure function (`computeSwimlaneLayout`) that runs dagre per stage subgraph then stacks lanes vertically. The view mode store gains `"swimlane"` as the new default, and `WorkflowDetailShell` routes to `WorkflowSwimlanePage`. NodeDetailPanel is reused from overview.

**Tech Stack:** ReactFlow 12.x, @dagrejs/dagre 1.x, TanStack Query, Zustand, Vitest + @testing-library/react

## Global Constraints

- TypeScript strict mode; keep types explicit
- Comments in English
- Zero new dependencies (ReactFlow + dagre already in project)
- Zero `next/*` or `react-router-dom` imports in shared packages
- Tests in `packages/views/` — jsdom environment, no framework mocks
- Follow existing i18n patterns (`useT("workflows")`)
- 8-color palette cycled by `sort_order % 8` for lane colors

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/core/workflows/stores/view-store.ts` | Add `"swimlane"` to type union, change default |
| Modify | `packages/views/locales/en/workflows.json` | Add `view.swimlane: "Swimlane"` |
| Modify | `packages/views/locales/zh-Hans/workflows.json` | Add `view.swimlane: "泳道图"` |
| Create | `packages/views/workflows/components/swimlane/swimlane-layout.ts` | `computeSwimlaneLayout()` pure function |
| Create | `packages/views/workflows/components/swimlane/swimlane-layout.test.ts` | Unit tests for layout algorithm |
| Create | `packages/views/workflows/components/swimlane/swimlane-canvas.tsx` | ReactFlow + lane overlay renderer |
| Create | `packages/views/workflows/components/swimlane/workflow-swimlane-page.tsx` | Page component (data fetch, state, composition) |
| Create | `packages/views/workflows/components/swimlane/swimlane-page.test.tsx` | Page integration tests |
| Create | `packages/views/workflows/components/swimlane/index.ts` | Barrel export |
| Modify | `packages/views/workflows/components/workflow-detail-shell.tsx` | Add swimlane option to dropdown + routing branch |

---

### Task 1: Extend view store with "swimlane" mode

**Files:**
- Modify: `packages/core/workflows/stores/view-store.ts`
- Modify: `packages/core/workflows/stores/view-store.test.ts`

**Interfaces:**
- Produces: `WorkflowViewMode = "swimlane" | "overview" | "editor"`, default `"swimlane"`

- [ ] **Step 1: Update type and default in view-store.ts**

```typescript
// Line 8: change the type union
export type WorkflowViewMode = "swimlane" | "overview" | "editor";

// Line 19: change the default value
viewMode: "swimlane" as WorkflowViewMode,
```

The rest of the file stays identical — `setViewMode` already accepts `WorkflowViewMode`, and persist/rehydrate works with any string value.

- [ ] **Step 2: Update view-store.test.ts if needed**

Check whether `view-store.test.ts` tests the default value. If it asserts `"overview"`, update to `"swimlane"`.

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @multica/core exec vitest run workflows/stores/view-store.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/workflows/stores/view-store.ts packages/core/workflows/stores/view-store.test.ts
git commit -m "feat(workflows): add swimlane to WorkflowViewMode, set as default"
```

---

### Task 2: Add i18n keys

**Files:**
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Produces:** `t($ => $.view.swimlane)` returns `"Swimlane"` (en) / `"泳道图"` (zh-Hans)

- [ ] **Step 1: Add English key**

In `packages/views/locales/en/workflows.json`, inside the `"view"` object (line ~255), add before `"overview"`:

```json
"swimlane": "Swimlane",
```

Result:
```json
"view": {
  "section": "View",
  "swimlane": "Swimlane",
  "overview": "Overview",
  "editor": "Editor"
},
```

- [ ] **Step 2: Add Chinese key**

In `packages/views/locales/zh-Hans/workflows.json`, inside the `"view"` object (line ~253), add before `"overview"`:

```json
"swimlane": "泳道图",
```

Result:
```json
"view": {
  "section": "视图",
  "swimlane": "泳道图",
  "overview": "概览",
  "editor": "编辑器"
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): add swimlane i18n keys"
```

---

### Task 3: Create swimlane-layout.ts (layout algorithm)

**Files:**
- Create: `packages/views/workflows/components/swimlane/swimlane-layout.ts`

**Interfaces:**
- Produces: `computeSwimlaneLayout(nodes, edges, stages) => SwimlaneLayoutResult`
- Imports `getNodeDimensions` pattern from `layout.ts` (inlined to avoid coupling)

- [ ] **Step 1: Write the module**

File: `packages/views/workflows/components/swimlane/swimlane-layout.ts`

```typescript
import dagre from "@dagrejs/dagre";
import type { WorkflowNode, WorkflowEdge, WorkflowStage } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";

// ── Constants ─────────────────────────────────────────────────

const SHAPE_DEFAULTS = {
  rectangle: { width: 150, height: 70 },
  pill: { width: 150, height: 70 },
  diamond: { width: 180, height: 180 },
  hexagon: { width: 200, height: 200 },
} as const;

export const LANE_HEADER_HEIGHT = 52;
export const LANE_PADDING = 16;
export const LANE_HEIGHT = 260;
export const LANE_GAP = 8;
export const LANE_SPACING = LANE_HEIGHT + LANE_GAP;

const STAGE_PALETTE = [
  { bg: "rgba(79,70,229,0.08)", border: "#4F46E5", text: "#4F46E5" },   // indigo
  { bg: "rgba(8,145,178,0.08)", border: "#0891B2", text: "#0891B2" },   // cyan
  { bg: "rgba(5,150,105,0.08)", border: "#059669", text: "#059669" },   // emerald
  { bg: "rgba(217,119,6,0.08)", border: "#D97706", text: "#D97706" },   // amber
  { bg: "rgba(220,38,38,0.08)", border: "#DC2626", text: "#DC2626" },   // red
  { bg: "rgba(124,58,237,0.08)", border: "#7C3AED", text: "#7C3AED" },  // violet
  { bg: "rgba(219,39,119,0.08)", border: "#DB2777", text: "#DB2777" },  // pink
  { bg: "rgba(37,99,235,0.08)", border: "#2563EB", text: "#2563EB" },   // blue
];

const UNASSIGNED_COLOR = {
  bg: "rgba(107,114,128,0.06)",
  border: "#6B7280",
  text: "#6B7280",
};

// ── Types ──────────────────────────────────────────────────────

export interface SwimlaneLane {
  stageId: string;
  stageName: string;
  sortOrder: number;
  y: number;
  height: number;
  color: (typeof STAGE_PALETTE)[number];
  isUnassigned: boolean;
}

export interface SwimlaneLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  lanes: SwimlaneLane[];
  canvasWidth: number;
  canvasHeight: number;
}

// ── Helpers ────────────────────────────────────────────────────

function getNodeDimensions(formatSchema: unknown): { width: number; height: number } {
  const shape = parseNodeShape(formatSchema);
  const defaults = SHAPE_DEFAULTS[shape] ?? SHAPE_DEFAULTS.rectangle;

  let width = defaults.width;
  let height = defaults.height;

  if (formatSchema && typeof formatSchema === "object" && formatSchema !== null) {
    const obj = formatSchema as Record<string, unknown>;
    if (typeof obj.width === "number" && obj.width > 0) width = obj.width;
    if (typeof obj.height === "number" && obj.height > 0) height = obj.height;
  }

  return { width, height };
}

function getStageColor(sortOrder: number) {
  return STAGE_PALETTE[sortOrder % STAGE_PALETTE.length];
}

// ── Main export ────────────────────────────────────────────────

export function computeSwimlaneLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  stages: WorkflowStage[],
): SwimlaneLayoutResult {
  const nodePositions = new Map<string, { x: number; y: number }>();
  const lanes: SwimlaneLane[] = [];
  const sortedStages = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  // Group nodes by stage
  const nodesByStage = new Map<string | null, WorkflowNode[]>();
  for (const node of nodes) {
    const key = node.stage_id ?? null;
    if (!nodesByStage.has(key)) nodesByStage.set(key, []);
    nodesByStage.get(key)!.push(node);
  }

  // Build set of assigned node ids for edge filtering
  const assignedNodeIds = new Set<string>();
  for (const s of sortedStages) {
    const stageNodes = nodesByStage.get(s.id) ?? [];
    for (const n of stageNodes) assignedNodeIds.add(n.id);
  }

  // Helper: run dagre on a subset of nodes
  const layoutSubgraph = (
    subNodes: WorkflowNode[],
    subEdges: WorkflowEdge[],
  ): Map<string, { x: number; y: number }> => {
    const positions = new Map<string, { x: number; y: number }>();
    if (subNodes.length === 0) return positions;

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 100, marginy: 20 });

    for (const node of subNodes) {
      const { width, height } = getNodeDimensions(node.format_schema);
      g.setNode(node.id, { width, height });
    }

    for (const edge of subEdges) {
      g.setEdge(edge.source_node_id, edge.target_node_id);
    }

    dagre.layout(g);

    for (const node of subNodes) {
      const dagreNode = g.node(node.id);
      if (dagreNode) {
        const { width, height } = getNodeDimensions(node.format_schema);
        positions.set(node.id, {
          x: dagreNode.x - width / 2,
          y: dagreNode.y - height / 2 + LANE_HEADER_HEIGHT + LANE_PADDING,
        });
      }
    }

    return positions;
  };

  let currentY = 0;

  // Layout each stage
  for (const stage of sortedStages) {
    const stageNodes = nodesByStage.get(stage.id) ?? [];
    const stageNodeIds = new Set(stageNodes.map((n) => n.id));
    const stageEdges = edges.filter(
      (e) => stageNodeIds.has(e.source_node_id) && stageNodeIds.has(e.target_node_id),
    );

    const color = getStageColor(stage.sort_order);
    lanes.push({
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sort_order,
      y: currentY,
      height: LANE_HEIGHT,
      color,
      isUnassigned: false,
    });

    const positions = layoutSubgraph(stageNodes, stageEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y + currentY });
    }

    currentY += LANE_SPACING;
  }

  // Unassigned lane
  const unassignedNodes = nodesByStage.get(null) ?? [];
  if (unassignedNodes.length > 0) {
    const unassignedNodeIds = new Set(unassignedNodes.map((n) => n.id));
    const unassignedEdges = edges.filter(
      (e) => unassignedNodeIds.has(e.source_node_id) && unassignedNodeIds.has(e.target_node_id),
    );

    lanes.push({
      stageId: "unassigned",
      stageName: "Unassigned",
      sortOrder: sortedStages.length,
      y: currentY,
      height: LANE_HEIGHT,
      color: UNASSIGNED_COLOR,
      isUnassigned: true,
    });

    const positions = layoutSubgraph(unassignedNodes, unassignedEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y + currentY });
    }

    currentY += LANE_SPACING;
  }

  // If no stages and no unassigned, still create one lane for all nodes
  if (lanes.length === 0 && nodes.length > 0) {
    const allEdges = edges.filter((e) => {
      const src = nodes.find((n) => n.id === e.source_node_id);
      const tgt = nodes.find((n) => n.id === e.target_node_id);
      return src != null && tgt != null;
    });

    lanes.push({
      stageId: "default",
      stageName: "",
      sortOrder: 0,
      y: 0,
      height: LANE_HEIGHT,
      color: UNASSIGNED_COLOR,
      isUnassigned: true,
    });

    const positions = layoutSubgraph(nodes, allEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y });
    }

    currentY = LANE_HEIGHT;
  }

  // Compute total canvas size
  let maxX = 0;
  for (const pos of nodePositions.values()) {
    maxX = Math.max(maxX, pos.x + 200); // 200px padding for node width
  }

  return {
    nodePositions,
    lanes,
    canvasWidth: Math.max(maxX, 800),
    canvasHeight: Math.max(currentY, 400),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/views/workflows/components/swimlane/swimlane-layout.ts
git commit -m "feat(workflows): add computeSwimlaneLayout pure function"
```

---

### Task 4: Write swimlane-layout unit tests

**Files:**
- Create: `packages/views/workflows/components/swimlane/swimlane-layout.test.ts`

**Interfaces:**
- Consumes: `computeSwimlaneLayout` from `swimlane-layout.ts`

- [ ] **Step 1: Write tests**

File: `packages/views/workflows/components/swimlane/swimlane-layout.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeSwimlaneLayout, LANE_SPACING, LANE_HEIGHT } from "./swimlane-layout";

// ── Test helpers ───────────────────────────────────────────────

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    workflow_id: "wf-1",
    title: "Test Node",
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent" as const,
    worker_id: null,
    critic_type: null as const,
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: null,
    created_at: "",
    updated_at: "",
    shape: "rectangle" as const,
    ...overrides,
  };
}

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-1",
    workflow_id: "wf-1",
    name: "Requirements",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("computeSwimlaneLayout", () => {
  it("returns empty result for empty inputs", () => {
    const result = computeSwimlaneLayout([], [], []);
    expect(result.nodePositions.size).toBe(0);
    expect(result.lanes).toHaveLength(0);
    expect(result.canvasWidth).toBe(800);
    expect(result.canvasHeight).toBe(400);
  });

  it("creates one lane per stage", () => {
    const stages = [
      makeStage({ id: "s1", name: "Phase 1", sort_order: 0 }),
      makeStage({ id: "s2", name: "Phase 2", sort_order: 1 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.lanes).toHaveLength(2);
    expect(result.lanes[0].stageName).toBe("Phase 1");
    expect(result.lanes[1].stageName).toBe("Phase 2");
  });

  it("stacks lanes vertically by sort_order", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.lanes[0].y).toBe(0);
    expect(result.lanes[1].y).toBe(LANE_SPACING);
  });

  it("places nodes within their stage lane", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const node = makeNode({ id: "n1", stage_id: "s1" });
    const result = computeSwimlaneLayout([node], [], stages);
    expect(result.nodePositions.has("n1")).toBe(true);
    const pos = result.nodePositions.get("n1")!;
    // Node should be within the first lane's vertical bounds
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeLessThan(LANE_HEIGHT);
  });

  it("places nodes from different stages in different lanes", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
    ];
    const nodes = [
      makeNode({ id: "n1", stage_id: "s1" }),
      makeNode({ id: "n2", stage_id: "s2" }),
    ];
    const result = computeSwimlaneLayout(nodes, [], stages);
    const pos1 = result.nodePositions.get("n1")!;
    const pos2 = result.nodePositions.get("n2")!;
    expect(pos2.y).toBeGreaterThan(pos1.y);
  });

  it("puts unassigned nodes in a separate lane", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const nodes = [
      makeNode({ id: "n1", stage_id: "s1" }),
      makeNode({ id: "n2", stage_id: null }),
    ];
    const result = computeSwimlaneLayout(nodes, [], stages);
    expect(result.lanes).toHaveLength(2); // stage lane + unassigned lane
    expect(result.lanes[1].isUnassigned).toBe(true);
    expect(result.nodePositions.has("n2")).toBe(true);
  });

  it("assigns colors cyclically from palette", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
      makeStage({ id: "s3", sort_order: 2 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    // First two should have different colors
    expect(result.lanes[0].color.border).not.toBe(result.lanes[1].color.border);
    // sort_order 8 wraps around to palette index 0
    const stages8 = [makeStage({ id: "s8", sort_order: 8 })];
    const result8 = computeSwimlaneLayout([], [], stages8);
    expect(result8.lanes[0].color.border).toBe(result.lanes[0].color.border);
  });

  it("produces positive canvas dimensions", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);
  });

  it("handles nodes without stages when no stages exist", () => {
    const nodes = [makeNode({ id: "n1", stage_id: null })];
    const result = computeSwimlaneLayout(nodes, [], []);
    expect(result.lanes).toHaveLength(1);
    expect(result.nodePositions.has("n1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @multica/views exec vitest run swimlane-layout.test.ts
```

Expected: 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/swimlane/swimlane-layout.test.ts
git commit -m "test(workflows): add unit tests for computeSwimlaneLayout"
```

---

### Task 5: Create swimlane-canvas.tsx (ReactFlow renderer)

**Files:**
- Create: `packages/views/workflows/components/swimlane/swimlane-canvas.tsx`

**Interfaces:**
- Consumes: `SwimlaneLayoutResult` from `swimlane-layout.ts`, `WorkflowNode`/`WorkflowEdge` from types, `WorkflowNode` renderer from `reactflow-nodes.tsx`
- Produces: `<SwimlaneCanvas>` React component

- [ ] **Step 1: Write the component**

File: `packages/views/workflows/components/swimlane/swimlane-canvas.tsx`

```typescript
"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { WorkflowNode as WorkflowNodeType, WorkflowEdge as WorkflowEdgeType } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import {
  WorkflowNode,
  NODE_WIDTH,
  NODE_HEIGHT,
  DIAMOND_SIZE,
  HEXAGON_SIZE,
  type WorkflowNodeData,
} from "../reactflow-nodes";
import type { SwimlaneLayoutResult } from "./swimlane-layout";
import { LANE_HEADER_HEIGHT } from "./swimlane-layout";

const nodeTypes = { workflow: WorkflowNode };

// ── Helpers ────────────────────────────────────────────────────

function getNodeDimensions(formatSchema: unknown) {
  const shape = parseNodeShape(formatSchema);
  switch (shape) {
    case "diamond": return { w: DIAMOND_SIZE, h: DIAMOND_SIZE };
    case "hexagon": return { w: HEXAGON_SIZE, h: HEXAGON_SIZE };
    case "pill": return { w: NODE_WIDTH, h: NODE_HEIGHT };
    default: return { w: NODE_WIDTH, h: NODE_HEIGHT };
  }
}

// ── Component ──────────────────────────────────────────────────

export interface SwimlaneCanvasProps {
  layout: SwimlaneLayoutResult;
  nodes: WorkflowNodeType[];
  edges: WorkflowEdgeType[];
  onNodeClick?: (nodeId: string) => void;
}

export function SwimlaneCanvas({ layout, nodes, edges, onNodeClick }: SwimlaneCanvasProps) {
  // Build ReactFlow nodes from layout positions
  const rfNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    return nodes
      .filter((n) => layout.nodePositions.has(n.id))
      .map((n) => {
        const pos = layout.nodePositions.get(n.id)!;
        const shape = parseNodeShape(n.format_schema);
        let nodeWidth = NODE_WIDTH;
        let nodeHeight = NODE_HEIGHT;
        if (n.format_schema && typeof n.format_schema === "object") {
          const obj = n.format_schema as Record<string, unknown>;
          if (typeof obj.width === "number") nodeWidth = obj.width;
          if (typeof obj.height === "number") nodeHeight = obj.height;
        }
        if (shape === "diamond") { nodeWidth = DIAMOND_SIZE; nodeHeight = DIAMOND_SIZE; }
        if (shape === "hexagon") { nodeWidth = HEXAGON_SIZE; nodeHeight = HEXAGON_SIZE; }

        return {
          id: n.id,
          type: "workflow",
          position: { x: pos.x, y: pos.y },
          width: nodeWidth,
          height: nodeHeight,
          data: {
            title: n.title,
            shape,
            nodeColor: undefined,
            fontSize: undefined,
          } satisfies WorkflowNodeData,
        };
      });
  }, [nodes, layout.nodePositions]);

  // Build ReactFlow edges
  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((e) => {
      // Determine color: use lane color if both nodes in same stage lane, else neutral
      const sourceNode = nodes.find((n) => n.id === e.source_node_id);
      const targetNode = nodes.find((n) => n.id === e.target_node_id);
      const sameLane = sourceNode?.stage_id === targetNode?.stage_id && sourceNode?.stage_id != null;

      let strokeColor = "#94A3B8"; // neutral slate-400
      if (sameLane) {
        const lane = layout.lanes.find((l) => l.stageId === sourceNode!.stage_id);
        if (lane) strokeColor = lane.color.border;
      }

      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        type: "step",
        style: { stroke: strokeColor, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 16, height: 16 },
      };
    });
  }, [edges, nodes, layout.lanes]);

  // Node click handler
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        className="bg-muted/20"
        data-testid="swimlane-reactflow"
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />

        {/* Lane background overlay */}
        <svg
          className="absolute inset-0 pointer-events-none overflow-visible"
          style={{ zIndex: -1 }}
          data-testid="swimlane-overlay"
        >
          {layout.lanes.map((lane) => (
            <g key={lane.stageId}>
              {/* Lane background */}
              <rect
                x={-10000}
                y={lane.y}
                width={20000}
                height={lane.height}
                fill={lane.color.bg}
                stroke={lane.isUnassigned ? lane.color.border : "transparent"}
                strokeWidth={lane.isUnassigned ? 1 : 0}
                strokeDasharray={lane.isUnassigned ? "8 4" : undefined}
              />
              {/* Lane header bar */}
              <rect
                x={-10000}
                y={lane.y}
                width={20000}
                height={LANE_HEADER_HEIGHT}
                fill={lane.color.border}
                opacity={0.15}
              />
              {/* Lane header text */}
              <text
                x={16}
                y={lane.y + LANE_HEADER_HEIGHT / 2}
                dominantBaseline="central"
                fill={lane.color.text}
                fontSize={13}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
                style={{ pointerEvents: "auto" }}
              >
                {lane.stageName}
              </text>
            </g>
          ))}
        </svg>
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/views/workflows/components/swimlane/swimlane-canvas.tsx
git commit -m "feat(workflows): add SwimlaneCanvas ReactFlow + lane overlay component"
```

---

### Task 6: Create workflow-swimlane-page.tsx (page component)

**Files:**
- Create: `packages/views/workflows/components/swimlane/workflow-swimlane-page.tsx`

**Interfaces:**
- Consumes: `SwimlaneCanvas` from `swimlane-canvas.tsx`, `NodeDetailPanel` from `overview/node-detail-panel.tsx`, TanStack Query hooks from `@multica/core/workflows/queries`
- Produces: `<WorkflowSwimlanePage>` component
- Props: `{ workflowId: string; viewToggle?: ReactNode }` (same signature as overview page)

- [ ] **Step 1: Write the page component**

File: `packages/views/workflows/components/swimlane/workflow-swimlane-page.tsx`

```typescript
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowDetailOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
} from "@multica/core/workflows/queries";
import { useNavigation } from "../../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { PageHeader } from "../../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { useT } from "../../../i18n";
import { SwimlaneCanvas } from "./swimlane-canvas";
import { NodeDetailPanel } from "../overview/node-detail-panel";
import { computeSwimlaneLayout } from "./swimlane-layout";
import type { ReactNode } from "react";

export interface WorkflowSwimlanePageProps {
  workflowId: string;
  viewToggle?: ReactNode;
}

export function WorkflowSwimlanePage({ workflowId, viewToggle }: WorkflowSwimlanePageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Data fetching — shared cache keys with overview & editor
  const {
    data: workflow,
    isLoading: workflowLoading,
    isError: workflowError,
    refetch: workflowRefetch,
  } = useQuery(workflowDetailOptions(wsId, workflowId));

  const { data: stages = [], isLoading: stagesLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );

  const { data: nodes = [], isLoading: nodesLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );

  const { data: edges = [] } = useQuery(
    workflowEdgesOptions(wsId, workflowId),
  );

  const isLoading = workflowLoading || stagesLoading || nodesLoading;

  // Compute layout
  const layout = useMemo(
    () => computeSwimlaneLayout(nodes, edges, stages),
    [nodes, edges, stages],
  );

  // ── Loading ──

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader>
          <Skeleton className="h-4 w-48" />
        </PageHeader>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="flex flex-col gap-2" data-testid="swimlane-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[260px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──

  if (workflowError || !workflow) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader>
          <Skeleton className="h-4 w-48" />
        </PageHeader>
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t(($) => $.detail.not_found)}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {t(($) => $.detail.not_found)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigation.push(wsPaths.workflows())}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t(($) => $.detail.back_to_workflows)}
                </Button>
                <Button variant="default" size="sm" onClick={() => workflowRefetch()}>
                  {t(($) => $.overview.error_retry)}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── Normal ──

  return (
    <div className="flex flex-col h-full">
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium truncate">{workflow.title}</h1>
        </div>
        {viewToggle && <div className="flex items-center gap-1">{viewToggle}</div>}
      </PageHeader>

      <div className="flex-1 min-h-0">
        <SwimlaneCanvas
          layout={layout}
          nodes={nodes}
          edges={edges}
          onNodeClick={setSelectedNodeId}
        />
      </div>

      {selectedNodeId && (
        <NodeDetailPanel
          nodeId={selectedNodeId}
          nodes={nodes}
          edges={edges}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/views/workflows/components/swimlane/workflow-swimlane-page.tsx
git commit -m "feat(workflows): add WorkflowSwimlanePage component"
```

---

### Task 7: Create barrel export

**Files:**
- Create: `packages/views/workflows/components/swimlane/index.ts`

- [ ] **Step 1: Write barrel file**

File: `packages/views/workflows/components/swimlane/index.ts`

```typescript
export { WorkflowSwimlanePage } from "./workflow-swimlane-page";
export type { WorkflowSwimlanePageProps } from "./workflow-swimlane-page";
export { SwimlaneCanvas } from "./swimlane-canvas";
export type { SwimlaneCanvasProps } from "./swimlane-canvas";
export { computeSwimlaneLayout, LANE_HEADER_HEIGHT, LANE_PADDING, LANE_HEIGHT, LANE_SPACING } from "./swimlane-layout";
export type { SwimlaneLayoutResult, SwimlaneLane } from "./swimlane-layout";
```

- [ ] **Step 2: Commit**

```bash
git add packages/views/workflows/components/swimlane/index.ts
git commit -m "feat(workflows): add swimlane barrel export"
```

---

### Task 8: Integrate into WorkflowDetailShell

**Files:**
- Modify: `packages/views/workflows/components/workflow-detail-shell.tsx`

**Interfaces:**
- Consumes: `WorkflowSwimlanePage` from `./swimlane`

- [ ] **Step 1: Update the shell**

```typescript
"use client";

import { useWorkflowViewStore } from "@multica/core/workflows/stores/view-store";
import { WorkflowDetailPage } from "./workflow-detail-page";
import { WorkflowOverviewPage } from "./overview";
import { WorkflowSwimlanePage } from "./swimlane";

import { useT } from "../../i18n";
import { Button } from "@multica/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { LayoutGrid, Layers, Pen } from "lucide-react";

export interface WorkflowDetailShellProps {
  workflowId: string;
}

export function WorkflowDetailShell({ workflowId }: WorkflowDetailShellProps) {
  const { t } = useT("workflows");
  const viewMode = useWorkflowViewStore((s) => s.viewMode);
  const setViewMode = useWorkflowViewStore((s) => s.setViewMode);

  const viewToggle = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon-sm" className="text-muted-foreground" title={t(($) => $.view.section)}>
            {viewMode === "swimlane" ? (
              <LayoutGrid className="size-4" />
            ) : viewMode === "overview" ? (
              <Layers className="size-4" />
            ) : (
              <Pen className="size-4" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t(($) => $.view.section)}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setViewMode("swimlane")}>
            <LayoutGrid className="size-4 mr-2" />
            {t(($) => $.view.swimlane)}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setViewMode("overview")}>
            <Layers className="size-4 mr-2" />
            {t(($) => $.view.overview)}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setViewMode("editor")}>
            <Pen className="size-4 mr-2" />
            {t(($) => $.view.editor)}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (viewMode === "editor") {
    return <WorkflowDetailPage workflowId={workflowId} viewToggle={viewToggle} />;
  }
  if (viewMode === "overview") {
    return <WorkflowOverviewPage workflowId={workflowId} viewToggle={viewToggle} />;
  }
  return <WorkflowSwimlanePage workflowId={workflowId} viewToggle={viewToggle} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/views/workflows/components/workflow-detail-shell.tsx
git commit -m "feat(workflows): integrate swimlane view into WorkflowDetailShell"
```

---

### Task 9: Write swimlane-page integration tests

**Files:**
- Create: `packages/views/workflows/components/swimlane/swimlane-page.test.tsx`

**Interfaces:**
- Consumes: `WorkflowSwimlanePage` from `workflow-swimlane-page.tsx`

- [ ] **Step 1: Write integration tests**

File: `packages/views/workflows/components/swimlane/swimlane-page.test.tsx`

```typescript
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../../test/i18n";

// ── Mock data ──────────────────────────────────────────────────

const MOCK_WORKFLOW = { id: "wf-1", title: "Test Workflow" };

const MOCK_STAGES = [
  { id: "s1", workflow_id: "wf-1", name: "Design", description: "", sort_order: 0, node_count: 2, created_at: "", updated_at: "" },
  { id: "s2", workflow_id: "wf-1", name: "Build", description: "", sort_order: 1, node_count: 1, created_at: "", updated_at: "" },
];

const MOCK_NODES = [
  { id: "n1", workflow_id: "wf-1", stage_id: "s1", title: "Architecture", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent" as const, worker_id: null, critic_type: null as const, critic_id: null, critic_api_url: null, sort_order: 0, created_at: "", updated_at: "", shape: "rectangle" as const },
  { id: "n2", workflow_id: "wf-1", stage_id: "s2", title: "Implement", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent" as const, worker_id: null, critic_type: null as const, critic_id: null, critic_api_url: null, sort_order: 0, created_at: "", updated_at: "", shape: "rectangle" as const },
];

const MOCK_EDGES = [
  { id: "e1", workflow_id: "wf-1", source_node_id: "n1", target_node_id: "n2" },
];

// ── Hoisted mocks ──────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  workflowData: undefined as unknown,
  stagesData: [] as unknown[],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  isLoading: false,
  isError: false,
  navigationPush: vi.fn(),
}));

// ── Mock @tanstack/react-query ─────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = opts.queryKey ?? [];
    if (Array.isArray(key) && key.includes("stages")) {
      return { data: mocks.stagesData, isLoading: mocks.isLoading, isError: mocks.isError };
    }
    if (Array.isArray(key) && key.includes("nodes")) {
      return { data: mocks.nodesData, isLoading: false, isError: false };
    }
    if (Array.isArray(key) && key.includes("edges")) {
      return { data: mocks.edgesData, isLoading: false, isError: false };
    }
    return { data: mocks.workflowData, isLoading: mocks.isLoading, isError: mocks.isError, refetch: vi.fn() };
  },
  useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Mock external packages ─────────────────────────────────────

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowDetailOptions: (_wsId: string, id: string) => ({ queryKey: ["workflows", "ws-1", "detail", id] }),
  workflowStagesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "stages"] }),
  workflowNodesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "nodes"] }),
  workflowEdgesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "edges"] }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    workflowDetail: (id: string) => `/ws-1/workflows/${id}`,
    workflows: () => "/ws-1/workflows",
  }),
}));

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush, replace: mocks.navigationPush }),
}));

// ── Mock ReactFlow ─────────────────────────────────────────────

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => (
    <div data-testid="swimlane-reactflow">
      <div data-testid="rf-nodecount">{(props.nodes as unknown[]).length}</div>
      <div data-testid="rf-edgecount">{(props.edges as unknown[]).length}</div>
      <button
        data-testid="rf-nodeclick"
        onClick={() => {
          const onNodeClick = props.onNodeClick as ((e: unknown, n: { id: string }) => void) | undefined;
          onNodeClick?.(null as unknown as React.MouseEvent, { id: "n1" });
        }}
      />
      <button
        data-testid="rf-nodeclick-n2"
        onClick={() => {
          const onNodeClick = props.onNodeClick as ((e: unknown, n: { id: string }) => void) | undefined;
          onNodeClick?.(null as unknown as React.MouseEvent, { id: "n2" });
        }}
      />
      {props.children as React.ReactNode}
    </div>
  ),
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

// ── Mock NodeDetailPanel ───────────────────────────────────────

vi.mock("../overview/node-detail-panel", () => ({
  NodeDetailPanel: (props: { nodeId: string; nodes: unknown[]; edges: unknown[]; onClose: () => void }) => (
    <div data-testid="node-detail-panel">
      <span data-testid="detail-node-id">{props.nodeId}</span>
      <button data-testid="node-detail-close" onClick={props.onClose}>Close</button>
    </div>
  ),
}));

// ── Tests ──────────────────────────────────────────────────────

import { WorkflowSwimlanePage } from "./workflow-swimlane-page";

describe("WorkflowSwimlanePage", () => {
  beforeEach(() => {
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.workflowData = MOCK_WORKFLOW;
    mocks.stagesData = MOCK_STAGES;
    mocks.nodesData = MOCK_NODES;
    mocks.edgesData = MOCK_EDGES;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading skeleton", () => {
    mocks.isLoading = true;
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-skeleton")).toBeTruthy();
  });

  it("renders error state", () => {
    mocks.isError = true;
    mocks.workflowData = undefined;
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders ReactFlow canvas with nodes", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-reactflow")).toBeTruthy();
    // 2 nodes should be rendered
    expect(screen.getByTestId("rf-nodecount").textContent).toBe("2");
  });

  it("renders edges in ReactFlow", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("rf-edgecount").textContent).toBe("1");
  });

  it("renders lane overlay", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-overlay")).toBeTruthy();
  });

  it("opens node detail panel on node click", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("node-detail-panel")).toBeTruthy();
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n1");
  });

  it("closes node detail panel", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("node-detail-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("node-detail-close"));
    expect(screen.queryByTestId("node-detail-panel")).toBeNull();
  });

  it("switches detail panel to different node", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n1");
    fireEvent.click(screen.getByTestId("rf-nodeclick-n2"));
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n2");
  });

  it("shows empty state when no nodes", () => {
    mocks.nodesData = [];
    mocks.edgesData = [];
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("rf-nodecount").textContent).toBe("0");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @multica/views exec vitest run swimlane-page.test.tsx
```

Expected: 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/swimlane/swimlane-page.test.tsx
git commit -m "test(workflows): add integration tests for WorkflowSwimlanePage"
```

---

### Task 10: Run full verification

- [ ] **Step 1: Run TypeScript type check**

```bash
pnpm typecheck
```

Fix any type errors. The most likely issues:
- `WorkflowStage` type field names (`sort_order` not `sortOrder`; `workflow_id` not `workflowId`) — check `packages/core/types/workflow.ts` for exact field names and match them.
- ReactFlow `Node` type compatibility with `WorkflowNodeData` — ensure `data` satisfies the constraint.

- [ ] **Step 2: Run Swimlane-specific tests**

```bash
pnpm --filter @multica/views exec vitest run swimlane-layout.test.ts
pnpm --filter @multica/views exec vitest run swimlane-page.test.tsx
pnpm --filter @multica/core exec vitest run workflows/stores/view-store.test.ts
```

All should PASS.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Fix any failing tests — regressions in existing tests (especially shell or overview tests that assert on `"overview"` being the default view mode).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(workflows): resolve type errors and test regressions from swimlane view"
```

---

## Implementation Order Summary

```
Task 1 (view store) ──┐
Task 2 (i18n)       ──┼──> Task 8 (shell integration)
                       |
Task 3 (layout.ts)  ──┼──> Task 5 (canvas) ──> Task 6 (page)
Task 4 (layout test)──┘                           │
                                                   ├──> Task 9 (page tests)
Task 7 (barrel) ──────────────────────────────────┘
                                                   
All ──> Task 10 (verification)
```

Tasks 1, 2, 3+4 can run in parallel. Task 5 depends on 3. Task 6 depends on 5+7. Task 8 depends on 1+2+6. Task 9 depends on 6.

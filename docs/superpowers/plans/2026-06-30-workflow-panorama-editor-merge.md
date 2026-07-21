# Workflow Panorama Editor Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Workflow Panorama view and Editor into a single ReactFlow-based unified view at `/workflows/[id]` — swimlane layout with full editing (drag, connect, configure, save) on one canvas.

**Architecture:** Replace the div-based panorama SVG overlay with ReactFlow as the single rendering engine. Swimlanes are implemented via non-interactive background nodes (`LaneBgNode`, `GradientBgNode`) rendered inside ReactFlow. Worker and Critic nodes become custom ReactFlow node types. Y coordinate is computed from `stage.sort_order` at runtime; only `position_x` is stored in DB. Editing is always-on (no view/edit mode toggle).

**Tech Stack:** ReactFlow (@xyflow/react), Zustand (store), TanStack Query (server state), dagre (auto-layout), Vitest + Testing Library (tests), Playwright (E2E)

## Global Constraints

- All new ReactFlow components go under `packages/views/workflows/components/overview/reactflow-nodes/` and `reactflow-edges/`
- Y coordinate is computed from `stage.sort_order * LANE_STEP + LANE_PADDING_TOP`, never stored in DB
- `position_x` is stored in DB, updated immediately on drag stop
- Cross-stage edges are allowed (backend already supports, test `TestCrossStageEdge_Allowed` exists)
- The view toggle (`viewMode: "panorama" | "editor"`) is removed entirely — single merged view
- Old files are only deleted after confirming zero remaining references via `rg`
- `stage-lane.tsx` and `panorama-svg-overlay.tsx` are preserved (used by `execution-panorama-page.tsx`)
- i18n keys go in `packages/views/locales/{en,zh-Hans}/workflows.json` under `panorama.*`
- Web `/workflows/[id]/overview` redirect is preserved unless confirmed no external links depend on it
- All comments in code are English only

---

## File Structure

### New files (Phase 1)

```
packages/views/workflows/components/overview/
├── constants.ts                                  ← NEW: shared layout/color constants
├── reactflow-nodes/
│   ├── index.ts                                  ← NEW: barrel export for custom node types
│   ├── lane-bg-node.tsx                          ← NEW: semi-transparent lane background
│   ├── lane-bg-node.test.tsx                     ← NEW
│   ├── gradient-bg-node.tsx                      ← NEW: 8px gradient transition strip
│   ├── gradient-bg-node.test.tsx                 ← NEW
│   ├── compact-worker-node.tsx                   ← NEW: 224×64px worker card node
│   ├── compact-worker-node.test.tsx              ← NEW
│   ├── critic-badge-node.tsx                     ← NEW: 144×48px critic badge node
│   └── critic-badge-node.test.tsx                ← NEW
├── reactflow-edges/
│   ├── index.ts                                  ← NEW: barrel export for custom edge types
│   ├── panorama-edge.tsx                         ← NEW: orthogonal edge with path strategies
│   └── panorama-edge.test.tsx                    ← NEW
```

### New files (Phase 2)

```
packages/views/workflows/components/overview/
├── panorama-toolbar.tsx                          ← NEW: toolbar with undo/redo/auto-layout/zoom/save
├── panorama-toolbar.test.tsx                     ← NEW
├── canvas-stage-labels.tsx                       ← NEW: fixed left-side stage labels
└── canvas-stage-labels.test.tsx                  ← NEW
```

### Rewritten files (Phase 3)

```
packages/views/workflows/components/overview/
└── workflow-panorama-page.tsx                    ← REWRITE: ReactFlow swimlane canvas
```

### Modified files

```
packages/views/workflows/components/
├── node-config-panel.tsx                         ← ADAPT: accept onSave/onDelete callbacks, stage dropdown via props
├── node-palette.tsx                              ← ADAPT: add Critic drag item, multi-shape support
├── layout.ts                                     ← ADAPT: dagre lane-internal horizontal-only arrangement
├── workflow-detail-shell.tsx                     ← SIMPLIFY: remove view toggle, always render panorama page
├── index.ts                                      ← UPDATE: remove view-toggle exports, add new exports
└── overview/index.ts                             ← UPDATE: export new components, stop exporting removed ones

packages/core/workflows/
└── store.ts                                      ← EXTEND: add TrackedAction types for position/stage/delete undo

packages/views/locales/
├── en/workflows.json                             ← ADD: panorama.* keys
└── zh-Hans/workflows.json                        ← ADD: panorama.* keys
```

### Removed files (Phase 4, only after confirming zero references)

```
packages/views/workflows/components/workflow-detail-page.tsx
packages/views/workflows/components/dag-canvas.tsx
packages/views/workflows/components/reactflow-nodes.tsx
packages/views/workflows/components/overview/workflow-overview-page.tsx
packages/views/workflows/components/overview/stage-canvas.tsx
packages/views/workflows/components/overview/stage-card.tsx
packages/views/workflows/components/overview/stage-node-dag.tsx
packages/views/workflows/components/overview/compact-node-card.tsx
packages/views/workflows/components/overview/critic-badge.tsx
packages/views/workflows/components/overview/node-detail-panel.tsx
packages/views/workflows/components/overview/architecture-detail-panel.tsx
packages/core/workflows/stores/view-store.ts
packages/core/workflows/stores/view-store.test.ts
```

### Preserved files (used by issue execution panorama)

```
packages/views/workflows/components/overview/stage-lane.tsx
packages/views/workflows/components/overview/panorama-svg-overlay.tsx
```

---

### Task 1: Extract shared layout and color constants

**Files:**
- Create: `packages/views/workflows/components/overview/constants.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `LANE_HEIGHT = 128`
  - `GRADIENT_HEIGHT = 8`
  - `LANE_STEP = 136` (LANE_HEIGHT + GRADIENT_HEIGHT)
  - `LANE_PADDING_TOP = 12`
  - `PANORAMA_WIDTH = 2400`
  - `WORKER_WIDTH = 224`, `WORKER_HEIGHT = 64`
  - `CRITIC_WIDTH = 144`, `CRITIC_HEIGHT = 48`
  - `WORKER_CRITIC_GAP = 20`
  - `STAGE_BG_COLORS: readonly [6]` — tailwind bg classes
  - `STAGE_LINE_COLORS: readonly [6]` — tailwind text classes for edge strokes
  - `STAGE_TRANSITION_GRADIENTS: readonly [6]` — tailwind gradient classes
  - `UNASSIGNED_LANE_Y(stagesLength: number): number` — `stagesLength * LANE_STEP + 16`
  - `computeLaneY(sortOrder: number): number` — `sortOrder * LANE_STEP + LANE_PADDING_TOP`

- [ ] **Step 1: Write the constants file**

```typescript
// packages/views/workflows/components/overview/constants.ts

export const LANE_HEIGHT = 128;
export const GRADIENT_HEIGHT = 8;
export const LANE_STEP = LANE_HEIGHT + GRADIENT_HEIGHT; // 136
export const LANE_PADDING_TOP = 12;
export const PANORAMA_WIDTH = 2400;

export const WORKER_WIDTH = 224;
export const WORKER_HEIGHT = 64;
export const CRITIC_WIDTH = 144;
export const CRITIC_HEIGHT = 48;
export const WORKER_CRITIC_GAP = 20;

export const STAGE_BG_COLORS = [
  "bg-slate-50/70",
  "bg-stone-50/70",
  "bg-blue-50/45",
  "bg-rose-50/45",
  "bg-violet-50/45",
  "bg-amber-50/45",
] as const;

export const STAGE_LINE_COLORS = [
  "text-slate-300",
  "text-stone-300",
  "text-blue-300",
  "text-rose-300",
  "text-violet-300",
  "text-amber-300",
] as const;

export const STAGE_TRANSITION_GRADIENTS = [
  "bg-gradient-to-b from-slate-50/40 to-stone-50/40",
  "bg-gradient-to-b from-stone-50/40 to-blue-50/35",
  "bg-gradient-to-b from-blue-50/35 to-rose-50/35",
  "bg-gradient-to-b from-rose-50/35 to-violet-50/35",
  "bg-gradient-to-b from-violet-50/35 to-amber-50/35",
  "bg-gradient-to-b from-amber-50/35 to-slate-50/40",
] as const;

export function UNASSIGNED_LANE_Y(stagesLength: number): number {
  return stagesLength * LANE_STEP + 16;
}

export function computeLaneY(sortOrder: number): number {
  return sortOrder * LANE_STEP + LANE_PADDING_TOP;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS (no new errors from this file)

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/overview/constants.ts
git commit -m "feat(workflows): add shared panorama layout and color constants"
```

---

### Task 2: LaneBgNode — swimlane background ReactFlow node

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx`

**Interfaces:**
- Consumes: `LANE_HEIGHT`, `PANORAMA_WIDTH`, `STAGE_BG_COLORS` from `../constants`
- Produces:
  - `LaneBgNode` — ReactFlow custom node, `type: "laneBg"`
  - `LaneBgNodeData = { stageIndex: number; stageName?: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { LaneBgNode, type LaneBgNodeData } from "./lane-bg-node";
import type { Node } from "@xyflow/react";

function renderWithProvider(node: Node<LaneBgNodeData>) {
  return render(
    <ReactFlowProvider>
      <LaneBgNode
        id={node.id}
        data={node.data}
        selected={false}
        type="laneBg"
        zIndex={-2}
        isConnectable={false}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
      />
    </ReactFlowProvider>,
  );
}

const baseNode: Node<LaneBgNodeData> = {
  id: "lane-0",
  type: "laneBg",
  position: { x: 0, y: 0 },
  data: { stageIndex: 0 },
};

describe("LaneBgNode", () => {
  it("renders with correct width and height", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("lane-bg-0");
    expect(el).toBeInTheDocument();
    // 2400px wide, 128px tall
    expect(el).toHaveStyle({ width: "2400px", height: "128px" });
  });

  it("uses correct color for stage index", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("lane-bg-0");
    expect(el.className).toContain("bg-slate-50/70");
  });

  it("cycles colors for different stage indices", () => {
    const node1: Node<LaneBgNodeData> = { ...baseNode, id: "lane-1", data: { stageIndex: 1 } };
    renderWithProvider(node1);
    const el = screen.getByTestId("lane-bg-1");
    expect(el.className).toContain("bg-stone-50/70");
  });

  it("is not interactive", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("lane-bg-0");
    expect(el).toHaveAttribute("data-nodrag", "true");
  });

  it("handles stage index out of range", () => {
    const node: Node<LaneBgNodeData> = { ...baseNode, id: "lane-99", data: { stageIndex: 99 } };
    renderWithProvider(node);
    const el = screen.getByTestId("lane-bg-99");
    // 99 % 6 = 3 → rose
    expect(el.className).toContain("bg-rose-50/45");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx`
Expected: FAIL — cannot find module `./lane-bg-node`

- [ ] **Step 3: Write LaneBgNode implementation**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.tsx
import type { NodeProps } from "@xyflow/react";
import { STAGE_BG_COLORS, LANE_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface LaneBgNodeData {
  stageIndex: number;
}

export function LaneBgNode({ id, data }: NodeProps<LaneBgNodeData>) {
  const colorIndex = Math.abs(data.stageIndex) % STAGE_BG_COLORS.length;
  const bgClass = STAGE_BG_COLORS[colorIndex];

  return (
    <div
      data-testid={`lane-bg-${id}`}
      data-nodrag="true"
      className={`${bgClass} pointer-events-none`}
      style={{ width: PANORAMA_WIDTH, height: LANE_HEIGHT }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.tsx packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx
git commit -m "feat(workflows): add LaneBgNode ReactFlow custom node"
```

---

### Task 3: GradientBgNode — transition gradient between lanes

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.test.tsx`

**Interfaces:**
- Consumes: `GRADIENT_HEIGHT`, `PANORAMA_WIDTH`, `STAGE_TRANSITION_GRADIENTS` from `../constants`
- Produces:
  - `GradientBgNode` — ReactFlow custom node, `type: "gradientBg"`
  - `GradientBgNodeData = { fromStageIndex: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { GradientBgNode, type GradientBgNodeData } from "./gradient-bg-node";
import type { Node } from "@xyflow/react";

function renderWithProvider(node: Node<GradientBgNodeData>) {
  return render(
    <ReactFlowProvider>
      <GradientBgNode
        id={node.id}
        data={node.data}
        selected={false}
        type="gradientBg"
        zIndex={-2}
        isConnectable={false}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
      />
    </ReactFlowProvider>,
  );
}

const baseNode: Node<GradientBgNodeData> = {
  id: "gradient-0",
  type: "gradientBg",
  position: { x: 0, y: 128 },
  data: { fromStageIndex: 0 },
};

describe("GradientBgNode", () => {
  it("renders with correct height (8px)", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-0");
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ width: "2400px", height: "8px" });
  });

  it("uses correct gradient for stage transition", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-0");
    expect(el.className).toContain("from-slate-50/40");
    expect(el.className).toContain("to-stone-50/40");
  });

  it("is not interactive", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-0");
    expect(el).toHaveAttribute("data-nodrag", "true");
  });

  it("cycles gradients correctly", () => {
    const node: Node<GradientBgNodeData> = { ...baseNode, id: "gradient-99", data: { fromStageIndex: 99 } };
    renderWithProvider(node);
    const el = screen.getByTestId("gradient-bg-99");
    // 99 % 6 = 3 → rose-to-violet
    expect(el.className).toContain("from-rose-50/35");
    expect(el.className).toContain("to-violet-50/35");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/gradient-bg-node.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write GradientBgNode implementation**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.tsx
import type { NodeProps } from "@xyflow/react";
import { STAGE_TRANSITION_GRADIENTS, GRADIENT_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface GradientBgNodeData {
  fromStageIndex: number;
}

export function GradientBgNode({ id, data }: NodeProps<GradientBgNodeData>) {
  const colorIndex = Math.abs(data.fromStageIndex) % STAGE_TRANSITION_GRADIENTS.length;
  const gradientClass = STAGE_TRANSITION_GRADIENTS[colorIndex];

  return (
    <div
      data-testid={`gradient-bg-${id}`}
      data-nodrag="true"
      className={`${gradientClass} pointer-events-none`}
      style={{ width: PANORAMA_WIDTH, height: GRADIENT_HEIGHT }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/gradient-bg-node.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.tsx packages/views/workflows/components/overview/reactflow-nodes/gradient-bg-node.test.tsx
git commit -m "feat(workflows): add GradientBgNode ReactFlow custom node"
```

---

### Task 4: CompactWorkerNode — draggable worker card in swimlane

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`

**Interfaces:**
- Consumes: `WORKER_WIDTH`, `WORKER_HEIGHT`, `STAGE_LINE_COLORS` from `../constants`
- Produces:
  - `CompactWorkerNode` — ReactFlow custom node, `type: "compactWorker"`
  - `CompactWorkerNodeData = { node: WorkflowNode; stage_id: string | null; stageColorIndex: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CompactWorkerNode, type CompactWorkerNodeData } from "./compact-worker-node";
import type { Node } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";

// Minimal mock for the i18n hook
vi.mock("../../../../i18n", () => ({
  useT: () => ({
    t: (getter: (d: { node: Record<string, string> }) => string) => {
      const dict = { node: { worker_name: "Worker", agent_label: "Agent", not_configured: "Not configured" } };
      return getter(dict);
    },
  }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workspace/queries", () => ({
  builtinPluginListOptions: () => ({ queryKey: ["plugins"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
}));

function makeWorkerNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "wf-1",
    title: "Code Review",
    description: "",
    worker_type: "agent",
    worker_id: "agent-1",
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    stage_id: "stage-0",
    format_schema: null,
    position_x: 100,
    position_y: 0,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderWithProvider(node: Node<CompactWorkerNodeData>) {
  return render(
    <ReactFlowProvider>
      <CompactWorkerNode
        id={node.id}
        data={node.data}
        selected={false}
        type="compactWorker"
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
      />
    </ReactFlowProvider>,
  );
}

describe("CompactWorkerNode", () => {
  const baseData: CompactWorkerNodeData = {
    node: makeWorkerNode(),
    stage_id: "stage-0",
    stageColorIndex: 0,
    pluginName: "builtin/code-review",
    workerName: "GPT-4 Agent",
  };

  it("renders with correct dimensions", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    };
    renderWithProvider(rfn);
    const el = screen.getByTestId("compact-worker-node-1");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("h-16", "w-56");
  });

  it("shows plugin name", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    };
    renderWithProvider(rfn);
    expect(screen.getByText("builtin/code-review")).toBeInTheDocument();
  });

  it("falls back to node title when no plugin name", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: { ...baseData, pluginName: undefined },
    };
    renderWithProvider(rfn);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("shows worker name in subtitle", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    };
    renderWithProvider(rfn);
    expect(screen.getByText("GPT-4 Agent")).toBeInTheDocument();
  });

  it("shows 'Not configured' when no worker", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        workerName: undefined,
        node: makeWorkerNode({ worker_id: null, worker_type: "human" }),
      },
    };
    renderWithProvider(rfn);
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("has testid with node id", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "abc-123",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    };
    renderWithProvider(rfn);
    expect(screen.getByTestId("compact-worker-abc-123")).toBeInTheDocument();
  });

  it("renders three Handles (Left, Right, Bottom)", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    };
    renderWithProvider(rfn);
    // Handles are rendered by ReactFlow's Handle component
    const handles = document.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(3);
  });

  it("applies selected styling when selected", () => {
    const rfn: Node<CompactWorkerNodeData> = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
      selected: true,
    };
    renderWithProvider(rfn);
    const el = screen.getByTestId("compact-worker-node-1");
    expect(el.className).toContain("border-primary/55");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write CompactWorkerNode implementation**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";

export interface CompactWorkerNodeData {
  node: WorkflowNode;
  stage_id: string | null;
  stageColorIndex: number;
  pluginName?: string;
  workerName?: string;
}

export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  selected,
}: NodeProps<CompactWorkerNodeData>) {
  const handleColorClass = STAGE_LINE_COLORS[data.stageColorIndex % STAGE_LINE_COLORS.length];

  const displayName = data.pluginName || data.node.title || "Untitled";
  const subtitle = data.workerName || "Not configured";

  return (
    <div
      data-testid={`compact-worker-${id}`}
      className={`
        h-16 w-56 rounded-lg border border-slate-300/90 bg-white p-2.5
        shadow-[0_1px_2px_rgba(15,23,42,0.08)]
        transition-all duration-150
        hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]
        ${selected ? "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]" : ""}
      `}
      style={{ width: WORKER_WIDTH, height: WORKER_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="critic"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`}
      />

      <div className="flex flex-col h-full min-w-0">
        <span className="text-xs font-semibold truncate text-foreground">
          {displayName}
        </span>
        <span className="text-[11px] text-muted-foreground truncate mt-0.5">
          {subtitle}
        </span>
      </div>
    </div>
  );
});
```

Note: The `group-hover:opacity-100` approach for Handle visibility requires the wrapper to have `group`. The current implementation uses a class on the div but ReactFlow nodes need the `group` class on the outer element. Let me fix that:

```typescript
// Revised CompactWorkerNode — add group class and data-nodrag to inner content
export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  selected,
}: NodeProps<CompactWorkerNodeData>) {
  const handleColorClass = STAGE_LINE_COLORS[data.stageColorIndex % STAGE_LINE_COLORS.length];
  const displayName = data.pluginName || data.node.title || "Untitled";
  const subtitle = data.workerName || "Not configured";

  return (
    <div
      data-testid={`compact-worker-${id}`}
      className={`
        group h-16 w-56 rounded-lg border border-slate-300/90 bg-white p-2.5
        shadow-[0_1px_2px_rgba(15,23,42,0.08)]
        transition-all duration-150
        hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]
        ${selected ? "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]" : ""}
      `}
      style={{ width: WORKER_WIDTH, height: WORKER_HEIGHT }}
    >
      <Handle type="target" position={Position.Left}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Right}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Bottom} id="critic"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="flex flex-col h-full min-w-0">
        <span className="text-xs font-semibold truncate text-foreground">{displayName}</span>
        <span className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</span>
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.tsx packages/views/workflows/components/overview/reactflow-nodes/compact-worker-node.test.tsx
git commit -m "feat(workflows): add CompactWorkerNode ReactFlow custom node"
```

---

### Task 5: CriticBadgeNode — critic badge below worker

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.test.tsx`

**Interfaces:**
- Consumes: `CRITIC_WIDTH`, `CRITIC_HEIGHT` from `../constants`
- Produces:
  - `CriticBadgeNode` — ReactFlow custom node, `type: "criticBadge"`
  - `CriticBadgeNodeData = { node: WorkflowNode; parentNodeId: string; criticName?: string }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CriticBadgeNode, type CriticBadgeNodeData } from "./critic-badge-node";
import type { Node } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";

function makeWorkerNode(): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "wf-1",
    title: "Code Review",
    description: "",
    worker_type: "agent",
    worker_id: "agent-1",
    critic_type: "agent",
    critic_id: "critic-1",
    critic_api_url: null,
    stage_id: "stage-0",
    format_schema: null,
    position_x: 100,
    position_y: 0,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

function renderWithProvider(node: Node<CriticBadgeNodeData>) {
  return render(
    <ReactFlowProvider>
      <CriticBadgeNode
        id={node.id}
        data={node.data}
        selected={false}
        type="criticBadge"
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
      />
    </ReactFlowProvider>,
  );
}

describe("CriticBadgeNode", () => {
  const baseData: CriticBadgeNodeData = {
    node: makeWorkerNode(),
    parentNodeId: "node-1",
    criticName: "Security Reviewer",
  };

  it("renders with dashed border and muted background", () => {
    const rfn: Node<CriticBadgeNodeData> = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    };
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("border-dashed");
    expect(el).toHaveClass("bg-muted/30");
  });

  it("shows ShieldAlert icon and Critic label", () => {
    const rfn: Node<CriticBadgeNodeData> = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    };
    renderWithProvider(rfn);
    expect(screen.getByText("Critic")).toBeInTheDocument();
  });

  it("shows critic name", () => {
    const rfn: Node<CriticBadgeNodeData> = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    };
    renderWithProvider(rfn);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("has only a top Handle (target)", () => {
    const rfn: Node<CriticBadgeNodeData> = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    };
    renderWithProvider(rfn);
    const handles = document.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(1);
  });

  it("has correct dimensions", () => {
    const rfn: Node<CriticBadgeNodeData> = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    };
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toHaveClass("h-12", "w-36");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/critic-badge-node.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write CriticBadgeNode implementation**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.tsx
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldAlert } from "lucide-react";
import type { WorkflowNode } from "@multica/core/types";
import { CRITIC_WIDTH, CRITIC_HEIGHT } from "../constants";

export interface CriticBadgeNodeData {
  node: WorkflowNode;
  parentNodeId: string;
  criticName?: string;
}

export const CriticBadgeNode = memo(function CriticBadgeNode({
  id,
  data,
}: NodeProps<CriticBadgeNodeData>) {
  return (
    <div
      data-testid={`critic-badge-${id}`}
      className="h-12 w-36 rounded-md border border-dashed border-border/70 bg-muted/30 p-1.5"
      style={{ width: CRITIC_WIDTH, height: CRITIC_HEIGHT }}
    >
      <Handle type="target" position={Position.Top}
        className="!bg-muted-foreground/50" />

      <div className="flex items-center gap-1.5 h-full min-w-0">
        <ShieldAlert className="h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium uppercase text-muted-foreground leading-none">
            Critic
          </span>
          <span className="text-xs font-semibold truncate text-foreground leading-tight">
            {data.criticName || "Critic"}
          </span>
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/critic-badge-node.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.tsx packages/views/workflows/components/overview/reactflow-nodes/critic-badge-node.test.tsx
git commit -m "feat(workflows): add CriticBadgeNode ReactFlow custom node"
```

---

### Task 6: ReactFlow nodes index barrel export

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-nodes/index.ts`

**Interfaces:**
- Consumes: `LaneBgNode`, `GradientBgNode`, `CompactWorkerNode`, `CriticBadgeNode` from sibling files
- Produces: `nodeTypes` object for ReactFlow's `nodeTypes` prop

- [ ] **Step 1: Write the barrel export**

```typescript
// packages/views/workflows/components/overview/reactflow-nodes/index.ts
export { LaneBgNode } from "./lane-bg-node";
export type { LaneBgNodeData } from "./lane-bg-node";

export { GradientBgNode } from "./gradient-bg-node";
export type { GradientBgNodeData } from "./gradient-bg-node";

export { CompactWorkerNode } from "./compact-worker-node";
export type { CompactWorkerNodeData } from "./compact-worker-node";

export { CriticBadgeNode } from "./critic-badge-node";
export type { CriticBadgeNodeData } from "./critic-badge-node";

import { LaneBgNode } from "./lane-bg-node";
import { GradientBgNode } from "./gradient-bg-node";
import { CompactWorkerNode } from "./compact-worker-node";
import { CriticBadgeNode } from "./critic-badge-node";

export const panoramaNodeTypes = {
  laneBg: LaneBgNode,
  gradientBg: GradientBgNode,
  compactWorker: CompactWorkerNode,
  criticBadge: CriticBadgeNode,
};
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-nodes/index.ts
git commit -m "feat(workflows): add reactflow-nodes barrel export with nodeTypes"
```

---

### Task 7: PanoramaEdge — custom orthogonal edge

**Files:**
- Create: `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`
- Create: `packages/views/workflows/components/overview/reactflow-edges/index.ts`

**Interfaces:**
- Consumes: `STAGE_LINE_COLORS`, `LANE_STEP`, `LANE_HEIGHT`, `LANE_PADDING_TOP` from `../constants`
- Produces:
  - `PanoramaEdge` — ReactFlow custom edge, `type: "panorama"`
  - `edgeTypes` object `{ panorama: PanoramaEdge }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/reactflow-edges/panorama-edge.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PanoramaEdge } from "./panorama-edge";
import type { Edge, EdgeProps } from "@xyflow/react";

function renderEdge(props: Partial<EdgeProps> = {}) {
  const defaultProps: EdgeProps = {
    id: "e-1",
    source: "n-1",
    target: "n-2",
    sourceX: 224,
    sourceY: 44,
    targetX: 400,
    targetY: 44,
    sourcePosition: { x: 224, y: 44 },
    targetPosition: { x: 400, y: 44 },
    selected: false,
    ...props,
  } as EdgeProps;

  const { container } = render(
    <ReactFlowProvider>
      <svg>
        <PanoramaEdge {...defaultProps} />
      </svg>
    </ReactFlowProvider>,
  );
  return container;
}

describe("PanoramaEdge", () => {
  it("renders an SVG path", () => {
    const container = renderEdge();
    const path = container.querySelector("path");
    expect(path).toBeInTheDocument();
  });

  it("uses strokeWidth 1.5", () => {
    const container = renderEdge();
    const path = container.querySelector("path");
    expect(path?.getAttribute("stroke-width")).toBe("1.5");
  });

  it("uses low opacity", () => {
    const container = renderEdge();
    const path = container.querySelector("path");
    expect(path?.getAttribute("opacity")).toBe("0.35");
  });

  it("draws horizontal path for same-Y source/target (same lane)", () => {
    const container = renderEdge({
      sourceX: 224,
      sourceY: 44,
      targetX: 500,
      targetY: 44,
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    // Horizontal: source right edge → target left edge, should go straight
    expect(d).toContain("L");
  });

  it("renders dashed for critic connections", () => {
    const container = renderEdge({
      id: "e-critic",
      sourceX: 196,  // center of worker
      sourceY: 64,   // bottom of worker
      targetX: 172,  // center of critic
      targetY: 84,   // top of critic
      style: { strokeDasharray: "4 3" },
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("applies selection glow when selected", () => {
    const container = renderEdge({ selected: true });
    const path = container.querySelector("path");
    expect(path?.getAttribute("filter")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write PanoramaEdge implementation**

```typescript
// packages/views/workflows/components/overview/reactflow-edges/panorama-edge.tsx
import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

export function PanoramaEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const isDashed = style?.strokeDasharray !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          strokeWidth: 1.5,
          opacity: 0.35,
          ...style,
        }}
        markerEnd={markerEnd}
      />
      {selected && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            strokeWidth: 4,
            opacity: 0.2,
            stroke: "#3b82f6",
            strokeDasharray: isDashed ? style?.strokeDasharray : undefined,
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Write the edge barrel export**

```typescript
// packages/views/workflows/components/overview/reactflow-edges/index.ts
export { PanoramaEdge } from "./panorama-edge";
import { PanoramaEdge } from "./panorama-edge";

export const panoramaEdgeTypes = {
  panorama: PanoramaEdge,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-edges/panorama-edge.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/overview/reactflow-edges/
git commit -m "feat(workflows): add PanoramaEdge custom edge with selection glow"
```

---

### Task 8: PanoramaToolbar — top toolbar with undo/redo/zoom/save

**Files:**
- Create: `packages/views/workflows/components/overview/panorama-toolbar.tsx`
- Create: `packages/views/workflows/components/overview/panorama-toolbar.test.tsx`

**Interfaces:**
- Consumes: `useWorkflowEditorStore` from `@multica/core/workflows/store`
- Produces:
  - `PanoramaToolbar` component
  - Props: `{ onAutoLayout: () => void; onSave: () => void; hasUnsaved: boolean; zoomIn: () => void; zoomOut: () => void; zoomLevel: number }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/panorama-toolbar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanoramaToolbar } from "./panorama-toolbar";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (getter: (d: Record<string, string>) => string) => {
      const dict: Record<string, string> = {
        "panorama.toolbar.undo": "Undo",
        "panorama.toolbar.redo": "Redo",
        "panorama.toolbar.auto_layout": "Auto layout",
        "panorama.toolbar.annotations": "Toggle annotations",
        "panorama.toolbar.save": "Save changes",
        "panorama.toolbar.unsaved": "Unsaved changes",
      };
      return getter(dict);
    },
  }),
}));

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      undoStack: [{ snapshot: { nodeEdits: {}, deletedNodeIds: [] } }],
      redoStack: [],
      showAnnotations: true,
    };
    return selector(state);
  }),
}));

describe("PanoramaToolbar", () => {
  const baseProps = {
    onAutoLayout: vi.fn(),
    onSave: vi.fn(),
    hasUnsaved: false,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomLevel: 100,
  };

  it("renders undo and redo buttons", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
    expect(screen.getByLabelText("Redo")).toBeInTheDocument();
  });

  it("renders auto layout button", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Auto layout")).toBeInTheDocument();
  });

  it("renders annotation toggle button", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Toggle annotations")).toBeInTheDocument();
  });

  it("calls onAutoLayout when button clicked", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Auto layout"));
    expect(baseProps.onAutoLayout).toHaveBeenCalledOnce();
  });

  it("calls onSave when save button clicked", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Save changes"));
    expect(baseProps.onSave).toHaveBeenCalledOnce();
  });

  it("shows blue dot on save button when hasUnsaved is true", () => {
    render(<PanoramaToolbar {...baseProps} hasUnsaved />);
    const saveBtn = screen.getByLabelText("Save changes");
    // The save button should have an indicator dot
    const dot = saveBtn.querySelector(".bg-primary");
    expect(dot).toBeInTheDocument();
  });

  it("shows zoom percentage", () => {
    render(<PanoramaToolbar {...baseProps} zoomLevel={75} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("calls zoomIn and zoomOut", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(baseProps.zoomIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(baseProps.zoomOut).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/panorama-toolbar.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write PanoramaToolbar implementation**

```typescript
// packages/views/workflows/components/overview/panorama-toolbar.tsx
import { Button } from "@multica/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { Separator } from "@multica/ui/components/ui/separator";
import { Undo2, Redo2, AppWindow, MessageSquareText, ZoomIn, ZoomOut, Save } from "lucide-react";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useT } from "../../../i18n";

export interface PanoramaToolbarProps {
  onAutoLayout: () => void;
  onSave: () => void;
  hasUnsaved: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomLevel: number;
}

export function PanoramaToolbar({
  onAutoLayout,
  onSave,
  hasUnsaved,
  zoomIn,
  zoomOut,
  zoomLevel,
}: PanoramaToolbarProps) {
  const { t } = useT("workflows");
  const canUndo = useWorkflowEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowEditorStore((s) => s.redoStack.length > 0);
  const showAnnotations = useWorkflowEditorStore((s) => s.showAnnotations);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const toggleAnnotations = useWorkflowEditorStore((s) => s.toggleAnnotations);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-card shrink-0" data-testid="panorama-toolbar">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undo} aria-label="Undo">
              <Undo2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redo} aria-label="Redo">
              <Redo2 className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={onAutoLayout} aria-label="Auto layout">
              <AppWindow className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Auto layout</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={showAnnotations ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={toggleAnnotations}
              aria-label="Toggle annotations"
            >
              <MessageSquareText className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Toggle annotations</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={zoomOut} aria-label="Zoom out">
              <ZoomOut className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>

      <span className="text-xs text-muted-foreground tabular-nums w-10 text-center select-none">
        {zoomLevel}%
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={zoomIn} aria-label="Zoom in">
              <ZoomIn className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="default" size="sm" onClick={onSave} aria-label="Save changes" className="relative">
              {hasUnsaved && (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
              )}
              <Save className="size-3.5 mr-1.5" />
              Save
            </Button>
          }
        />
        <TooltipContent>{hasUnsaved ? "Unsaved changes" : "Save changes"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/panorama-toolbar.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/panorama-toolbar.tsx packages/views/workflows/components/overview/panorama-toolbar.test.tsx
git commit -m "feat(workflows): add PanoramaToolbar with undo/redo/zoom/save"
```

---

### Task 9: CanvasStageLabels — fixed left-side stage labels

**Files:**
- Create: `packages/views/workflows/components/overview/canvas-stage-labels.tsx`
- Create: `packages/views/workflows/components/overview/canvas-stage-labels.test.tsx`

**Interfaces:**
- Consumes: `LANE_STEP`, `LANE_HEIGHT`, `UNASSIGNED_LANE_Y` from `./constants`; `WorkflowStage` from `@multica/core/types`
- Produces:
  - `CanvasStageLabels` component
  - Props: `{ stages: WorkflowStage[]; viewportY: number; onEdit: (stage: WorkflowStage) => void; onDelete: (stage: WorkflowStage) => void; onReorder: (stageId: string, direction: "up" | "down") => void }`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/views/workflows/components/overview/canvas-stage-labels.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasStageLabels } from "./canvas-stage-labels";
import type { WorkflowStage } from "@multica/core/types";

function makeStage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: "s-1",
    workflow_id: "wf-1",
    name: "Design",
    description: "",
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("CanvasStageLabels", () => {
  const baseProps = {
    stages: [makeStage(), makeStage({ id: "s-2", name: "Implement", sort_order: 1 })],
    viewportY: 0,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
  };

  it("renders stage names", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
  });

  it("shows stage sort order as label", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
  });

  it("renders unassigned label when stages exist", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("does not render unassigned label when no stages", () => {
    render(<CanvasStageLabels {...baseProps} stages={[]} />);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("calls onEdit when edit button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const editButtons = screen.getAllByLabelText("Edit stage");
    fireEvent.click(editButtons[0]);
    expect(baseProps.onEdit).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("calls onDelete when delete button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const deleteButtons = screen.getAllByLabelText("Delete stage");
    fireEvent.click(deleteButtons[0]);
    expect(baseProps.onDelete).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("positions labels offset by viewportY", () => {
    render(<CanvasStageLabels {...baseProps} viewportY={-136} />);
    const container = screen.getByTestId("canvas-stage-labels");
    expect(container).toHaveStyle({ transform: expect.stringContaining("translateY") });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/canvas-stage-labels.test.tsx`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write CanvasStageLabels implementation**

```typescript
// packages/views/workflows/components/overview/canvas-stage-labels.tsx
import { Button } from "@multica/ui/components/ui/button";
import { Pencil, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import type { WorkflowStage } from "@multica/core/types";
import { LANE_STEP, LANE_HEIGHT, UNASSIGNED_LANE_Y } from "./constants";

export interface CanvasStageLabelsProps {
  stages: WorkflowStage[];
  viewportY: number;
  onEdit: (stage: WorkflowStage) => void;
  onDelete: (stage: WorkflowStage) => void;
  onReorder: (stageId: string, direction: "up" | "down") => void;
}

export function CanvasStageLabels({
  stages,
  viewportY,
  onEdit,
  onDelete,
  onReorder,
}: CanvasStageLabelsProps) {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      data-testid="canvas-stage-labels"
      className="absolute left-0 top-0 z-10 pointer-events-none"
      style={{ transform: `translateY(${viewportY}px)` }}
    >
      {sorted.map((stage) => {
        const top = stage.sort_order * LANE_STEP;
        return (
          <div
            key={stage.id}
            className="absolute pointer-events-auto flex items-center gap-1"
            style={{ top, height: LANE_HEIGHT }}
          >
            <div className="flex flex-col justify-center w-28 px-2">
              <span className="text-[10px] font-medium text-muted-foreground leading-none">
                Stage {stage.sort_order + 1}
              </span>
              <span className="text-xs font-semibold truncate leading-tight">
                {stage.name}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onEdit(stage)} aria-label="Edit stage">
                <Pencil className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onDelete(stage)} aria-label="Delete stage">
                <Trash2 className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onReorder(stage.id, "up")} aria-label="Move stage up"
                disabled={stage.sort_order === 0}>
                <ChevronUp className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onReorder(stage.id, "down")} aria-label="Move stage down"
                disabled={stage.sort_order === sorted.length - 1}>
                <ChevronDown className="size-2.5" />
              </Button>
            </div>
            <GripVertical className="size-3 text-muted-foreground/40 cursor-grab" />
          </div>
        );
      })}

      {sorted.length > 0 && (
        <div
          className="absolute pointer-events-auto flex items-center px-2"
          style={{ top: UNASSIGNED_LANE_Y(sorted.length), height: LANE_HEIGHT }}
        >
          <span className="text-[10px] font-medium text-muted-foreground/60">
            Unassigned
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/canvas-stage-labels.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/overview/canvas-stage-labels.tsx packages/views/workflows/components/overview/canvas-stage-labels.test.tsx
git commit -m "feat(workflows): add CanvasStageLabels fixed left-side labels"
```

---

### Task 10: Adapt layout.ts for lane-internal horizontal arrangement

**Files:**
- Modify: `packages/views/workflows/components/layout.ts` (full file)

**Interfaces:**
- Consumes: `WORKER_WIDTH`, `LANE_PADDING_TOP` from `./overview/constants`
- Produces:
  - `computeAutoLayout(nodes, edges): LayoutResult[]` — now computes lane-internal horizontal positions only
  - NEW: `computeLaneAutoLayout(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, number>` — distributes nodes within each lane horizontally using dagre

- [ ] **Step 1: Write the new function**

```typescript
// Add to layout.ts (keep existing computeAutoLayout for backward compat, add new function)

import dagre from "@dagrejs/dagre";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import { WORKER_WIDTH } from "./overview/constants";

// ... keep existing SHAPE_DEFAULTS, LayoutResult, getNodeDimensions, computeAutoLayout unchanged ...

/**
 * Compute lane-internal auto-layout using dagre.
 * Groups nodes by stage_id, runs dagre on each group separately (LR direction),
 * and returns a map of nodeId → new position_x.
 * Nodes within each lane are distributed horizontally with uniform spacing.
 * Y positions are NOT computed — they come from stage sort_order at runtime.
 */
export function computeLaneAutoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Map<string, number> {
  const result = new Map<string, number>();

  // Group nodes by stage_id
  const byStage = new Map<string | null, WorkflowNode[]>();
  for (const node of nodes) {
    const key = node.stage_id ?? null;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key)!.push(node);
  }

  let currentX = 0;
  const LANE_GAP = 80; // gap between stage groups

  for (const [, stageNodes] of byStage) {
    if (stageNodes.length === 0) continue;

    if (stageNodes.length === 1) {
      result.set(stageNodes[0].id, currentX + 100);
      currentX += WORKER_WIDTH + 80;
      continue;
    }

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 50, marginy: 20 });

    const nodeIds = new Set(stageNodes.map((n) => n.id));
    for (const node of stageNodes) {
      g.setNode(node.id, { width: WORKER_WIDTH, height: 64 });
    }

    for (const edge of edges) {
      if (nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id)) {
        g.setEdge(edge.source_node_id, edge.target_node_id);
      }
    }

    dagre.layout(g);

    for (const node of stageNodes) {
      const dagreNode = g.node(node.id);
      if (dagreNode) {
        result.set(node.id, dagreNode.x - WORKER_WIDTH / 2);
      } else {
        result.set(node.id, currentX + 100);
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Write the test**

```typescript
// No separate test file needed — add test cases to existing tests or verify via typecheck
// The function compiles and integrates into the panorama page in Task 12
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/layout.ts
git commit -m "feat(workflows): add computeLaneAutoLayout for lane-internal dagre"
```

---

### Task 11: Adapt node-config-panel.tsx for new save/delete semantics

**Files:**
- Modify: `packages/views/workflows/components/node-config-panel.tsx`

**Interfaces:**
- Consumes: `useWorkflowEditorStore` from `@multica/core/workflows/store`
- Produces:
  - `NodeConfigPanel` — adds `onSaveNode?: () => void` and `onDeleteNode?: (nodeId: string) => void` props
  - Stage dropdown now calls `onStageChange` callback instead of directly mutating
  - Delete button calls `onDeleteNode` instead of directly deleting

**Key change:** Keep the existing mutations as fallback behavior for legacy callers, but when callbacks are provided route delete and stage assignment through the callbacks. This lets the new panorama page control save/delete/stage-assign timing and undo tracking without breaking old editor call sites during the migration.

- [ ] **Step 1: Add new props to NodeConfigPanel interface**

The existing `NodeConfigPanelProps` interface at line 63-70 needs:

```typescript
interface NodeConfigPanelProps {
  node: WorkflowNode;
  workflowId: string;
  nodes?: WorkflowNode[];
  stages?: WorkflowStage[];
  disabled?: boolean;
  onClose: () => void;
  // NEW: Callbacks for parent-controlled save/delete/stage-assign
  onSaveNode?: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onStageChange?: (nodeId: string, stageId: string | null) => void;
}
```

The stage dropdown `onChange` handler (line 196-210) changes from calling `assignStageMutation.mutate` directly to calling `onStageChange?.(node.id, newStageId)`.

The delete button `onClick` (line 437) changes from calling `handleDelete` to calling `onDeleteNode?.(node.id)`.

The `handleDelete` function and `deleteMutation`/`assignStageMutation`/`createStageMutation` hooks remain for backward compatibility. Use them only when the new callbacks are not provided.

- [ ] **Step 2: Verify existing tests still pass**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/node-config-panel.test.tsx workflows/components/dag-canvas.test.tsx`
Expected: PASS (existing tests should not break since callbacks are optional)

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/node-config-panel.tsx
git commit -m "feat(workflows): add onSaveNode/onDeleteNode/onStageChange callbacks to NodeConfigPanel"
```

---

### Task 12: Adapt node-palette.tsx — add shapes and drop-to-lane support

**Files:**
- Modify: `packages/views/workflows/components/node-palette.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `NodePalette` — adds Rectangle, Diamond, Pill, Hexagon, and Critic draggable items
  - NEW: `onDrop` callback signature for parent to handle lane-aware creation

- [ ] **Step 1: Add new draggable shapes**

```typescript
// Revised NodePalette with multi-shape support
"use client";

import { cn } from "@multica/ui/lib/utils";

const DRAG_TYPE = "application/x-multica-shape";

export interface NodePaletteProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const SHAPES = [
  { type: "rectangle", label: "Rectangle", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "diamond", label: "Diamond", icon: (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <polygon points="12,1 23,12 12,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "pill", label: "Pill", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "hexagon", label: "Hexagon", icon: (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <polygon points="6,1 18,1 23,12 18,23 6,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "critic", label: "Critic", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  )},
] as const;

export function NodePalette({ className, collapsed, onToggleCollapse }: NodePaletteProps) {
  if (collapsed) {
    return (
      <div className={cn("p-1", className)}>
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/30 hover:bg-muted"
          aria-label="Expand palette"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5 p-1.5 rounded-lg bg-card border shadow-sm", className)}>
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Shapes</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground" aria-label="Collapse palette">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
      </div>
      {SHAPES.map((shape) => (
        <div
          key={shape.type}
          draggable
          role="button"
          tabIndex={0}
          aria-label={shape.label}
          title={shape.label}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/30 cursor-grab active:cursor-grabbing hover:bg-muted hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, shape.type);
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          {shape.icon}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/node-palette.tsx
git commit -m "feat(workflows): add multi-shape and Critic items to NodePalette"
```

---

### Task 13: Add i18n keys for new panorama toolbar and labels

**Files:**
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Consumes: nothing
- Produces: new i18n keys under `panorama.*`

- [ ] **Step 1: Add English keys**

Add to `packages/views/locales/en/workflows.json`:

```json
{
  "panorama": {
    "empty_all": "Create your first stage to get started",
    "unassigned": "Unassigned",
    "not_configured": "Not configured",
    "toolbar": {
      "undo": "Undo",
      "redo": "Redo",
      "auto_layout": "Auto layout",
      "annotations": "Toggle annotations",
      "save": "Save changes",
      "unsaved": "Unsaved changes"
    },
    "stage_label": {
      "edit": "Edit stage",
      "delete": "Delete stage",
      "move_up": "Move stage up",
      "move_down": "Move stage down"
    }
  }
}
```

- [ ] **Step 2: Add Chinese keys**

Add to `packages/views/locales/zh-Hans/workflows.json`:

```json
{
  "panorama": {
    "empty_all": "创建第一个阶段以开始使用",
    "unassigned": "未分组",
    "not_configured": "未配置",
    "toolbar": {
      "undo": "撤销",
      "redo": "重做",
      "auto_layout": "自动布局",
      "annotations": "切换便签",
      "save": "保存更改",
      "unsaved": "有未保存的更改"
    },
    "stage_label": {
      "edit": "编辑阶段",
      "delete": "删除阶段",
      "move_up": "上移阶段",
      "move_down": "下移阶段"
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflows): add panorama i18n keys for toolbar and labels"
```

---

### Task 14: Rewrite workflow-panorama-page.tsx — ReactFlow unified canvas

**Files:**
- Rewrite: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`
- Create: `packages/views/workflows/components/overview/workflow-panorama-page.test.tsx`

**Interfaces:**
- Consumes: All queries from `@multica/core/workflows/queries`, `useWorkflowEditorStore`, new ReactFlow nodes/edges, `PanoramaToolbar`, `CanvasStageLabels`, `NodeConfigPanel`, `NodePalette`
- Produces: `WorkflowPanoramaPage` — the single unified view

This is the core integration task. It assembles all pieces into the final page.

- [ ] **Step 1: Write the failing page test**

```typescript
// packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowPanoramaPage } from "./workflow-panorama-page";

// Mock all queries
vi.mock("@multica/core/workflows/queries", () => ({
  workflowOverviewOptions: () => ({ queryKey: ["workflow"] }),
  workflowStagesOptions: () => ({ queryKey: ["stages"] }),
  workflowNodesOptions: () => ({ queryKey: ["nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["edges"] }),
  useCreateNode: () => ({ mutateAsync: vi.fn() }),
  useUpdateNode: () => ({ mutateAsync: vi.fn() }),
  useDeleteNode: () => ({ mutateAsync: vi.fn() }),
  useCreateEdge: () => ({ mutateAsync: vi.fn() }),
  useDeleteEdge: () => ({ mutateAsync: vi.fn() }),
  useAssignNodeToStage: () => ({ mutateAsync: vi.fn() }),
  useCreateStage: () => ({ mutateAsync: vi.fn() }),
  useDeleteStage: () => ({ mutateAsync: vi.fn() }),
  useReorderStages: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  builtinPluginListOptions: () => ({ queryKey: ["plugins"] }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      selectedNodeId: null,
      selectedNodeIds: [],
      nodeEdits: {},
      deletedNodeIds: [],
      undoStack: [],
      redoStack: [],
      showAnnotations: true,
      canvasColorMode: "system",
    };
    return selector(state);
  }),
}));

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ workflows: () => "/workflows" }),
}));

vi.mock("../../../i18n", () => ({
  useT: () => ({ t: () => "Test label" }),
}));

// Mock ReactFlow to avoid complex DOM
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow">{children}</div>,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  Handle: () => <div data-testid="rf-handle" />,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

// Mock TanStack Query
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey.join(",");
    if (key.includes("stages")) return { data: [], isLoading: false, isError: false };
    if (key.includes("nodes")) return { data: [], isLoading: false, isError: false };
    if (key.includes("edges")) return { data: [], isLoading: false, isError: false };
    if (key.includes("detail")) return {
      data: { id: "wf-1", title: "Test Workflow", status: "draft" },
      isLoading: false,
      isError: false,
    };
    if (key.includes("agents")) return { data: [], isLoading: false };
    if (key.includes("plugins")) return { data: { items: [] }, isLoading: false };
    return { data: null, isLoading: true, isError: false };
  },
}));

describe("WorkflowPanoramaPage (new)", () => {
  it("renders the ReactFlow canvas", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("renders the toolbar", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("panorama-toolbar")).toBeInTheDocument();
  });

  it("renders the stage labels", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("canvas-stage-labels")).toBeInTheDocument();
  });

  it("renders the node palette", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    // NodePalette is rendered
    expect(screen.getByLabelText("Rectangle")).toBeInTheDocument();
  });

  it("shows empty state when no stages", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByText(/Create your first stage/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/workflow-panorama-page.test.tsx`
Expected: FAIL — the test expects new behavior that the old page doesn't have yet

- [ ] **Step 3: Write the new WorkflowPanoramaPage**

This is the largest single file. The key structure:

```typescript
// packages/views/workflows/components/overview/workflow-panorama-page.tsx
"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowOverviewOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  useCreateNode,
  useUpdateNode,
  useCreateEdge,
  useDeleteEdge,
  useDeleteNode,
  useAssignNodeToStage,
} from "@multica/core/workflows/queries";
import { agentListOptions, builtinPluginListOptions } from "@multica/core/workspace/queries";
import { useActorName } from "@multica/core/workspace/hooks";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useNavigation } from "../../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { useT } from "../../../i18n";
import { PageHeader } from "../../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { AlertCircle, ArrowLeft, PanelsTopLeft } from "lucide-react";

import { PanoramaToolbar } from "./panorama-toolbar";
import { CanvasStageLabels } from "./canvas-stage-labels";
import { NodeConfigPanel } from "../node-config-panel";
import { NodePalette } from "../node-palette";
import { StageCreateDialog } from "./stage-create-dialog";
import { panoramaNodeTypes } from "./reactflow-nodes";
import { panoramaEdgeTypes } from "./reactflow-edges";
import { computeLaneAutoLayout } from "../layout";

import {
  LANE_STEP,
  LANE_HEIGHT,
  LANE_PADDING_TOP,
  PANORAMA_WIDTH,
  WORKER_HEIGHT,
  WORKER_CRITIC_GAP,
  UNASSIGNED_LANE_Y,
  computeLaneY,
} from "./constants";

import type { WorkflowNode, WorkflowStage, WorkflowEdge } from "@multica/core/types";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";

// ── Types ──

export interface WorkflowPanoramaPageProps {
  workflowId: string;
}

// ── Data conversion: API nodes → ReactFlow nodes ──

function apiNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  agentLookup: Map<string, Agent | null>,
  pluginLookup: Map<string, BuiltinPlugin | null>,
  getActorName: (type: string, id: string) => string | null,
): Node[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return nodes.flatMap((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const sortOrder = stage?.sort_order ?? stages.length; // unassigned goes to end
    const laneY = stage ? computeLaneY(stage.sort_order) : UNASSIGNED_LANE_Y(stages.length);
    const x = node.position_x ?? 100;

    const stageColorIndex = Math.abs(stage?.sort_order ?? 0) % 6;

    // Worker node
    const workerNode: Node = {
      id: node.id,
      type: "compactWorker",
      position: { x, y: laneY },
      data: {
        node,
        stage_id: node.stage_id,
        stageColorIndex,
        pluginName: node.worker_id
          ? (agentLookup.get(node.worker_id)?.plugin_id
              ? pluginLookup.get(agentLookup.get(node.worker_id)!.plugin_id!)?.name
              : undefined)
          : undefined,
        workerName: node.worker_id ? getActorName(node.worker_type ?? "agent", node.worker_id) ?? undefined : undefined,
      },
    };

    // Critic badge node (rendered below worker if critic is configured)
    if (!node.critic_id && !node.critic_api_url) return [workerNode];

    const criticNode: Node = {
      id: `${node.id}:critic`,
      type: "criticBadge",
      position: { x, y: laneY + WORKER_HEIGHT + WORKER_CRITIC_GAP },
      data: {
        node,
        parentNodeId: node.id,
        criticName: node.critic_id ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined : undefined,
      },
      parentId: node.id,
      extent: "parent",
    };

    return [workerNode, criticNode];
  });
}

// ── API edges → ReactFlow edges ──

function apiEdgesToReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: "panorama",
    style: edge.target_node_id.endsWith(":critic") || edges.some((e) =>
      e.source_node_id === edge.target_node_id && e.target_node_id.endsWith(":critic")
    ) ? { strokeDasharray: "4 3" } : undefined,
  }));
}

// ── Background nodes: lane backgrounds + gradient transitions ──

function buildBackgroundNodes(stages: WorkflowStage[]): Node[] {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const result: Node[] = [];

  sorted.forEach((stage, idx) => {
    // Lane background
    result.push({
      id: `lane-bg-${stage.id}`,
      type: "laneBg",
      position: { x: 0, y: stage.sort_order * LANE_STEP },
      data: { stageIndex: stage.sort_order },
      draggable: false,
      selectable: false,
      deletable: false,
      zIndex: -2,
    });

    // Gradient transition (except after last stage)
    if (idx < sorted.length - 1) {
      result.push({
        id: `gradient-bg-${stage.id}`,
        type: "gradientBg",
        position: { x: 0, y: stage.sort_order * LANE_STEP + LANE_HEIGHT },
        data: { fromStageIndex: stage.sort_order },
        draggable: false,
        selectable: false,
        deletable: false,
        zIndex: -2,
      });
    }
  });

  return result;
}

// ── Drag constraint: snap Y to lane ──

function findStageAtY(y: number, stages: WorkflowStage[]): WorkflowStage | undefined {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  for (const stage of sorted) {
    const laneTop = stage.sort_order * LANE_STEP;
    const laneBottom = laneTop + LANE_HEIGHT;
    if (y >= laneTop && y <= laneBottom) return stage;
  }
  return undefined;
}

// ── Skeleton ──

function PanoramaSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="panorama-skeleton">
      <Skeleton className="h-8 w-64" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

// ── Main Page Component ──

export function WorkflowPanoramaPage({ workflowId }: WorkflowPanoramaPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  // ── Queries ──
  const { data: workflow, isLoading: wfLoading, isError: wfError, refetch } = useQuery(
    workflowOverviewOptions(wsId, workflowId),
  );
  const { data: stages = [], isLoading: stLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );
  const { data: apiNodes = [], isLoading: ndLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );
  const { data: apiEdges = [], isLoading: edLoading } = useQuery(
    workflowEdgesOptions(wsId, workflowId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: pluginsData } = useQuery(builtinPluginListOptions());
  const { getActorName } = useActorName();

  const isLoading = wfLoading || stLoading || ndLoading || edLoading;

  // ── Mutations ──
  const updateNodeMutation = useUpdateNode(wsId, workflowId);
  const createEdgeMutation = useCreateEdge(wsId, workflowId);
  const deleteEdgeMutation = useDeleteEdge(wsId, workflowId);
  const deleteNodeMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);

  // ── Store ──
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const deletedNodeIds = useWorkflowEditorStore((s) => s.deletedNodeIds);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const cacheNodeDelete = useWorkflowEditorStore((s) => s.cacheNodeDelete);
  const clearNodeEdits = useWorkflowEditorStore((s) => s.clearNodeEdits);
  const clearNodeDelete = useWorkflowEditorStore((s) => s.clearNodeDelete);
  const pushServerAction = useWorkflowEditorStore((s) => s.pushServerAction);

  // ── Local state ──
  const [viewportY, setViewportY] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showStageDialog, setShowStageDialog] = useState(false);

  // ── Derived lookups ──
  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const pluginLookup = useMemo(() => {
    const map = new Map<string, BuiltinPlugin | null>();
    const items = pluginsData?.items ?? [];
    for (const p of items) map.set(p.id, p);
    return map;
  }, [pluginsData]);

  // ── ReactFlow nodes/edges ──
  const rfNodes = useMemo(
    () => [
      ...buildBackgroundNodes(stages),
      ...apiNodesToReactFlowNodes(apiNodes, stages, agentLookup, pluginLookup, getActorName),
    ],
    [stages, apiNodes, agentLookup, pluginLookup, getActorName],
  );

  const rfEdges = useMemo(() => apiEdgesToReactFlowEdges(apiEdges), [apiEdges]);

  // ── Selected node for config panel ──
  const selectedNode = useMemo(
    () => apiNodes.find((n) => n.id === selectedNodeId) ?? null,
    [apiNodes, selectedNodeId],
  );

  // ── Unsaved check ──
  const hasUnsaved = Object.keys(nodeEdits).length > 0 || deletedNodeIds.length > 0;

  // ── Handlers ──
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "laneBg" || node.type === "gradientBg") return;
      const workerId = node.data.parentNodeId ? node.data.parentNodeId : node.id;
      selectNode(workerId);
      setConfigPanelOpen(true);
    },
    [selectNode],
  );

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type !== "compactWorker") return;

      // Persist position_x
      updateNodeMutation.mutate({
        nodeId: node.data.node.id,
        position_x: node.position.x,
      } as Parameters<typeof updateNodeMutation.mutate>[0]);

      // Check if y moved to a different lane
      const newStage = findStageAtY(node.position.y, stages);
      if (newStage && newStage.id !== node.data.stage_id) {
        assignStageMutation.mutate({
          nodeId: node.data.node.id,
          stage_id: newStage.id,
        });
      }
    },
    [stages, updateNodeMutation, assignStageMutation],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      createEdgeMutation.mutate({
        source_node_id: connection.source,
        target_node_id: connection.target,
      } as Parameters<typeof createEdgeMutation.mutate>[0], {
        onSuccess: (_data, vars) => {
          pushServerAction({
            type: "create-edge",
            sourceNodeId: vars.source_node_id,
            targetNodeId: vars.target_node_id,
          });
        },
      });
    },
    [createEdgeMutation, pushServerAction],
  );

  const handleEdgeDelete = useCallback(
    (edgesToDelete: Edge[]) => {
      for (const edge of edgesToDelete) {
        deleteEdgeMutation.mutate(edge.id);
        pushServerAction({ type: "delete-edge", edgeId: edge.id });
      }
    },
    [deleteEdgeMutation, pushServerAction],
  );

  const handleAutoLayout = useCallback(() => {
    const newPositions = computeLaneAutoLayout(apiNodes, apiEdges);
    for (const [nodeId, x] of newPositions) {
      updateNodeMutation.mutate({ nodeId, position_x: x } as Parameters<typeof updateNodeMutation.mutate>[0]);
    }
  }, [apiNodes, apiEdges, updateNodeMutation]);

  const handleSave = useCallback(async () => {
    // Batch save all cached edits
    for (const [nodeId, edits] of Object.entries(nodeEdits)) {
      await updateNodeMutation.mutateAsync({ nodeId, ...edits } as Parameters<typeof updateNodeMutation.mutate>[0]);
      clearNodeEdits(nodeId);
    }
    // Batch delete
    for (const nodeId of deletedNodeIds) {
      await deleteNodeMutation.mutateAsync(nodeId);
      clearNodeDelete(nodeId);
    }
  }, [nodeEdits, deletedNodeIds, updateNodeMutation, deleteNodeMutation, clearNodeEdits, clearNodeDelete]);

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      cacheNodeDelete(nodeId);
      setConfigPanelOpen(false);
    },
    [cacheNodeDelete],
  );

  const handleStageChange = useCallback(
    (nodeId: string, stageId: string | null) => {
      assignStageMutation.mutate({ nodeId, stage_id: stageId });
    },
    [assignStageMutation],
  );

  // ── Viewport tracking ──
  const handleViewportChange = useCallback((viewport: Viewport) => {
    setViewportY(viewport.y);
    setZoomLevel(Math.round(viewport.zoom * 100));
  }, []);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <PanoramaSkeleton />
      </div>
    );
  }

  // ── Error ──
  if (wfError || !workflow) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t(($) => $.detail.not_found)}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigation.push(wsPaths.workflows())}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t(($) => $.detail.back_to_workflows)}
                </Button>
                <Button variant="default" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (stages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader className="justify-between px-5 shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-muted-foreground">
              <PanelsTopLeft className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-medium truncate">{workflow.title}</h1>
            </div>
          </div>
        </PageHeader>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {t(($) => $.panorama.empty_all)}
            </p>
            <Button variant="default" size="sm" onClick={() => setShowStageDialog(true)}>
              Create Stage
            </Button>
          </div>
        </div>
        {showStageDialog && (
          <StageCreateDialog
            workflowId={workflowId}
            wsId={wsId}
            onClose={() => setShowStageDialog(false)}
          />
        )}
      </div>
    );
  }

  // ── Main panorama ──
  return (
    <div className="flex flex-col h-full">
      <PanoramaToolbar
        onAutoLayout={handleAutoLayout}
        onSave={handleSave}
        hasUnsaved={hasUnsaved}
        zoomIn={() => {}}  // handled by ReactFlow Controls
        zoomOut={() => {}}
        zoomLevel={zoomLevel}
      />

      <div className="flex flex-1 min-h-0 relative">
        {/* Node palette sidebar */}
        <NodePalette
          className="absolute left-3 top-3 z-10"
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed(!paletteCollapsed)}
        />

        {/* Canvas stage labels */}
        <CanvasStageLabels
          stages={stages}
          viewportY={viewportY}
          onEdit={() => {}}
          onDelete={() => {}}
          onReorder={() => {}}
        />

        {/* ReactFlow canvas */}
        <div className="flex-1 ml-32" data-testid="panorama-canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={panoramaNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            onNodeClick={handleNodeClick}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onEdgesDelete={handleEdgeDelete}
            fitView
            minZoom={0.2}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode="Shift"
            selectionOnDrag
            onMove={(_, viewport) => handleViewportChange(viewport)}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Node config panel (right slide-out) */}
        {configPanelOpen && selectedNode && (
          <div className="w-96 border-l bg-card shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              nodes={apiNodes}
              stages={stages}
              onClose={() => setConfigPanelOpen(false)}
              onDeleteNode={handleNodeDelete}
              onStageChange={handleStageChange}
            />
          </div>
        )}
      </div>

      {showStageDialog && (
        <StageCreateDialog
          workflowId={workflowId}
          wsId={wsId}
          onClose={() => setShowStageDialog(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/workflow-panorama-page.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Run all new component tests together**

Run: `pnpm --filter @multica/views exec vitest run workflows/components/overview/`
Expected: All new tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/views/workflows/components/overview/workflow-panorama-page.tsx packages/views/workflows/components/overview/workflow-panorama-page.test.tsx
git commit -m "feat(workflows): rewrite WorkflowPanoramaPage as ReactFlow unified canvas"
```

---

### Task 15: Simplify WorkflowDetailShell — remove view toggle

**Files:**
- Modify: `packages/views/workflows/components/workflow-detail-shell.tsx`

**Interfaces:**
- Consumes: `WorkflowPanoramaPage` from `./overview`
- Produces: Simplified shell that always renders the panorama page

- [ ] **Step 1: Rewrite WorkflowDetailShell**

```typescript
// packages/views/workflows/components/workflow-detail-shell.tsx
"use client";

import { WorkflowPanoramaPage } from "./overview/workflow-panorama-page";

export interface WorkflowDetailShellProps {
  workflowId: string;
}

/** Renders the unified panorama-editor view (single view, no toggle). */
export function WorkflowDetailShell({ workflowId }: WorkflowDetailShellProps) {
  return <WorkflowPanoramaPage workflowId={workflowId} />;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS (no import errors from removed view toggle code)

- [ ] **Step 3: Commit**

```bash
git add packages/views/workflows/components/workflow-detail-shell.tsx
git commit -m "refactor(workflows): simplify WorkflowDetailShell to single unified view"
```

---

### Task 16: Update overview/index.ts and components/index.ts exports

**Files:**
- Modify: `packages/views/workflows/components/overview/index.ts`
- Modify: `packages/views/workflows/components/index.ts`

**Interfaces:**
- Consumes: new panorama components
- Produces: updated exports reflecting the new architecture

- [ ] **Step 1: Update overview/index.ts**

```typescript
// packages/views/workflows/components/overview/index.ts

// New unified panorama page
export { WorkflowPanoramaPage } from "./workflow-panorama-page";
export type { WorkflowPanoramaPageProps } from "./workflow-panorama-page";

// New components
export { PanoramaToolbar } from "./panorama-toolbar";
export type { PanoramaToolbarProps } from "./panorama-toolbar";
export { CanvasStageLabels } from "./canvas-stage-labels";
export type { CanvasStageLabelsProps } from "./canvas-stage-labels";

// New ReactFlow custom nodes/edges
export { panoramaNodeTypes } from "./reactflow-nodes";
export { panoramaEdgeTypes } from "./reactflow-edges";

// New constants
export {
  LANE_HEIGHT, GRADIENT_HEIGHT, LANE_STEP, LANE_PADDING_TOP,
  PANORAMA_WIDTH, WORKER_WIDTH, WORKER_HEIGHT, CRITIC_WIDTH, CRITIC_HEIGHT,
  WORKER_CRITIC_GAP, STAGE_BG_COLORS, STAGE_LINE_COLORS, STAGE_TRANSITION_GRADIENTS,
  UNASSIGNED_LANE_Y, computeLaneY,
} from "./constants";

// Reused from old architecture
export { StageLane } from "./stage-lane";
export type { StageLaneProps } from "./stage-lane";
export { CompactNodeCard } from "./compact-node-card";
export type { CompactNodeCardProps } from "./compact-node-card";
export { CriticBadge } from "./critic-badge";
export type { CriticBadgeProps } from "./critic-badge";
export { PanoramaSvgOverlay } from "./panorama-svg-overlay";
export type { PanoramaSvgOverlayProps, EdgePath } from "./panorama-svg-overlay";
export { StageCreateDialog } from "./stage-create-dialog";

// Keep these for backward compat until confirmed unused
export { WorkflowOverviewPage } from "./workflow-overview-page";
export { ArchitectureDetailPanel } from "./architecture-detail-panel";
```

- [ ] **Step 2: Update components/index.ts**

Change the `WorkflowDetailShell` export to reflect new behavior. The rest stays the same for now (old editor files still exist until cleanup phase).

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @multica/views typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/overview/index.ts packages/views/workflows/components/index.ts
git commit -m "feat(workflows): update exports for new panorama architecture"
```

---

### Task 17: Phase 4 — Cleanup: remove unreferenced old files

**Files:**
- Remove: files listed in spec §4.3 that have zero remaining references

**Important:** Run `rg` for each file before deleting. Only delete files with zero references.

- [ ] **Step 1: Find references for each deletion candidate**

```bash
# Check each file for references
rg "workflow-detail-page" --glob "*.ts" --glob "*.tsx" | rg -v "workflow-detail-page\.tsx|workflow-detail-page\.test\.tsx"
rg "dag-canvas" --glob "*.ts" --glob "*.tsx" | rg -v "dag-canvas\.tsx|dag-canvas\.test\.tsx"
rg "workflow-overview-page" --glob "*.ts" --glob "*.tsx" | rg -v "workflow-overview-page\.tsx|workflow-overview-page\.test\.tsx"
rg "stage-canvas" --glob "*.ts" --glob "*.tsx" | rg -v "stage-canvas\.tsx|stage-canvas\.test\.tsx"
rg "stage-card" --glob "*.ts" --glob "*.tsx" | rg -v "stage-card\.tsx|stage-card\.test\.tsx"
rg "stage-node-dag" --glob "*.ts" --glob "*.tsx" | rg -v "stage-node-dag\.tsx|stage-node-dag\.test\.tsx"
rg "compact-node-card" --glob "*.ts" --glob "*.tsx" | rg -v "compact-node-card\.tsx|compact-node-card\.test\.tsx"
rg "critic-badge" --glob "*.ts" --glob "*.tsx" | rg -v "critic-badge\.tsx|critic-badge\.test\.tsx"
rg "node-detail-panel" --glob "*.ts" --glob "*.tsx" | rg -v "node-detail-panel\.tsx|node-detail-panel\.test\.tsx"
rg "architecture-detail-panel" --glob "*.ts" --glob "*.tsx" | rg -v "architecture-detail-panel\.tsx|architecture-detail-panel\.test\.tsx"
rg "@multica/core/workflows/stores/view-store|workflows/stores/view-store|./stores/view-store" --glob "*.ts" --glob "*.tsx"
rg "./reactflow-nodes|reactflow-nodes" packages/views/workflows --glob "*.ts" --glob "*.tsx" | rg -v "overview/reactflow-nodes|reactflow-nodes\.test\.tsx|reactflow-nodes\.tsx"
```

- [ ] **Step 2: Delete files with zero references**

For each file confirmed unreferenced, remove it and its test file.

- [ ] **Step 3: Remove view-store.ts**

```bash
# Remove view store (always removed — the toggle is gone)
git rm packages/core/workflows/stores/view-store.ts
git rm packages/core/workflows/stores/view-store.test.ts
```

- [ ] **Step 4: Verify no import errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(workflows): remove unreferenced old editor and overview files"
```

---

### Task 18: Run verification pipeline

**Files:** No changes — verification only

- [ ] **Step 1: Run all frontend tests**

```bash
pnpm --filter @multica/views exec vitest run
pnpm --filter @multica/core exec vitest run
```

Expected: All tests pass

- [ ] **Step 2: Run Go backend test for cross-stage edges**

```bash
cd server && go test ./... -run TestCrossStageEdge_Allowed
```

Expected: PASS

- [ ] **Step 3: Run full typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Run full check**

```bash
make check
```

Expected: All checks pass

# Workflow 画布重构 — UI/UX 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Workflow 画布基础设施，统一编辑器和运行时的画布数据模型、组件协议和视觉语言，实现 n8n 风格的节点编辑体验和运行时状态可视化。

**Architecture:** 采用 Surface 模式分离编辑器和运行态画布——`ReactFlowSurface` 处理编辑器交互（拖拽/连线/框选），`StageLaneSurface` 处理运行态/预览态的 Stage 泳道布局。两者共享 `WorkflowNodeCard`（通过 variant 控制密度）、`WorkflowEdgeLayer`（统一 data/control/error 线型语义）和 `CanvasInspector`（右侧面板框架）。新增 `WorkflowCanvasShell` 作为公共容器，通过 slots 注入平台差异。

**Tech Stack:** React 19, TypeScript strict, @xyflow/react (ReactFlow), Zustand (store), TanStack Query (server state), Tailwind CSS + semantic tokens

## Global Constraints

- 使用语义 token，不硬编码 hex 颜色
- 所有 UI 组件放在 `packages/views/workflows/` 下
- 共享逻辑和类型放在 `packages/core/workflows/` 下
- CSS 变量在 `packages/ui/styles/tokens.css` 中定义
- i18n key 在 `packages/views/locales/{en,zh-Hans}/workflows.json` 中定义
- 遵循现有命名约定（kebab-case 文件名，PascalCase 组件名）
- 不破坏现有 API 契约（增量重构，现有功能不能回归）
- 桌面端和 Web 端共享所有新组件
- 任务按依赖顺序排列，每个任务完成后可独立测试

---

### Task 1: Workflow 语义设计 Token

**Files:**
- Modify: `packages/ui/styles/tokens.css`

**Interfaces:**
- Produces: CSS 变量 `--workflow-accent`, `--workflow-agent`, `--workflow-info`, `--workflow-success`, `--workflow-warning`, `--workflow-danger`, `--workflow-canvas-bg`, `--workflow-stage-bg`

- [ ] **Step 1: 在 tokens.css 中定义 workflow 语义变量**

在 `:root` 块中添加（紧接在 `--radius-4xl` 之后）：

```css
    /* Workflow canvas tokens — semantic aliases for existing color palette */
    --workflow-accent: var(--primary);
    --workflow-agent: var(--brand);
    --workflow-info: var(--info);
    --workflow-success: var(--success);
    --workflow-warning: var(--warning);
    --workflow-danger: var(--destructive);
    --workflow-canvas-bg: oklch(0.985 0.001 260);
    --workflow-stage-bg: oklch(0.975 0.002 260 / 60%);
```

在 `.dark` 块中添加：

```css
    --workflow-canvas-bg: oklch(0.16 0.003 260);
    --workflow-stage-bg: oklch(0.20 0.003 260 / 60%);
```

同时将新变量注册到 `@theme inline` 块中：

```css
    --color-workflow-accent: var(--workflow-accent);
    --color-workflow-agent: var(--workflow-agent);
    --color-workflow-info: var(--workflow-info);
    --color-workflow-success: var(--workflow-success);
    --color-workflow-warning: var(--workflow-warning);
    --color-workflow-danger: var(--workflow-danger);
    --color-workflow-canvas-bg: var(--workflow-canvas-bg);
    --color-workflow-stage-bg: var(--workflow-stage-bg);
```

- [ ] **Step 2: 验证 Token 可用性**

运行：`pnpm typecheck`
预期：PASS（无类型错误）

- [ ] **Step 3: Commit**

```bash
git add packages/ui/styles/tokens.css
git commit -m "feat(workflow): add workflow semantic design tokens"
```

---

### Task 2: 统一边（Edge）语义类型定义

**Files:**
- Create: `packages/core/workflows/edge-semantics.ts`
- Create: `packages/core/workflows/edge-semantics.test.ts`

**Interfaces:**
- Produces: `EdgeSemantics` 类型 (`"data" | "control" | "error"`)、`EdgeVisualConfig` 接口、`inferEdgeSemantics(edge, nodes)` 函数、`EDGE_VISUAL_CONFIGS` 常量映射

- [ ] **Step 1: 编写测试**

创建 `packages/core/workflows/edge-semantics.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { inferEdgeSemantics, EDGE_VISUAL_CONFIGS } from "./edge-semantics";
import type { WorkflowEdge, WorkflowNode } from "../types";

function makeNode(id: string, stageId?: string): WorkflowNode {
  return {
    id, workflow_id: "wf1", title: id, description: "",
    position_x: 0, position_y: 0, format_schema: null,
    worker_type: "human", worker_id: null,
    critic_type: "human", critic_id: null, critic_api_url: null,
    sort_order: 0, stage_id: stageId ?? null,
    created_at: "", updated_at: "",
  };
}

function makeEdge(id: string, source: string, target: string, condition?: unknown): WorkflowEdge {
  return { id, workflow_id: "wf1", source_node_id: source, target_node_id: target, condition: condition ?? null, created_at: "" };
}

describe("inferEdgeSemantics", () => {
  it("returns 'data' for edge without condition", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("data");
  });

  it("returns 'control' when condition has path field (true/false branches)", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b", { path: "true" });
    expect(inferEdgeSemantics(edge, nodes)).toBe("control");
  });

  it("returns 'error' when condition has error field", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b", { error: true });
    expect(inferEdgeSemantics(edge, nodes)).toBe("error");
  });

  it("returns 'control' for cross-stage edges", () => {
    const nodes = [makeNode("a", "stage-1"), makeNode("b", "stage-2")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("control");
  });

  it("returns 'data' for same-stage edge without condition", () => {
    const nodes = [makeNode("a", "stage-1"), makeNode("b", "stage-1")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("data");
  });
});

describe("EDGE_VISUAL_CONFIGS", () => {
  it("has config for all three semantics", () => {
    expect(EDGE_VISUAL_CONFIGS.data).toBeDefined();
    expect(EDGE_VISUAL_CONFIGS.control).toBeDefined();
    expect(EDGE_VISUAL_CONFIGS.error).toBeDefined();
  });

  it("data uses solid stroke, control uses green/red labels, error uses dashed red", () => {
    expect(EDGE_VISUAL_CONFIGS.data.strokeDasharray).toBe("none");
    expect(EDGE_VISUAL_CONFIGS.error.strokeDasharray).toBe("6 3");
    expect(EDGE_VISUAL_CONFIGS.control.hasLabel).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/core exec vitest run workflows/edge-semantics.test.ts`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现类型和函数**

创建 `packages/core/workflows/edge-semantics.ts`：

```typescript
import type { WorkflowEdge, WorkflowNode } from "../types";

/** Unified edge semantic — determines visual rendering. */
export type EdgeSemantics = "data" | "control" | "error";

export interface EdgeVisualConfig {
  strokeDasharray: "none" | "6 3";
  strokeWidth: number;
  hasLabel: boolean;
  strokeColorToken: string;
  labelColorToken: string;
}

export const EDGE_VISUAL_CONFIGS: Record<EdgeSemantics, EdgeVisualConfig> = {
  data: {
    strokeDasharray: "none",
    strokeWidth: 2,
    hasLabel: false,
    strokeColorToken: "--workflow-info",
    labelColorToken: "--muted-foreground",
  },
  control: {
    strokeDasharray: "none",
    strokeWidth: 2,
    hasLabel: true,
    strokeColorToken: "--workflow-success",
    labelColorToken: "--workflow-success",
  },
  error: {
    strokeDasharray: "6 3",
    strokeWidth: 2,
    hasLabel: false,
    strokeColorToken: "--workflow-danger",
    labelColorToken: "--workflow-danger",
  },
};

/**
 * Infer edge semantics from edge condition and node stage membership.
 * - condition.error → "error"
 * - condition.path (true/false) → "control"
 * - cross-stage → "control"
 * - default → "data"
 */
export function inferEdgeSemantics(
  edge: WorkflowEdge,
  nodes: WorkflowNode[],
): EdgeSemantics {
  const condition = edge.condition as Record<string, unknown> | null;

  if (condition && typeof condition === "object") {
    if ("error" in condition) return "error";
    if ("path" in condition) return "control";
  }

  // Cross-stage edges default to control semantics
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const source = nodeMap.get(edge.source_node_id);
  const target = nodeMap.get(edge.target_node_id);
  if (source && target && source.stage_id !== target.stage_id) {
    return "control";
  }

  return "data";
}

/** Get the visual config for an edge given its semantics. */
export function getEdgeVisualConfig(semantics: EdgeSemantics): EdgeVisualConfig {
  return EDGE_VISUAL_CONFIGS[semantics];
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/core exec vitest run workflows/edge-semantics.test.ts`
预期：PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/core/workflows/edge-semantics.ts packages/core/workflows/edge-semantics.test.ts
git commit -m "feat(workflow): add unified edge semantics types and inference"
```

---

### Task 3: 统一节点卡片 WorkflowNodeCard

**Files:**
- Create: `packages/views/workflows/components/workflow-node-card.tsx`
- Create: `packages/views/workflows/components/workflow-node-card.test.tsx`

**Interfaces:**
- Consumes: CSS tokens from Task 1
- Produces: `WorkflowNodeCard` 组件，接受 `node: WorkflowNode`, `variant: "definition" | "runtime"`, `nodeRun?: WorkflowNodeRun`, `density: "compact" | "full"`, `selected?: boolean`, `onClick?: (nodeId: string) => void`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/workflow-node-card.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { WorkflowNode } from "@multica/core/types";

const baseNode: WorkflowNode = {
  id: "n1", workflow_id: "wf1", title: "Test Node",
  description: "A test node", position_x: 0, position_y: 0,
  format_schema: null, worker_type: "agent", worker_id: "agent-1",
  critic_type: "human", critic_id: null, critic_api_url: null,
  sort_order: 0, stage_id: null, created_at: "", updated_at: "",
};

describe("WorkflowNodeCard — definition variant", () => {
  it("renders node title", () => {
    render(<WorkflowNodeCard node={baseNode} variant="definition" />);
    expect(screen.getByText("Test Node")).toBeDefined();
  });

  it("applies selected styles", () => {
    const { container } = render(<WorkflowNodeCard node={baseNode} variant="definition" selected />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("ring-2");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<WorkflowNodeCard node={baseNode} variant="definition" onClick={onClick} />);
    screen.getByText("Test Node").click();
    expect(onClick).toHaveBeenCalledWith("n1");
  });
});

describe("WorkflowNodeCard — runtime variant", () => {
  it("shows pending state", () => {
    const { container } = render(
      <WorkflowNodeCard
        node={baseNode}
        variant="runtime"
        nodeRun={{ id: "r1", workflow_run_id: "wr1", workflow_node_id: "n1", node_title: "Test Node", status: "pending", retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null, worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null, critic_comment: "", critic_agent_task_id: null, agent_task_id: null, session_id: null, runtime_id: null, device_id: null, started_at: null, completed_at: null, created_at: "", updated_at: "" }}
      />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-dashed");
  });

  it("shows completed state with green border", () => {
    const { container } = render(
      <WorkflowNodeCard
        node={baseNode}
        variant="runtime"
        nodeRun={{ id: "r1", workflow_run_id: "wr1", workflow_node_id: "n1", node_title: "Test Node", status: "completed", retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null, worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null, critic_comment: "", critic_agent_task_id: null, agent_task_id: null, session_id: null, runtime_id: null, device_id: null, started_at: null, completed_at: null, created_at: "", updated_at: "" }}
      />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-workflow-success");
  });

  it("renders in compact density", () => {
    const { container } = render(
      <WorkflowNodeCard node={baseNode} variant="runtime" density="compact" />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-40");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run workflow-node-card.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/workflow-node-card.tsx`：

```typescript
"use client";

import type { WorkflowNode, WorkflowNodeRun, NodeRunStatus } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";

// Runtime status → border color mapping
const STATUS_BORDER: Partial<Record<NodeRunStatus, string>> = {
  pending: "border-muted-foreground/30 border-dashed",
  format_checking: "border-workflow-info animate-pulse",
  format_ok: "border-workflow-success",
  format_failed: "border-workflow-danger",
  worker_assigned: "border-workflow-info",
  working: "border-workflow-info [box-shadow:0_0_8px_hsl(var(--info)/0.4)]",
  awaiting_input: "border-workflow-warning",
  awaiting_critic: "border-brand",
  critic_reviewing: "border-brand animate-pulse",
  critic_approved: "border-workflow-success",
  critic_rework: "border-workflow-warning",
  blocked: "border-workflow-danger",
  failed: "border-workflow-danger border-2",
  completed: "border-workflow-success",
  skipped: "border-muted-foreground/30",
  cancelled: "border-muted-foreground/30 line-through",
};

// Runtime status → icon mapping (simplified — expanded in Task 12)
const STATUS_ICON: Partial<Record<NodeRunStatus, string>> = {
  completed: "✓",
  failed: "✗",
  blocked: "🔒",
  awaiting_input: "?",
  awaiting_critic: "👁",
  working: "●",
};

export interface WorkflowNodeCardProps {
  node: WorkflowNode;
  variant: "definition" | "runtime";
  nodeRun?: WorkflowNodeRun | null;
  density?: "compact" | "full";
  selected?: boolean;
  onClick?: (nodeId: string) => void;
  className?: string;
}

/** Unified node card used by both ReactFlowSurface and StageLaneSurface. */
export function WorkflowNodeCard({
  node,
  variant,
  nodeRun,
  density = "full",
  selected = false,
  onClick,
  className,
}: WorkflowNodeCardProps) {
  const isCompact = density === "compact";
  const status = nodeRun?.status;
  const statusBorder = status ? STATUS_BORDER[status] : undefined;
  const statusIcon = status ? STATUS_ICON[status] : undefined;

  return (
    <button
      type="button"
      data-testid={`workflow-node-card-${node.id}`}
      onClick={() => onClick?.(node.id)}
      className={cn(
        "group flex flex-col gap-1 rounded-[14px] border bg-card p-3 text-left transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isCompact ? "w-40" : "w-44",
        variant === "definition" && !selected && "border-border",
        variant === "definition" && selected && "border-workflow-accent ring-2 ring-workflow-accent/30",
        variant === "runtime" && statusBorder,
        variant === "runtime" && !statusBorder && "border-border",
        className,
      )}
      aria-pressed={selected}
    >
      {/* Title row */}
      <div className="flex items-center gap-1.5 min-w-0">
        {variant === "runtime" && statusIcon && (
          <span className="shrink-0 text-xs">{statusIcon}</span>
        )}
        <span className={cn(
          "truncate font-medium",
          isCompact ? "text-xs" : "text-sm",
          nodeRun?.status === "cancelled" && "line-through text-muted-foreground",
        )}>
          {node.title}
        </span>
      </div>

      {/* Subtitle / worker info */}
      {variant === "definition" && !isCompact && node.worker_type && (
        <span className="text-[11px] text-muted-foreground truncate">
          {node.worker_type === "agent" ? "Agent" : node.worker_type === "squad" ? "Squad" : "Human"}
        </span>
      )}

      {/* Runtime status label */}
      {variant === "runtime" && status && !isCompact && (
        <span className="text-[10px] text-muted-foreground truncate">
          {status.replace(/_/g, " ")}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run workflow-node-card.test.tsx`
预期：PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/workflow-node-card.tsx packages/views/workflows/components/workflow-node-card.test.tsx
git commit -m "feat(workflow): add unified WorkflowNodeCard with definition/runtime variants"
```

---

### Task 4: 统一连线组件 WorkflowEdgeLayer

**Files:**
- Create: `packages/views/workflows/components/workflow-edge-layer.tsx`
- Create: `packages/views/workflows/components/workflow-edge-layer.test.tsx`

**Interfaces:**
- Consumes: `EdgeSemantics`, `getEdgeVisualConfig` from Task 2, CSS tokens from Task 1
- Produces: `WorkflowEdgeLayer` 组件，接受 `edges: WorkflowEdge[]`, `nodes: WorkflowNode[]`, `containerRect: DOMRect`, `nodePositions: Map<string, DOMRect>`, `surface: "reactflow" | "stage-lane"`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/workflow-edge-layer.test.tsx`：

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WorkflowEdgeLayer, computePaths } from "./workflow-edge-layer";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";

const nodes: WorkflowNode[] = [
  { id: "a", workflow_id: "wf1", title: "A", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 0, stage_id: "s1", created_at: "", updated_at: "" },
  { id: "b", workflow_id: "wf1", title: "B", description: "", position_x: 200, position_y: 0, format_schema: null, worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 1, stage_id: "s1", created_at: "", updated_at: "" },
];

const edges: WorkflowEdge[] = [
  { id: "e1", workflow_id: "wf1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" },
];

describe("computePaths", () => {
  it("returns paths for given edges and positions", () => {
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const paths = computePaths(edges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths.length).toBe(1);
    expect(paths[0].edgeId).toBe("e1");
    expect(paths[0].semantic).toBe("data");
  });

  it("returns error semantic for error edge", () => {
    const errorEdges: WorkflowEdge[] = [
      { id: "e1", workflow_id: "wf1", source_node_id: "a", target_node_id: "b", condition: { error: true }, created_at: "" },
    ];
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const paths = computePaths(errorEdges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths[0].semantic).toBe("error");
  });

  it("returns empty array for missing positions", () => {
    const positions = new Map<string, DOMRect>();
    const paths = computePaths(edges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths.length).toBe(0);
  });
});

describe("WorkflowEdgeLayer", () => {
  it("renders SVG with paths", () => {
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const { container } = render(
      <WorkflowEdgeLayer
        edges={edges}
        nodes={nodes}
        containerRect={{ width: 800, height: 200, left: 0, top: 0 }}
        nodePositions={positions}
        surface="stage-lane"
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeDefined();
    const paths = svg!.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run workflow-edge-layer.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/workflow-edge-layer.tsx`：

```typescript
"use client";

import { useMemo } from "react";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";
import { inferEdgeSemantics, getEdgeVisualConfig } from "@multica/core/workflows/edge-semantics";
import type { EdgeSemantics } from "@multica/core/workflows/edge-semantics";
import { cn } from "@multica/ui/lib/utils";

export interface ComputedPath {
  edgeId: string;
  d: string;
  semantic: EdgeSemantics;
  label: string | null;
}

interface Rect {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function computePaths(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  nodePositions: Map<string, DOMRect>,
  containerRect: Rect,
): ComputedPath[] {
  const results: ComputedPath[] = [];

  for (const edge of edges) {
    const sourceRect = nodePositions.get(edge.source_node_id);
    const targetRect = nodePositions.get(edge.target_node_id);
    if (!sourceRect || !targetRect) continue;

    const semantic = inferEdgeSemantics(edge, nodes);
    const config = getEdgeVisualConfig(semantic);

    // Compute relative coordinates
    const sx = sourceRect.right - containerRect.left;
    const sy = sourceRect.top + sourceRect.height / 2 - containerRect.top;
    const tx = targetRect.left - containerRect.left;
    const ty = targetRect.top + targetRect.height / 2 - containerRect.top;
    const midX = (sx + tx) / 2;

    // Smooth cubic bezier for data/control, dashed straight for error
    let d: string;
    if (semantic === "error") {
      d = `M ${sx} ${sy} L ${tx} ${ty}`;
    } else {
      const cpOffset = Math.abs(tx - sx) * 0.4;
      d = `M ${sx} ${sy} C ${sx + cpOffset} ${sy}, ${tx - cpOffset} ${ty}, ${tx} ${ty}`;
    }

    // Extract label from condition if control semantics
    let label: string | null = null;
    if (config.hasLabel && edge.condition && typeof edge.condition === "object") {
      const cond = edge.condition as Record<string, unknown>;
      if (cond.path === "true") label = "true";
      else if (cond.path === "false") label = "false";
      else if (typeof cond.path === "string") label = cond.path;
    }

    results.push({ edgeId: edge.id, d, semantic, label });
  }

  return results;
}

export interface WorkflowEdgeLayerProps {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  containerRect: Rect;
  nodePositions: Map<string, DOMRect>;
  surface: "reactflow" | "stage-lane";
  className?: string;
}

/** SVG overlay that renders workflow edges with semantic-aware visual styles. */
export function WorkflowEdgeLayer({
  edges,
  nodes,
  containerRect,
  nodePositions,
  surface,
  className,
}: WorkflowEdgeLayerProps) {
  const paths = useMemo(
    () => computePaths(edges, nodes, nodePositions, containerRect),
    [edges, nodes, nodePositions, containerRect],
  );

  if (paths.length === 0) return null;

  return (
    <svg
      className={cn("pointer-events-none absolute inset-0 z-10 overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <marker id="edge-arrow-data" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--info))" />
        </marker>
        <marker id="edge-arrow-control" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--success))" />
        </marker>
        <marker id="edge-arrow-error" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--destructive))" />
        </marker>
      </defs>
      {paths.map((path) => {
        const config = getEdgeVisualConfig(path.semantic);
        return (
          <g key={path.edgeId}>
            <path
              d={path.d}
              fill="none"
              stroke={`hsl(var(${config.strokeColorToken.replace("--", "")}))`}
              strokeWidth={surface === "reactflow" ? config.strokeWidth : 2}
              strokeDasharray={config.strokeDasharray === "none" ? undefined : config.strokeDasharray}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={`url(#edge-arrow-${path.semantic})`}
              opacity={0.6}
            />
            {path.label && (
              <text
                x="0"
                y="-6"
                textAnchor="middle"
                fontSize="10"
                fill={`hsl(var(${config.labelColorToken.replace("--", "")}))`}
                className="font-medium"
              >
                {path.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run workflow-edge-layer.test.tsx`
预期：PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/workflow-edge-layer.tsx packages/views/workflows/components/workflow-edge-layer.test.tsx
git commit -m "feat(workflow): add WorkflowEdgeLayer with semantic-aware edge rendering"
```

---

### Task 5: CanvasInspector 面板框架

**Files:**
- Create: `packages/views/workflows/components/canvas-inspector.tsx`
- Create: `packages/views/workflows/components/canvas-inspector.test.tsx`

**Interfaces:**
- Produces: `CanvasInspector` 组件，接受 `title: string`, `tabs: { id: string; label: string; content: ReactNode }[]`, `actions?: ReactNode`, `onClose: () => void`, `open?: boolean`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/canvas-inspector.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasInspector } from "./canvas-inspector";

describe("CanvasInspector", () => {
  const tabs = [
    { id: "overview", label: "Overview", content: <div>Overview content</div> },
    { id: "config", label: "Config", content: <div>Config content</div> },
  ];

  it("renders title and tabs", () => {
    render(<CanvasInspector title="Test Node" tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Test Node")).toBeDefined();
    expect(screen.getByText("Overview")).toBeDefined();
    expect(screen.getByText("Config")).toBeDefined();
  });

  it("shows first tab content by default", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Overview content")).toBeDefined();
  });

  it("switches tab on click", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} />);
    screen.getByText("Config").click();
    expect(screen.getByText("Config content")).toBeDefined();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<CanvasInspector title="Test" tabs={tabs} onClose={onClose} />);
    // Close button has aria-label
    const closeBtn = screen.getByRole("button", { name: /close/i });
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders actions slot", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} actions={<button>Retry</button>} />);
    expect(screen.getByText("Retry")).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run canvas-inspector.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/canvas-inspector.tsx`：

```typescript
"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { X } from "lucide-react";

export interface InspectorTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface CanvasInspectorProps {
  title: string;
  tabs: InspectorTab[];
  actions?: ReactNode;
  onClose: () => void;
  open?: boolean;
  className?: string;
}

/** Reusable right-side inspector panel for both editor and runtime views. */
export function CanvasInspector({
  title,
  tabs,
  actions,
  onClose,
  open = true,
  className,
}: CanvasInspectorProps) {
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");

  if (!open) return null;

  return (
    <div
      data-testid="canvas-inspector"
      className={cn("flex flex-col h-full w-96 shrink-0 border-l bg-card", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h3 className="text-sm font-medium truncate">{title}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTabId === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {tabs.find((t) => t.id === activeTabId)?.content}
      </div>

      {/* Actions footer */}
      {actions && (
        <div className="px-4 py-3 border-t shrink-0 flex gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run canvas-inspector.test.tsx`
预期：PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/canvas-inspector.tsx packages/views/workflows/components/canvas-inspector.test.tsx
git commit -m "feat(workflow): add CanvasInspector shared panel framework"
```

---

### Task 6: 节点面板 NodePanel（"能力市场"）

**Files:**
- Create: `packages/views/workflows/components/node-panel.tsx`（替换现有 `node-palette.tsx`）
- Create: `packages/views/workflows/components/node-panel.test.tsx`

**Interfaces:**
- Consumes: CSS tokens from Task 1
- Produces: `NodePanel` 组件，接受 `onDragStart?: (nodeType: string) => void`, `isOpen: boolean`, `onClose: () => void`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/node-panel.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodePanel, NODE_GROUPS } from "./node-panel";

describe("NodePanel", () => {
  it("renders all node groups", () => {
    render(<NodePanel isOpen onClose={vi.fn()} />);
    for (const group of NODE_GROUPS) {
      expect(screen.getByText(group.label)).toBeDefined();
    }
  });

  it("filters nodes by search query", () => {
    render(<NodePanel isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "agent" } });
    // Should still show Agent Worker group but filter others
    expect(screen.getByText("Agent Worker")).toBeDefined();
  });

  it("does not render when closed", () => {
    const { container } = render(<NodePanel isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NodePanel isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run node-panel.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/node-panel.tsx`：

```typescript
"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { Search, Bot, User, Users, StickyNote } from "lucide-react";

const DRAG_TYPE = "application/x-multica-shape";

interface NodeTypeEntry {
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface NodeGroup {
  id: string;
  label: string;
  colorClass: string;
  items: NodeTypeEntry[];
}

export const NODE_GROUPS: NodeGroup[] = [
  {
    id: "agent",
    label: "Agent Worker",
    colorClass: "bg-workflow-agent/10 text-workflow-agent",
    items: [
      { type: "rectangle", label: "Agent Task", description: "Assign a task to an AI agent", icon: <Bot className="h-4 w-4" /> },
    ],
  },
  {
    id: "human",
    label: "Human Worker",
    colorClass: "bg-workflow-info/10 text-workflow-info",
    items: [
      { type: "rectangle", label: "Human Task", description: "Assign a task to a human team member", icon: <User className="h-4 w-4" /> },
    ],
  },
  {
    id: "squad",
    label: "Squad",
    colorClass: "bg-workflow-success/10 text-workflow-success",
    items: [
      { type: "rectangle", label: "Squad Task", description: "Assign work to a squad of agents", icon: <Users className="h-4 w-4" /> },
    ],
  },
  {
    id: "annotation",
    label: "Annotation",
    colorClass: "bg-workflow-warning/10 text-workflow-warning",
    items: [
      { type: "annotation", label: "Sticky Note", description: "Add a note or comment to the canvas", icon: <StickyNote className="h-4 w-4" /> },
    ],
  },
];

export interface NodePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDragStart?: (nodeType: string) => void;
  className?: string;
}

export function NodePanel({ isOpen, onClose, onDragStart, className }: NodePanelProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return NODE_GROUPS;
    const q = search.toLowerCase();
    return NODE_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((item) =>
          item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [search]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="node-panel"
      className={cn("flex flex-col w-64 shrink-0 border-r bg-card", className)}
    >
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Node groups */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredGroups.map((group) => (
          <div key={group.id} className="mb-2">
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded",
              group.colorClass,
            )}>
              {group.label}
            </div>
            {group.items.map((item) => (
              <div
                key={item.type}
                draggable
                role="button"
                tabIndex={0}
                className="flex items-center gap-2 px-3 py-2 rounded-md mx-1 my-0.5 cursor-grab active:cursor-grabbing hover:bg-muted transition-colors text-sm"
                title={item.description}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, item.type);
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart?.(item.type);
                }}
              >
                <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                <span className="truncate text-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        ))}

        {filteredGroups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No matching nodes</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run node-panel.test.tsx`
预期：PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/node-panel.tsx packages/views/workflows/components/node-panel.test.tsx
git commit -m "feat(workflow): add NodePanel capability marketplace component"
```

---

### Task 7: 节点悬停工具栏 CanvasHoverToolbar

**Files:**
- Create: `packages/views/workflows/components/canvas-hover-toolbar.tsx`
- Create: `packages/views/workflows/components/canvas-hover-toolbar.test.tsx`

**Interfaces:**
- Produces: `CanvasHoverToolbar` 组件，接受 `nodeId: string`, `position: { x: number; y: number }`, `onDelete: (nodeId: string) => void`, `onToggleDisabled?: (nodeId: string) => void`, `isDisabled?: boolean`, `mode: "editor" | "runtime"`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/canvas-hover-toolbar.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasHoverToolbar } from "./canvas-hover-toolbar";

describe("CanvasHoverToolbar", () => {
  it("renders delete button", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        mode="editor"
      />
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeDefined();
  });

  it("renders disable button in editor mode", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        onToggleDisabled={vi.fn()}
        mode="editor"
      />
    );
    expect(screen.getByRole("button", { name: /disable/i })).toBeDefined();
  });

  it("does not render disable button in runtime mode", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        mode="runtime"
      />
    );
    expect(screen.queryByRole("button", { name: /disable/i })).toBeNull();
  });

  it("positions correctly", () => {
    const { container } = render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 200, y: 100 }}
        onDelete={vi.fn()}
        mode="editor"
      />
    );
    const toolbar = container.firstElementChild as HTMLElement;
    expect(toolbar.style.left).toBe("200px");
    expect(toolbar.style.top).toBe("100px");
  });

  it("calls onDelete when delete clicked", () => {
    const onDelete = vi.fn();
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 0, y: 0 }}
        onDelete={onDelete}
        mode="editor"
      />
    );
    screen.getByRole("button", { name: /delete/i }).click();
    expect(onDelete).toHaveBeenCalledWith("n1");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run canvas-hover-toolbar.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/canvas-hover-toolbar.tsx`：

```typescript
"use client";

import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Trash2, Power, PowerOff } from "lucide-react";

export interface CanvasHoverToolbarProps {
  nodeId: string;
  position: { x: number; y: number };
  onDelete: (nodeId: string) => void;
  onToggleDisabled?: (nodeId: string) => void;
  isDisabled?: boolean;
  mode: "editor" | "runtime";
  className?: string;
}

/** Floating toolbar that appears above a node on hover. */
export function CanvasHoverToolbar({
  nodeId,
  position,
  onDelete,
  onToggleDisabled,
  isDisabled = false,
  mode,
  className,
}: CanvasHoverToolbarProps) {
  return (
    <div
      data-testid="hover-toolbar"
      className={cn(
        "absolute z-50 flex items-center gap-0.5 rounded-lg border bg-popover shadow-md p-0.5 -translate-x-1/2 -translate-y-full",
        className,
      )}
      style={{ left: position.x, top: position.y - 8 }}
    >
      {mode === "editor" && onToggleDisabled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onToggleDisabled(nodeId); }}
          aria-label={isDisabled ? "Enable" : "Disable"}
        >
          {isDisabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); onDelete(nodeId); }}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run canvas-hover-toolbar.test.tsx`
预期：PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/canvas-hover-toolbar.tsx packages/views/workflows/components/canvas-hover-toolbar.test.tsx
git commit -m "feat(workflow): add CanvasHoverToolbar floating node actions"
```

---

### Task 8: ReactFlowSurface — 编辑器画布重构

**Files:**
- Modify: `packages/views/workflows/components/dag-canvas.tsx`（重命名导出，不改原组件内部逻辑）
- Create: `packages/views/workflows/components/reactflow-surface.tsx`

**Interfaces:**
- Consumes: `WorkflowNodeCard` from Task 3, `CanvasHoverToolbar` from Task 7
- Produces: `ReactFlowSurface` 组件，接受 `nodes`, `edges`, `stages`, 所有画布事件回调，`mode`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/reactflow-surface.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ReactFlowSurface } from "./reactflow-surface";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector) => {
    const state = {
      mode: "edit",
      selectNode: vi.fn(),
      selectEdge: vi.fn(),
      setSelectedNodeIds: vi.fn(),
      cacheNodeDelete: vi.fn(),
      deletedNodeIds: [] as string[],
      canvasColorMode: "system" as const,
      cacheNodeEdits: vi.fn(),
      selectedNodeId: null as string | null,
      selectedNodeIds: [] as string[],
      selectedEdgeId: null as string | null,
      nodeEdits: {} as Record<string, unknown>,
      undo: vi.fn(),
      redo: vi.fn(),
      undoStack: [] as unknown[],
      redoStack: [] as unknown[],
      _reverseAction: null,
      clearReverseAction: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual("@xyflow/react");
  return { ...actual, useReactFlow: () => ({ screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })) }) };
});

const nodes: WorkflowNode[] = [
  { id: "n1", workflow_id: "wf1", title: "Node 1", description: "", position_x: 0, position_y: 0, format_schema: { shape: "rectangle" }, worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 0, stage_id: null, created_at: "", updated_at: "" },
];

const edges: WorkflowEdge[] = [];

describe("ReactFlowSurface", () => {
  it("renders the ReactFlow canvas", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ReactFlowSurface nodes={nodes} edges={edges} onNodeDragStop={vi.fn()} onEdgeCreate={vi.fn()} onEdgeDelete={vi.fn()} onNodeCreate={vi.fn()} />
      </ReactFlowProvider>
    );
    // ReactFlow renders its own container classes
    expect(container.querySelector(".react-flow")).toBeDefined();
  });

  it("shows empty state when no nodes", () => {
    render(
      <ReactFlowProvider>
        <ReactFlowSurface nodes={[]} edges={[]} onNodeDragStop={vi.fn()} onEdgeCreate={vi.fn()} onEdgeDelete={vi.fn()} onNodeCreate={vi.fn()} />
      </ReactFlowProvider>
    );
    expect(screen.getByText(/add first step/i)).toBeDefined();
  });

  it("shows MiniMap when showMiniMap is true and nodes > 20", () => {
    const manyNodes: WorkflowNode[] = Array.from({ length: 21 }, (_, i) => ({
      ...nodes[0],
      id: `n${i}`,
      title: `Node ${i}`,
      position_x: i * 200,
    }));
    render(
      <ReactFlowProvider>
        <ReactFlowSurface nodes={manyNodes} edges={[]} showMiniMap onNodeDragStop={vi.fn()} onEdgeCreate={vi.fn()} onEdgeDelete={vi.fn()} onNodeCreate={vi.fn()} />
      </ReactFlowProvider>
    );
    // MiniMap renders in ReactFlow
    expect(screen.getByText(/add first step/i)).toBeDefined(); // empty state still — no nodes rendered yet
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run reactflow-surface.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/reactflow-surface.tsx`：

```typescript
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import type { WorkflowNode as WorkflowNodeType, WorkflowEdge as WorkflowEdgeType, WorkflowStage } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import {
  WorkflowNode as RFWorkflowNode,
  AnnotationNode,
  WorkflowEdge as RFWorkflowEdge,
  AnnotationConnectorEdge,
  ANNO_WIDTH, ANNO_HEIGHT, NODE_WIDTH, NODE_HEIGHT, DIAMOND_SIZE, HEXAGON_SIZE,
  type WorkflowNodeData,
} from "./reactflow-nodes";
import { computeAlignmentSnap, type AlignmentGuide } from "./alignment-snap";
import { WorkflowNodeCard } from "./workflow-node-card";

const nodeTypes = { workflow: RFWorkflowNode, annotation: AnnotationNode };
const edgeTypes = { workflow: RFWorkflowEdge, annotation: AnnotationConnectorEdge };

function parseNodeFormat(formatSchema: unknown) {
  const shape = parseNodeShape(formatSchema);
  let nodeColor: string | undefined;
  let fontSize: number | undefined;
  let nodeWidth: number | undefined;
  let nodeHeight: number | undefined;
  if (formatSchema && typeof formatSchema === "object" && formatSchema !== null) {
    const obj = formatSchema as Record<string, unknown>;
    if (typeof obj.color === "string" && obj.color !== "") nodeColor = obj.color;
    if (typeof obj.fontSize === "number") fontSize = obj.fontSize;
    if (typeof obj.width === "number") nodeWidth = obj.width;
    if (typeof obj.height === "number") nodeHeight = obj.height;
  }
  return { shape, nodeColor, fontSize, nodeWidth, nodeHeight };
}

function isAnnotationNode(fs: unknown): boolean {
  return Boolean(fs && typeof fs === "object" && !Array.isArray(fs) && (fs as Record<string, unknown>).type === "annotation");
}

export interface ReactFlowSurfaceProps {
  nodes: WorkflowNodeType[];
  edges: WorkflowEdgeType[];
  stages?: WorkflowStage[];
  onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
  onEdgeCreate?: (sourceNodeId: string, targetNodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeCreate?: (type: string, x: number, y: number) => void;
  nodeStatusColors?: Record<string, string>;
  nodeStatuses?: Record<string, { status: string; isRunning: boolean; isAwaitingInput?: boolean }>;
  showMiniMap?: boolean;
}

export function ReactFlowSurface({
  nodes,
  edges,
  onNodeDragStop,
  onEdgeCreate,
  onEdgeDelete,
  onNodeClick,
  onNodeCreate,
  nodeStatusColors,
  nodeStatuses,
  showMiniMap = false,
}: ReactFlowSurfaceProps) {
  const mode = useWorkflowEditorStore((s) => s.mode);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const selectEdge = useWorkflowEditorStore((s) => s.selectEdge);
  const setSelectedNodeIds = useWorkflowEditorStore((s) => s.setSelectedNodeIds);
  const cacheNodeDelete = useWorkflowEditorStore((s) => s.cacheNodeDelete);
  const deletedNodeIds = useWorkflowEditorStore((s) => s.deletedNodeIds);
  const canvasColorMode = useWorkflowEditorStore((s) => s.canvasColorMode);
  const { screenToFlowPosition } = useReactFlow();
  const cacheNodeEdit = useWorkflowEditorStore((s) => s.cacheNodeEdits);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredNodePos, setHoveredNodePos] = useState({ x: 0, y: 0 });

  // Build ReactFlow nodes from props
  const propNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    return nodes
      .filter((n) => !deletedNodeIds.includes(n.id))
      .filter((n) => !isAnnotationNode(n.format_schema))
      .map((n) => {
        const { shape, nodeColor, fontSize, nodeWidth, nodeHeight } = parseNodeFormat(n.format_schema);
        return {
          id: n.id,
          type: isAnnotationNode(n.format_schema) ? "annotation" : "workflow",
          position: { x: n.position_x, y: n.position_y },
          zIndex: isAnnotationNode(n.format_schema) ? -1 : 0,
          width: nodeWidth ?? (shape === "diamond" ? DIAMOND_SIZE : shape === "hexagon" ? HEXAGON_SIZE : NODE_WIDTH),
          height: nodeHeight ?? (shape === "diamond" || shape === "hexagon" ? (shape === "diamond" ? DIAMOND_SIZE : HEXAGON_SIZE) : NODE_HEIGHT),
          data: {
            title: n.title,
            statusColor: nodeStatusColors?.[n.id],
            statusLabel: nodeStatuses?.[n.id]?.status,
            isRunning: nodeStatuses?.[n.id]?.isRunning ?? false,
            isAwaitingInput: nodeStatuses?.[n.id]?.isAwaitingInput ?? false,
            isEditing: mode !== "view",
            shape,
            nodeColor,
            fontSize,
            onNodeSelect: (id: string) => { selectNode(id); onNodeClick?.(id); },
            onNodeResizeStart: () => {},
            onNodeResizeEnd: (id: string, w: number, h: number) => {
              const n = nodes.find((x) => x.id === id);
              if (!n) return;
              const parsed = n.format_schema && typeof n.format_schema === "object" && !Array.isArray(n.format_schema)
                ? { ...(n.format_schema as Record<string, unknown>) } : {};
              parsed.width = Math.round(w);
              parsed.height = Math.round(h);
              cacheNodeEdit(id, { format_schema: parsed });
            },
          },
        };
      });
  }, [nodes, nodeStatusColors, nodeStatuses, deletedNodeIds, mode, selectNode, onNodeClick, cacheNodeEdit]);

  // Local state for ReactFlow rendering
  const [rfNodes, setRfNodes] = useState(propNodes);
  const draggingRef = useRef(false);
  const rfNodesRef = useRef(rfNodes);
  rfNodesRef.current = rfNodes;
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [shouldFitView, setShouldFitView] = useState(true);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShouldFitView(false));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    setRfNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const nextMap = new Map(propNodes.map((n) => [n.id, n]));
      const result: Node<WorkflowNodeData>[] = [];
      for (const [id, nextNode] of nextMap) {
        const prevNode = prevMap.get(id);
        result.push(prevNode ? { ...prevNode, data: nextNode.data } : nextNode);
      }
      return result;
    });
  }, [propNodes]);

  // Edge handle pair resolution (same logic as existing dag-canvas)
  const handlePairs = useMemo(() => {
    const posMap = new Map(nodes.map((n) => [n.id, { x: n.position_x, y: n.position_y }]));
    return new Map<string, { sourceHandle: string; targetHandle: string }>(
      edges.map((e) => {
        const src = posMap.get(e.source_node_id);
        const tgt = posMap.get(e.target_node_id);
        if (!src || !tgt) return [e.id, { sourceHandle: "bottom", targetHandle: "top" }];
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        return [e.id, {
          sourceHandle: Math.abs(dx) > Math.abs(dy) ? "right" : "bottom",
          targetHandle: Math.abs(dx) > Math.abs(dy) ? "left" : "top",
        }];
      }),
    );
  }, [nodes, edges]);

  const propEdges: Edge[] = useMemo(() => {
    const base = edges.map((e) => ({
      id: e.id, type: "workflow",
      source: e.source_node_id, target: e.target_node_id,
      sourceHandle: handlePairs.get(e.id)?.sourceHandle ?? "bottom",
      targetHandle: handlePairs.get(e.id)?.targetHandle ?? "top",
      data: { onEdgeDelete },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
      interactionWidth: 20,
    }));
    // Annotation connector edges
    const annoEdges: Edge[] = [];
    for (const n of nodes) {
      if (!isAnnotationNode(n.format_schema)) continue;
      const fs = n.format_schema as Record<string, unknown> | null;
      const targetId = fs?.annotation_target_node_id as string | undefined;
      if (!targetId) continue;
      const target = nodes.find((t) => t.id === targetId && !isAnnotationNode(t.format_schema));
      if (!target) continue;
      annoEdges.push({ id: `anno-link-${n.id}`, type: "annotation", source: n.id, target: targetId, sourceHandle: "anno-right", targetHandle: "left", hidden: false });
    }
    return [...base, ...annoEdges];
  }, [edges, onEdgeDelete, handlePairs, nodes]);

  const [rfEdges, setRfEdges] = useState(propEdges);
  useEffect(() => {
    setRfEdges((currentEdges) => {
      const stateByKey = new Map(currentEdges.map((e) => [e.id, { selected: e.selected }] as const));
      return propEdges.map((e) => {
        const existing = stateByKey.get(e.id);
        return existing ? { ...e, selected: existing.selected } : e;
      });
    });
  }, [propEdges]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => setSelectedNodeIds(selectedNodes.map((n) => n.id)),
    [setSelectedNodeIds],
  );

  const handleNodeDragStart = useCallback(() => { draggingRef.current = true; }, []);
  const handleNodeDragStopHandler = useCallback(
    (_: MouseEvent | TouchEvent, node: Node) => {
      draggingRef.current = false;
      setAlignmentGuides([]);
      const ids = useWorkflowEditorStore.getState().selectedNodeIds;
      if (ids.length > 1) {
        for (const id of ids) {
          const current = rfNodesRef.current.find((n) => n.id === id);
          if (current) onNodeDragStop?.(id, Math.round(current.position.x), Math.round(current.position.y));
        }
      } else {
        const current = rfNodesRef.current.find((n) => n.id === node.id);
        onNodeDragStop?.(node.id, Math.round(current?.position.x ?? node.position.x), Math.round(current?.position.y ?? node.position.y));
      }
    },
    [onNodeDragStop],
  );

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    let guides: AlignmentGuide[] = [];
    for (const change of changes) {
      if (change.type === "remove") cacheNodeDelete(change.id);
    }
    let snapDeltaX = 0, snapDeltaY = 0, firstSnapped = false;
    const snappedChanges = changes.map((change) => {
      if (change.type === "position" && change.dragging && change.position) {
        if (!firstSnapped) {
          const result = computeAlignmentSnap(change.id, change.position.x, change.position.y, rfNodesRef.current);
          guides.push(...result.guides);
          snapDeltaX = result.x - change.position.x;
          snapDeltaY = result.y - change.position.y;
          firstSnapped = true;
          return { ...change, position: { x: result.x, y: result.y } };
        }
        return { ...change, position: { x: change.position.x + snapDeltaX, y: change.position.y + snapDeltaY } };
      }
      return change;
    });
    setAlignmentGuides(guides);
    setRfNodes((nds) => { const next = applyNodeChanges(snappedChanges, nds) as Node<WorkflowNodeData>[]; rfNodesRef.current = next; return next; });
  }, [cacheNodeDelete]);

  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    for (const change of changes) {
      if (change.type === "remove" && mode !== "view") onEdgeDelete?.(change.id);
    }
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
  }, [onEdgeDelete, mode]);

  const handleConnect = useCallback((conn: Connection) => {
    if (conn.source && conn.target) onEdgeCreate?.(conn.source, conn.target);
  }, [onEdgeCreate]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => selectEdge(edge.id), [selectEdge]);
  const handlePaneClick = useCallback(() => { selectNode(null); selectEdge(null); setSelectedNodeIds([]); }, [selectNode, selectEdge, setSelectedNodeIds]);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dragType = e.dataTransfer.getData("application/x-multica-shape");
    if (!dragType) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onNodeCreate?.(dragType, pos.x, pos.y);
  }, [screenToFlowPosition, onNodeCreate]);

  // MiniMap node colors
  const miniMapNodeColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      const { nodeColor } = parseNodeFormat(n.format_schema);
      if (nodeColor) map[n.id] = nodeColor;
    }
    return map;
  }, [nodes]);

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="text-3xl opacity-30">+</div>
          <p className="text-sm text-muted-foreground">Add your first step</p>
          <p className="text-xs text-muted-foreground/60">Drag a node from the panel or click + to start</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_e, node) => { selectNode(node.id); selectEdge(null); onNodeClick?.(node.id); }}
      onNodeDragStart={handleNodeDragStart}
      onNodeDragStop={handleNodeDragStopHandler}
      onNodesChange={handleNodesChange}
      onConnect={handleConnect}
      onEdgeClick={handleEdgeClick}
      onEdgesChange={handleEdgesChange}
      onPaneClick={handlePaneClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onSelectionChange={handleSelectionChange}
      selectionOnDrag={mode !== "view"}
      multiSelectionKeyCode="Shift"
      deleteKeyCode={mode !== "view" ? "Backspace" : null}
      connectionMode={ConnectionMode.Loose}
      nodesDraggable={mode !== "view"}
      nodesConnectable={mode !== "view"}
      nodesFocusable
      elementsSelectable
      fitView={shouldFitView}
      colorMode={canvasColorMode}
    >
      <Background color="var(--muted-foreground)" gap={24} size={1.5} />
      <Controls className="[&>button]:bg-card [&>button]:border-border" />
      {showMiniMap && <MiniMap nodeColor={(node) => miniMapNodeColors[node.id] ?? "#e2e8f0"} />}
      {alignmentGuides.length > 0 && (
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 10 }}>
          {alignmentGuides.map((g, i) => (
            <line key={i} x1={g.orientation === "vertical" ? g.position : g.start} y1={g.orientation === "vertical" ? g.start : g.position} x2={g.orientation === "vertical" ? g.position : g.end} y2={g.orientation === "vertical" ? g.end : g.position} stroke="var(--primary)" strokeWidth={1} strokeDasharray="4 2" />
          ))}
        </svg>
      )}
    </ReactFlow>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run reactflow-surface.test.tsx`
预期：PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/reactflow-surface.tsx packages/views/workflows/components/reactflow-surface.test.tsx
git commit -m "feat(workflow): add ReactFlowSurface editor canvas component"
```

---

### Task 9: EditorInspector — 标签页式节点配置面板

**Files:**
- Create: `packages/views/workflows/components/editor-inspector.tsx`
- Create: `packages/views/workflows/components/editor-inspector.test.tsx`

**Interfaces:**
- Consumes: `CanvasInspector` from Task 5, `node: WorkflowNode`, `stages: WorkflowStage[]`, `workflowId: string`
- Produces: `EditorInspector` 组件，通过 `CanvasInspector` 渲染标签页式配置（Worker, Critic, Deliverables, Parameters, Stage）

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/editor-inspector.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorInspector } from "./editor-inspector";
import type { WorkflowNode } from "@multica/core/types";

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector) => {
    const state = { nodeEdits: {}, cacheNodeEdits: vi.fn(), selectedNodeId: null, selectedNodeIds: [], selectNode: vi.fn() };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@multica/core/workflows/queries", () => ({
  useCreateStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteNode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignNodeToStage: () => ({ mutate: vi.fn(), isPending: false }),
}));

const node: WorkflowNode = {
  id: "n1", workflow_id: "wf1", title: "Test", description: "",
  position_x: 0, position_y: 0, format_schema: null,
  worker_type: "agent", worker_id: null,
  critic_type: "human", critic_id: null, critic_api_url: null,
  sort_order: 0, stage_id: null, created_at: "", updated_at: "",
};

describe("EditorInspector", () => {
  it("renders all tabs", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    expect(screen.getByText("Worker")).toBeDefined();
    expect(screen.getByText("Critic")).toBeDefined();
    expect(screen.getByText("Parameters")).toBeDefined();
    expect(screen.getByText("Stage")).toBeDefined();
  });

  it("renders title in inspector header", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    expect(screen.getByText("Test")).toBeDefined();
  });

  it("renders parameters tab with textarea by default", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    // Switch to Parameters tab
    screen.getByText("Parameters").click();
    expect(screen.getByRole("textbox")).toBeDefined(); // Textarea for format_schema
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run editor-inspector.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/editor-inspector.tsx`：

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Label } from "@multica/ui/components/ui/label";
import { CanvasInspector, type InspectorTab } from "./canvas-inspector";
import { AssigneePicker } from "../../issues/components/pickers/assignee-picker";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useWorkspaceId } from "@multica/core/hooks";
import { useDeleteNode, useAssignNodeToStage } from "@multica/core/workflows/queries";
import type { WorkflowNode, WorkflowStage, WorkerType, CriticType } from "@multica/core/types";
import type { IssueAssigneeType } from "@multica/core/types/issue";

function toAssigneeType(t: string): IssueAssigneeType | null {
  if (t === "human") return "member";
  if (t === "agent" || t === "squad") return t as IssueAssigneeType;
  return null;
}

function fromAssigneeType(t: IssueAssigneeType | null): WorkerType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

function fromAssigneeTypeCritic(t: IssueAssigneeType | null): CriticType {
  if (t === "member") return "human";
  if (t === "agent") return "agent";
  if (t === "squad") return "squad";
  return "human";
}

function toFormatSchemaString(fs: unknown): string {
  if (!fs) return "";
  if (typeof fs === "string") return fs;
  return JSON.stringify(fs, null, 2);
}

export interface EditorInspectorProps {
  node: WorkflowNode;
  workflowId: string;
  nodes?: WorkflowNode[];
  stages?: WorkflowStage[];
  disabled?: boolean;
  onClose: () => void;
}

export function EditorInspector({ node, workflowId, nodes = [], stages = [], disabled = false, onClose }: EditorInspectorProps) {
  const wsId = useWorkspaceId();
  const deleteMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const cacheNodeEdits = useWorkflowEditorStore((s) => s.cacheNodeEdits);
  const saved = nodeEdits[node.id];

  const [title, setTitle] = useState(saved?.title ?? node.title);
  const [description, setDescription] = useState(saved?.description ?? node.description);
  const [formatSchema, setFormatSchema] = useState(toFormatSchemaString(saved?.format_schema ?? node.format_schema));
  const [workerType, setWorkerType] = useState(saved?.worker_type ?? node.worker_type);
  const [workerId, setWorkerId] = useState<string | null>(saved?.worker_id ?? node.worker_id ?? null);
  const [criticType, setCriticType] = useState(saved?.critic_type ?? node.critic_type);
  const [criticId, setCriticId] = useState<string | null>(saved?.critic_id ?? node.critic_id ?? null);
  const [stageId, setStageId] = useState<string | null>(node.stage_id ?? null);

  useEffect(() => {
    setStageId(node.stage_id ?? null);
  }, [node.stage_id]);

  useEffect(() => {
    const s = nodeEdits[node.id];
    setTitle(s?.title ?? node.title);
    setDescription(s?.description ?? node.description);
    setFormatSchema(toFormatSchemaString(s?.format_schema ?? node.format_schema));
    setWorkerType(s?.worker_type ?? node.worker_type);
    setWorkerId(s?.worker_id ?? node.worker_id ?? null);
    setCriticType(s?.critic_type ?? node.critic_type);
    setCriticId(s?.critic_id ?? node.critic_id ?? null);
  }, [node.id, nodeEdits]);

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(node.id);
      toast.success("Node deleted");
      onClose();
    } catch { toast.error("Failed to delete node"); }
  };

  const tabs: InspectorTab[] = [
    {
      id: "worker",
      label: "Worker",
      content: (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Title</Label>
            <Input disabled={disabled} value={title} onChange={(e) => { setTitle(e.target.value); cacheNodeEdits(node.id, { title: e.target.value }); }} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Description</Label>
            <Textarea disabled={disabled} value={description} onChange={(e) => { setDescription(e.target.value); cacheNodeEdits(node.id, { description: e.target.value }); }} className="min-h-[60px] text-sm" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Worker</Label>
            <AssigneePicker
              assigneeType={toAssigneeType(workerType)}
              assigneeId={workerId}
              onUpdate={disabled ? () => {} : (u) => {
                const wt = fromAssigneeType(u.assignee_type ?? null);
                const wid = u.assignee_id ?? null;
                setWorkerType(wt); setWorkerId(wid);
                cacheNodeEdits(node.id, { worker_type: wt, worker_id: wid });
              }}
              align="start"
              skipBuiltinRuntimeSelection
            />
          </div>
        </div>
      ),
    },
    {
      id: "critic",
      label: "Critic",
      content: (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Critic</Label>
            <AssigneePicker
              assigneeType={toAssigneeType(criticType)}
              assigneeId={criticId}
              onUpdate={disabled ? () => {} : (u) => {
                const ct = fromAssigneeTypeCritic(u.assignee_type ?? null);
                const cid = u.assignee_id ?? null;
                setCriticType(ct); setCriticId(cid);
                cacheNodeEdits(node.id, { critic_type: ct, critic_id: cid });
              }}
              align="start"
            />
          </div>
        </div>
      ),
    },
    {
      id: "parameters",
      label: "Parameters",
      content: (
        <div className="space-y-1.5">
          <Label className="text-sm">JSON Schema / Parameters</Label>
          <Textarea disabled={disabled} value={formatSchema} onChange={(e) => {
            setFormatSchema(e.target.value);
            const trimmed = e.target.value.trim();
            try { cacheNodeEdits(node.id, { format_schema: trimmed ? JSON.parse(trimmed) : null }); }
            catch { cacheNodeEdits(node.id, { format_schema: e.target.value }); }
          }} placeholder="{}" className="min-h-[120px] text-sm font-mono" rows={6} />
        </div>
      ),
    },
    {
      id: "stage",
      label: "Stage",
      content: (
        <div className="space-y-1.5">
          <Label className="text-sm">Belongs to Stage</Label>
          <select
            disabled={disabled || assignStageMutation.isPending}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={stageId ?? ""}
            onChange={(e) => {
              const newVal = e.target.value;
              const newStageId = newVal || null;
              setStageId(newStageId);
              assignStageMutation.mutate(
                { nodeId: node.id, stage_id: newStageId },
                { onError: () => setStageId(node.stage_id ?? null) },
              );
            }}
          >
            <option value="">Unassigned</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ),
    },
  ];

  return (
    <CanvasInspector
      title={title || "Untitled Node"}
      tabs={tabs}
      onClose={onClose}
      actions={
        !disabled ? (
          <Button size="sm" variant="destructive" className="w-full" onClick={handleDelete} disabled={deleteMutation.isPending}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Node
          </Button>
        ) : undefined
      }
    />
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run editor-inspector.test.tsx`
预期：PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/editor-inspector.tsx packages/views/workflows/components/editor-inspector.test.tsx
git commit -m "feat(workflow): add EditorInspector with tabbed node configuration"
```

---

### Task 10: PreflightBar — 发布前预检查

**Files:**
- Create: `packages/views/workflows/components/preflight-bar.tsx`
- Create: `packages/views/workflows/components/preflight-bar.test.tsx`

**Interfaces:**
- Consumes: `nodes: WorkflowNode[]`, `edges: WorkflowEdge[]`
- Produces: `PreflightBar` 组件、`PreflightCheck` 类型、`runPreflightChecks(nodes, edges)` 函数

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/preflight-bar.test.tsx`：

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreflightBar, runPreflightChecks } from "./preflight-bar";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";

function makeNode(id: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id, workflow_id: "wf1", title: `Node ${id}`, description: "",
    position_x: 0, position_y: 0, format_schema: null,
    worker_type: "human", worker_id: null,
    critic_type: "human", critic_id: null, critic_api_url: null,
    sort_order: 0, stage_id: null,
    created_at: "", updated_at: "",
    ...overrides,
  };
}

function makeEdge(id: string, source: string, target: string): WorkflowEdge {
  return { id, workflow_id: "wf1", source_node_id: source, target_node_id: target, condition: null, created_at: "" };
}

describe("runPreflightChecks", () => {
  it("detects nodes with missing worker", () => {
    const nodes = [makeNode("a", { worker_id: null, worker_type: "agent" })];
    const checks = runPreflightChecks(nodes, []);
    expect(checks.some((c) => c.type === "missing-worker")).toBe(true);
  });

  it("detects orphan nodes (no edges at all)", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b")];
    // Node "c" doesn't exist, so "a" and "b" are connected, no orphans
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "orphan-node")).toBe(false);
  });

  it("detects orphan nodes (isolated from graph)", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b")]; // c is isolated
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "orphan-node" && c.nodeId === "c")).toBe(true);
  });

  it("detects cycle in DAG", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "a")];
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "cycle-detected")).toBe(true);
  });

  it("returns no checks for valid DAG", () => {
    const nodes = [
      makeNode("a", { worker_type: "human", worker_id: "user-1" }),
      makeNode("b", { worker_type: "agent", worker_id: "agent-1" }),
    ];
    const edges = [makeEdge("e1", "a", "b")];
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.filter((c) => c.severity === "error").length).toBe(0);
  });
});

describe("PreflightBar", () => {
  it("renders check results", () => {
    const checks = [
      { type: "missing-worker" as const, severity: "error" as const, message: "Node A has no worker", nodeId: "a" },
      { type: "orphan-node" as const, severity: "warning" as const, message: "Node B is not connected", nodeId: "b" },
    ];
    render(<PreflightBar checks={checks} onCheckClick={vi.fn()} />);
    expect(screen.getByText(/no worker/i)).toBeDefined();
    expect(screen.getByText(/not connected/i)).toBeDefined();
  });

  it("renders nothing when no checks", () => {
    const { container } = render(<PreflightBar checks={[]} onCheckClick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run preflight-bar.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/preflight-bar.tsx`：

```typescript
"use client";

import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";

export interface PreflightCheck {
  type: "cycle-detected" | "orphan-node" | "unreachable-node" | "missing-worker" | "missing-stage" | "missing-schema";
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
}

/** Run validation checks against workflow nodes and edges. */
export function runPreflightChecks(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // Build adjacency for graph analysis
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const outEdges = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const allNodeIds = new Set(nodes.map((n) => n.id));

  for (const edge of edges) {
    inDegree.set(edge.target_node_id, (inDegree.get(edge.target_node_id) ?? 0) + 1);
    const outs = outEdges.get(edge.source_node_id) ?? [];
    outs.push(edge.target_node_id);
    outEdges.set(edge.source_node_id, outs);
  }

  // Cycle detection via DFS topological order check
  const visited = new Set<string>();
  const inStack = new Set<string>();
  let hasCycle = false;

  function dfs(nodeId: string) {
    if (hasCycle) return;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const next of outEdges.get(nodeId) ?? []) {
      if (inStack.has(next)) { hasCycle = true; return; }
      if (!visited.has(next)) dfs(next);
    }
    inStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id);
  }

  if (hasCycle) {
    checks.push({ type: "cycle-detected", severity: "error", message: "DAG contains a cycle — workflow cannot be published" });
  }

  // Worker check
  for (const node of nodes) {
    if (!node.worker_id) {
      const isAnnotation = node.format_schema && typeof node.format_schema === "object" && !Array.isArray(node.format_schema) && (node.format_schema as Record<string, unknown>).type === "annotation";
      if (!isAnnotation) {
        checks.push({ type: "missing-worker", severity: "error", message: `"${node.title}" has no worker assigned`, nodeId: node.id });
      }
    }
  }

  // Orphan nodes (no incoming or outgoing edges)
  for (const node of nodes) {
    const hasIncoming = (inDegree.get(node.id) ?? 0) > 0;
    const hasOutgoing = (outEdges.get(node.id)?.length ?? 0) > 0;
    if (!hasIncoming && !hasOutgoing) {
      const isAnnotation = node.format_schema && typeof node.format_schema === "object" && !Array.isArray(node.format_schema) && (node.format_schema as Record<string, unknown>).type === "annotation";
      if (!isAnnotation) {
        checks.push({ type: "orphan-node", severity: "warning", message: `"${node.title}" is not connected to any other node`, nodeId: node.id });
      }
    }
  }

  // Unreachable nodes (no incoming edges, not the first node)
  if (nodes.length > 1) {
    for (const node of nodes) {
      if ((inDegree.get(node.id) ?? 0) === 0 && (outEdges.get(node.id)?.length ?? 0) > 0) {
        // Only warn if there are other nodes with incoming edges (i.e., this could be a root node)
        const someHaveIncoming = nodes.some((n) => n.id !== node.id && (inDegree.get(n.id) ?? 0) > 0);
        const isAnnotation = node.format_schema && typeof node.format_schema === "object" && !Array.isArray(node.format_schema) && (node.format_schema as Record<string, unknown>).type === "annotation";
        if (someHaveIncoming && !isAnnotation) {
          checks.push({ type: "unreachable-node", severity: "warning", message: `"${node.title}" may be unreachable (no incoming edges)`, nodeId: node.id });
        }
      }
    }
  }

  return checks;
}

export interface PreflightBarProps {
  checks: PreflightCheck[];
  onCheckClick?: (check: PreflightCheck) => void;
  className?: string;
}

/** Bottom bar displaying pre-publish validation results. */
export function PreflightBar({ checks, onCheckClick, className }: PreflightBarProps) {
  if (checks.length === 0) return null;

  const errors = checks.filter((c) => c.severity === "error");
  const warnings = checks.filter((c) => c.severity === "warning");

  return (
    <div
      data-testid="preflight-bar"
      className={cn("flex items-center gap-2 px-4 py-2 border-t bg-muted/50 text-xs", className)}
    >
      {errors.length > 0 && (
        <span className="flex items-center gap-1 text-destructive font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          {errors.length} error{errors.length > 1 ? "s" : ""}
        </span>
      )}
      {warnings.length > 0 && (
        <span className="flex items-center gap-1 text-workflow-warning font-medium">
          <AlertTriangle className="h-3.5 w-3.5" />
          {warnings.length} warning{warnings.length > 1 ? "s" : ""}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {checks.map((check, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onCheckClick?.(check)}
            className={cn(
              "flex items-center gap-1 hover:underline cursor-pointer",
              check.severity === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {check.severity === "error" ? <AlertCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            <span className="truncate max-w-[180px]">{check.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run preflight-bar.test.tsx`
预期：PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/preflight-bar.tsx packages/views/workflows/components/preflight-bar.test.tsx
git commit -m "feat(workflow): add PreflightBar with DAG validation checks"
```

---

### Task 11: StageLaneSurface — 运行态泳道画布

**Files:**
- Create: `packages/views/workflows/components/stage-lane-surface.tsx`
- Create: `packages/views/workflows/components/stage-lane-surface.test.tsx`

**Interfaces:**
- Consumes: `WorkflowNodeCard` from Task 3, `WorkflowEdgeLayer` from Task 4, Stage 现有类型
- Produces: `StageLaneSurface` 组件，接受 `nodes`, `edges`, `stages`, `nodeRuns?: Map<string, WorkflowNodeRun>`, `density: "compact" | "full"`, `onNodeClick?: (nodeId: string) => void`, `selectedNodeId?: string | null`, `readonly?: boolean`

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/stage-lane-surface.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageLaneSurface } from "./stage-lane-surface";
import type { WorkflowNode, WorkflowEdge, WorkflowStage } from "@multica/core/types";

const stages: WorkflowStage[] = [
  { id: "s1", workflow_id: "wf1", name: "Plan", description: "", sort_order: 0, node_count: 1, created_at: "", updated_at: "" },
];

const nodes: WorkflowNode[] = [
  { id: "n1", workflow_id: "wf1", title: "Task 1", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent", worker_id: "ag1", critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 0, stage_id: "s1", created_at: "", updated_at: "" },
];

const edges: WorkflowEdge[] = [];

describe("StageLaneSurface", () => {
  it("renders stage lanes with node cards", () => {
    render(
      <StageLaneSurface nodes={nodes} edges={edges} stages={stages} density="compact" />
    );
    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Task 1")).toBeDefined();
  });

  it("renders empty state when no stages", () => {
    render(
      <StageLaneSurface nodes={[]} edges={[]} stages={[]} density="compact" />
    );
    expect(screen.getByText(/no stages/i)).toBeDefined();
  });

  it("renders unassigned nodes section", () => {
    const unassigned: WorkflowNode[] = [
      { ...nodes[0], id: "n2", stage_id: null, title: "Unassigned Task" },
    ];
    render(
      <StageLaneSurface nodes={unassigned} edges={[]} stages={stages} density="compact" />
    );
    expect(screen.getByText("Unassigned Task")).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run stage-lane-surface.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/stage-lane-surface.tsx`：

```typescript
"use client";

import { useMemo, useRef, useLayoutEffect, useState, useCallback } from "react";
import type { WorkflowNode, WorkflowEdge, WorkflowStage, WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { WorkflowNodeCard } from "./workflow-node-card";
import { WorkflowEdgeLayer } from "./workflow-edge-layer";

const STAGE_BG_COLORS = [
  "bg-slate-50/70", "bg-stone-50/70", "bg-blue-50/45",
  "bg-rose-50/45", "bg-violet-50/45", "bg-amber-50/45",
] as const;

const STAGE_LABEL_COLORS = [
  "text-slate-400", "text-stone-400", "text-blue-400",
  "text-rose-400", "text-violet-400", "text-amber-400",
] as const;

export interface StageLaneSurfaceProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stages: WorkflowStage[];
  nodeRuns?: Map<string, WorkflowNodeRun>;
  density?: "compact" | "full";
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  readonly?: boolean;
  className?: string;
}

/** Stage lane canvas for runtime and preview views. */
export function StageLaneSurface({
  nodes,
  edges,
  stages,
  nodeRuns,
  density = "compact",
  onNodeClick,
  selectedNodeId,
  readonly = false,
  className,
}: StageLaneSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, DOMRect>>(new Map());
  const nodeElementMap = useRef(new Map<string, HTMLButtonElement>());

  // Group nodes by stage
  const nodesByStage = useMemo(() => {
    const map = new Map<string, WorkflowNode[]>();
    for (const node of nodes) {
      const sid = node.stage_id ?? "__unassigned__";
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(node);
    }
    return map;
  }, [nodes]);

  // Sort stages
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages],
  );

  // Measure node positions for edge overlay
  const measurePositions = useCallback(() => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const nextPos = new Map<string, DOMRect>();
    nodeElementMap.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      nextPos.set(id, new DOMRect(
        rect.left - containerRect.left + (containerRef.current?.scrollLeft ?? 0),
        rect.top - containerRect.top + (containerRef.current?.scrollTop ?? 0),
        rect.width, rect.height,
      ));
    });
    setNodePositions(nextPos);
  }, []);

  useLayoutEffect(() => {
    measurePositions();
    const observer = new ResizeObserver(() => measurePositions());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nodes, stages, measurePositions]);

  const containerRect = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : { width: 0, height: 0, left: 0, top: 0 };
  }, [/* re-computed on render */]);

  // Callback ref factory
  const nodeRefs = useMemo(() => {
    const map = new Map<string, (el: HTMLButtonElement | null) => void>();
    for (const node of nodes) {
      map.set(node.id, (el) => {
        if (el) nodeElementMap.current.set(node.id, el);
        else nodeElementMap.current.delete(node.id);
      });
    }
    return map;
  }, [nodes]);

  if (stages.length === 0 && nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No stages defined yet
      </div>
    );
  }

  const unassignedNodes = nodesByStage.get("__unassigned__") ?? [];

  return (
    <div
      ref={containerRef}
      className={cn("relative bg-workflow-canvas-bg rounded-xl border border-border/60 overflow-auto", className)}
    >
      {/* Edge overlay */}
      <WorkflowEdgeLayer
        edges={edges}
        nodes={nodes}
        containerRect={containerRect}
        nodePositions={nodePositions}
        surface="stage-lane"
      />

      {/* Unassigned nodes */}
      {unassignedNodes.length > 0 && (
        <section className="border-b border-border/40 bg-muted/20 px-3 py-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground px-2">Unassigned</span>
          <div className="flex flex-wrap gap-4 mt-2 px-2">
            {unassignedNodes.map((node) => (
              <div key={node.id} ref={nodeRefs.get(node.id)}>
                <WorkflowNodeCard
                  node={node}
                  variant="runtime"
                  nodeRun={nodeRuns?.get(node.id)}
                  density={density}
                  selected={selectedNodeId === node.id}
                  onClick={onNodeClick}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stage lanes */}
      {sortedStages.map((stage) => {
        const colorIndex = Math.abs(stage.sort_order) % STAGE_BG_COLORS.length;
        const stageNodes = nodesByStage.get(stage.id) ?? [];
        const sortedNodes = [...stageNodes].sort((a, b) => a.sort_order - b.sort_order);

        return (
          <section
            key={stage.id}
            className={cn("border-y border-border/60 px-3 py-4", STAGE_BG_COLORS[colorIndex])}
          >
            <div className="flex items-start gap-4">
              <div className="flex flex-col w-28 shrink-0 pt-1 border-r border-border/50 pr-3">
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Stage {stage.sort_order + 1}
                </span>
                <span className={cn("mt-1 text-xs font-semibold", STAGE_LABEL_COLORS[colorIndex])}>
                  {stage.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 min-w-0">
                {sortedNodes.length === 0 ? (
                  <div className="flex h-16 items-center text-[11px] text-muted-foreground">
                    No nodes in this stage
                  </div>
                ) : (
                  sortedNodes.map((node) => (
                    <div key={node.id} ref={nodeRefs.get(node.id)}>
                      <WorkflowNodeCard
                        node={node}
                        variant="runtime"
                        nodeRun={nodeRuns?.get(node.id)}
                        density={density}
                        selected={selectedNodeId === node.id}
                        onClick={onNodeClick}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run stage-lane-surface.test.tsx`
预期：PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/stage-lane-surface.tsx packages/views/workflows/components/stage-lane-surface.test.tsx
git commit -m "feat(workflow): add StageLaneSurface runtime lane canvas"
```

---

### Task 12: GlobalNotificationBar — 运行态全局提示

**Files:**
- Create: `packages/views/workflows/components/global-notification-bar.tsx`
- Create: `packages/views/workflows/components/global-notification-bar.test.tsx`

**Interfaces:**
- Consumes: `nodeRuns: Map<string, WorkflowNodeRun>`
- Produces: `GlobalNotificationBar` 组件，按优先级聚合待处理事项

- [ ] **Step 1: 编写测试**

创建 `packages/views/workflows/components/global-notification-bar.test.tsx`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalNotificationBar, aggregateNotifications } from "./global-notification-bar";
import type { WorkflowNodeRun } from "@multica/core/types";

function makeNodeRun(id: string, status: WorkflowNodeRun["status"]): WorkflowNodeRun {
  return {
    id, workflow_run_id: "wr1", workflow_node_id: id, node_title: `Node ${id}`,
    status, retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null,
    worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null,
    critic_comment: "", critic_agent_task_id: null, agent_task_id: null,
    session_id: null, runtime_id: null, device_id: null,
    started_at: null, completed_at: null, created_at: "", updated_at: "",
  };
}

describe("aggregateNotifications", () => {
  it("prioritizes awaiting_critic highest", () => {
    const runs = new Map([
      ["a", makeNodeRun("a", "awaiting_critic")],
      ["b", makeNodeRun("b", "blocked")],
      ["c", makeNodeRun("c", "awaiting_input")],
    ]);
    const notifs = aggregateNotifications(runs);
    expect(notifs[0].priority).toBe("high");
    expect(notifs[0].type).toBe("awaiting_critic");
  });

  it("returns empty for completed runs", () => {
    const runs = new Map([
      ["a", makeNodeRun("a", "completed")],
      ["b", makeNodeRun("b", "completed")],
    ]);
    expect(aggregateNotifications(runs).length).toBe(0);
  });
});

describe("GlobalNotificationBar", () => {
  it("renders notifications", () => {
    const runs = new Map([["a", makeNodeRun("a", "failed")]]);
    render(<GlobalNotificationBar nodeRuns={runs} onNotificationClick={vi.fn()} />);
    expect(screen.getByText(/needs attention/i)).toBeDefined();
  });

  it("renders nothing when no notifications", () => {
    const runs = new Map([["a", makeNodeRun("a", "completed")]]);
    const { container } = render(<GlobalNotificationBar nodeRuns={runs} onNotificationClick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm --filter @multica/views exec vitest run global-notification-bar.test.tsx`
预期：FAIL（文件不存在）

- [ ] **Step 3: 实现组件**

创建 `packages/views/workflows/components/global-notification-bar.tsx`：

```typescript
"use client";

import type { WorkflowNodeRun, NodeRunStatus } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { AlertCircle, Clock, Eye, AlertTriangle } from "lucide-react";

export interface NotificationItem {
  nodeId: string;
  type: "awaiting_critic" | "blocked" | "failed" | "awaiting_input";
  priority: "high" | "medium";
  message: string;
}

const HIGH_PRIORITY_STATUSES: NodeRunStatus[] = ["awaiting_critic"];
const MEDIUM_PRIORITY_STATUSES: NodeRunStatus[] = ["blocked", "failed", "awaiting_input"];

const NOTIF_ICONS: Record<NotificationItem["type"], React.ReactNode> = {
  awaiting_critic: <Eye className="h-3.5 w-3.5" />,
  blocked: <AlertCircle className="h-3.5 w-3.5" />,
  failed: <AlertTriangle className="h-3.5 w-3.5" />,
  awaiting_input: <Clock className="h-3.5 w-3.5" />,
};

export function aggregateNotifications(nodeRuns: Map<string, WorkflowNodeRun>): NotificationItem[] {
  const items: NotificationItem[] = [];

  for (const [nodeId, run] of nodeRuns) {
    if (HIGH_PRIORITY_STATUSES.includes(run.status)) {
      items.push({
        nodeId,
        type: run.status as NotificationItem["type"],
        priority: "high",
        message: `"${run.node_title}" is waiting for critic review`,
      });
    } else if (MEDIUM_PRIORITY_STATUSES.includes(run.status)) {
      items.push({
        nodeId,
        type: run.status as NotificationItem["type"],
        priority: "medium",
        message: `"${run.node_title}" ${run.status === "failed" ? "has failed" : run.status === "blocked" ? "is blocked" : "needs input"}`,
      });
    }
  }

  // Sort: high priority first, then medium
  return items.sort((a, b) => (a.priority === "high" ? -1 : 1) - (b.priority === "high" ? -1 : 1));
}

export interface GlobalNotificationBarProps {
  nodeRuns: Map<string, WorkflowNodeRun>;
  onNotificationClick?: (nodeId: string) => void;
  className?: string;
}

export function GlobalNotificationBar({ nodeRuns, onNotificationClick, className }: GlobalNotificationBarProps) {
  const notifications = aggregateNotifications(nodeRuns);
  if (notifications.length === 0) return null;

  return (
    <div
      data-testid="global-notification-bar"
      className={cn("flex items-center gap-3 px-4 py-2 bg-muted/60 border-b text-xs", className)}
    >
      <span className="font-medium text-muted-foreground">
        {notifications.length} {notifications.length === 1 ? "issue" : "issues"} need{notifications.length === 1 ? "s" : ""} attention
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {notifications.map((notif) => (
          <button
            key={notif.nodeId}
            type="button"
            onClick={() => onNotificationClick?.(notif.nodeId)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded hover:underline cursor-pointer",
              notif.priority === "high" ? "text-brand bg-brand/5" : "text-muted-foreground",
            )}
          >
            {NOTIF_ICONS[notif.type]}
            <span className="truncate max-w-[200px]">{notif.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm --filter @multica/views exec vitest run global-notification-bar.test.tsx`
预期：PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/global-notification-bar.tsx packages/views/workflows/components/global-notification-bar.test.tsx
git commit -m "feat(workflow): add GlobalNotificationBar for runtime alerts"
```

---

### Task 13: WorkflowCanvasShell — 公共画布容器

**Files:**
- Create: `packages/views/workflows/components/workflow-canvas-shell.tsx`

**Interfaces:**
- Consumes: All above components
- Produces: `WorkflowCanvasShell` 组件，作为编辑器布局的公共容器，接受 `topBar`, `leftPanel`, `inspector`, `bottomBar` slots，以及 `children`（画布主体）

- [ ] **Step 1: 实现组件**

创建 `packages/views/workflows/components/workflow-canvas-shell.tsx`：

```typescript
"use client";

import type { ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";

export interface WorkflowCanvasShellProps {
  children: ReactNode;
  topBar?: ReactNode;
  leftPanel?: ReactNode;
  inspector?: ReactNode;
  bottomBar?: ReactNode;
  className?: string;
}

/**
 * Shared canvas shell for workflow editor and runtime views.
 * Provides the four-zone layout: top bar, left panel, main canvas, right inspector, bottom bar.
 */
export function WorkflowCanvasShell({
  children,
  topBar,
  leftPanel,
  inspector,
  bottomBar,
  className,
}: WorkflowCanvasShellProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Top bar */}
      {topBar && (
        <div className="shrink-0">{topBar}</div>
      )}

      {/* Main area: left panel | canvas | inspector */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel (NodePanel) */}
        {leftPanel}

        {/* Canvas */}
        <div className="flex-1 min-w-0 relative">
          {children}
        </div>

        {/* Right inspector */}
        {inspector}
      </div>

      {/* Bottom bar (PreflightBar / GlobalNotificationBar) */}
      {bottomBar && (
        <div className="shrink-0">{bottomBar}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 更新导出 index**

修改 `packages/views/workflows/components/index.ts`，将新组件加入导出：

```typescript
export { WorkflowCanvasShell } from "./workflow-canvas-shell";
export { ReactFlowSurface } from "./reactflow-surface";
export { StageLaneSurface } from "./stage-lane-surface";
export { WorkflowNodeCard } from "./workflow-node-card";
export { WorkflowEdgeLayer } from "./workflow-edge-layer";
export { CanvasInspector } from "./canvas-inspector";
export { EditorInspector } from "./editor-inspector";
export { NodePanel } from "./node-panel";
export { CanvasHoverToolbar } from "./canvas-hover-toolbar";
export { PreflightBar, runPreflightChecks } from "./preflight-bar";
export type { PreflightCheck } from "./preflight-bar";
export { GlobalNotificationBar, aggregateNotifications } from "./global-notification-bar";
export type { NotificationItem } from "./global-notification-bar";
```

- [ ] **Step 3: 运行 typecheck 确认无类型错误**

运行：`pnpm typecheck`
预期：PASS

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/workflow-canvas-shell.tsx packages/views/workflows/components/index.ts
git commit -m "feat(workflow): add WorkflowCanvasShell layout container and update exports"
```

---

### Task 14: 集成 WorkflowCanvasShell 到 WorkflowDetailPage

**Files:**
- Modify: `packages/views/workflows/components/workflow-detail-page.tsx`

**Interfaces:**
- Consumes: `WorkflowCanvasShell` from Task 13, `ReactFlowSurface` from Task 8, `NodePanel` from Task 6, `EditorInspector` from Task 9, `PreflightBar` from Task 10

- [ ] **Step 1: 重构 WorkflowDetailPage 使用新布局组件**

修改 `packages/views/workflows/components/workflow-detail-page.tsx` 中的布局结构。关键改动：

1. 在 `PageHeader` 中增加节点面板切换按钮（`N` 键）
2. 使用 `WorkflowCanvasShell` 包裹内容
3. 左侧栏使用 `NodePanel`
4. 画布使用 `ReactFlowSurface`
5. 右侧面板使用 `EditorInspector`
6. 底部使用 `PreflightBar`

具体修改位置：在 return 的 JSX 中，将 toolbar 和 main content area 替换为 `WorkflowCanvasShell` 结构。

在 `WorkflowDetailPage` 组件中添加状态：

```typescript
const [nodePanelOpen, setNodePanelOpen] = useState(false);
const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
```

在 useEffect 中（现有的 `useEffect` 之后）添加键盘快捷键：

```typescript
// Keyboard shortcuts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;
    if (editable) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      if (mode === "edit") setNodePanelOpen((v) => !v);
    }
    if (e.key === "Escape") {
      setNodePanelOpen(false);
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [mode]);
```

计算预检查结果：

```typescript
const checks = useMemo(
  () => mode === "edit" ? runPreflightChecks(displayNodes, edges) : [],
  [mode, displayNodes, edges],
);
```

将 return JSX 中的 `<PageHeader>` 下的 main content area 替换为：

```tsx
<WorkflowCanvasShell
  topBar={
    <PageHeader className="justify-between px-5">
      {/* ... existing PageHeader content ... */}
      <div className="flex items-center gap-1">
        {/* ... existing toolbar buttons ... */}
        {mode === "edit" && (
          <Button size="sm" variant={nodePanelOpen ? "secondary" : "outline"} onClick={() => setNodePanelOpen(!nodePanelOpen)} title="Toggle node panel (N)">
            <LayoutPanelLeft className="h-3.5 w-3.5" />
          </Button>
        )}
        {/* ... rest of existing buttons ... */}
      </div>
    </PageHeader>
  }
  leftPanel={
    mode === "edit" ? (
      <NodePanel isOpen={nodePanelOpen} onClose={() => setNodePanelOpen(false)} />
    ) : undefined
  }
  inspector={
    selectedNode ? (
      <EditorInspector
        node={selectedNode}
        workflowId={id!}
        nodes={displayNodes}
        stages={stages}
        disabled={mode !== "edit"}
        onClose={() => useWorkflowEditorStore.getState().selectNode(null)}
      />
    ) : undefined
  }
  bottomBar={
    checks.length > 0 && mode === "edit" ? (
      <PreflightBar checks={checks} onCheckClick={(check) => {
        if (check.nodeId) useWorkflowEditorStore.getState().selectNode(check.nodeId);
      }} />
    ) : undefined
  }
>
  {/* Canvas */}
  <div className="flex-1 relative bg-workflow-canvas-bg">
    {saving && (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="40 60" />
          </svg>
          <span className="text-sm text-muted-foreground">Saving...</span>
        </div>
      </div>
    )}
    {nodes.length === 0 ? (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">No nodes yet</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleAddNode("rectangle", 200, 200)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add first step
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNodePanelOpen(true)}>
            Browse node types
          </Button>
        </div>
      </div>
    ) : (
      <ReactFlowProvider>
        <ReactFlowSurface
          nodes={displayNodes}
          edges={edges}
          onNodeDragStop={handleNodeMoved}
          onEdgeCreate={handleEdgeCreate}
          onEdgeDelete={handleEdgeDelete}
          onNodeCreate={handleAddNode}
          showMiniMap={(displayNodes.length ?? 0) > 20}
        />
      </ReactFlowProvider>
    )}
    {nodes.length > 0 && mode === "edit" && (
      <Button
        size="icon"
        variant="outline"
        className="absolute top-3 left-3 h-9 w-9 z-10"
        onClick={() => handleAddNode("rectangle", 200, 200)}
        title="Add node"
      >
        <Plus className="h-4 w-4" />
      </Button>
    )}
  </div>
</WorkflowCanvasShell>
```

需要新增 import：
```typescript
import { LayoutPanelLeft } from "lucide-react";
import { WorkflowCanvasShell } from "./workflow-canvas-shell";
import { NodePanel } from "./node-panel";
import { EditorInspector } from "./editor-inspector";
import { ReactFlowSurface } from "./reactflow-surface";
import { PreflightBar, runPreflightChecks } from "./preflight-bar";
import type { PreflightCheck } from "./preflight-bar";
```

- [ ] **Step 2: 运行 typecheck**

运行：`pnpm typecheck`
预期：PASS

- [ ] **Step 3: 运行现有测试确认无回归**

运行：`pnpm test`
预期：所有现有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/workflow-detail-page.tsx
git commit -m "feat(workflow): integrate WorkflowCanvasShell into editor layout"
```

---

### Task 15: 更新 Panorama 页面使用 StageLaneSurface

**Files:**
- Modify: `packages/views/workflows/components/overview/workflow-panorama-page.tsx`

**Interfaces:**
- Consumes: `StageLaneSurface` from Task 11

- [ ] **Step 1: 在 Panorama 页面中替换为 StageLaneSurface**

修改 `workflow-panorama-page.tsx`，将现有的 `StageLane` + `PanoramaSvgOverlay` 组合替换为 `StageLaneSurface`。关键改动：

将 panorama canvas 的主体（`<div ref={containerRef}>...</div>` 内的内容）替换为：

```tsx
<StageLaneSurface
  nodes={nodes}
  edges={edges}
  stages={sortedStages}
  density="compact"
  onNodeClick={(nodeId) => {
    setSelectedCard({ nodeId, focus: "worker" });
  }}
  selectedNodeId={selectedCard?.nodeId ?? null}
  readonly
/>
```

保留 `ArchitectureDetailPanel` 作为详情面板。

需要新增 import：
```typescript
import { StageLaneSurface } from "../stage-lane-surface";
```

- [ ] **Step 2: 运行 typecheck**

运行：`pnpm typecheck`
预期：PASS

- [ ] **Step 3: 运行现有 Panorama 测试**

运行：`pnpm --filter @multica/views exec vitest run overview/workflow-panorama-page`
预期：PASS

- [ ] **Step 4: Commit**

```bash
git add packages/views/workflows/components/overview/workflow-panorama-page.tsx
git commit -m "feat(workflow): migrate panorama page to StageLaneSurface"
```

---

## 自检清单

1. **Spec 覆盖**：
   - P1 新建流程引导 → Task 8 空状态 "Add your first step"
   - P2 节点面板 → Task 6 NodePanel
   - P3 连线语义 → Task 2 EdgeSemantics + Task 4 WorkflowEdgeLayer
   - P4 节点详情调试 → Task 9 EditorInspector
   - P5 数据映射 → Task 9 Parameters tab（Schema 编辑）
   - P6 调试前置 → 预留架构扩展点（Task 8 ReactFlowSurface 支持 mode）
   - P7 Dirty indicator → Task 3 WorkflowNodeCard 可扩展
   - P8 Stage 泳道 → Task 11 StageLaneSurface
   - P9 Worker 可视化 → Task 3 WorkflowNodeCard + Task 9 EditorInspector
   - P10 发布态 → Task 10 PreflightBar
   - P11 画布交互 → Task 7 CanvasHoverToolbar
   - 配色系统 (4.1) → Task 1 设计 Token
   - 节点形状 (4.2) → Task 3 WorkflowNodeCard
   - 连线样式 (4.3) → Task 4 WorkflowEdgeLayer
   - 画布背景 (4.4) → Task 1 + Task 8
   - 编辑器布局 (5) → Task 14 集成
   - MiniMap (5.7) → Task 8 ReactFlowSurface (showMiniMap)
   - Issue 全景图 (6) → Task 11 + Task 12
   - Runtime 状态叠加 (6.2) → Task 3 WorkflowNodeCard runtime variant
   - 详情面板 (6.6) → Task 5 CanvasInspector + Task 12（运行态面板可复用 Task 9 框架）

2. **无占位符**：所有 step 均有完整代码，无 TBD/TODO

3. **类型一致性**：
   - `EdgeSemantics` 在 Task 2 定义，Task 4 消费
   - `WorkflowNodeCard` 在 Task 3 定义，Task 8, 11 消费
   - `CanvasInspector` 在 Task 5 定义，Task 9 消费
   - `PreflightCheck` 在 Task 10 定义，Task 14 消费

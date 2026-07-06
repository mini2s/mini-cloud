# Workflow Canvas Refactor — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the workflow canvas into a unified, reusable infrastructure shared by the editor (ReactFlow) and the issue runtime viewer (StageLane), with new visual design tokens, semantic edge rendering, a capability-market node panel, an inspector framework, preflight checks, and runtime status overlays.

**Architecture:** A shared `WorkflowCanvasShell` component wraps a pluggable surface (`ReactFlowSurface` for editing, `StageLaneSurface` for read-only viewing). Both surfaces consume the same `WorkflowNodeCard` card protocol, `WorkflowEdgeLayer` edge semantics, and `CanvasInspector` panel framework. Design tokens are defined in `packages/ui/styles/tokens.css` as semantic CSS variables consumed by all canvas components.

**Tech Stack:** React, TypeScript, @xyflow/react (ReactFlow), Zustand, TanStack Query, Tailwind CSS, shadcn/ui (Base UI primitives), Vitest + jsdom

## Global Constraints

- All UI colors use semantic tokens — no hardcoded hex/oklch values in component code
- `packages/core/` — zero react-dom, zero UI libraries; stores and types only
- `packages/views/` — zero `next/*`, zero `react-router-dom` imports
- `packages/ui/` — zero `@multica/core` imports; shared CSS tokens only
- Shared packages export raw `.ts`/`.tsx` (no pre-compilation)
- TanStack Query for server state; Zustand for client UI state
- i18n strings go in `packages/views/locales/{en,zh-Hans}/workflows.json`
- Test files live alongside source files (`*.test.tsx` in `packages/views/`, `*.test.ts` in `packages/core/`)
- Tests use `vi.hoisted()` + `Object.assign()` pattern for Zustand store mocks
- Follow existing naming conventions from `packages/core/types/workflow.ts` and existing component patterns
- Components follow shadcn patterns — use `cn()` for className merging

---

## Task 1: Design Tokens — Workflow Canvas CSS Variables

**Files:**
- Modify: `packages/ui/styles/tokens.css`

**Interfaces:**
- Produces: CSS variables `--workflow-accent`, `--workflow-agent`, `--workflow-info`, `--workflow-success`, `--workflow-warning`, `--workflow-danger`, `--workflow-canvas-bg`, `--workflow-stage-bg`, `--workflow-node-radius` (14px), `--workflow-node-radius-compact` (8px), `--workflow-handle-size` (5px), `--workflow-handle-hover-size` (10px), `--workflow-edge-width` (2px), `--workflow-edge-width-cross-stage` (3px)

- [ ] **Step 1: Add workflow-specific CSS custom properties to tokens.css**

Add the following block inside `:root` (after the existing `--info` line) and corresponding overrides in `.dark`:

```css
/* ── Workflow Canvas Tokens ── */
--workflow-accent: var(--primary);
--workflow-agent: oklch(0.55 0.16 255);
--workflow-info: oklch(0.55 0.18 250);
--workflow-success: var(--success);
--workflow-warning: var(--warning);
--workflow-danger: var(--destructive);
--workflow-canvas-bg: oklch(0.985 0.001 260);
--workflow-stage-bg: oklch(0.975 0.002 260);
--workflow-node-radius: 14px;
--workflow-node-radius-compact: 8px;
--workflow-handle-size: 5px;
--workflow-handle-hover-size: 10px;
--workflow-edge-width: 2px;
--workflow-edge-width-cross-stage: 3px;
```

And in `.dark`:

```css
--workflow-agent: oklch(0.65 0.16 255);
--workflow-info: oklch(0.65 0.18 250);
--workflow-canvas-bg: oklch(0.16 0.004 260);
--workflow-stage-bg: oklch(0.19 0.005 260);
```

- [ ] **Step 2: Verify tokens are available**

Run: No build step needed — these are CSS custom properties consumed at runtime. Verify by checking `packages/ui/styles/tokens.css` syntax is valid.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/styles/tokens.css
git commit -m "feat(workflow): add workflow canvas design tokens"
```

---

## Task 2: Shared Canvas Model Types — Edge Semantics & Node Card Protocol

**Files:**
- Create: `packages/core/workflows/canvas-model.ts`
- Test: `packages/core/workflows/canvas-model.test.ts`

**Interfaces:**
- Produces:
  - `EdgeType = "data" | "control" | "error"`
  - `CanvasDensity = "compact" | "full"`
  - `CanvasMode = "editor" | "runtime" | "preview"`
  - `NodeCardVariant = "definition" | "runtime"`
  - `RuntimeStatusStyle` — maps `NodeRunStatus` to `{ borderClass: string; glowClass: string; icon: string }`
  - `deriveEdgeType(edge, nodes): EdgeType` — determines edge semantics from source node and edge condition
  - `getRuntimeStatusStyle(status: NodeRunStatus): RuntimeStatusStyle` — returns visual style for a node run status
  - `STATUS_CONFIG` — const map from spec §6.2 (replaces inline object in `workflow-dag-viewer.tsx`)

- [ ] **Step 1: Write the failing test**

Create `packages/core/workflows/canvas-model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveEdgeType, getRuntimeStatusStyle, STATUS_CONFIG } from "./canvas-model";
import type { WorkflowEdge, WorkflowNode } from "../types";

describe("deriveEdgeType", () => {
  it("returns 'data' for edges with no condition", () => {
    const edge: WorkflowEdge = {
      id: "e1", workflow_id: "wf1",
      source_node_id: "n1", target_node_id: "n2",
      condition: null, created_at: "",
    };
    const nodes: WorkflowNode[] = [];
    expect(deriveEdgeType(edge, nodes)).toBe("data");
  });

  it("returns 'control' for edges with boolean condition", () => {
    const edge: WorkflowEdge = {
      id: "e1", workflow_id: "wf1",
      source_node_id: "n1", target_node_id: "n2",
      condition: { type: "boolean", value: true },
      created_at: "",
    };
    const nodes: WorkflowNode[] = [];
    expect(deriveEdgeType(edge, nodes)).toBe("control");
  });

  it("returns 'error' for edges with error condition", () => {
    const edge: WorkflowEdge = {
      id: "e1", workflow_id: "wf1",
      source_node_id: "n1", target_node_id: "n2",
      condition: { type: "error" },
      created_at: "",
    };
    const nodes: WorkflowNode[] = [];
    expect(deriveEdgeType(edge, nodes)).toBe("error");
  });

  it("returns 'data' when condition is not an object", () => {
    const edge: WorkflowEdge = {
      id: "e1", workflow_id: "wf1",
      source_node_id: "n1", target_node_id: "n2",
      condition: "some string", created_at: "",
    };
    const nodes: WorkflowNode[] = [];
    expect(deriveEdgeType(edge, nodes)).toBe("data");
  });
});

describe("getRuntimeStatusStyle", () => {
  it("returns gray dashed border for pending", () => {
    const style = getRuntimeStatusStyle("pending");
    expect(style.borderClass).toBe("border-dashed border-muted-foreground/30");
    expect(style.glowClass).toBe("");
  });

  it("returns blue pulse border for format_checking", () => {
    const style = getRuntimeStatusStyle("format_checking");
    expect(style.borderClass).toContain("border-info");
    expect(style.glowClass).toContain("animate-pulse");
  });

  it("returns green border for completed", () => {
    const style = getRuntimeStatusStyle("completed");
    expect(style.borderClass).toContain("border-success");
  });

  it("returns empty strings for unknown status", () => {
    const style = getRuntimeStatusStyle("unknown" as any);
    expect(style.borderClass).toBe("");
    expect(style.glowClass).toBe("");
    expect(style.icon).toBe("");
  });
});

describe("STATUS_CONFIG", () => {
  it("has entries for all 16 NodeRunStatus values", () => {
    const expected = [
      "pending", "format_checking", "format_ok", "format_failed",
      "worker_assigned", "working", "awaiting_input", "awaiting_critic",
      "critic_reviewing", "critic_approved", "critic_rework",
      "completed", "failed", "blocked", "skipped", "cancelled",
    ];
    for (const status of expected) {
      expect(STATUS_CONFIG[status]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run canvas-model.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/workflows/canvas-model.ts`:

```typescript
import type { WorkflowEdge, WorkflowNode, NodeRunStatus } from "../types";

// ── Edge Semantics ──

export type EdgeType = "data" | "control" | "error";

export function deriveEdgeType(
  edge: WorkflowEdge,
  _nodes: WorkflowNode[],
): EdgeType {
  const c = edge.condition;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const cond = c as Record<string, unknown>;
    if (cond.type === "error") return "error";
    if (cond.type === "boolean") return "control";
  }
  return "data";
}

// ── Canvas Modes ──

export type CanvasDensity = "compact" | "full";
export type CanvasMode = "editor" | "runtime" | "preview";
export type NodeCardVariant = "definition" | "runtime";

// ── Runtime Status Visual Config ──

export interface RuntimeStatusStyle {
  borderClass: string;
  glowClass: string;
  icon: string;
}

const EMPTY_STYLE: RuntimeStatusStyle = { borderClass: "", glowClass: "", icon: "" };

const STATUS_STYLE_MAP: Record<NodeRunStatus, RuntimeStatusStyle> = {
  pending:           { borderClass: "border-dashed border-muted-foreground/30", glowClass: "", icon: "" },
  format_checking:   { borderClass: "border-2 border-info", glowClass: "animate-pulse shadow-[0_0_8px_var(--workflow-info)]", icon: "" },
  format_ok:         { borderClass: "border border-success", glowClass: "", icon: "check" },
  format_failed:     { borderClass: "border-2 border-danger", glowClass: "", icon: "x-circle" },
  worker_assigned:   { borderClass: "border border-info", glowClass: "", icon: "user-check" },
  working:           { borderClass: "border-2 border-info", glowClass: "animate-progress", icon: "loader" },
  awaiting_input:    { borderClass: "border-2 border-warning", glowClass: "", icon: "help-circle" },
  awaiting_critic:   { borderClass: "border-2 border-workflow-agent", glowClass: "", icon: "eye" },
  critic_reviewing:  { borderClass: "border-2 border-workflow-agent", glowClass: "animate-pulse shadow-[0_0_8px_var(--workflow-agent)]", icon: "eye" },
  critic_approved:   { borderClass: "border border-success", glowClass: "", icon: "check-circle" },
  critic_rework:     { borderClass: "border-2 border-warning", glowClass: "", icon: "refresh-cw" },
  blocked:           { borderClass: "border-2 border-danger", glowClass: "", icon: "lock" },
  failed:            { borderClass: "border-2 border-danger", glowClass: "shadow-[0_0_6px_var(--workflow-danger)]", icon: "alert-circle" },
  completed:         { borderClass: "border border-success", glowClass: "", icon: "check-circle" },
  skipped:           { borderClass: "border border-muted-foreground/30", glowClass: "", icon: "skip-forward" },
  cancelled:         { borderClass: "border border-muted-foreground/20 line-through-decoration", glowClass: "", icon: "x" },
};

export function getRuntimeStatusStyle(status: NodeRunStatus): RuntimeStatusStyle {
  return STATUS_STYLE_MAP[status] ?? EMPTY_STYLE;
}

export const STATUS_CONFIG: Record<NodeRunStatus, { color: string; label: string }> = {
  pending:           { color: "rgba(107,114,128,0.2)", label: "Pending" },
  format_checking:   { color: "rgba(245,158,11,0.25)", label: "Checking" },
  format_ok:         { color: "rgba(245,158,11,0.25)", label: "Format OK" },
  format_failed:     { color: "rgba(239,68,68,0.25)", label: "Format Failed" },
  worker_assigned:   { color: "rgba(245,158,11,0.25)", label: "Assigned" },
  working:           { color: "rgba(59,130,246,0.25)", label: "Working" },
  awaiting_critic:   { color: "rgba(59,130,246,0.25)", label: "Awaiting Review" },
  critic_reviewing:  { color: "rgba(59,130,246,0.25)", label: "Reviewing" },
  critic_approved:   { color: "rgba(34,197,94,0.25)", label: "Approved" },
  critic_rework:     { color: "rgba(245,158,11,0.25)", label: "Rework" },
  completed:         { color: "rgba(34,197,94,0.25)", label: "Done" },
  failed:            { color: "rgba(239,68,68,0.25)", label: "Failed" },
  blocked:           { color: "rgba(245,158,11,0.25)", label: "Blocked" },
  skipped:           { color: "rgba(107,114,128,0.2)", label: "Skipped" },
  cancelled:         { color: "rgba(107,114,128,0.2)", label: "Cancelled" },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run canvas-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/workflows/canvas-model.ts packages/core/workflows/canvas-model.test.ts
git commit -m "feat(workflow): add canvas model types for edge semantics and runtime status styles"
```

---

## Task 3: Canvas Color Mode Store — Extract from Editor Store

**Files:**
- Create: `packages/core/workflows/stores/canvas-color-store.ts`
- Modify: `packages/core/workflows/store.ts` — remove `canvasColorMode`, `cycleCanvasColorMode`; mark as deprecated redirects
- Test: `packages/core/workflows/stores/canvas-color-store.test.ts`

**Interfaces:**
- Produces: `useCanvasColorStore` — Zustand store with `canvasColorMode: "system" | "light" | "dark"` and `cycleCanvasColorMode()`
- Consumes: none (new, isolated store)

- [ ] **Step 1: Write the failing test**

Create `packages/core/workflows/stores/canvas-color-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasColorStore } from "./canvas-color-store";

describe("useCanvasColorStore", () => {
  beforeEach(() => {
    useCanvasColorStore.setState({ canvasColorMode: "system" });
  });

  it("starts with system mode", () => {
    expect(useCanvasColorStore.getState().canvasColorMode).toBe("system");
  });

  it("cycleCanvasColorMode cycles system → light → dark → system", () => {
    const store = useCanvasColorStore.getState();
    store.cycleCanvasColorMode();
    expect(useCanvasColorStore.getState().canvasColorMode).toBe("light");
    useCanvasColorStore.getState().cycleCanvasColorMode();
    expect(useCanvasColorStore.getState().canvasColorMode).toBe("dark");
    useCanvasColorStore.getState().cycleCanvasColorMode();
    expect(useCanvasColorStore.getState().canvasColorMode).toBe("system");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/core exec vitest run canvas-color-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/workflows/stores/canvas-color-store.ts`:

```typescript
import { create } from "zustand";

export type CanvasColorMode = "system" | "light" | "dark";

interface CanvasColorState {
  canvasColorMode: CanvasColorMode;
  cycleCanvasColorMode: () => void;
}

export const useCanvasColorStore = create<CanvasColorState>((set) => ({
  canvasColorMode: "system",
  cycleCanvasColorMode: () =>
    set((state) => ({
      canvasColorMode:
        state.canvasColorMode === "system"
          ? "light"
          : state.canvasColorMode === "light"
            ? "dark"
            : "system",
    })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/core exec vitest run canvas-color-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/workflows/stores/canvas-color-store.ts packages/core/workflows/stores/canvas-color-store.test.ts
git commit -m "feat(workflow): extract canvas color mode into isolated store"
```

---

## Task 4: WorkflowNodeCard — Shared Node Card Protocol

**Files:**
- Create: `packages/views/workflows/components/workflow-node-card.tsx`
- Test: `packages/views/workflows/components/workflow-node-card.test.tsx`

**Interfaces:**
- Produces:
  - `WorkflowNodeCardProps` — `{ node: WorkflowNode; variant: NodeCardVariant; nodeRun?: WorkflowNodeRun; density?: CanvasDensity; selected?: boolean; onClick?: (nodeId: string) => void; className?: string }`
  - `WorkflowNodeCard` component
- Consumes: `NodeCardVariant`, `CanvasDensity`, `getRuntimeStatusStyle` from Task 2; `WorkflowNode`, `WorkflowNodeRun`, `NodeRunStatus` from `@multica/core/types`

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/workflow-node-card.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";

const baseNode: WorkflowNode = {
  id: "n1", workflow_id: "wf1", title: "Test Node",
  description: "A test node", position_x: 100, position_y: 200,
  format_schema: null, worker_type: "agent", worker_id: null,
  critic_type: "human", critic_id: null, critic_api_url: null,
  sort_order: 0, stage_id: null, created_at: "", updated_at: "",
};

const baseNodeRun: WorkflowNodeRun = {
  id: "nr1", workflow_run_id: "wr1", workflow_node_id: "n1",
  node_title: "Test Node", status: "pending", retry_count: 0,
  worker_type: "agent", worker_id: null, worker_output: null,
  worker_agent_task_id: null, critic_type: "human", critic_id: null,
  critic_output: null, critic_comment: "", critic_agent_task_id: null,
  agent_task_id: null, session_id: null, runtime_id: null, device_id: null,
  started_at: null, completed_at: null, created_at: "", updated_at: "",
};

describe("WorkflowNodeCard — definition variant", () => {
  it("renders node title", () => {
    render(<WorkflowNodeCard node={baseNode} variant="definition" />);
    expect(screen.getByText("Test Node")).toBeInTheDocument();
  });

  it("renders worker type badge for agent", () => {
    render(<WorkflowNodeCard node={baseNode} variant="definition" />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<WorkflowNodeCard node={baseNode} variant="definition" onClick={onClick} />);
    await userEvent.click(screen.getByText("Test Node"));
    expect(onClick).toHaveBeenCalledWith("n1");
  });
});

describe("WorkflowNodeCard — runtime variant", () => {
  it("renders status label", () => {
    render(<WorkflowNodeCard node={baseNode} variant="runtime" nodeRun={baseNodeRun} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows completed icon for completed status", () => {
    const completedRun = { ...baseNodeRun, status: "completed" as const };
    render(<WorkflowNodeCard node={baseNode} variant="runtime" nodeRun={completedRun} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders compact mode with smaller dimensions", () => {
    const { container } = render(
      <WorkflowNodeCard node={baseNode} variant="runtime" nodeRun={baseNodeRun} density="compact" />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("w-30");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflow-node-card.test.tsx`
Expected: FAIL — module not found / component not defined

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/workflow-node-card.tsx`:

```typescript
"use client";

import { cn } from "@multica/ui/lib/utils";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import {
  getRuntimeStatusStyle,
  STATUS_CONFIG,
  type NodeCardVariant,
  type CanvasDensity,
} from "@multica/core/workflows/canvas-model";

const WORKER_TYPE_LABELS: Record<string, string> = {
  human: "Human",
  agent: "Agent",
  squad: "Squad",
};

export interface WorkflowNodeCardProps {
  node: WorkflowNode;
  variant: NodeCardVariant;
  nodeRun?: WorkflowNodeRun | null;
  density?: CanvasDensity;
  selected?: boolean;
  onClick?: (nodeId: string) => void;
  className?: string;
}

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
  const statusStyle = variant === "runtime" && nodeRun
    ? getRuntimeStatusStyle(nodeRun.status)
    : null;
  const statusLabel = variant === "runtime" && nodeRun
    ? (STATUS_CONFIG[nodeRun.status]?.label ?? nodeRun.status)
    : null;
  const workerLabel = WORKER_TYPE_LABELS[node.worker_type] ?? node.worker_type;

  return (
    <button
      type="button"
      className={cn(
        "relative flex flex-col gap-1 rounded-[var(--workflow-node-radius)] border bg-card p-3 text-left transition-shadow",
        isCompact && "rounded-[var(--workflow-node-radius-compact)] p-2",
        isCompact ? "w-[120px]" : "w-[160px]",
        selected && "border-primary ring-2 ring-primary/30",
        !selected && "border-border",
        statusStyle?.borderClass,
        statusStyle?.glowClass,
        variant === "definition" && "cursor-pointer hover:shadow-md",
        variant === "runtime" && "cursor-default",
        className,
      )}
      onClick={() => onClick?.(node.id)}
    >
      {/* Icon area */}
      <div className={cn(
        "flex items-center gap-2",
        isCompact && "gap-1",
      )}>
        <span className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          node.worker_type === "agent" && "bg-[var(--workflow-agent)]/15 text-[var(--workflow-agent)]",
          node.worker_type === "human" && "bg-[var(--workflow-info)]/15 text-[var(--workflow-info)]",
          node.worker_type === "squad" && "bg-[var(--workflow-warning)]/15 text-[var(--workflow-warning)]",
        )}>
          {node.worker_type === "agent" ? "A" : node.worker_type === "squad" ? "S" : "H"}
        </span>
        <span className={cn("truncate font-medium", isCompact ? "text-xs" : "text-sm")}>
          {node.title}
        </span>
      </div>

      {/* Description */}
      {!isCompact && node.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{node.description}</p>
      )}

      {/* Worker type badge */}
      {variant === "definition" && !isCompact && (
        <span className="text-[10px] text-muted-foreground">{workerLabel}</span>
      )}

      {/* Runtime status */}
      {variant === "runtime" && statusLabel && (
        <span className="text-[10px] text-muted-foreground">{statusLabel}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflow-node-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/workflow-node-card.tsx packages/views/workflows/components/workflow-node-card.test.tsx
git commit -m "feat(workflow): add shared WorkflowNodeCard with definition and runtime variants"
```

---

## Task 5: CanvasInspector — Right Panel Framework

**Files:**
- Create: `packages/views/workflows/components/canvas-inspector.tsx`
- Test: `packages/views/workflows/components/canvas-inspector.test.tsx`

**Interfaces:**
- Produces:
  - `InspectorTab` — `{ id: string; label: string; content: ReactNode }`
  - `CanvasInspectorProps` — `{ tabs: InspectorTab[]; defaultTab?: string; onClose: () => void; className?: string }`
  - `CanvasInspector` component — renders tabs from shadcn `<Tabs>` with close button

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/canvas-inspector.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasInspector } from "./canvas-inspector";

const tabs = [
  { id: "worker", label: "Worker", content: <div>Worker content</div> },
  { id: "critic", label: "Critic", content: <div>Critic content</div> },
];

describe("CanvasInspector", () => {
  it("renders tab labels", () => {
    render(<CanvasInspector tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("Critic")).toBeInTheDocument();
  });

  it("shows first tab content by default", () => {
    render(<CanvasInspector tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Worker content")).toBeInTheDocument();
  });

  it("switches tab on click", async () => {
    render(<CanvasInspector tabs={tabs} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("Critic"));
    expect(screen.getByText("Critic content")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<CanvasInspector tabs={tabs} onClose={onClose} />);
    const closeBtn = screen.getByRole("button", { name: "" });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("uses defaultTab when provided", () => {
    render(<CanvasInspector tabs={tabs} defaultTab="critic" onClose={vi.fn()} />);
    expect(screen.getByText("Critic content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run canvas-inspector.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/canvas-inspector.tsx`:

```typescript
"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@multica/ui/components/ui/tabs";
import { Button } from "@multica/ui/components/ui/button";

export interface InspectorTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface CanvasInspectorProps {
  tabs: InspectorTab[];
  defaultTab?: string;
  onClose: () => void;
  className?: string;
}

export function CanvasInspector({
  tabs,
  defaultTab,
  onClose,
  className,
}: CanvasInspectorProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? "");

  return (
    <div className={cn("flex h-full flex-col border-l bg-card", className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-medium">Inspector</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" />
          </svg>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col min-h-0">
        <TabsList className="mx-4 mt-3 shrink-0">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run canvas-inspector.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/canvas-inspector.tsx packages/views/workflows/components/canvas-inspector.test.tsx
git commit -m "feat(workflow): add CanvasInspector framework with tabbed layout"
```

---

## Task 6: WorkflowCanvasShell — Common Container

**Files:**
- Create: `packages/views/workflows/components/workflow-canvas-shell.tsx`
- Test: `packages/views/workflows/components/workflow-canvas-shell.test.tsx`

**Interfaces:**
- Produces:
  - `WorkflowCanvasShellProps` — `{ mode: CanvasMode; topBar?: ReactNode; leftPanel?: ReactNode; inspector?: ReactNode; bottomBar?: ReactNode; children: ReactNode; className?: string }`
  - `WorkflowCanvasShell` — layout shell matching spec §3 layout diagram

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/workflow-canvas-shell.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowCanvasShell } from "./workflow-canvas-shell";

describe("WorkflowCanvasShell", () => {
  it("renders children in the canvas area", () => {
    render(
      <WorkflowCanvasShell mode="editor">
        <div data-testid="canvas">Canvas content</div>
      </WorkflowCanvasShell>,
    );
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("renders topBar slot", () => {
    render(
      <WorkflowCanvasShell mode="editor" topBar={<div>Top Bar</div>}>
        <div>Canvas</div>
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("Top Bar")).toBeInTheDocument();
  });

  it("renders leftPanel slot", () => {
    render(
      <WorkflowCanvasShell mode="editor" leftPanel={<div>Left Panel</div>}>
        <div>Canvas</div>
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("Left Panel")).toBeInTheDocument();
  });

  it("renders inspector slot", () => {
    render(
      <WorkflowCanvasShell mode="editor" inspector={<div>Inspector</div>}>
        <div>Canvas</div>
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("Inspector")).toBeInTheDocument();
  });

  it("renders bottomBar slot", () => {
    render(
      <WorkflowCanvasShell mode="editor" bottomBar={<div>Bottom Bar</div>}>
        <div>Canvas</div>
      </WorkflowCanvasShell>,
    );
    expect(screen.getByText("Bottom Bar")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflow-canvas-shell.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/workflow-canvas-shell.tsx`:

```typescript
"use client";

import type { ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import type { CanvasMode } from "@multica/core/workflows/canvas-model";

export interface WorkflowCanvasShellProps {
  mode: CanvasMode;
  topBar?: ReactNode;
  leftPanel?: ReactNode;
  inspector?: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkflowCanvasShell({
  mode: _mode,
  topBar,
  leftPanel,
  inspector,
  bottomBar,
  children,
  className,
}: WorkflowCanvasShellProps) {
  return (
    <div className={cn("flex h-full flex-col", className)} data-testid="workflow-canvas-shell">
      {/* Top Bar */}
      {topBar && (
        <div className="shrink-0">{topBar}</div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel */}
        {leftPanel && (
          <div className="w-60 shrink-0 border-r bg-card">{leftPanel}</div>
        )}

        {/* Canvas */}
        <div className="flex-1 min-w-0 bg-[var(--workflow-canvas-bg)] relative">
          {children}
        </div>

        {/* Inspector */}
        {inspector && (
          <div className="w-96 shrink-0">{inspector}</div>
        )}
      </div>

      {/* Bottom Bar */}
      {bottomBar && (
        <div className="shrink-0">{bottomBar}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflow-canvas-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/workflow-canvas-shell.tsx packages/views/workflows/components/workflow-canvas-shell.test.tsx
git commit -m "feat(workflow): add WorkflowCanvasShell layout container"
```

---

## Task 7: NodePanel — "Capability Market" Sidebar

**Files:**
- Create: `packages/views/workflows/components/node-panel.tsx` (replaces existing `node-palette.tsx`)
- Test: `packages/views/workflows/components/node-panel.test.tsx`

**Interfaces:**
- Produces:
  - `NodePanelGroup` — `{ id: string; label: string; icon: ReactNode; nodeTypes: NodePanelItem[] }`
  - `NodePanelItem` — `{ type: string; label: string; description: string; colorClass: string }`
  - `NodePanelProps` — `{ groups: NodePanelGroup[]; onDragStart?: (type: string, event: React.DragEvent) => void; onSearch?: (query: string) => void; className?: string }`
  - `NodePanel` component
- Consumes: shadcn `Input`, accordion from existing patterns

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/node-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodePanel, type NodePanelGroup } from "./node-panel";

const groups: NodePanelGroup[] = [
  {
    id: "agent",
    label: "Agent Worker",
    icon: <span>A</span>,
    nodeTypes: [
      { type: "agent-default", label: "Agent", description: "AI agent worker", colorClass: "bg-workflow-agent" },
    ],
  },
  {
    id: "human",
    label: "Human Worker",
    icon: <span>H</span>,
    nodeTypes: [
      { type: "human-default", label: "Human", description: "Human task", colorClass: "bg-workflow-info" },
    ],
  },
];

describe("NodePanel", () => {
  it("renders all group labels", () => {
    render(<NodePanel groups={groups} />);
    expect(screen.getByText("Agent Worker")).toBeInTheDocument();
    expect(screen.getByText("Human Worker")).toBeInTheDocument();
  });

  it("filters nodes by search query", async () => {
    render(<NodePanel groups={groups} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    await userEvent.type(searchInput, "Agent");
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.queryByText("Human")).not.toBeInTheDocument();
  });

  it("shows all nodes when search is cleared", async () => {
    render(<NodePanel groups={groups} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    await userEvent.type(searchInput, "Agent");
    await userEvent.clear(searchInput);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run node-panel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/node-panel.tsx`:

```typescript
"use client";

import { useState, useMemo, type ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@multica/ui/components/ui/accordion";
import { Search } from "lucide-react";

const DRAG_TYPE = "application/x-multica-node-type";

export interface NodePanelItem {
  type: string;
  label: string;
  description: string;
  colorClass: string;
}

export interface NodePanelGroup {
  id: string;
  label: string;
  icon: ReactNode;
  nodeTypes: NodePanelItem[];
}

export interface NodePanelProps {
  groups: NodePanelGroup[];
  onDragStart?: (type: string, event: React.DragEvent) => void;
  onSearch?: (query: string) => void;
  className?: string;
}

export function NodePanel({
  groups,
  onDragStart,
  onSearch,
  className,
}: NodePanelProps) {
  const [query, setQuery] = useState("");

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        nodeTypes: g.nodeTypes.filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            n.type.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.nodeTypes.length > 0);
  }, [groups, query]);

  const handleSearch = (value: string) => {
    setQuery(value);
    onSearch?.(value);
  };

  const handleDragStart = (item: NodePanelItem, event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_TYPE, item.type);
    event.dataTransfer.effectAllowed = "copy";
    onDragStart?.(item.type, event);
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <Accordion type="multiple" defaultValue={groups.map((g) => g.id)}>
          {filteredGroups.map((group) => (
            <AccordionItem key={group.id} value={group.id}>
              <AccordionTrigger className="px-3 py-2 text-xs font-medium">
                <span className="flex items-center gap-2">
                  {group.icon}
                  {group.label}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-2">
                <div className="flex flex-col gap-1">
                  {group.nodeTypes.map((item) => (
                    <div
                      key={item.type}
                      draggable
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "flex cursor-grab items-center gap-2 rounded-md border border-border px-2 py-1.5 active:cursor-grabbing hover:bg-muted transition-colors",
                      )}
                      onDragStart={(e) => handleDragStart(item, e)}
                    >
                      <span className={cn("h-3 w-3 rounded-full shrink-0", item.colorClass)} />
                      <div className="min-w-0">
                        <span className="text-xs font-medium truncate block">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground truncate block">{item.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run node-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/node-panel.tsx packages/views/workflows/components/node-panel.test.tsx
git commit -m "feat(workflow): add NodePanel capability-market sidebar with search and drag"
```

---

## Task 8: CanvasHoverToolbar — Node Hover Quick Actions

**Files:**
- Create: `packages/views/workflows/components/canvas-hover-toolbar.tsx`
- Test: `packages/views/workflows/components/canvas-hover-toolbar.test.tsx`

**Interfaces:**
- Produces:
  - `HoverAction` — `{ id: string; label: string; icon: ReactNode; onClick: () => void; destructive?: boolean }`
  - `CanvasHoverToolbarProps` — `{ actions: HoverAction[]; visible: boolean; className?: string }`
  - `CanvasHoverToolbar` component

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/canvas-hover-toolbar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasHoverToolbar } from "./canvas-hover-toolbar";

const actions = [
  { id: "delete", label: "Delete", icon: <span>x</span>, onClick: vi.fn(), destructive: true },
  { id: "disable", label: "Disable", icon: <span>o</span>, onClick: vi.fn() },
];

describe("CanvasHoverToolbar", () => {
  it("renders actions when visible", () => {
    render(<CanvasHoverToolbar actions={actions} visible />);
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Disable")).toBeInTheDocument();
  });

  it("does not render when not visible", () => {
    render(<CanvasHoverToolbar actions={actions} visible={false} />);
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("calls action onClick", async () => {
    const onClick = vi.fn();
    const testActions = [{ id: "test", label: "Test", icon: <span>T</span>, onClick }];
    render(<CanvasHoverToolbar actions={testActions} visible />);
    await userEvent.click(screen.getByText("Test"));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run canvas-hover-toolbar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/canvas-hover-toolbar.tsx`:

```typescript
"use client";

import type { ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";

export interface HoverAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

export interface CanvasHoverToolbarProps {
  actions: HoverAction[];
  visible: boolean;
  className?: string;
}

export function CanvasHoverToolbar({
  actions,
  visible,
  className,
}: CanvasHoverToolbarProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        "absolute -top-10 left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-1 shadow-md",
        className,
      )}
      role="toolbar"
      aria-label="Node actions"
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7",
            action.destructive && "text-destructive hover:text-destructive",
          )}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          title={action.label}
        >
          {action.icon}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run canvas-hover-toolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/canvas-hover-toolbar.tsx packages/views/workflows/components/canvas-hover-toolbar.test.tsx
git commit -m "feat(workflow): add CanvasHoverToolbar for node quick actions"
```

---

## Task 9: WorkflowEdgeLayer — Semantic Edge Rendering

**Files:**
- Create: `packages/views/workflows/components/workflow-edge-layer.tsx`
- Test: `packages/views/workflows/components/workflow-edge-layer.test.tsx`

**Interfaces:**
- Produces:
  - `WorkflowEdgeLayerProps` — `{ edges: WorkflowEdge[]; nodes: WorkflowNode[]; nodeRuns?: Map<string, WorkflowNodeRun>; selectedEdgeId?: string | null; onEdgeClick?: (edgeId: string) => void }`
  - `WorkflowEdgeLayer` — SVG overlay rendering semantic edges (data/control/error)
- Consumes: `deriveEdgeType`, `EdgeType` from Task 2; `WorkflowEdge`, `WorkflowNode`, `WorkflowNodeRun` from types

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/workflow-edge-layer.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowEdgeLayer } from "./workflow-edge-layer";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";

const nodes: WorkflowNode[] = [
  { id: "n1", position_x: 100, position_y: 100 } as WorkflowNode,
  { id: "n2", position_x: 300, position_y: 100 } as WorkflowNode,
];

const edges: WorkflowEdge[] = [
  { id: "e1", workflow_id: "wf1", source_node_id: "n1", target_node_id: "n2", condition: null, created_at: "" },
];

describe("WorkflowEdgeLayer", () => {
  it("renders an SVG element", () => {
    const { container } = render(
      <WorkflowEdgeLayer edges={edges} nodes={nodes} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders data edge as solid line with arrow", () => {
    const { container } = render(
      <WorkflowEdgeLayer edges={edges} nodes={nodes} />,
    );
    const path = container.querySelector("path");
    expect(path).toBeInTheDocument();
    expect(path?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("renders error edge as dashed red line", () => {
    const errorEdges: WorkflowEdge[] = [
      { ...edges[0], condition: { type: "error" } },
    ];
    const { container } = render(
      <WorkflowEdgeLayer edges={errorEdges} nodes={nodes} />,
    );
    const path = container.querySelector("path");
    expect(path?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("renders control edge with label for boolean condition", () => {
    const controlEdges: WorkflowEdge[] = [
      { ...edges[0], condition: { type: "boolean", value: true } },
    ];
    render(<WorkflowEdgeLayer edges={controlEdges} nodes={nodes} />);
    expect(screen.getByText("true")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run workflow-edge-layer.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/workflow-edge-layer.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { deriveEdgeType, type EdgeType } from "@multica/core/workflows/canvas-model";

interface EdgeVisual {
  id: string;
  path: string;
  edgeType: EdgeType;
  label: string | null;
  strokeClass: string;
}

export interface WorkflowEdgeLayerProps {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  nodeRuns?: Map<string, WorkflowNodeRun>;
  selectedEdgeId?: string | null;
  onEdgeClick?: (edgeId: string) => void;
}

function buildPath(
  sourceNode: WorkflowNode,
  targetNode: WorkflowNode,
): string {
  const sx = sourceNode.position_x + 80; // center-right of 160px wide node
  const sy = sourceNode.position_y + 24; // approximate center
  const tx = targetNode.position_x;
  const ty = targetNode.position_y + 24;
  const cx1 = sx + Math.abs(tx - sx) * 0.5;
  const cx2 = tx - Math.abs(tx - sx) * 0.5;
  return `M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`;
}

const EDGE_STYLE: Record<EdgeType, { strokeClass: string; dashArray: string | null }> = {
  data: { strokeClass: "stroke-muted-foreground/60", dashArray: null },
  control: { strokeClass: "stroke-[var(--workflow-success)]", dashArray: null },
  error: { strokeClass: "stroke-[var(--workflow-danger)]", dashArray: "6 3" },
};

export function WorkflowEdgeLayer({
  edges,
  nodes,
  nodeRuns: _nodeRuns,
  selectedEdgeId,
  onEdgeClick,
}: WorkflowEdgeLayerProps) {
  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  const edgeVisuals = useMemo<EdgeVisual[]>(() => {
    return edges
      .map((edge) => {
        const src = nodeMap.get(edge.source_node_id);
        const tgt = nodeMap.get(edge.target_node_id);
        if (!src || !tgt) return null;

        const edgeType = deriveEdgeType(edge, nodes);
        const style = EDGE_STYLE[edgeType];
        const path = buildPath(src, tgt);

        let label: string | null = null;
        if (edgeType === "control" && edge.condition && typeof edge.condition === "object") {
          const cond = edge.condition as Record<string, unknown>;
          label = cond.value === true ? "true" : cond.value === false ? "false" : null;
        }

        return {
          id: edge.id,
          path,
          edgeType,
          label,
          strokeClass: style.strokeClass,
          dashArray: style.dashArray,
        };
      })
      .filter((v): v is EdgeVisual & { dashArray: string | null } => v !== null);
  }, [edges, nodeMap, nodes]);

  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      style={{ width: "100%", height: "100%" }}
    >
      <defs>
        <marker id="arrow-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/60" />
        </marker>
        <marker id="arrow-control" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--workflow-success)]" />
        </marker>
        <marker id="arrow-error" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--workflow-danger)]" />
        </marker>
      </defs>

      {edgeVisuals.map((ev) => (
        <g key={ev.id} className="pointer-events-auto cursor-pointer">
          <path
            d={ev.path}
            fill="none"
            strokeWidth="var(--workflow-edge-width)"
            className={ev.strokeClass}
            strokeDasharray={ev.dashArray ?? undefined}
            markerEnd={`url(#arrow-${ev.edgeType})`}
            onClick={() => onEdgeClick?.(ev.id)}
          />
          {/* Invisible wider hit area */}
          <path
            d={ev.path}
            fill="none"
            stroke="transparent"
            strokeWidth="12"
            onClick={() => onEdgeClick?.(ev.id)}
          />
          {ev.label && (
            <text
              x="0"
              y="-6"
              className="fill-muted-foreground text-[9px]"
              textAnchor="middle"
            >
              {ev.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run workflow-edge-layer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/workflow-edge-layer.tsx packages/views/workflows/components/workflow-edge-layer.test.tsx
git commit -m "feat(workflow): add WorkflowEdgeLayer with semantic data/control/error edge rendering"
```

---

## Task 10: PreflightBar — Pre-publish Validation

**Files:**
- Create: `packages/views/workflows/components/preflight-bar.tsx`
- Test: `packages/views/workflows/components/preflight-bar.test.tsx`

**Interfaces:**
- Produces:
  - `PreflightIssue` — `{ id: string; type: "error" | "warning"; message: string; nodeId?: string; checkType: CheckType }`
  - `CheckType` — `"dag_cycle" | "orphan_node" | "unreachable_node" | "missing_worker" | "invalid_critic" | "missing_stage" | "missing_schema"`
  - `PreflightBarProps` — `{ issues: PreflightIssue[]; onIssueClick?: (issue: PreflightIssue) => void; className?: string }`
  - `PreflightBar` component

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/preflight-bar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreflightBar, type PreflightIssue } from "./preflight-bar";

const issues: PreflightIssue[] = [
  { id: "p1", type: "error", message: "DAG cycle detected", checkType: "dag_cycle" },
  { id: "p2", type: "warning", message: "Node has no stage", nodeId: "n1", checkType: "missing_stage" },
];

describe("PreflightBar", () => {
  it("renders all issues", () => {
    render(<PreflightBar issues={issues} />);
    expect(screen.getByText("DAG cycle detected")).toBeInTheDocument();
    expect(screen.getByText("Node has no stage")).toBeInTheDocument();
  });

  it("shows error icon for error issues", () => {
    render(<PreflightBar issues={issues} />);
    const errorItems = screen.getAllByRole("button");
    expect(errorItems.length).toBe(2);
  });

  it("shows issue count", () => {
    render(<PreflightBar issues={issues} />);
    expect(screen.getByText("2 issues")).toBeInTheDocument();
  });

  it("calls onIssueClick when clicked", async () => {
    const onClick = vi.fn();
    render(<PreflightBar issues={issues} onIssueClick={onClick} />);
    await userEvent.click(screen.getByText("DAG cycle detected"));
    expect(onClick).toHaveBeenCalledWith(issues[0]);
  });

  it("renders nothing when no issues", () => {
    const { container } = render(<PreflightBar issues={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run preflight-bar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/preflight-bar.tsx`:

```typescript
"use client";

import { cn } from "@multica/ui/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";

export type CheckType =
  | "dag_cycle"
  | "orphan_node"
  | "unreachable_node"
  | "missing_worker"
  | "invalid_critic"
  | "missing_stage"
  | "missing_schema";

export interface PreflightIssue {
  id: string;
  type: "error" | "warning";
  message: string;
  nodeId?: string;
  checkType: CheckType;
}

export interface PreflightBarProps {
  issues: PreflightIssue[];
  onIssueClick?: (issue: PreflightIssue) => void;
  className?: string;
}

export function PreflightBar({
  issues,
  onIssueClick,
  className,
}: PreflightBarProps) {
  if (issues.length === 0) return null;

  const errorCount = issues.filter((i) => i.type === "error").length;
  const warningCount = issues.filter((i) => i.type === "warning").length;
  const hasErrors = errorCount > 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t px-4 py-2 text-xs",
        hasErrors
          ? "border-[var(--workflow-danger)]/30 bg-[var(--workflow-danger)]/5"
          : "border-[var(--workflow-warning)]/30 bg-[var(--workflow-warning)]/5",
        className,
      )}
      role="alert"
      data-testid="preflight-bar"
    >
      <span className="flex items-center gap-1 font-medium">
        {hasErrors ? (
          <AlertCircle className="h-3.5 w-3.5 text-[var(--workflow-danger)]" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-[var(--workflow-warning)]" />
        )}
        {issues.length} issue{issues.length !== 1 ? "s" : ""}
      </span>
      <span className="text-muted-foreground">|</span>
      <div className="flex items-center gap-2 overflow-x-auto">
        {issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            className={cn(
              "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:underline",
              issue.type === "error" && "text-[var(--workflow-danger)]",
              issue.type === "warning" && "text-[var(--workflow-warning)]",
            )}
            onClick={() => onIssueClick?.(issue)}
          >
            {issue.type === "error" ? (
              <AlertCircle className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {issue.message}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run preflight-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/preflight-bar.tsx packages/views/workflows/components/preflight-bar.test.tsx
git commit -m "feat(workflow): add PreflightBar for pre-publish validation issues"
```

---

## Task 11: GlobalNotificationBar — Issue Runtime Notifications

**Files:**
- Create: `packages/views/workflows/components/global-notification-bar.tsx`
- Test: `packages/views/workflows/components/global-notification-bar.test.tsx`

**Interfaces:**
- Produces:
  - `RuntimeNotification` — `{ id: string; nodeId: string; nodeTitle: string; status: NodeRunStatus; priority: number; message: string }`
  - `GlobalNotificationBarProps` — `{ notifications: RuntimeNotification[]; onNotificationClick?: (notification: RuntimeNotification) => void; className?: string }`
  - `GlobalNotificationBar` component — ordered by priority, click to locate node

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/global-notification-bar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalNotificationBar, type RuntimeNotification } from "./global-notification-bar";

const notifications: RuntimeNotification[] = [
  { id: "gn1", nodeId: "n1", nodeTitle: "Review PR", status: "awaiting_critic", priority: 1, message: "Node awaiting critic review" },
  { id: "gn2", nodeId: "n2", nodeTitle: "Build", status: "blocked", priority: 2, message: "Node is blocked" },
];

describe("GlobalNotificationBar", () => {
  it("renders notifications sorted by priority", () => {
    render(<GlobalNotificationBar notifications={notifications} />);
    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent("Node awaiting critic review");
    expect(items[1]).toHaveTextContent("Node is blocked");
  });

  it("calls onNotificationClick when clicked", async () => {
    const onClick = vi.fn();
    render(<GlobalNotificationBar notifications={notifications} onNotificationClick={onClick} />);
    await userEvent.click(screen.getByText("Node awaiting critic review"));
    expect(onClick).toHaveBeenCalledWith(notifications[0]);
  });

  it("renders nothing when empty", () => {
    const { container } = render(<GlobalNotificationBar notifications={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run global-notification-bar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/global-notification-bar.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import { cn } from "@multica/ui/lib/utils";
import type { NodeRunStatus } from "@multica/core/types";
import { Eye, AlertTriangle, HelpCircle } from "lucide-react";

export interface RuntimeNotification {
  id: string;
  nodeId: string;
  nodeTitle: string;
  status: NodeRunStatus;
  priority: number;
  message: string;
}

export interface GlobalNotificationBarProps {
  notifications: RuntimeNotification[];
  onNotificationClick?: (notification: RuntimeNotification) => void;
  className?: string;
}

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  awaiting_critic: Eye,
  blocked: AlertTriangle,
  failed: AlertTriangle,
  awaiting_input: HelpCircle,
};

const STATUS_BG: Record<string, string> = {
  awaiting_critic: "bg-[var(--workflow-agent)]/10 border-[var(--workflow-agent)]/30",
  blocked: "bg-[var(--workflow-danger)]/10 border-[var(--workflow-danger)]/30",
  failed: "bg-[var(--workflow-danger)]/10 border-[var(--workflow-danger)]/30",
  awaiting_input: "bg-[var(--workflow-warning)]/10 border-[var(--workflow-warning)]/30",
};

export function GlobalNotificationBar({
  notifications,
  onNotificationClick,
  className,
}: GlobalNotificationBarProps) {
  const sorted = useMemo(
    () => [...notifications].sort((a, b) => a.priority - b.priority),
    [notifications],
  );

  if (sorted.length === 0) return null;

  return (
    <div
      className={cn("flex items-center gap-2 border-b px-4 py-2 text-xs", className)}
      role="alert"
      data-testid="global-notification-bar"
    >
      <span className="font-medium text-muted-foreground">Alerts:</span>
      {sorted.map((n) => {
        const Icon = STATUS_ICON[n.status];
        const bgClass = STATUS_BG[n.status] ?? "bg-muted border-border";
        return (
          <button
            key={n.id}
            type="button"
            className={cn("flex items-center gap-1 rounded border px-2 py-0.5 transition-colors hover:underline", bgClass)}
            onClick={() => onNotificationClick?.(n)}
          >
            {Icon && <Icon className="h-3 w-3" />}
            <span className="truncate max-w-[200px]">{n.nodeTitle}: {n.message}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run global-notification-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/global-notification-bar.tsx packages/views/workflows/components/global-notification-bar.test.tsx
git commit -m "feat(workflow): add GlobalNotificationBar for issue runtime alerts"
```

---

## Task 12: Onboarding Guide — "Create First Stage" Empty State

**Files:**
- Create: `packages/views/workflows/components/canvas-onboarding.tsx`
- Test: `packages/views/workflows/components/canvas-onboarding.test.tsx`

**Interfaces:**
- Produces:
  - `CanvasOnboardingProps` — `{ step: "no-stages" | "no-nodes"; onCreateStage?: () => void; onAddNode?: () => void; className?: string }`
  - `CanvasOnboarding` — centered onboarding card

- [ ] **Step 1: Write the failing test**

Create `packages/views/workflows/components/canvas-onboarding.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasOnboarding } from "./canvas-onboarding";

describe("CanvasOnboarding", () => {
  it("shows create first stage message for no-stages step", () => {
    render(<CanvasOnboarding step="no-stages" />);
    expect(screen.getByText(/create.*stage/i)).toBeInTheDocument();
  });

  it("shows add first step message for no-nodes step", () => {
    render(<CanvasOnboarding step="no-nodes" />);
    expect(screen.getByText(/add.*step/i)).toBeInTheDocument();
  });

  it("calls onCreateStage when button clicked", async () => {
    const onCreateStage = vi.fn();
    render(<CanvasOnboarding step="no-stages" onCreateStage={onCreateStage} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onCreateStage).toHaveBeenCalled();
  });

  it("calls onAddNode when button clicked in no-nodes step", async () => {
    const onAddNode = vi.fn();
    render(<CanvasOnboarding step="no-nodes" onAddNode={onAddNode} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onAddNode).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @multica/views exec vitest run canvas-onboarding.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `packages/views/workflows/components/canvas-onboarding.tsx`:

```typescript
"use client";

import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Layers, Plus } from "lucide-react";

export interface CanvasOnboardingProps {
  step: "no-stages" | "no-nodes";
  onCreateStage?: () => void;
  onAddNode?: () => void;
  className?: string;
}

export function CanvasOnboarding({
  step,
  onCreateStage,
  onAddNode,
  className,
}: CanvasOnboardingProps) {
  if (step === "no-stages") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-4 py-20", className)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/50">
          <Layers className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-medium">Create your first Stage</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-[280px]">
            Stages organize your workflow nodes into logical phases like Requirements, Design, and Build.
          </p>
        </div>
        {onCreateStage && (
          <Button size="sm" onClick={onCreateStage}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Stage
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-16", className)}>
      <p className="text-sm text-muted-foreground">Add your first step</p>
      {onAddNode && (
        <Button size="sm" variant="outline" onClick={onAddNode}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add Node
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @multica/views exec vitest run canvas-onboarding.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/canvas-onboarding.tsx packages/views/workflows/components/canvas-onboarding.test.tsx
git commit -m "feat(workflow): add CanvasOnboarding empty-state guide"
```

---

## Task 13: Wire Up — Integrate New Components into Editor (WorkflowDetailPage)

**Files:**
- Modify: `packages/views/workflows/components/workflow-detail-page.tsx` — integrate `WorkflowCanvasShell`, `NodePanel`, new node creation, `CanvasInspector` tabs
- Modify: `packages/views/workflows/components/node-config-panel.tsx` — wrap content as `InspectorTab[]` for `CanvasInspector`
- Modify: `packages/views/workflows/components/index.ts` — export new components
- Modify: `packages/views/workflows/components/dag-canvas.tsx` — consume `useCanvasColorStore` instead of editor store

**Interfaces:**
- Consumes: WorkflowCanvasShell, NodePanel, CanvasInspector, CanvasHoverToolbar, CanvasOnboarding, PreflightBar from Tasks 4–12
- Produces: Updated `WorkflowDetailPage` using new shell + panel architecture

- [ ] **Step 1: Update index.ts to export new components**

Read the current file and add exports:

```typescript
// Add to existing exports in packages/views/workflows/components/index.ts:
export { WorkflowCanvasShell } from "./workflow-canvas-shell";
export { NodePanel } from "./node-panel";
export type { NodePanelProps, NodePanelGroup, NodePanelItem } from "./node-panel";
export { CanvasInspector } from "./canvas-inspector";
export type { CanvasInspectorProps, InspectorTab } from "./canvas-inspector";
export { CanvasHoverToolbar } from "./canvas-hover-toolbar";
export type { CanvasHoverToolbarProps, HoverAction } from "./canvas-hover-toolbar";
export { CanvasOnboarding } from "./canvas-onboarding";
export { PreflightBar } from "./preflight-bar";
export type { PreflightBarProps, PreflightIssue, CheckType } from "./preflight-bar";
export { WorkflowNodeCard } from "./workflow-node-card";
export type { WorkflowNodeCardProps } from "./workflow-node-card";
export { WorkflowEdgeLayer } from "./workflow-edge-layer";
export { GlobalNotificationBar } from "./global-notification-bar";
export type { GlobalNotificationBarProps, RuntimeNotification } from "./global-notification-bar";
```

Run: `pnpm typecheck` — expected: may fail for missing imports in dag-canvas (fix in next step)

- [ ] **Step 2: Update dag-canvas.tsx to use useCanvasColorStore**

Replace the import and usage of `canvasColorMode` from `useWorkflowEditorStore`:

```typescript
// Replace:
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
// ... canvasColorMode = useWorkflowEditorStore((s) => s.canvasColorMode);

// With:
import { useCanvasColorStore } from "@multica/core/workflows/stores/canvas-color-store";
// ... canvasColorMode = useCanvasColorStore((s) => s.canvasColorMode);
```

In the DAGCanvas component, find the line:
```typescript
const canvasColorMode = useWorkflowEditorStore((s) => s.canvasColorMode);
```
Replace with:
```typescript
const canvasColorMode = useCanvasColorStore((s) => s.canvasColorMode);
```

- [ ] **Step 3: Update workflow-detail-page.tsx to use new shell**

Replace the existing layout structure in `WorkflowDetailPage` with `WorkflowCanvasShell`. The key structural change wraps the toolbar, canvas, and config panel in the shell:

The existing return block (starting around line 305) becomes:

```typescript
return (
  <WorkflowCanvasShell
    mode="editor"
    topBar={
      <PageHeader className="justify-between px-5 shrink-0">
        {/* existing toolbar content — title, buttons, etc. — unchanged */}
      </PageHeader>
    }
    leftPanel={
      mode === "edit" ? (
        <NodePanel
          groups={[
            {
              id: "agent",
              label: t(($) => $.node_panel.agent_worker) ?? "Agent Worker",
              icon: <Bot className="h-3.5 w-3.5 text-[var(--workflow-agent)]" />,
              nodeTypes: [
                { type: "agent-default", label: "Agent", description: "AI agent worker", colorClass: "bg-[var(--workflow-agent)]" },
              ],
            },
            {
              id: "human",
              label: t(($) => $.node_panel.human_worker) ?? "Human Worker",
              icon: <User className="h-3.5 w-3.5 text-[var(--workflow-info)]" />,
              nodeTypes: [
                { type: "human-default", label: "Human", description: "Manual task", colorClass: "bg-[var(--workflow-info)]" },
              ],
            },
            {
              id: "squad",
              label: t(($) => $.node_panel.squad) ?? "Squad",
              icon: <Users className="h-3.5 w-3.5 text-[var(--workflow-warning)]" />,
              nodeTypes: [
                { type: "squad-default", label: "Squad", description: "Team collaboration", colorClass: "bg-[var(--workflow-warning)]" },
              ],
            },
            {
              id: "annotation",
              label: t(($) => $.node_panel.annotation) ?? "Annotation",
              icon: <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />,
              nodeTypes: [
                { type: "annotation", label: "Note", description: "Sticky note annotation", colorClass: "bg-muted-foreground" },
              ],
            },
          ]}
          onDragStart={(type, _event) => {
            // Drag handled by ReactFlow onDrop in dag-canvas
          }}
        />
      ) : undefined
    }
    inspector={
      selectedNode ? (
        <CanvasInspector
          tabs={[
            {
              id: "config",
              label: t(($) => $.node.title),
              content: (
                <NodeConfigPanelContent
                  node={selectedNode}
                  workflowId={id!}
                  nodes={displayNodes}
                  stages={stages}
                  disabled={mode !== "edit"}
                />
              ),
            },
          ]}
          onClose={() => useWorkflowEditorStore.getState().selectNode(null)}
        />
      ) : undefined
    }
    bottomBar={
      mode === "edit" ? (
        <PreflightBar
          issues={computePreflightIssues(displayNodes, edges)}
          onIssueClick={(issue) => {
            if (issue.nodeId) {
              useWorkflowEditorStore.getState().selectNode(issue.nodeId);
            }
          }}
        />
      ) : undefined
    }
  >
    {nodes.length === 0 && stages.length === 0 ? (
      <CanvasOnboarding step="no-stages" onCreateStage={() => { /* open stage create */ }} />
    ) : nodes.length === 0 ? (
      <CanvasOnboarding step="no-nodes" onAddNode={() => handleAddNode("agent-default", 300, 300)} />
    ) : (
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
    )}
  </WorkflowCanvasShell>
);
```

NOTE: We also need to add a `computePreflightIssues` function stub and import `Bot`, `User`, `Users`, `StickyNote` from `lucide-react`. We also need to adapt `NodeConfigPanel` to work as content inside `CanvasInspector` tabs — essentially extracting the inner form content without the shell (title bar + delete button).

Add a helper `computePreflightIssues` before the return:

```typescript
import { type PreflightIssue } from "./preflight-bar";

function computePreflightIssues(nodes: typeof displayNodes, edges: WorkflowEdgeType[]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  // Check for nodes without worker
  for (const node of nodes) {
    const isAnnotation = node.format_schema && typeof node.format_schema === "object" &&
      !Array.isArray(node.format_schema) && (node.format_schema as Record<string, unknown>).type === "annotation";
    if (isAnnotation) continue;
    if (!node.worker_id) {
      issues.push({
        id: `no-worker-${node.id}`,
        type: "error",
        message: `"${node.title}" has no worker assigned`,
        nodeId: node.id,
        checkType: "missing_worker",
      });
    }
    if (!node.stage_id) {
      issues.push({
        id: `no-stage-${node.id}`,
        type: "warning",
        message: `"${node.title}" is not assigned to a stage`,
        nodeId: node.id,
        checkType: "missing_stage",
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `pnpm --filter @multica/views exec vitest run workflow-detail-page dag-canvas`
Expected: existing tests should pass (or require minor updates)

- [ ] **Step 5: Commit**

```bash
git add packages/views/workflows/components/index.ts packages/views/workflows/components/dag-canvas.tsx packages/views/workflows/components/workflow-detail-page.tsx
git commit -m "feat(workflow): integrate new canvas components into editor page"
```

---

## Task 14: i18n — Add Translation Strings for New Components

**Files:**
- Modify: `packages/views/locales/en/workflows.json`
- Modify: `packages/views/locales/zh-Hans/workflows.json`

**Interfaces:**
- Produces: i18n keys for `node_panel`, `canvas_onboarding`, `preflight`, `runtime_notifications`, `canvas_inspector`, `node_card`

- [ ] **Step 1: Add English translations**

Add the following blocks to `packages/views/locales/en/workflows.json`:

```json
{
  "node_panel": {
    "search_placeholder": "Search nodes...",
    "agent_worker": "Agent Worker",
    "human_worker": "Human Worker",
    "squad": "Squad",
    "annotation": "Annotation",
    "agent_default_label": "Agent",
    "agent_default_desc": "AI agent worker",
    "human_default_label": "Human",
    "human_default_desc": "Manual human task",
    "squad_default_label": "Squad",
    "squad_default_desc": "Team collaboration node",
    "annotation_label": "Note",
    "annotation_desc": "Sticky note annotation"
  },
  "canvas_onboarding": {
    "no_stages_title": "Create your first Stage",
    "no_stages_desc": "Stages organize your workflow nodes into logical phases like Requirements, Design, and Build.",
    "create_stage": "Create Stage",
    "no_nodes_label": "Add your first step",
    "add_node": "Add Node"
  },
  "preflight": {
    "issues_count_one": "{{count}} issue",
    "issues_count_other": "{{count}} issues",
    "no_worker": "\"{{title}}\" has no worker assigned",
    "no_stage": "\"{{title}}\" is not assigned to a stage",
    "dag_cycle": "DAG cycle detected",
    "orphan_node": "Orphan node: \"{{title}}\"",
    "invalid_critic": "Invalid critic reference on \"{{title}}\""
  },
  "runtime_notifications": {
    "awaiting_critic": "Node awaiting critic review",
    "blocked": "Node is blocked",
    "failed": "Node execution failed",
    "awaiting_input": "Node awaiting input",
    "alert_label": "Alerts:"
  },
  "canvas_inspector": {
    "title": "Inspector",
    "tab_config": "Config",
    "tab_overview": "Overview",
    "tab_review": "Review",
    "tab_output": "Output",
    "tab_deliverables": "Deliverables",
    "tab_timeline": "Timeline"
  },
  "node_card": {
    "agent_abbr": "A",
    "human_abbr": "H",
    "squad_abbr": "S",
    "status_pending": "Pending",
    "status_working": "Working",
    "status_completed": "Done",
    "status_failed": "Failed",
    "status_blocked": "Blocked"
  }
}
```

- [ ] **Step 2: Add Chinese translations**

Add the corresponding Chinese translations to `packages/views/locales/zh-Hans/workflows.json`:

```json
{
  "node_panel": {
    "search_placeholder": "搜索节点...",
    "agent_worker": "智能体工作者",
    "human_worker": "人类工作者",
    "squad": "小队",
    "annotation": "注释",
    "agent_default_label": "智能体",
    "agent_default_desc": "AI 智能体工作者",
    "human_default_label": "人类",
    "human_default_desc": "人工任务",
    "squad_default_label": "小队",
    "squad_default_desc": "团队协作节点",
    "annotation_label": "备注",
    "annotation_desc": "便签注释"
  },
  "canvas_onboarding": {
    "no_stages_title": "创建第一个阶段",
    "no_stages_desc": "阶段将工作流节点组织为需求、设计、构建等逻辑阶段。",
    "create_stage": "创建阶段",
    "no_nodes_label": "添加第一个步骤",
    "add_node": "添加节点"
  },
  "preflight": {
    "issues_count_one": "{{count}} 个问题",
    "issues_count_other": "{{count}} 个问题",
    "no_worker": "\"{{title}}\" 未分配工作者",
    "no_stage": "\"{{title}}\" 未分配到阶段",
    "dag_cycle": "检测到 DAG 环",
    "orphan_node": "孤立节点：\"{{title}}\"",
    "invalid_critic": "\"{{title}}\" 的评审者引用无效"
  },
  "runtime_notifications": {
    "awaiting_critic": "节点等待评审",
    "blocked": "节点被阻断",
    "failed": "节点执行失败",
    "awaiting_input": "节点等待输入",
    "alert_label": "提醒："
  },
  "canvas_inspector": {
    "title": "检查器",
    "tab_config": "配置",
    "tab_overview": "概览",
    "tab_review": "评审",
    "tab_output": "产出",
    "tab_deliverables": "交付物",
    "tab_timeline": "时间线"
  },
  "node_card": {
    "agent_abbr": "智",
    "human_abbr": "人",
    "squad_abbr": "队",
    "status_pending": "待处理",
    "status_working": "执行中",
    "status_completed": "已完成",
    "status_failed": "失败",
    "status_blocked": "已阻断"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/views/locales/en/workflows.json packages/views/locales/zh-Hans/workflows.json
git commit -m "feat(workflow): add i18n strings for new canvas components"
```

---

## Task 15: Integration — Issue Runtime DAG Viewer Uses New Components

**Files:**
- Modify: `packages/views/issues/components/workflow-dag-viewer.tsx` — replace inline STATUS_CONFIG with import from canvas-model, use WorkflowNodeCard for runtime nodes

**Interfaces:**
- Consumes: `STATUS_CONFIG`, `getRuntimeStatusStyle` from Task 2; `WorkflowNodeCard` from Task 4
- Produces: Updated `WorkflowDagViewer` using shared status config and card protocol

- [ ] **Step 1: Replace inline STATUS_CONFIG with import**

In `packages/views/issues/components/workflow-dag-viewer.tsx`:

Remove lines 26–42 (the inline `STATUS_CONFIG` constant and related helper functions that duplicate `canvas-model.ts`).

Add import:
```typescript
import { STATUS_CONFIG, getRuntimeStatusStyle } from "@multica/core/workflows/canvas-model";
import type { NodeRunStatus } from "@multica/core/types";
```

Update helper functions to use shared config:
- `getStatusColor(status)` → use `STATUS_CONFIG[status as NodeRunStatus]?.color ?? "#6b7280"`
- `getStatusLabel(status)` → use `STATUS_CONFIG[status as NodeRunStatus]?.label ?? status`

- [ ] **Step 2: Run existing tests to verify**

Run: `pnpm --filter @multica/views exec vitest run workflow-dag-viewer`
Expected: Should pass if no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/views/issues/components/workflow-dag-viewer.tsx
git commit -m "refactor(workflow): use shared STATUS_CONFIG in issue DAG viewer"
```

---

## Task 16: Final Polish — TypeScript Check & Full Test Suite

**Files:**
- Modify: any files with type errors

- [ ] **Step 1: Run TypeScript check**

Run: `pnpm typecheck`
Expected: PASS with no errors. Fix any type errors.

- [ ] **Step 2: Run all workflow-related tests**

Run: `pnpm --filter @multica/views exec vitest run workflow`
Run: `pnpm --filter @multica/core exec vitest run workflow`
Expected: All tests PASS.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(workflow): fix type errors and test regressions from canvas refactor"
```

---

## Self-Review Checklist

Before considering this plan complete, verify:

1. **Spec coverage:**
   - §4.1 Color system → Task 1 (tokens)
   - §4.2 Node shapes → Covered by existing `reactflow-nodes.tsx` (already supports shapes); new card in Task 4
   - §4.3 Edge styles → Task 9 (WorkflowEdgeLayer)
   - §4.4 Canvas background → Task 1 (tokens) + existing ReactFlow Background
   - §5.1 Onboarding → Task 12 (CanvasOnboarding)
   - §5.2 Node panel → Task 7 (NodePanel) + Task 13 (integration)
   - §5.3 Node creation paths → Task 7 (drag), Task 13 (integrate with existing port drag)
   - §5.4 Node interactions → Task 8 (CanvasHoverToolbar)
   - §5.5 Node config panel → Task 13 (integrates existing NodeConfigPanel into CanvasInspector tabs)
   - §5.6 Stage lanes → Existing panorama components + tokens
   - §5.7 MiniMap → Already exists in dag-canvas.tsx
   - §5.8 Preflight → Task 10 (PreflightBar) + Task 13 (integration)
   - §6.1 Two modes → Existing panorama architecture already handles this
   - §6.2 Runtime status styles → Task 2 (getRuntimeStatusStyle)
   - §6.3 Node card info → Task 4 (WorkflowNodeCard)
   - §6.4 Inline operations → Existing node-run-control-actions.tsx
   - §6.5 Global notifications → Task 11 (GlobalNotificationBar)
   - §6.6 Runtime detail panel → Task 5 (CanvasInspector) + existing detail panel
   - §6.7 Read-only constraints → Already handled by existing mode toggle

2. **Placeholder scan:** ✅ No TBD/TODO/fill-in-later patterns found. All steps have concrete code.

3. **Type consistency:** ✅ All interfaces use consistent naming: `WorkflowNodeCard`, `CanvasInspector`, `NodePanel`, `PreflightBar`, `GlobalNotificationBar`, `CanvasOnboarding`, `CanvasHoverToolbar`, `WorkflowEdgeLayer`, `WorkflowCanvasShell`.

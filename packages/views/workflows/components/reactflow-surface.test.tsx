// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ReactFlowSurface } from "./reactflow-surface";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";

// ── Store mock ───────────────────────────────────────────────────
const mockStoreState = {
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
  _reverseAction: null as null,
  clearReverseAction: vi.fn(),
};

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: Object.assign(
    (selector: unknown) => {
      if (typeof selector === "function") return selector(mockStoreState);
      return mockStoreState;
    },
    { getState: () => mockStoreState },
  ),
}));

// ── @xyflow/react mock ────────────────────────────────────────────
// MiniMap is mocked to render a data-testid="rf-minimap" so tests
// can assert presence/absence in jsdom (the real MiniMap uses canvas
// and doesn't render a meaningful DOM element in jsdom).
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div className="react-flow">{children}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => <div data-testid="rf-minimap" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes,
  applyEdgeChanges: (_changes: unknown[], edges: unknown[]) => edges,
  useReactFlow: () => ({ screenToFlowPosition: vi.fn(() => ({ x: 0, y: 0 })) }),
}));

const baseNode: WorkflowNode = {
  id: "n1",
  workflow_id: "wf1",
  title: "Node 1",
  description: "",
  position_x: 0,
  position_y: 0,
  format_schema: { shape: "rectangle" },
  worker_type: "agent",
  worker_id: null,
  critic_type: "human",
  critic_id: null,
  critic_api_url: null,
  sort_order: 0,
  stage_id: null,
  created_at: "",
  updated_at: "",
};

const nodes: WorkflowNode[] = [baseNode];
const edges: WorkflowEdge[] = [];

describe("ReactFlowSurface", () => {
  it("renders the ReactFlow canvas", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ReactFlowSurface
          nodes={nodes}
          edges={edges}
          onNodeDragStop={vi.fn()}
          onEdgeCreate={vi.fn()}
          onEdgeDelete={vi.fn()}
          onNodeCreate={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".react-flow")).toBeDefined();
  });

  it("shows empty state when no nodes", () => {
    render(
      <ReactFlowProvider>
        <ReactFlowSurface
          nodes={[]}
          edges={[]}
          onNodeDragStop={vi.fn()}
          onEdgeCreate={vi.fn()}
          onEdgeDelete={vi.fn()}
          onNodeCreate={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText(/add your first step/i)).toBeDefined();
  });

  it("renders MiniMap when showMiniMap is true", () => {
    render(
      <ReactFlowProvider>
        <ReactFlowSurface
          nodes={nodes}
          edges={edges}
          showMiniMap
          onNodeDragStop={vi.fn()}
          onEdgeCreate={vi.fn()}
          onEdgeDelete={vi.fn()}
          onNodeCreate={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // MiniMap is mocked as a <div data-testid="rf-minimap" /> above
    expect(screen.getByTestId("rf-minimap")).toBeDefined();
  });

  it("does not render MiniMap when showMiniMap is false (default)", () => {
    render(
      <ReactFlowProvider>
        <ReactFlowSurface
          nodes={nodes}
          edges={edges}
          onNodeDragStop={vi.fn()}
          onEdgeCreate={vi.fn()}
          onEdgeDelete={vi.fn()}
          onNodeCreate={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    expect(screen.queryByTestId("rf-minimap")).toBeNull();
  });
});

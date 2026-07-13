// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactFlowPropsRef = vi.hoisted(() => [] as Record<string, unknown>[]);
const mocks = vi.hoisted(() => ({
  fitView: vi.fn(),
  viewportInitialized: true,
  nodesInitialized: true,
}));

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: (props: Record<string, unknown>) => {
    reactFlowPropsRef.push(props);
    return (
      <div
        data-testid="reactflow"
        data-draggable={String(props.nodesDraggable)}
        data-connectable={String(props.nodesConnectable)}
      >
        {props.children as React.ReactNode}
      </div>
    );
  },
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  BaseEdge: () => null,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ["M0,0 L100,100"],
  getStraightPath: () => ["M0,0 L100,100"],
  useReactFlow: () => ({
    fitView: mocks.fitView,
    viewportInitialized: mocks.viewportInitialized,
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
  useNodesInitialized: () => mocks.nodesInitialized,
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { computeTemplatePreviewViewport, WorkflowTemplatePreviewCanvas } from "./workflow-template-preview-canvas";
import type { WorkflowEdge, WorkflowNode, WorkflowStage } from "@multica/core/types";

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "workflow-1",
    title: "Design",
    description: "",
    position_x: 120,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 1,
    stage_id: "stage-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: "stage-1",
    workflow_id: "workflow-1",
    name: "Plan",
    description: "",
    sort_order: 0,
    node_count: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
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

describe("WorkflowTemplatePreviewCanvas", () => {
  beforeEach(() => {
    reactFlowPropsRef.length = 0;
    mocks.fitView.mockClear();
    mocks.viewportInitialized = true;
    mocks.nodesInitialized = true;
  });

  it("uses the workflow editor canvas model in read-only mode", () => {
    render(
      <WorkflowTemplatePreviewCanvas
        nodes={[makeNode(), makeNode({ id: "node-2", title: "Build", position_x: 420 })]}
        edges={[makeEdge()]}
        stages={[makeStage()]}
      />,
    );

    expect(screen.getByTestId("workflow-template-preview-canvas")).toHaveClass("flex", "h-full", "w-full");
    expect(screen.getByTestId("workflow-canvas-core")).toBeInTheDocument();
    expect(screen.getByTestId("panorama-canvas")).toHaveClass("left-0");
    expect(screen.getByTestId("reactflow")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByTestId("reactflow")).toHaveAttribute("data-connectable", "false");
    expect(screen.queryByTestId("rf-controls")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rf-minimap")).not.toBeInTheDocument();

    const props = reactFlowPropsRef.at(-1)!;
    const rfNodes = props.nodes as Array<{ type: string }>;
    const rfEdges = props.edges as Array<{ type: string }>;
    expect(rfNodes.map((node) => node.type)).toEqual(["compactWorker", "compactWorker"]);
    expect(rfEdges.map((edge) => edge.type)).toEqual(["panorama"]);
  });

  it("computes a centered viewport for the preview bounds", () => {
    const viewport = computeTemplatePreviewViewport(
      [
        { position: { x: 100, y: 50 }, width: 240, height: 104 },
        { position: { x: 500, y: 450 }, width: 240, height: 104 },
      ],
      { width: 638, height: 398 },
    );

    const boundsCenterX = (100 + 740) / 2;
    const boundsCenterY = (50 + 554) / 2;
    const screenCenterX = boundsCenterX * viewport.zoom + viewport.x;
    const screenCenterY = boundsCenterY * viewport.zoom + viewport.y;

    expect(screenCenterX).toBeCloseTo(319);
    expect(screenCenterY).toBeCloseTo(199);
    expect(viewport.zoom).toBeLessThan(0.85);
  });

  it("passes a centered controlled viewport after measuring the preview size", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 638,
      bottom: 398,
      width: 638,
      height: 398,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      disconnect() {}
    });

    render(
      <WorkflowTemplatePreviewCanvas
        nodes={[makeNode(), makeNode({ id: "node-2", title: "Build", position_x: 420 })]}
        edges={[makeEdge()]}
        stages={[makeStage()]}
      />,
    );

    await waitFor(() => {
      expect(reactFlowPropsRef.at(-1)?.viewport).toEqual(
        expect.objectContaining({
          zoom: expect.any(Number),
        }),
      );
    });

    expect((reactFlowPropsRef.at(-1)?.viewport as { zoom: number }).zoom).toBeLessThanOrEqual(0.85);
    expect(mocks.fitView).not.toHaveBeenCalled();

    rectSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

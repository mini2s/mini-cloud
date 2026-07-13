// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const reactFlowPropsRef = vi.hoisted(() => [] as Record<string, unknown>[]);

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
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

import { WorkflowTemplatePreviewCanvas } from "./workflow-template-preview-canvas";
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
    expect(screen.getByTestId("reactflow")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByTestId("reactflow")).toHaveAttribute("data-connectable", "false");

    const props = reactFlowPropsRef.at(-1)!;
    const rfNodes = props.nodes as Array<{ type: string }>;
    const rfEdges = props.edges as Array<{ type: string }>;
    expect(rfNodes.map((node) => node.type)).toEqual(["compactWorker", "compactWorker"]);
    expect(rfEdges.map((edge) => edge.type)).toEqual(["panorama"]);
  });
});

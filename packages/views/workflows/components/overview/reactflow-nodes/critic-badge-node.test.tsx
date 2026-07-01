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

function renderWithProvider(node: Node) {
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
        draggable={false}
        selectable={false}
        dragging={false}
        deletable={false}
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
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("border-dashed");
    expect(el).toHaveClass("bg-muted/30");
  });

  it("shows ShieldAlert icon and Critic label", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Critic")).toBeInTheDocument();
  });

  it("shows critic name", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("has only a top Handle (target)", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handles = document.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(1);
  });

  it("uses a stable top handle id", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handle = document.querySelector(".react-flow__handle");
    expect(handle?.getAttribute("data-handleid")).toBe("top");
  });

  it("has correct dimensions", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toHaveClass("h-12", "w-36");
  });
});

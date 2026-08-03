// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type Node } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "@multica/core/types";
import { BoundaryNode, type BoundaryNodeData } from "./boundary-node";

function makeNode(kind: "start" | "end"): WorkflowNode {
  return {
    id: kind,
    workflow_id: "workflow-1",
    title: kind === "start" ? "Start" : "End",
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: { type: kind },
    worker_type: "human",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: "stage-1",
    created_at: "",
    updated_at: "",
  };
}

function renderBoundary(kind: "start" | "end", dataOverrides: Partial<BoundaryNodeData> = {}) {
  const node: Node<BoundaryNodeData> = {
    id: kind,
    type: "boundary",
    position: { x: 0, y: 0 },
    data: { node: makeNode(kind), kind, stageColorIndex: 0, ...dataOverrides },
  };
  return render(
    <ReactFlowProvider>
      <BoundaryNode
        id={node.id}
        data={node.data}
        selected={false}
        type="boundary"
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        draggable={false}
        selectable={false}
        dragging={false}
        deletable
      />
    </ReactFlowProvider>,
  );
}

describe("BoundaryNode", () => {
  it("renders directional handles for boundary kinds", () => {
    const { unmount } = renderBoundary("start");
    expect(screen.getByTestId("boundary-node-start")).toHaveStyle({ width: "176px", height: "64px" });
    expect(document.querySelector('[data-handleid="right"]')).toBeInTheDocument();
    expect(document.querySelector('[data-handleid="bottom"]')).toBeInTheDocument();
    expect(document.querySelector('[data-handleid="left"]')).not.toBeInTheDocument();

    unmount();
    renderBoundary("end");
    expect(document.querySelector('[data-handleid="left"]')).toBeInTheDocument();
    expect(document.querySelector('[data-handleid="right"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-handleid="bottom"]')).not.toBeInTheDocument();
  });

  it("uses the shared connected-node affordance for the start boundary", () => {
    const onAddConnectedNode = vi.fn();
    renderBoundary("start", {
      addConnectedNodeLabel: "Drag to connect, click to add node",
      onAddConnectedNode,
    });

    const addButton = screen.getByRole("button", { name: "Drag to connect, click to add node" });
    expect(screen.getByTestId("workflow-canvas-add-connected-node-tooltip")).toHaveTextContent("Click to add node");

    fireEvent.click(addButton);

    expect(onAddConnectedNode).toHaveBeenCalledWith("start");
  });
});

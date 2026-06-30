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
  id: "0",
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
    const node1: Node<LaneBgNodeData> = { ...baseNode, id: "1", data: { stageIndex: 1 } };
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
    const node: Node<LaneBgNodeData> = { ...baseNode, id: "99", data: { stageIndex: 99 } };
    renderWithProvider(node);
    const el = screen.getByTestId("lane-bg-99");
    // 99 % 6 = 3 → rose
    expect(el.className).toContain("bg-rose-50/45");
  });
});

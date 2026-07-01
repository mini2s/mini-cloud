import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { GradientBgNode, type GradientBgNodeData } from "./gradient-bg-node";
import type { Node } from "@xyflow/react";

function renderWithProvider(node: Node) {
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
        draggable={false}
        selectable={false}
        dragging={false}
        deletable={false}
      />
    </ReactFlowProvider>,
  );
}

const baseNode = {
  id: "gradient-0",
  type: "gradientBg",
  position: { x: 0, y: 160 },
  data: { fromStageIndex: 0 } as GradientBgNodeData,
} as Node;

describe("GradientBgNode", () => {
  it("renders with correct height (16px)", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-gradient-0");
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ width: "2400px", height: "16px" });
  });

  it("uses correct gradient for stage transition", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-gradient-0");
    expect(el.className).toContain("from-slate-100/60");
    expect(el.className).toContain("to-stone-100/60");
  });

  it("is not interactive", () => {
    renderWithProvider(baseNode);
    const el = screen.getByTestId("gradient-bg-gradient-0");
    expect(el).toHaveAttribute("data-nodrag", "true");
  });

  it("cycles gradients correctly", () => {
    const node = { ...baseNode, id: "gradient-99", data: { fromStageIndex: 99 } } as Node;
    renderWithProvider(node);
    const el = screen.getByTestId("gradient-bg-gradient-99");
    // 99 % 6 = 3 → rose-to-violet
    expect(el.className).toContain("from-rose-100/50");
    expect(el.className).toContain("to-violet-100/50");
  });
});

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PanoramaEdge } from "./panorama-edge";
import type { EdgeProps } from "@xyflow/react";

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
    expect(path?.style.strokeWidth).toBe("1.5");
  });

  it("uses low opacity", () => {
    const container = renderEdge();
    const path = container.querySelector("path");
    expect(path?.style.opacity).toBe("0.35");
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
    expect(d).toContain("L");
  });

  it("renders dashed for critic connections", () => {
    const container = renderEdge({
      id: "e-critic",
      sourceX: 196,
      sourceY: 64,
      targetX: 172,
      targetY: 84,
      style: { strokeDasharray: "4 3" },
    });
    const path = container.querySelector("path");
    expect(path?.style.strokeDasharray).toBe("4 3");
  });

  it("applies selection glow when selected", () => {
    const container = renderEdge({ selected: true });
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });
});

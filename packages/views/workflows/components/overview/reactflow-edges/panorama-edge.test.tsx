import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider, Position } from "@xyflow/react";
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
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
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

  it("uses explicit stage color data before falling back to source Y", () => {
    const container = renderEdge({
      sourceY: 44,
      data: { stageColorIndex: 3 },
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("class")).toContain("text-rose-300");
  });

  it("does not render text labels on data edges", () => {
    const container = renderEdge({
      data: { edgeKind: "data", edgeLabel: "data", stageColorIndex: 2 },
    });
    expect(container.querySelector("[data-testid='panorama-edge-label']")).not.toBeInTheDocument();
    expect(container.querySelector("[data-testid='panorama-edge-label-shell']")).not.toBeInTheDocument();
  });

  it("uses semantic tone without rendering condition text labels", () => {
    const container = renderEdge({
      data: { edgeKind: "condition", edgeLabel: "approved", edgeTone: "condition" },
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("class")).toContain("text-blue");
    expect(container.querySelector("[data-testid='panorama-edge-label']")).not.toBeInTheDocument();
  });

  it("renders critic edges with dashed amber styling and no text label", () => {
    const container = renderEdge({
      data: { edgeKind: "critic", edgeLabel: "critic", edgeTone: "critic" },
      style: { strokeDasharray: "4 3" },
    });
    const path = container.querySelector("path");
    expect(path?.style.strokeDasharray).toBe("4 3");
    expect(path?.getAttribute("class")).toContain("amber");
    expect(container.querySelector("[data-testid='panorama-edge-label']")).not.toBeInTheDocument();
  });

  it("uses straight path for same-Y horizontal connections", () => {
    const container = renderEdge({
      sourceX: 224,
      sourceY: 44,
      targetX: 500,
      targetY: 44,
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBe(2);
  });

  it("renders dashed for critic connections", () => {
    const container = renderEdge({
      id: "e-critic",
      sourceX: 196,
      sourceY: 64,
      targetX: 172,
      targetY: 84,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: { strokeDasharray: "4 3" },
    });
    const path = container.querySelector("path");
    expect(path?.style.strokeDasharray).toBe("4 3");
  });

  it("uses straight path for vertical connections (Bottom→Top)", () => {
    const container = renderEdge({
      sourceX: 196,
      sourceY: 64,
      targetX: 172,
      targetY: 84,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    // Straight path: M x,y L x,y — exactly one line segment, no intermediate waypoints
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBe(2); // M + single L = direct line
  });

  it("uses straight path for vertical connections (Top→Bottom)", () => {
    const container = renderEdge({
      sourceX: 172,
      sourceY: 84,
      targetX: 196,
      targetY: 64,
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBe(2);
  });

  it("uses smooth step path for horizontal connections (Right→Left)", () => {
    const container = renderEdge({
      sourceX: 224,
      sourceY: 44,
      targetX: 500,
      targetY: 92,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    // Smooth step path has intermediate waypoints (multiple L segments)
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBeGreaterThan(2);
  });

  it("applies selection glow when selected", () => {
    const container = renderEdge({ selected: true });
    const paths = container.querySelectorAll("path.react-flow__edge-path");
    expect(paths.length).toBe(1);
    expect(paths[0]?.getAttribute("class")).toContain("drop-shadow");
  });
});

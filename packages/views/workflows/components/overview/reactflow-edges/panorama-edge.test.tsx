import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, Position } from "@xyflow/react";
import { PanoramaEdge } from "./panorama-edge";
import type { EdgeProps } from "@xyflow/react";
import type { ReactNode } from "react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

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

  it("renders default panorama edges with readable opacity and stroke width", () => {
    const container = renderEdge({ id: "edge-1", selected: false, data: { edgeTone: "data" } });
    const path = container.querySelector("path");
    expect(path?.style.strokeWidth).toBe("2.75");
    expect(path?.style.opacity).toBe("0.72");
  });

  it("renders selected edges with stronger primary emphasis", () => {
    const container = renderEdge({ id: "edge-1", selected: true, data: { edgeTone: "data" } });
    const path = container.querySelector("path");
    expect(path?.style.opacity).toBe("0.95");
    expect(path?.style.strokeWidth).toBe("3.5");
  });

  it("tones down completed and waiting runtime edges so they do not dominate the canvas", () => {
    const successContainer = renderEdge({ id: "edge-success", data: { edgeTone: "success" } });
    const waitingContainer = renderEdge({ id: "edge-waiting", data: { edgeTone: "waiting" } });

    const successPath = successContainer.querySelector("path");
    const waitingPath = waitingContainer.querySelector("path");
    expect(successPath?.style.opacity).toBe("0.46");
    expect(successPath?.style.strokeWidth).toBe("2.25");
    expect(waitingPath?.style.opacity).toBe("0.34");
    expect(waitingPath?.style.strokeWidth).toBe("2");
  });

  it("uses explicit stage color data before falling back to source Y", () => {
    const container = renderEdge({
      sourceY: 44,
      data: { stageColorIndex: 3 },
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("class")).toContain("text-rose-300");
  });

  it("renders business labels for runtime edge data", () => {
    renderEdge({
      id: "edge-1",
      selected: false,
      sourceX: 20,
      sourceY: 30,
      targetX: 120,
      targetY: 30,
      data: { edgeTone: "running", edgeLabel: "4 child issues" },
    });
    expect(screen.getByTestId("panorama-edge-label-edge-1")).toHaveTextContent("4 child issues");
  });

  it("uses semantic tone and renders condition labels when supplied", () => {
    const container = renderEdge({
      id: "edge-condition",
      data: { edgeKind: "condition", edgeLabel: "approved", edgeTone: "condition" },
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("class")).toContain("text-blue");
    expect(screen.getByTestId("panorama-edge-label-edge-condition")).toHaveTextContent("approved");
  });

  it("renders critic edges with dashed amber styling and labels when supplied", () => {
    const container = renderEdge({
      id: "edge-critic",
      data: { edgeKind: "critic", edgeLabel: "critic", edgeTone: "critic" },
      style: { strokeDasharray: "4 3" },
    });
    const path = container.querySelector("path");
    expect(path?.style.strokeDasharray).toBe("4 3");
    expect(path?.getAttribute("class")).toContain("amber");
    expect(screen.getByTestId("panorama-edge-label-edge-critic")).toHaveTextContent("critic");
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
    // Smooth step path has intermediate waypoints (multiple L segments).
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBeGreaterThan(2);
  });

  it("uses straight path for same-stage horizontal connections", () => {
    const container = renderEdge({
      sourceX: 224,
      sourceY: 44,
      targetX: 500,
      targetY: 92,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { sameStage: true },
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBe(2);
  });

  it("uses smooth step path for cross-stage horizontal connections", () => {
    const container = renderEdge({
      sourceX: 224,
      sourceY: 44,
      targetX: 500,
      targetY: 220,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { sameStage: false },
    });
    const path = container.querySelector("path");
    const d = path?.getAttribute("d") ?? "";
    const segments = d.match(/[ML]/g) ?? [];
    expect(segments.length).toBeGreaterThan(2);
  });

  it("applies selection glow when selected", () => {
    const container = renderEdge({ selected: true });
    const paths = container.querySelectorAll("path.react-flow__edge-path");
    expect(paths.length).toBe(1);
    expect(paths[0]?.getAttribute("class")).toContain("drop-shadow");
  });

  it("renders a delete button for selected workflow edges", () => {
    renderEdge({
      selected: true,
      data: { onDeleteEdge: vi.fn() },
    });

    expect(screen.getByRole("button", { name: "Delete edge" })).toBeInTheDocument();
  });

  it("positions the delete button at the provided safe edge click point", () => {
    renderEdge({
      selected: true,
      data: {
        onDeleteEdge: vi.fn(),
        deleteButtonPosition: { x: 120, y: 88 },
      },
    });

    expect(screen.getByRole("button", { name: "Delete edge" })).toHaveStyle({
      transform: "translate(-50%, -50%) translate(120px, 88px)",
    });
  });

  it("does not add a custom hitbox that can block React Flow edge selection", () => {
    const container = renderEdge({
      selected: false,
      data: { onDeleteEdge: vi.fn() },
    });

    expect(container.querySelector("[data-testid='panorama-edge-hitbox-e-1']")).not.toBeInTheDocument();
    expect(container.querySelectorAll("path.react-flow__edge-interaction")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete edge" })).not.toBeInTheDocument();
  });

  it("calls delete callback with the edge id", () => {
    const onDeleteEdge = vi.fn();
    renderEdge({
      id: "edge-delete-me",
      selected: true,
      data: { onDeleteEdge },
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete edge" }));

    expect(onDeleteEdge).toHaveBeenCalledWith("edge-delete-me");
  });

  it("does not render delete button for critic edges", () => {
    renderEdge({
      selected: true,
      data: { edgeKind: "critic", edgeTone: "critic", onDeleteEdge: vi.fn() },
    });

    expect(screen.queryByRole("button", { name: "Delete edge" })).not.toBeInTheDocument();
  });
});

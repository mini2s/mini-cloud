import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WorkflowEdgeLayer, computePaths } from "./workflow-edge-layer";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";

const nodes: WorkflowNode[] = [
  { id: "a", workflow_id: "wf1", title: "A", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 0, stage_id: "s1", created_at: "", updated_at: "" },
  { id: "b", workflow_id: "wf1", title: "B", description: "", position_x: 200, position_y: 0, format_schema: null, worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 1, stage_id: "s1", created_at: "", updated_at: "" },
];

const edges: WorkflowEdge[] = [
  { id: "e1", workflow_id: "wf1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" },
];

describe("computePaths", () => {
  it("returns paths for given edges and positions", () => {
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const paths = computePaths(edges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths.length).toBe(1);
    const p0 = paths[0]!;
    expect(p0.edgeId).toBe("e1");
    expect(p0.semantic).toBe("data");
  });

  it("returns error semantic for error edge", () => {
    const errorEdges: WorkflowEdge[] = [
      { id: "e1", workflow_id: "wf1", source_node_id: "a", target_node_id: "b", condition: { error: true }, created_at: "" },
    ];
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const paths = computePaths(errorEdges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths[0]!.semantic).toBe("error");
  });

  it("returns empty array for missing positions", () => {
    const positions = new Map<string, DOMRect>();
    const paths = computePaths(edges, nodes, positions, { width: 800, height: 200, left: 0, top: 0 });
    expect(paths.length).toBe(0);
  });
});

describe("WorkflowEdgeLayer", () => {
  it("renders SVG with paths", () => {
    const positions = new Map<string, DOMRect>([
      ["a", new DOMRect(100, 50, 160, 70)],
      ["b", new DOMRect(400, 50, 160, 70)],
    ]);
    const { container } = render(
      <WorkflowEdgeLayer
        edges={edges}
        nodes={nodes}
        containerRect={{ width: 800, height: 200, left: 0, top: 0 }}
        nodePositions={positions}
        surface="stage-lane"
      />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeDefined();
    const paths = svg!.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
  });
});

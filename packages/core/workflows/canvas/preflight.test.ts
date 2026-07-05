import { describe, expect, it } from "vitest";
import { runCanvasPreflight } from "./preflight";
import type { CanvasEdge, CanvasModel, CanvasNode } from "./types";

function node(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: "n1",
    workflowId: "workflow-1",
    title: "Node",
    description: "",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId: "stage-1",
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: "agent-1",
    criticType: "human",
    criticId: "member-1",
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
    ...overrides,
  };
}

function edge(sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id: `${sourceNodeId}-${targetNodeId}`,
    workflowId: "workflow-1",
    sourceNodeId,
    targetNodeId,
    condition: null,
    source: {} as CanvasEdge["source"],
  };
}

function model(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasModel {
  return {
    stages: [],
    nodes,
    edges,
    nodesById: new Map(nodes.map((item) => [item.id, item])),
    edgesById: new Map(edges.map((item) => [item.id, item])),
  };
}

describe("runCanvasPreflight", () => {
  it("reports missing worker and critic references", () => {
    const issues = runCanvasPreflight(model([
      node({ id: "n1", workerId: null, criticId: null }),
    ], []));

    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_worker",
      "missing_critic",
      "isolated_node",
    ]);
  });

  it("reports cycles", () => {
    const issues = runCanvasPreflight(model([
      node({ id: "n1" }),
      node({ id: "n2" }),
    ], [edge("n1", "n2"), edge("n2", "n1")]));

    expect(issues.some((issue) => issue.code === "cycle_detected")).toBe(true);
  });

  it("does not double-report isolated nodes as unreachable", () => {
    // n3 is isolated (not in any edge) — it should get isolated_node but NOT unreachable_node
    const issues = runCanvasPreflight(model([
      node({ id: "n1" }),
      node({ id: "n2" }),
      node({ id: "n3" }),
    ], [edge("n1", "n2")]));

    expect(issues).toContainEqual(expect.objectContaining({
      code: "isolated_node",
      nodeId: "n3",
    }));
    // n3 should NOT be flagged as unreachable since it's already isolated
    expect(issues.find((i) => i.code === "unreachable_node" && i.nodeId === "n3")).toBeUndefined();
  });
});

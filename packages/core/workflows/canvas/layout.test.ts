import { describe, expect, it } from "vitest";
import { chooseEdgeHandles, layoutNodesByStage } from "./layout";
import type { CanvasNode, CanvasStage } from "./types";

function canvasNode(id: string, stageId: string | null, x: number, y: number, sortOrder = 0): CanvasNode {
  return {
    id,
    workflowId: "workflow-1",
    title: id,
    description: "",
    position: { x, y },
    sortOrder,
    stageId,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: null,
    criticType: "human",
    criticId: null,
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
  };
}

function canvasStage(id: string, sortOrder: number): CanvasStage {
  return {
    id,
    workflowId: "workflow-1",
    name: id,
    description: "",
    sortOrder,
    nodeCount: 0,
    source: null,
    isVirtual: false,
  };
}

describe("chooseEdgeHandles", () => {
  it("uses right-to-left handles for mostly horizontal edges", () => {
    expect(chooseEdgeHandles({ x: 0, y: 0 }, { x: 200, y: 20 })).toEqual({
      sourceHandle: "right",
      targetHandle: "left",
    });
  });

  it("uses bottom-to-top handles for mostly vertical edges", () => {
    expect(chooseEdgeHandles({ x: 0, y: 0 }, { x: 20, y: 200 })).toEqual({
      sourceHandle: "bottom",
      targetHandle: "top",
    });
  });
});

describe("layoutNodesByStage", () => {
  it("places nodes by stage order and node sort order", () => {
    const result = layoutNodesByStage({
      stages: [canvasStage("s2", 2), canvasStage("s1", 1)],
      nodes: [
        canvasNode("n2", "s1", 0, 0, 2),
        canvasNode("n1", "s1", 0, 0, 1),
        canvasNode("n3", "s2", 0, 0, 1),
      ],
    });

    expect(result.map((item) => [item.nodeId, item.x, item.y])).toEqual([
      ["n1", 160, 120],
      ["n2", 360, 120],
      ["n3", 160, 280],
    ]);
  });
});

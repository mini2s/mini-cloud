import { describe, expect, it } from "vitest";
import { workflowEdgesToReactFlowEdges, workflowNodesToReactFlowNodes } from "./workflow-canvas-model";
import type { WorkflowEdge, WorkflowNode, WorkflowStage } from "@multica/core/types";

function makeStage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: "stage-1",
    workflow_id: "workflow-1",
    name: "Stage 1",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "workflow-1",
    title: "Node 1",
    description: "",
    position_x: 100,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: "stage-1",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: "edge-1",
    workflow_id: "workflow-1",
    source_node_id: "node-1",
    target_node_id: "node-2",
    condition: null,
    created_at: "",
    ...overrides,
  };
}

describe("workflowEdgesToReactFlowEdges", () => {
  it("maps boundary nodes to their dedicated renderer and dimensions", () => {
    const rfNodes = workflowNodesToReactFlowNodes({
      nodes: [
        makeNode({ id: "start", position_x: 100, format_schema: { type: "start" } }),
        makeNode({ id: "task", position_x: 200 }),
        makeNode({ id: "end", position_x: 300, format_schema: { type: "end" } }),
      ],
      stages: [makeStage()],
      nodeType: "compactWorker",
      makeNodeData: (node) => ({ node }),
    });

    expect(rfNodes.find((node) => node.id === "start")).toMatchObject({
      type: "boundary",
      width: 176,
      height: 64,
      data: { kind: "start" },
    });
    expect(rfNodes.find((node) => node.id === "end")).toMatchObject({
      type: "boundary",
      width: 176,
      height: 64,
      data: { kind: "end" },
    });
    expect(rfNodes.find((node) => node.id === "task")?.position.x).toBe(372);
  });

  it("enforces a minimum horizontal gap within each stage without compressing larger gaps", () => {
    const rfNodes = workflowNodesToReactFlowNodes({
      nodes: [
        makeNode({ id: "stage-1-a", stage_id: "stage-1", position_x: 100, sort_order: 0 }),
        makeNode({ id: "stage-1-b", stage_id: "stage-1", position_x: 420, sort_order: 1 }),
        makeNode({ id: "stage-1-c", stage_id: "stage-1", position_x: 900, sort_order: 2 }),
        makeNode({ id: "stage-2-a", stage_id: "stage-2", position_x: 120, sort_order: 0 }),
      ],
      stages: [
        makeStage({ id: "stage-1", sort_order: 0 }),
        makeStage({ id: "stage-2", sort_order: 1 }),
      ],
      nodeType: "compactWorker",
      makeNodeData: (node) => ({ node }),
    });

    expect(Object.fromEntries(rfNodes.map((node) => [node.id, node.position.x]))).toEqual({
      "stage-1-a": 100,
      "stage-1-b": 492,
      "stage-1-c": 900,
      "stage-2-a": 120,
    });
  });

  it("does not create critic badge nodes by default", () => {
    const rfNodes = workflowNodesToReactFlowNodes({
      nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
      stages: [],
      nodeType: "compactWorker",
      makeNodeData: (node) => ({ node }),
    });

    expect(rfNodes.map((node) => node.id)).toEqual(["node-1"]);
  });

  it("creates critic badge nodes when explicitly enabled", () => {
    const rfNodes = workflowNodesToReactFlowNodes({
      nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
      stages: [],
      nodeType: "compactWorker",
      includeCriticBadges: true,
      makeNodeData: (node) => ({ node }),
    });

    expect(rfNodes.map((node) => node.id)).toEqual(["node-1", "node-1:critic"]);
  });

  it("does not create critic edges by default", () => {
    const rfEdges = workflowEdgesToReactFlowEdges({
      edges: [],
      nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
      stages: [],
    });

    expect(rfEdges).toEqual([]);
  });

  it("creates critic edges when explicitly enabled", () => {
    const rfEdges = workflowEdgesToReactFlowEdges({
      edges: [],
      nodes: [makeNode({ id: "node-1", critic_id: "critic-1" })],
      stages: [],
      includeCriticEdges: true,
    });

    expect(rfEdges.map((edge) => edge.id)).toEqual(["node-1:critic-edge"]);
  });

  it("marks whether workflow edges connect nodes in the same stage", () => {
    const edges = workflowEdgesToReactFlowEdges({
      stages: [
        makeStage({ id: "stage-1", sort_order: 0 }),
        makeStage({ id: "stage-2", sort_order: 1 }),
      ],
      nodes: [
        makeNode({ id: "node-1", stage_id: "stage-1" }),
        makeNode({ id: "node-2", stage_id: "stage-1" }),
        makeNode({ id: "node-3", stage_id: "stage-2" }),
      ],
      edges: [
        makeEdge({ id: "same-stage", source_node_id: "node-1", target_node_id: "node-2" }),
        makeEdge({ id: "cross-stage", source_node_id: "node-1", target_node_id: "node-3" }),
      ],
    });

    expect(edges.find((edge) => edge.id === "same-stage")?.data).toMatchObject({ sameStage: true });
    expect(edges.find((edge) => edge.id === "cross-stage")?.data).toMatchObject({ sameStage: false });
  });

  it("keeps ordinary editor edges stage-colored even when condition metadata is an object", () => {
    const edges = workflowEdgesToReactFlowEdges({
      stages: [
        makeStage({ id: "stage-1", sort_order: 0 }),
        makeStage({ id: "stage-2", sort_order: 1 }),
        makeStage({ id: "stage-3", sort_order: 2 }),
      ],
      nodes: [
        makeNode({ id: "node-1", stage_id: "stage-1" }),
        makeNode({ id: "node-2", stage_id: "stage-2" }),
        makeNode({ id: "node-3", stage_id: "stage-3" }),
      ],
      edges: [
        makeEdge({ id: "stage-1-edge", source_node_id: "node-1", target_node_id: "node-2", condition: {} }),
        makeEdge({ id: "stage-3-edge", source_node_id: "node-3", target_node_id: "node-2", condition: {} }),
      ],
    });

    expect(edges.find((edge) => edge.id === "stage-1-edge")?.data).toMatchObject({
      edgeTone: "data",
      stageColorIndex: 0,
    });
    expect(edges.find((edge) => edge.id === "stage-1-edge")?.markerEnd).toMatchObject({
      color: "rgb(203 213 225)",
    });
    expect(edges.find((edge) => edge.id === "stage-3-edge")?.data).toMatchObject({
      edgeTone: "data",
      stageColorIndex: 2,
    });
    expect(edges.find((edge) => edge.id === "stage-3-edge")?.markerEnd).toMatchObject({
      color: "rgb(147 197 253)",
    });
  });
});

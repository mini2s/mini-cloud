import { describe, expect, it } from "vitest";
import { workflowEdgesToReactFlowEdges } from "./workflow-canvas-model";
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
});

import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeRun, WorkflowStage } from "../../types";
import { buildCanvasModel } from "./build-canvas-model";

function node(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "workflow-1",
    title: "Node",
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stage(overrides: Partial<WorkflowStage>): WorkflowStage {
  return {
    id: "stage-1",
    workflow_id: "workflow-1",
    name: "Stage",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function edge(overrides: Partial<WorkflowEdge>): WorkflowEdge {
  return {
    id: "edge-1",
    workflow_id: "workflow-1",
    source_node_id: "node-1",
    target_node_id: "node-2",
    condition: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function nodeRun(overrides: Partial<WorkflowNodeRun>): WorkflowNodeRun {
  return {
    id: "node-run-1",
    workflow_run_id: "run-1",
    workflow_node_id: "node-1",
    node_title: "Node",
    status: "pending",
    retry_count: 0,
    worker_type: "agent",
    worker_id: null,
    worker_output: null,
    worker_agent_task_id: null,
    critic_type: "human",
    critic_id: null,
    critic_output: null,
    critic_comment: "",
    critic_agent_task_id: null,
    agent_task_id: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildCanvasModel", () => {
  it("sorts stages and nodes into a stable canvas model", () => {
    const model = buildCanvasModel({
      stages: [stage({ id: "s2", name: "Build", sort_order: 2 }), stage({ id: "s1", name: "Plan", sort_order: 1 })],
      nodes: [
        node({ id: "n2", title: "Second", stage_id: "s1", sort_order: 2, position_x: 200, position_y: 20 }),
        node({ id: "n1", title: "First", stage_id: "s1", sort_order: 1, position_x: 100, position_y: 20 }),
      ],
      edges: [edge({ id: "e1", source_node_id: "n1", target_node_id: "n2" })],
    });

    expect(model.stages.map((s) => s.id)).toEqual(["s1", "s2", "__unassigned__"]);
    expect(model.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(model.edges[0]).toMatchObject({ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" });
  });

  it("applies node draft overlays without mutating server nodes", () => {
    const serverNode = node({ id: "n1", title: "Server", position_x: 10, position_y: 20 });
    const model = buildCanvasModel({
      stages: [],
      nodes: [serverNode],
      edges: [],
      draft: {
        nodeEdits: {
          n1: { title: "Draft", position_x: 30 },
        },
        deletedNodeIds: [],
      },
    });

    expect(model.nodes[0]).toMatchObject({ id: "n1", title: "Draft", position: { x: 30, y: 20 } });
    expect(serverNode.title).toBe("Server");
    expect(serverNode.position_x).toBe(10);
  });

  it("filters draft-deleted nodes and dangling edges", () => {
    const model = buildCanvasModel({
      stages: [],
      nodes: [node({ id: "n1" }), node({ id: "n2" })],
      edges: [edge({ id: "e1", source_node_id: "n1", target_node_id: "n2" })],
      draft: { nodeEdits: {}, deletedNodeIds: ["n2"] },
    });

    expect(model.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(model.edges).toEqual([]);
  });

  it("attaches runtime overlays by workflow node id", () => {
    const model = buildCanvasModel({
      stages: [],
      nodes: [node({ id: "n1" })],
      edges: [],
      nodeRuns: [nodeRun({ workflow_node_id: "n1", status: "working", retry_count: 2 })],
    });

    expect(model.nodes[0]?.runtime).toMatchObject({
      nodeRunId: "node-run-1",
      status: "working",
      retryCount: 2,
    });
  });
});

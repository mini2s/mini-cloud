import { describe, expect, it } from "vitest";
import { computeLaneAutoLayout, computeStageTransferPositionX } from "./layout";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";

function makeNode(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "n1",
    workflow_id: "wf-1",
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
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<WorkflowEdge>): WorkflowEdge {
  return {
    id: "e1",
    workflow_id: "wf-1",
    source_node_id: "n1",
    target_node_id: "n2",
    condition: null,
    created_at: "",
    ...overrides,
  };
}

describe("computeLaneAutoLayout", () => {
  it("spreads nodes in the same stage across distinct x positions", () => {
    const positions = computeLaneAutoLayout(
      [
        makeNode({ id: "n1", stage_id: "stage-1" }),
        makeNode({ id: "n2", stage_id: "stage-1" }),
        makeNode({ id: "n3", stage_id: "stage-1" }),
      ],
      [
        makeEdge({ id: "e1", source_node_id: "n1", target_node_id: "n2" }),
        makeEdge({ id: "e2", source_node_id: "n2", target_node_id: "n3" }),
      ],
    );

    expect(new Set(positions.values()).size).toBe(3);
    expect(positions.get("n2")).toBeGreaterThan(positions.get("n1") ?? 0);
    expect(positions.get("n3")).toBeGreaterThan(positions.get("n2") ?? 0);
  });
});

describe("computeStageTransferPositionX", () => {
  it("places a moved node in an open slot within the target stage", () => {
    const x = computeStageTransferPositionX(
      [
        makeNode({ id: "n1", stage_id: "stage-1", position_x: 120 }),
        makeNode({ id: "n2", stage_id: "stage-1", position_x: 440 }),
        makeNode({ id: "moving", stage_id: "stage-2", position_x: 120 }),
      ],
      "moving",
      "stage-1",
    );

    expect(x).toBe(872);
  });
});

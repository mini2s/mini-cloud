import { describe, it, expect } from "vitest";
import { inferEdgeSemantics, EDGE_VISUAL_CONFIGS } from "./edge-semantics";
import type { WorkflowEdge, WorkflowNode } from "../types";

function makeNode(id: string, stageId?: string): WorkflowNode {
  return {
    id, workflow_id: "wf1", title: id, description: "",
    position_x: 0, position_y: 0, format_schema: null,
    worker_type: "human", worker_id: null,
    critic_type: "human", critic_id: null, critic_api_url: null,
    sort_order: 0, stage_id: stageId ?? null,
    created_at: "", updated_at: "",
  };
}

function makeEdge(id: string, source: string, target: string, condition?: unknown): WorkflowEdge {
  return { id, workflow_id: "wf1", source_node_id: source, target_node_id: target, condition: condition ?? null, created_at: "" };
}

describe("inferEdgeSemantics", () => {
  it("returns 'data' for edge without condition", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("data");
  });

  it("returns 'control' when condition has path field (true/false branches)", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b", { path: "true" });
    expect(inferEdgeSemantics(edge, nodes)).toBe("control");
  });

  it("returns 'error' when condition has error field", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edge = makeEdge("e1", "a", "b", { error: true });
    expect(inferEdgeSemantics(edge, nodes)).toBe("error");
  });

  it("returns 'control' for cross-stage edges", () => {
    const nodes = [makeNode("a", "stage-1"), makeNode("b", "stage-2")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("control");
  });

  it("returns 'data' for same-stage edge without condition", () => {
    const nodes = [makeNode("a", "stage-1"), makeNode("b", "stage-1")];
    const edge = makeEdge("e1", "a", "b");
    expect(inferEdgeSemantics(edge, nodes)).toBe("data");
  });
});

describe("EDGE_VISUAL_CONFIGS", () => {
  it("has config for all three semantics", () => {
    expect(EDGE_VISUAL_CONFIGS.data).toBeDefined();
    expect(EDGE_VISUAL_CONFIGS.control).toBeDefined();
    expect(EDGE_VISUAL_CONFIGS.error).toBeDefined();
  });

  it("data uses solid stroke, control uses green/red labels, error uses dashed red", () => {
    expect(EDGE_VISUAL_CONFIGS.data.strokeDasharray).toBe("none");
    expect(EDGE_VISUAL_CONFIGS.error.strokeDasharray).toBe("6 3");
    expect(EDGE_VISUAL_CONFIGS.control.hasLabel).toBe(true);
  });
});

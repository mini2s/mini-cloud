import { describe, it, expect } from "vitest";
import {
  checkDAGCycles,
  checkOrphanNodes,
  checkUnreachableNodes,
  checkWorkerMissing,
  checkInvalidCriticRef,
  checkStageMissing,
  runAllPreflightChecks,
} from "./preflight-checks";
import type { WorkflowNode, WorkflowEdge, WorkflowStage } from "../types";

// ── Test fixtures ──

function makeNode(overrides: Partial<WorkflowNode> & { id: string }): WorkflowNode {
  return {
    workflow_id: "wf-1",
    title: overrides.id,
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: "agent-1",
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

function makeEdge(overrides: Partial<WorkflowEdge> & { source_node_id: string; target_node_id: string }): WorkflowEdge {
  return {
    id: `e-${overrides.source_node_id}-${overrides.target_node_id}`,
    workflow_id: "wf-1",
    condition: null,
    created_at: "",
    ...overrides,
  };
}

function makeStage(overrides: Partial<WorkflowStage> & { id: string; sort_order: number }): WorkflowStage {
  return {
    workflow_id: "wf-1",
    name: overrides.id,
    description: "",
    node_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// ── checkDAGCycles ──

describe("checkDAGCycles", () => {
  it("returns empty for empty nodes", () => {
    expect(checkDAGCycles([], [])).toEqual([]);
  });

  it("returns empty for single node", () => {
    const nodes = [makeNode({ id: "a" })];
    expect(checkDAGCycles(nodes, [])).toEqual([]);
  });

  it("returns empty for a linear DAG", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })];
    const edges = [makeEdge({ source_node_id: "a", target_node_id: "b" }), makeEdge({ source_node_id: "b", target_node_id: "c" })];
    expect(checkDAGCycles(nodes, edges)).toEqual([]);
  });

  it("detects a simple 2-node cycle", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" })];
    const edges = [
      makeEdge({ source_node_id: "a", target_node_id: "b" }),
      makeEdge({ source_node_id: "b", target_node_id: "a" }),
    ];
    const issues = checkDAGCycles(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.checkId).toBe("dag-cycle");
    expect(issues[0]!.blocking).toBe(true);
  });

  it("detects a 3-node cycle", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })];
    const edges = [
      makeEdge({ source_node_id: "a", target_node_id: "b" }),
      makeEdge({ source_node_id: "b", target_node_id: "c" }),
      makeEdge({ source_node_id: "c", target_node_id: "a" }),
    ];
    const issues = checkDAGCycles(nodes, edges);
    expect(issues).toHaveLength(1);
  });

  it("detects self-loop", () => {
    const nodes = [makeNode({ id: "a" })];
    const edges = [makeEdge({ source_node_id: "a", target_node_id: "a" })];
    const issues = checkDAGCycles(nodes, edges);
    expect(issues).toHaveLength(1);
  });

  it("handles disconnected components with a cycle in one", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" }), makeNode({ id: "d" })];
    const edges = [
      makeEdge({ source_node_id: "a", target_node_id: "b" }),
      makeEdge({ source_node_id: "b", target_node_id: "a" }),
      makeEdge({ source_node_id: "c", target_node_id: "d" }),
    ];
    const issues = checkDAGCycles(nodes, edges);
    expect(issues).toHaveLength(1);
  });
});

// ── checkOrphanNodes ──

describe("checkOrphanNodes", () => {
  it("returns empty for empty nodes", () => {
    expect(checkOrphanNodes([], [])).toEqual([]);
  });

  it("returns empty for single node (even though orphan, N<=1 is fine)", () => {
    const nodes = [makeNode({ id: "a" })];
    expect(checkOrphanNodes(nodes, [])).toEqual([]);
  });

  it("detects orphan node with no edges", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })];
    const edges = [makeEdge({ source_node_id: "a", target_node_id: "b" })];
    const issues = checkOrphanNodes(nodes, edges);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.nodeId).toBe("c");
    expect(issues[0]!.blocking).toBe(false);
  });

  it("returns empty when all nodes connected", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b" })];
    const edges = [makeEdge({ source_node_id: "a", target_node_id: "b" })];
    expect(checkOrphanNodes(nodes, edges)).toEqual([]);
  });
});

// ── checkUnreachableNodes ──

describe("checkUnreachableNodes", () => {
  it("returns empty for N<=1", () => {
    const nodes = [makeNode({ id: "a" })];
    const stages = [makeStage({ id: "stage-1", sort_order: 0 })];
    expect(checkUnreachableNodes(nodes, [], stages)).toEqual([]);
  });

  it("flags node in later stage with no indegree", () => {
    const nodes = [
      makeNode({ id: "a", stage_id: "stage-1" }),
      makeNode({ id: "b", stage_id: "stage-2" }),
    ];
    const stages = [
      makeStage({ id: "stage-1", sort_order: 0 }),
      makeStage({ id: "stage-2", sort_order: 1 }),
    ];
    // Only a → b edge (b has indegree 1, OK)
    const issues = checkUnreachableNodes(
      nodes,
      [makeEdge({ source_node_id: "a", target_node_id: "b" })],
      stages,
    );
    expect(issues).toHaveLength(0);
  });

  it("flags entry node in later stage with no incoming edges", () => {
    const nodes = [
      makeNode({ id: "a", stage_id: "stage-1", title: "Node A" }),
      makeNode({ id: "b", stage_id: "stage-2", title: "Node B" }),
    ];
    const stages = [
      makeStage({ id: "stage-1", sort_order: 0 }),
      makeStage({ id: "stage-2", sort_order: 1 }),
    ];
    const issues = checkUnreachableNodes(nodes, [], stages);
    expect(issues).toHaveLength(1);
    // "a" is in primary stage (stage-1), not flagged
    // "b" is in later stage (stage-2) with indegree 0, flagged
    expect(issues[0]!.nodeId).toBe("b");
  });

  it("only flags later-stage roots", () => {
    const nodes = [
      makeNode({ id: "a", stage_id: "stage-1", title: "A" }),
      makeNode({ id: "b", stage_id: "stage-2", title: "B" }),
      makeNode({ id: "c", stage_id: "stage-2", title: "C" }),
    ];
    const stages = [
      makeStage({ id: "stage-1", sort_order: 0 }),
      makeStage({ id: "stage-2", sort_order: 1 }),
    ];
    const edges = [
      makeEdge({ source_node_id: "a", target_node_id: "c" }),
    ];
    const issues = checkUnreachableNodes(nodes, edges, stages);
    // "a" in stage-1 indegree 0, but primary stage → not flagged
    // "b" in stage-2 indegree 0 → flagged
    // "c" in stage-2 indegree 1 → not flagged
    expect(issues).toHaveLength(1);
    expect(issues[0]!.nodeId).toBe("b");
  });
});

// ── checkWorkerMissing ──

describe("checkWorkerMissing", () => {
  it("flags node without worker_type", () => {
    const nodes = [makeNode({ id: "a", worker_type: "" as unknown as "agent", worker_id: null })];
    const issues = checkWorkerMissing(nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.blocking).toBe(true);
  });

  it("flags node without worker_id", () => {
    const nodes = [makeNode({ id: "a", worker_type: "agent", worker_id: null })];
    const issues = checkWorkerMissing(nodes);
    expect(issues).toHaveLength(1);
  });

  it("skips annotation nodes", () => {
    const nodes = [makeNode({ id: "a", worker_type: "" as unknown as "agent", worker_id: null, format_schema: { type: "annotation" } })];
    const issues = checkWorkerMissing(nodes);
    expect(issues).toHaveLength(0);
  });

  it("skips gateway nodes", () => {
    const nodes = [makeNode({ id: "fork", worker_type: "" as unknown as "agent", worker_id: null, format_schema: { type: "gateway", gateway_kind: "fork" } })];
    expect(checkWorkerMissing(nodes)).toEqual([]);
  });

  it("passes node with worker", () => {
    const nodes = [makeNode({ id: "a", worker_type: "agent", worker_id: "agent-1" })];
    expect(checkWorkerMissing(nodes)).toEqual([]);
  });
});

// ── checkInvalidCriticRef ──

describe("checkInvalidCriticRef", () => {
  const agentIds = new Set(["agent-1", "agent-2"]);

  it("passes node without critic", () => {
    const nodes = [makeNode({ id: "a", critic_id: null })];
    expect(checkInvalidCriticRef(nodes, agentIds)).toEqual([]);
  });

  it("flags node with invalid critic_id", () => {
    const nodes = [makeNode({ id: "a", critic_id: "nonexistent", critic_type: "agent" })];
    const issues = checkInvalidCriticRef(nodes, agentIds);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.blocking).toBe(true);
  });

  it("passes node with valid critic_id", () => {
    const nodes = [makeNode({ id: "a", critic_id: "agent-1", critic_type: "agent" })];
    expect(checkInvalidCriticRef(nodes, agentIds)).toEqual([]);
  });

  it("skips API critics", () => {
    const nodes = [makeNode({ id: "a", critic_type: "api", critic_id: "nonexistent", critic_api_url: "https://example.com" })];
    expect(checkInvalidCriticRef(nodes, agentIds)).toEqual([]);
  });

  it("skips gateway nodes", () => {
    const nodes = [makeNode({ id: "join", critic_id: "nonexistent", critic_type: "agent", format_schema: { type: "gateway", gateway_kind: "join" } })];
    expect(checkInvalidCriticRef(nodes, agentIds)).toEqual([]);
  });
});

// ── checkStageMissing ──

describe("checkStageMissing", () => {
  it("flags node without stage_id", () => {
    const nodes = [makeNode({ id: "a", stage_id: null })];
    const issues = checkStageMissing(nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.blocking).toBe(false);
  });

  it("skips annotation nodes", () => {
    const nodes = [makeNode({ id: "a", stage_id: null, format_schema: { type: "annotation" } })];
    expect(checkStageMissing(nodes)).toEqual([]);
  });

  it("skips gateway nodes", () => {
    const nodes = [makeNode({ id: "fork", stage_id: null, format_schema: { type: "gateway", gateway_kind: "fork" } })];
    expect(checkStageMissing(nodes)).toEqual([]);
  });

  it("passes node with stage", () => {
    const nodes = [makeNode({ id: "a", stage_id: "stage-1" })];
    expect(checkStageMissing(nodes)).toEqual([]);
  });
});

// ── runAllPreflightChecks ──

describe("runAllPreflightChecks", () => {
  it("returns passed=true for empty nodes", () => {
    const result = runAllPreflightChecks({
      nodes: [],
      edges: [],
      stages: [],
      agentIds: new Set(),
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("aggregates multiple issues", () => {
    const nodes = [
      makeNode({ id: "a", worker_type: "agent", worker_id: null, stage_id: null }),
      makeNode({ id: "b", worker_type: "agent", worker_id: "agent-1", stage_id: "stage-1" }),
    ];
    const stages = [makeStage({ id: "stage-1", sort_order: 0 })];
    const edges = [makeEdge({ source_node_id: "a", target_node_id: "b" })];
    const result = runAllPreflightChecks({
      nodes,
      edges,
      stages,
      agentIds: new Set(["agent-1"]),
    });
    expect(result.passed).toBe(false);
    // "a" has worker-missing + stage-missing = 2 issues
    expect(result.blockingCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.issues).toHaveLength(2);
  });

  it("sorts blocking issues first", () => {
    const nodes = [
      makeNode({ id: "a", worker_type: "agent", worker_id: null, stage_id: null }),
      makeNode({ id: "b", worker_type: "agent", worker_id: "agent-1", stage_id: "stage-1" }),
    ];
    const stages = [makeStage({ id: "stage-1", sort_order: 0 })];
    const result = runAllPreflightChecks({
      nodes,
      edges: [],
      stages,
      agentIds: new Set(["agent-1"]),
    });
    // worker-missing (blocking) should come before stage-missing (warning)
    expect(result.issues[0]!.blocking).toBe(true);
    expect(result.issues[1]!.blocking).toBe(false);
  });

  it("blocks a fork gateway with fewer than two outgoing edges", () => {
    const nodes = [
      makeNode({ id: "fork", title: "Fork", format_schema: { type: "gateway", gateway_kind: "fork" } }),
      makeNode({ id: "a" }),
    ];
    const result = runAllPreflightChecks({
      nodes,
      edges: [makeEdge({ source_node_id: "fork", target_node_id: "a" })],
      stages: [makeStage({ id: "stage-1", sort_order: 0 })],
      agentIds: new Set(["agent-1"]),
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      checkId: "gateway-fork-outgoing",
      nodeId: "fork",
      blocking: true,
    }));
  });

  it("blocks a join gateway with fewer than two incoming edges", () => {
    const nodes = [
      makeNode({ id: "a" }),
      makeNode({ id: "join", title: "Join", format_schema: { type: "gateway", gateway_kind: "join" } }),
    ];
    const result = runAllPreflightChecks({
      nodes,
      edges: [makeEdge({ source_node_id: "a", target_node_id: "join" })],
      stages: [makeStage({ id: "stage-1", sort_order: 0 })],
      agentIds: new Set(["agent-1"]),
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      checkId: "gateway-join-incoming",
      nodeId: "join",
      blocking: true,
    }));
  });

  it("blocks invalid gateway kinds", () => {
    const nodes = [makeNode({ id: "bad", format_schema: { type: "gateway", gateway_kind: "split" } })];
    const result = runAllPreflightChecks({
      nodes,
      edges: [],
      stages: [makeStage({ id: "stage-1", sort_order: 0 })],
      agentIds: new Set(["agent-1"]),
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      checkId: "gateway-kind-invalid",
      nodeId: "bad",
      blocking: true,
    }));
  });

  it("warns when a join gateway has multiple outgoing edges", () => {
    const nodes = [
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
      makeNode({ id: "join", format_schema: { type: "gateway", gateway_kind: "join" } }),
      makeNode({ id: "out-1" }),
      makeNode({ id: "out-2" }),
    ];
    const result = runAllPreflightChecks({
      nodes,
      edges: [
        makeEdge({ source_node_id: "a", target_node_id: "join" }),
        makeEdge({ source_node_id: "b", target_node_id: "join" }),
        makeEdge({ source_node_id: "join", target_node_id: "out-1" }),
        makeEdge({ source_node_id: "join", target_node_id: "out-2" }),
      ],
      stages: [makeStage({ id: "stage-1", sort_order: 0 })],
      agentIds: new Set(["agent-1"]),
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      checkId: "gateway-join-multiple-outgoing",
      nodeId: "join",
      blocking: false,
      severity: "warning",
    }));
  });

  it("passes valid fork and join gateway topology", () => {
    const nodes = [
      makeNode({ id: "fork", format_schema: { type: "gateway", gateway_kind: "fork" } }),
      makeNode({ id: "a" }),
      makeNode({ id: "b" }),
      makeNode({ id: "join", format_schema: { type: "gateway", gateway_kind: "join" } }),
      makeNode({ id: "out" }),
    ];
    const result = runAllPreflightChecks({
      nodes,
      edges: [
        makeEdge({ source_node_id: "fork", target_node_id: "a" }),
        makeEdge({ source_node_id: "fork", target_node_id: "b" }),
        makeEdge({ source_node_id: "a", target_node_id: "join" }),
        makeEdge({ source_node_id: "b", target_node_id: "join" }),
        makeEdge({ source_node_id: "join", target_node_id: "out" }),
      ],
      stages: [makeStage({ id: "stage-1", sort_order: 0 })],
      agentIds: new Set(["agent-1"]),
    });

    expect(result.issues.filter((issue) => issue.checkId.startsWith("gateway-"))).toEqual([]);
  });
});

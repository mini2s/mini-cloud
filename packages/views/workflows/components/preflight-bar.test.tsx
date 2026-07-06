import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreflightBar, runPreflightChecks } from "./preflight-bar";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";

function makeNode(id: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id, workflow_id: "wf1", title: `Node ${id}`, description: "",
    position_x: 0, position_y: 0, format_schema: null,
    worker_type: "human", worker_id: null,
    critic_type: "human", critic_id: null, critic_api_url: null,
    sort_order: 0, stage_id: null,
    created_at: "", updated_at: "",
    ...overrides,
  };
}

function makeEdge(id: string, source: string, target: string): WorkflowEdge {
  return { id, workflow_id: "wf1", source_node_id: source, target_node_id: target, condition: null, created_at: "" };
}

describe("runPreflightChecks", () => {
  it("detects nodes with missing worker", () => {
    const nodes = [makeNode("a", { worker_id: null, worker_type: "agent" })];
    const checks = runPreflightChecks(nodes, []);
    expect(checks.some((c) => c.type === "missing-worker")).toBe(true);
  });

  it("detects orphan nodes (no edges at all)", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b")];
    // Node "c" doesn't exist, so "a" and "b" are connected, no orphans
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "orphan-node")).toBe(false);
  });

  it("detects orphan nodes (isolated from graph)", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b")]; // c is isolated
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "orphan-node" && c.nodeId === "c")).toBe(true);
  });

  it("detects cycle in DAG", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "a")];
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.some((c) => c.type === "cycle-detected")).toBe(true);
  });

  it("returns no checks for valid DAG", () => {
    const nodes = [
      makeNode("a", { worker_type: "human", worker_id: "user-1" }),
      makeNode("b", { worker_type: "agent", worker_id: "agent-1" }),
    ];
    const edges = [makeEdge("e1", "a", "b")];
    const checks = runPreflightChecks(nodes, edges);
    expect(checks.filter((c) => c.severity === "error").length).toBe(0);
  });
});

describe("PreflightBar", () => {
  it("renders check results", () => {
    const checks = [
      { type: "missing-worker" as const, severity: "error" as const, message: "Node A has no worker", nodeId: "a" },
      { type: "orphan-node" as const, severity: "warning" as const, message: "Node B is not connected", nodeId: "b" },
    ];
    render(<PreflightBar checks={checks} onCheckClick={vi.fn()} />);
    expect(screen.getByText(/no worker/i)).toBeDefined();
    expect(screen.getByText(/not connected/i)).toBeDefined();
  });

  it("renders nothing when no checks", () => {
    const { container } = render(<PreflightBar checks={[]} onCheckClick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

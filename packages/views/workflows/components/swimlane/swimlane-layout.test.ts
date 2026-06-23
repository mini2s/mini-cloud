import { describe, it, expect } from "vitest";
import { computeSwimlaneLayout, LANE_SPACING, LANE_HEIGHT } from "./swimlane-layout";

// ── Test helpers ───────────────────────────────────────────────

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    workflow_id: "wf-1",
    title: "Test Node",
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent" as const,
    worker_id: null,
    critic_type: "human" as const,
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: null,
    created_at: "",
    updated_at: "",
    shape: "rectangle" as const,
    ...overrides,
  };
}

function makeStage(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-1",
    workflow_id: "wf-1",
    name: "Requirements",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("computeSwimlaneLayout", () => {
  it("returns empty result for empty inputs", () => {
    const result = computeSwimlaneLayout([], [], []);
    expect(result.nodePositions.size).toBe(0);
    expect(result.lanes).toHaveLength(0);
    expect(result.canvasWidth).toBe(800);
    expect(result.canvasHeight).toBe(400);
  });

  it("creates one lane per stage", () => {
    const stages = [
      makeStage({ id: "s1", name: "Phase 1", sort_order: 0 }),
      makeStage({ id: "s2", name: "Phase 2", sort_order: 1 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.lanes).toHaveLength(2);
    expect(result.lanes[0]!.stageName).toBe("Phase 1");
    expect(result.lanes[1]!.stageName).toBe("Phase 2");
  });

  it("stacks lanes vertically by sort_order", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.lanes[0]!.y).toBe(0);
    expect(result.lanes[1]!.y).toBe(LANE_SPACING);
  });

  it("places nodes within their stage lane", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const node = makeNode({ id: "n1", stage_id: "s1" });
    const result = computeSwimlaneLayout([node], [], stages);
    expect(result.nodePositions.has("n1")).toBe(true);
    const pos = result.nodePositions.get("n1")!;
    // Node should be within the first lane's vertical bounds
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeLessThan(LANE_HEIGHT);
  });

  it("places nodes from different stages in different lanes", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
    ];
    const nodes = [
      makeNode({ id: "n1", stage_id: "s1" }),
      makeNode({ id: "n2", stage_id: "s2" }),
    ];
    const result = computeSwimlaneLayout(nodes, [], stages);
    const pos1 = result.nodePositions.get("n1")!;
    const pos2 = result.nodePositions.get("n2")!;
    expect(pos2.y).toBeGreaterThan(pos1.y);
  });

  it("puts unassigned nodes in a separate lane", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const nodes = [
      makeNode({ id: "n1", stage_id: "s1" }),
      makeNode({ id: "n2", stage_id: null }),
    ];
    const result = computeSwimlaneLayout(nodes, [], stages);
    expect(result.lanes).toHaveLength(2); // stage lane + unassigned lane
    expect(result.lanes[1]!.isUnassigned).toBe(true);
    expect(result.nodePositions.has("n2")).toBe(true);
  });

  it("assigns colors cyclically from palette", () => {
    const stages = [
      makeStage({ id: "s1", sort_order: 0 }),
      makeStage({ id: "s2", sort_order: 1 }),
      makeStage({ id: "s3", sort_order: 2 }),
    ];
    const result = computeSwimlaneLayout([], [], stages);
    // First two should have different colors
    expect(result.lanes[0]!.color.border).not.toBe(result.lanes[1]!.color.border);
    // sort_order 8 wraps around to palette index 0
    const stages8 = [makeStage({ id: "s8", sort_order: 8 })];
    const result8 = computeSwimlaneLayout([], [], stages8);
    expect(result8.lanes[0]!.color.border).toBe(result.lanes[0]!.color.border);
  });

  it("produces positive canvas dimensions", () => {
    const stages = [makeStage({ id: "s1", sort_order: 0 })];
    const result = computeSwimlaneLayout([], [], stages);
    expect(result.canvasWidth).toBeGreaterThan(0);
    expect(result.canvasHeight).toBeGreaterThan(0);
  });

  it("handles nodes without stages when no stages exist", () => {
    const nodes = [makeNode({ id: "n1", stage_id: null })];
    const result = computeSwimlaneLayout(nodes, [], []);
    expect(result.lanes).toHaveLength(1);
    expect(result.nodePositions.has("n1")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StageLaneSurface } from "./stage-lane-surface";
import type { WorkflowNode, WorkflowEdge, WorkflowStage } from "@multica/core/types";

const stages: WorkflowStage[] = [
  { id: "s1", workflow_id: "wf1", name: "Plan", description: "", sort_order: 0, node_count: 1, created_at: "", updated_at: "" },
];

const nodes: WorkflowNode[] = [
  { id: "n1", workflow_id: "wf1", title: "Task 1", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent", worker_id: "ag1", critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 0, stage_id: "s1", created_at: "", updated_at: "" },
];

const edges: WorkflowEdge[] = [];

describe("StageLaneSurface", () => {
  it("renders stage lanes with node cards", () => {
    render(
      <StageLaneSurface nodes={nodes} edges={edges} stages={stages} density="compact" />
    );
    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Task 1")).toBeDefined();
  });

  it("renders empty state when no stages", () => {
    render(
      <StageLaneSurface nodes={[]} edges={[]} stages={[]} density="compact" />
    );
    expect(screen.getByText(/no stages/i)).toBeDefined();
  });

  it("renders unassigned nodes section", () => {
    const unassigned: WorkflowNode[] = [
      { ...nodes[0]!, id: "n2", stage_id: null, title: "Unassigned Task" },
    ];
    render(
      <StageLaneSurface nodes={unassigned} edges={[]} stages={stages} density="compact" />
    );
    expect(screen.getByText("Unassigned Task")).toBeDefined();
  });
});

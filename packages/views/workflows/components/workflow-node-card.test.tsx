import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { WorkflowNode } from "@multica/core/types";

const baseNode: WorkflowNode = {
  id: "n1", workflow_id: "wf1", title: "Test Node",
  description: "A test node", position_x: 0, position_y: 0,
  format_schema: null, worker_type: "agent", worker_id: "agent-1",
  critic_type: "human", critic_id: null, critic_api_url: null,
  sort_order: 0, stage_id: null, created_at: "", updated_at: "",
};

describe("WorkflowNodeCard — definition variant", () => {
  it("renders node title", () => {
    render(<WorkflowNodeCard node={baseNode} variant="definition" />);
    expect(screen.getByText("Test Node")).toBeDefined();
  });

  it("applies selected styles", () => {
    const { container } = render(<WorkflowNodeCard node={baseNode} variant="definition" selected />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("ring-2");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<WorkflowNodeCard node={baseNode} variant="definition" onClick={onClick} />);
    screen.getByText("Test Node").click();
    expect(onClick).toHaveBeenCalledWith("n1");
  });
});

describe("WorkflowNodeCard — runtime variant", () => {
  it("shows pending state", () => {
    const { container } = render(
      <WorkflowNodeCard
        node={baseNode}
        variant="runtime"
        nodeRun={{ id: "r1", workflow_run_id: "wr1", workflow_node_id: "n1", node_title: "Test Node", status: "pending", retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null, worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null, critic_comment: "", critic_agent_task_id: null, agent_task_id: null, session_id: null, runtime_id: null, device_id: null, started_at: null, completed_at: null, created_at: "", updated_at: "" }}
      />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-dashed");
  });

  it("shows completed state with green border", () => {
    const { container } = render(
      <WorkflowNodeCard
        node={baseNode}
        variant="runtime"
        nodeRun={{ id: "r1", workflow_run_id: "wr1", workflow_node_id: "n1", node_title: "Test Node", status: "completed", retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null, worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null, critic_comment: "", critic_agent_task_id: null, agent_task_id: null, session_id: null, runtime_id: null, device_id: null, started_at: null, completed_at: null, created_at: "", updated_at: "" }}
      />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-workflow-success");
  });

  it("renders in compact density", () => {
    const { container } = render(
      <WorkflowNodeCard node={baseNode} variant="runtime" density="compact" />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("w-40");
  });
});

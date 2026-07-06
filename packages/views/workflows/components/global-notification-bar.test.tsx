import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalNotificationBar, aggregateNotifications } from "./global-notification-bar";
import type { WorkflowNodeRun } from "@multica/core/types";

function makeNodeRun(id: string, status: WorkflowNodeRun["status"]): WorkflowNodeRun {
  return {
    id, workflow_run_id: "wr1", workflow_node_id: id, node_title: `Node ${id}`,
    status, retry_count: 0, worker_type: "agent", worker_id: null, worker_output: null,
    worker_agent_task_id: null, critic_type: "human", critic_id: null, critic_output: null,
    critic_comment: "", critic_agent_task_id: null, agent_task_id: null,
    session_id: null, runtime_id: null, device_id: null,
    started_at: null, completed_at: null, created_at: "", updated_at: "",
  };
}

describe("aggregateNotifications", () => {
  it("prioritizes awaiting_critic highest", () => {
    const runs = new Map([
      ["a", makeNodeRun("a", "awaiting_critic")],
      ["b", makeNodeRun("b", "blocked")],
      ["c", makeNodeRun("c", "awaiting_input")],
    ]);
    const notifs = aggregateNotifications(runs);
    expect(notifs[0]!.priority).toBe("high");
    expect(notifs[0]!.type).toBe("awaiting_critic");
  });

  it("returns empty for completed runs", () => {
    const runs = new Map([
      ["a", makeNodeRun("a", "completed")],
      ["b", makeNodeRun("b", "completed")],
    ]);
    expect(aggregateNotifications(runs).length).toBe(0);
  });
});

describe("GlobalNotificationBar", () => {
  it("renders notifications", () => {
    const runs = new Map([["a", makeNodeRun("a", "failed")]]);
    render(<GlobalNotificationBar nodeRuns={runs} onNotificationClick={vi.fn()} />);
    expect(screen.getByText(/needs attention/i)).toBeDefined();
  });

  it("renders nothing when no notifications", () => {
    const runs = new Map([["a", makeNodeRun("a", "completed")]]);
    const { container } = render(<GlobalNotificationBar nodeRuns={runs} onNotificationClick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

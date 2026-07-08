// @vitest-environment jsdom

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GlobalNotificationBar } from "./global-notification-bar";
import type { WorkflowNodeRun } from "@multica/core/types";

// ---------------------------------------------------------------------------
// i18n mock
// ---------------------------------------------------------------------------
vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (accessor: any, params?: Record<string, unknown>) => {
      const translations = {
        execution: {
          notification: {
            summary_title: "Action needed:",
            awaiting_critic: "Awaiting review:",
            blocked_failed: "Needs attention:",
            awaiting_input: "Awaiting input:",
            summary_label: `This run has ${params?.count ?? ""} signal types`,
          },
        },
      };
      if (typeof accessor === "function") {
        const result = accessor(translations);
        if (typeof result === "string") return result;
      }
      return String(typeof accessor === "function" ? accessor(translations) : accessor);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNodeRun(overrides: Partial<WorkflowNodeRun> = {}): WorkflowNodeRun {
  return {
    id: "nr-1",
    workflow_run_id: "wr-1",
    workflow_node_id: "n-1",
    node_title: "Test Node",
    status: "pending",
    retry_count: 0,
    worker_type: "agent",
    worker_id: "w-1",
    worker_output: null,
    worker_agent_task_id: null,
    critic_type: "human",
    critic_id: "c-1",
    critic_output: null,
    critic_comment: null,
    critic_agent_task_id: null,
    agent_task_id: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    started_at: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as WorkflowNodeRun;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GlobalNotificationBar", () => {
  it("renders nothing when no actionable runs exist", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "completed" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "working" }));

    const { container } = render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for empty map", () => {
    const { container } = render(
      <GlobalNotificationBar
        nodeRunMap={new Map()}
        onScrollToNode={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders awaiting_critic notification chip", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "n-1" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "awaiting_critic", workflow_node_id: "n-2" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("global-notification-bar")).toBeInTheDocument();
    expect(screen.getByTestId("notification-item-awaiting_critic")).toBeInTheDocument();
  });

  it("renders as a compact canvas status bar", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "n-1" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "blocked", workflow_node_id: "n-2" }));
    map.set("n-3", makeNodeRun({ id: "nr-3", status: "awaiting_input", workflow_node_id: "n-3" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("global-notification-bar")).toHaveClass(
      "border-border",
      "bg-background/95",
    );
    expect(screen.getByTestId("notification-summary")).toBeInTheDocument();
    expect(screen.getByTestId("notification-rail")).toBeInTheDocument();
  });

  it("renders blocked_failed notification chip", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "blocked", workflow_node_id: "n-1" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "failed", workflow_node_id: "n-2" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("notification-item-blocked_failed")).toBeInTheDocument();
  });

  it("renders awaiting_input notification chip", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "awaiting_input", workflow_node_id: "n-1" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("notification-item-awaiting_input")).toBeInTheDocument();
  });

  it("renders multiple notification chips in priority order", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "awaiting_input", workflow_node_id: "n-1" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "blocked", workflow_node_id: "n-2" }));
    map.set("n-3", makeNodeRun({ id: "nr-3", status: "awaiting_critic", workflow_node_id: "n-3" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    const bar = screen.getByTestId("global-notification-bar");
    // Find the chips container (second child, after status indicator)
    const chipsContainer = bar.querySelector(".flex-1");
    const children = [...(chipsContainer?.children ?? [])];
    expect(children[0]).toHaveAttribute("data-testid", "notification-item-blocked_failed");
    expect(children[1]).toHaveAttribute("data-testid", "notification-item-awaiting_critic");
    expect(children[2]).toHaveAttribute("data-testid", "notification-item-awaiting_input");
  });

  it("shows the total notification count with a generic summary label", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("review", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "review" }));
    map.set("blocked", makeNodeRun({ id: "nr-2", status: "blocked", workflow_node_id: "blocked" }));
    map.set("failed", makeNodeRun({ id: "nr-3", status: "failed", workflow_node_id: "failed" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Action needed:3");
    expect(screen.getByTestId("notification-item-awaiting_critic")).toHaveTextContent("Awaiting review:1");
  });

  it("calls onScrollToNode with firstNodeId on chip click", () => {
    const onScrollToNode = vi.fn();
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-abc", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "n-abc" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={onScrollToNode} />,
    );

    fireEvent.click(screen.getByTestId("notification-item-awaiting_critic"));
    expect(onScrollToNode).toHaveBeenCalledWith("n-abc");
  });

  it("uses first blocked node for blocked_failed chip scroll target", () => {
    const onScrollToNode = vi.fn();
    const map = new Map<string, WorkflowNodeRun>();
    map.set("first-blocked", makeNodeRun({ id: "nr-1", status: "blocked", workflow_node_id: "first-blocked" }));
    map.set("second-failed", makeNodeRun({ id: "nr-2", status: "failed", workflow_node_id: "second-failed" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={onScrollToNode} />,
    );

    fireEvent.click(screen.getByTestId("notification-item-blocked_failed"));
    expect(onScrollToNode).toHaveBeenCalledWith("first-blocked");
  });
});

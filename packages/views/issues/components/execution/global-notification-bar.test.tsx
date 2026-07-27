// @vitest-environment jsdom

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GlobalNotificationBar } from "./global-notification-bar";
import type { WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

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
            progress_title: "Run progress:",
            progress_done: `${params?.done ?? ""}/${params?.total ?? ""} done`,
            current_node: `Current: ${params?.title ?? ""}`,
            no_current_node: "No active node",
            running_count: `${params?.count ?? ""} running`,
            reviewing_count: `${params?.count ?? ""} reviewing`,
            blocked_count: `${params?.count ?? ""} blocked`,
            waiting_count: `${params?.count ?? ""} waiting`,
            elapsed: `Elapsed ${params?.elapsed ?? ""}`,
            no_action_needed: "No action needed",
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
  it("renders progress and prioritized chips when a run is active", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "completed" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "working", node_title: "Build API" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );
    expect(screen.getByTestId("global-notification-bar")).toBeInTheDocument();
    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Run progress:1/2 done");
    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Current: Build API");
    expect(screen.getByTestId("progress-chip-running")).toBeInTheDocument();
    expect(screen.queryByText("No action needed")).not.toBeInTheDocument();
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

  it("uses progress chips as the only node navigation controls", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("n-1", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "n-1" }));
    map.set("n-2", makeNodeRun({ id: "nr-2", status: "blocked", workflow_node_id: "n-2" }));
    map.set("n-3", makeNodeRun({ id: "nr-3", status: "pending", workflow_node_id: "n-3" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("global-notification-bar")).toBeInTheDocument();
    expect(screen.getByTestId("progress-chip-running")).toBeInTheDocument();
    expect(screen.getByTestId("progress-chip-reviewing")).toBeInTheDocument();
    expect(screen.getByTestId("progress-chip-blocked")).toBeInTheDocument();
    expect(screen.getByTestId("progress-chip-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-item-awaiting_critic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-item-blocked_failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notification-item-awaiting_input")).not.toBeInTheDocument();
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

  it("shows the total notification count with a generic summary label", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("review", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "review" }));
    map.set("blocked", makeNodeRun({ id: "nr-2", status: "blocked", workflow_node_id: "blocked" }));
    map.set("failed", makeNodeRun({ id: "nr-3", status: "failed", workflow_node_id: "failed" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Run progress:0/3 done");
    expect(screen.getByTestId("progress-chip-blocked")).toHaveTextContent("2 blocked");
    expect(screen.getByTestId("progress-chip-reviewing")).toHaveTextContent("1 reviewing");
  });

  it("keeps a failed node in the attention count when its compatibility summary says blocked", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("failed", makeNodeRun({
      id: "nr-1",
      status: "failed",
      workflow_node_id: "failed",
      node_title: "Run CSC",
    }));
    const summaries = new Map<string, WorkflowNodeRuntimeSummary>();
    summaries.set("failed", {
      workflow_node_id: "failed",
      node_run_id: "nr-1",
      display_status: "blocked",
      active_actor_type: "agent",
      active_actor_id: "a1",
      duration_seconds: 10,
      session_id: null,
      runtime_id: null,
      device_id: null,
      has_error: true,
      error_message: "Max turns reached",
      split_progress: null,
    });

    render(
      <GlobalNotificationBar
        nodeRunMap={map}
        runtimeSummaryMap={summaries}
        onScrollToNode={vi.fn()}
      />,
    );

    expect(screen.getByTestId("progress-chip-blocked")).toHaveTextContent("1 blocked");
    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Current: Run CSC");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("0 waiting");
  });

  it("shows counts, current node, and elapsed fallback in the progress summary", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("done", makeNodeRun({ id: "nr-1", status: "completed", workflow_node_id: "done" }));
    map.set("running", makeNodeRun({ id: "nr-2", status: "working", workflow_node_id: "running", node_title: "Implement worker", started_at: null }));
    map.set("blocked", makeNodeRun({ id: "nr-3", status: "blocked", workflow_node_id: "blocked", node_title: "Investigate blocker" }));
    map.set("pending", makeNodeRun({ id: "nr-4", status: "pending", workflow_node_id: "pending" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Run progress:1/4 done");
    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Current: Investigate blocker");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("1 running");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("1 blocked");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("1 waiting");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("Elapsed --");
  });

  it("counts node runs by the same display status shown on runtime cards", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("review", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "review", node_title: "Review split" }));
    map.set("todo", makeNodeRun({ id: "nr-2", status: "worker_assigned", workflow_node_id: "todo", node_title: "Plan tests" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("1 reviewing");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("1 waiting");
    expect(screen.getByTestId("run-progress-counts")).toHaveTextContent("0 running");
    expect(screen.getByTestId("notification-summary")).toHaveTextContent("Current: Review split");
  });

  it("treats reviewing display status as actionable", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("review", makeNodeRun({ id: "nr-1", status: "awaiting_critic", workflow_node_id: "review" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    expect(screen.getByTestId("progress-chip-reviewing")).toHaveTextContent("1 reviewing");
    expect(screen.queryByText("No action needed")).not.toBeInTheDocument();
  });

  it("lets progress count chips focus their first matching node", () => {
    const onScrollToNode = vi.fn();
    const map = new Map<string, WorkflowNodeRun>();
    map.set("done", makeNodeRun({ id: "nr-1", status: "completed", workflow_node_id: "done" }));
    map.set("running", makeNodeRun({ id: "nr-2", status: "working", workflow_node_id: "running" }));
    map.set("blocked", makeNodeRun({ id: "nr-3", status: "blocked", workflow_node_id: "blocked" }));
    map.set("pending", makeNodeRun({ id: "nr-4", status: "pending", workflow_node_id: "pending" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={onScrollToNode} />,
    );

    fireEvent.click(screen.getByTestId("progress-chip-blocked"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("blocked");

    fireEvent.click(screen.getByTestId("progress-chip-running"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("running");

    fireEvent.click(screen.getByTestId("progress-chip-waiting"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("pending");
  });

  it("orders progress chips by action priority", () => {
    const map = new Map<string, WorkflowNodeRun>();
    map.set("pending", makeNodeRun({ id: "nr-1", status: "pending", workflow_node_id: "pending" }));
    map.set("running", makeNodeRun({ id: "nr-2", status: "working", workflow_node_id: "running" }));
    map.set("blocked", makeNodeRun({ id: "nr-3", status: "blocked", workflow_node_id: "blocked" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={vi.fn()} />,
    );

    const chips = [...screen.getByTestId("run-progress-counts").querySelectorAll("button")];
    expect(chips.map((chip) => chip.getAttribute("data-testid"))).toEqual([
      "progress-chip-blocked",
      "progress-chip-running",
      "progress-chip-waiting",
      "progress-chip-reviewing",
    ]);
  });

  it("targets the highest-priority node and preserves order for ties", () => {
    const onScrollToNode = vi.fn();
    const map = new Map<string, WorkflowNodeRun>();
    map.set("running-low", makeNodeRun({ id: "nr-1", status: "working", workflow_node_id: "running-low" }));
    map.set("running-high", makeNodeRun({ id: "nr-2", status: "awaiting_critic", workflow_node_id: "running-high" }));
    map.set("blocked-low", makeNodeRun({ id: "nr-3", status: "failed", workflow_node_id: "blocked-low" }));
    map.set("blocked-high", makeNodeRun({ id: "nr-4", status: "critic_rework", workflow_node_id: "blocked-high" }));

    render(
      <GlobalNotificationBar nodeRunMap={map} onScrollToNode={onScrollToNode} />,
    );

    fireEvent.click(screen.getByTestId("progress-chip-reviewing"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("running-high");

    fireEvent.click(screen.getByTestId("progress-chip-running"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("running-low");

    fireEvent.click(screen.getByTestId("progress-chip-blocked"));
    expect(onScrollToNode).toHaveBeenLastCalledWith("blocked-low");
  });

});

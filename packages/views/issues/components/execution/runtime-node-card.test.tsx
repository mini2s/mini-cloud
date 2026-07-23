import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { RuntimeNodeCard, RUNTIME_NODE_HEIGHT } from "./runtime-node-card";
import type { NodeRunActionType } from "./runtime-node-card";
import type { WorkflowNode, WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

// Mock @multica/views/i18n for useT hook — handles function selector form
vi.mock("@multica/views/i18n", () => {
  const issues = {
    execution: {
      panorama: {
        not_started: "Not started",
      },
      display_status: {
        pending: "Pending",
        todo: "Todo",
        in_progress: "In progress",
        reviewing: "Reviewing",
        completed: "Completed",
        blocked: "Blocked",
        cancelled: "Cancelled",
        dispatched: "Dispatched",
        joined: "Joined",
        waiting_upstream: "Waiting for upstream",
      },
      card: {
        worker_label: "Executor",
        critic_label: "Reviewer",
        artifacts_label: "Artifacts",
        gateway_label_fork: "Branch start",
        gateway_label_join: "Join point",
        gateway_label: "Branch node",
        split_badge: "Split",
        split_child_count: "{{count}} child issues",
        split_child_count_one: "{{count}} child issue",
        split_child_count_other: "{{count}} child issues",
        split_child_done: "{{count}} done",
        split_child_failed: "{{count}} failed",
        split_child_running: "{{count}} running",
        split_child_ready: "{{count}} ready",
        split_child_skipped: "{{count}} skipped",
        split_child_cancelled: "{{count}} cancelled",
        split_child_expand: "Expand child issues",
        split_child_collapse: "Collapse child issues",
        split_mode_barrier: "Wait for child issues",
        split_mode_pipeline: "Continue after creation",
        actions: {
          approve: "Approve",
          reject: "Reject",
          submit_input: "Submit",
          handback: "Return",
          retry: "Retry",
          skip: "Skip",
          complete: "Complete",
        },
      },
      detail_panel: {
        worker_output: "Worker Output",
        critic_output: "Critic Output",
        open_session: "Open session",
      },
    },
  };

  const workflows = {
    detail_panel: {
      split_node_generating_draft_tasks: "Generating draft tasks",
      split_node_review_tasks_one: "Review {{count}} task",
      split_node_review_tasks_other: "Review {{count}} tasks",
      split_node_review_tasks: "Review {{count}} tasks",
      split_node_mode_concurrency: "{{mode}} · concurrency {{concurrency}}",
      split_status_fallback: "pending",
    },
  };

  const localeMaps = { issues, workflows } as Record<string, Record<string, unknown>>;

  return {
    useT: (namespace: string) => ({
      t: (selector: unknown, options?: Record<string, unknown>) => {
        if (typeof selector === "function") {
          const value = selector(localeMaps[namespace] ?? {});
          if (typeof value === "string" && options) {
            return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(options[key] ?? ""));
          }
          return value;
        }
        return String(selector);
      },
    }),
  };
});

const baseNode: WorkflowNode = {
  id: "node-1",
  workflow_id: "wf-1",
  title: "需求收集",
  description: "",
  position_x: 0,
  position_y: 0,
  format_schema: null,
  worker_type: "agent",
  worker_id: "agent-1",
  critic_type: "agent",
  critic_id: "agent-2",
  critic_api_url: null,
  sort_order: 0,
  stage_id: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const completedRun: WorkflowNodeRun = {
  id: "run-1",
  workflow_run_id: "wr-1",
  workflow_node_id: "node-1",
  node_title: "需求收集",
  status: "completed",
  retry_count: 0,
  worker_type: "agent",
  worker_id: "agent-1",
  worker_output: null,
  worker_agent_task_id: null,
  critic_type: "agent",
  critic_id: "agent-2",
  critic_output: null,
  critic_comment: "",
  critic_agent_task_id: null,
  agent_task_id: null,
  session_id: null,
  runtime_id: null,
  runtime_selection_reason: null,
  failure_reason: null,
  device_id: null,
  split_review_chat_session_id: null,
  split_config_version: 1,
  started_at: null,
  completed_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const runtimeSummary: WorkflowNodeRuntimeSummary = {
  workflow_node_id: "node-1",
  node_run_id: "run-1",
  display_status: "reviewing",
  active_actor_type: "agent",
  active_actor_id: "agent-2",
  duration_seconds: 90,
  session_id: null,
  runtime_id: null,
  device_id: null,
  has_error: false,
  error_message: "",
  split_progress: null,
};

describe("RuntimeNodeCard", () => {
  it("renders with completed status", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );
    const card = screen.getByTestId("runtime-node-card-node-1");
    expect(card).toBeInTheDocument();
  });

  it("renders pending status when nodeRun is null (not started)", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={null}
        workerName={null}
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    const card = screen.getByTestId("runtime-node-card-node-1");
    expect(card).toBeInTheDocument();
  });

  it("does not render critic row when critic_type is empty and critic_id is null", () => {
    const noCriticNode: WorkflowNode = {
      ...baseNode,
      critic_type: "" as any,
      critic_id: null,
    };
    render(
      <RuntimeNodeCard
        node={noCriticNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    // Critic row not rendered at all
    expect(screen.queryByText("Critic:")).not.toBeInTheDocument();
  });

  it("calls onClick with node id on click", async () => {
    const onClick = vi.fn();
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={onClick}
      />,
    );
    await userEvent.click(screen.getByTestId("runtime-node-card-node-1"));
    expect(onClick).toHaveBeenCalledWith("node-1");
  });

  it("opens the node session without opening the detail panel", async () => {
    const onClick = vi.fn();
    const onOpenSession = vi.fn();
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={{ ...completedRun, session_id: "session-1" }}
        workerName="小助手"
        criticName="审核员"
        onClick={onClick}
        onOpenSession={onOpenSession}
      />,
    );

    const sessionButton = screen.getByRole("button", { name: "Open session" });
    expect(sessionButton.querySelector("svg")).toBeNull();
    expect(sessionButton).toHaveClass("cursor-pointer", "hover:-translate-y-px", "hover:bg-primary/10");
    await userEvent.click(sessionButton);

    expect(onOpenSession).toHaveBeenCalledWith("node-1");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides the session action when the node has no session", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open session" })).not.toBeInTheDocument();
  });

  it("does not expose raw output names as panorama-card artifacts", () => {
    const runWithOutputs: WorkflowNodeRun = {
      ...completedRun,
      worker_output: { summary: "已完成需求文档" },
      critic_output: { comment: "审核通过" },
    };
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={runWithOutputs}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Artifacts:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Worker Output/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Critic Output/)).not.toBeInTheDocument();
  });

  it.each([
    ["agent", ".lucide-bot"],
    ["squad", ".lucide-building-2"],
    ["human", ".lucide-user"],
  ] as const)("does not render actor type icon for %s worker slots", (workerType, iconSelector) => {
    const { container } = render(
      <RuntimeNodeCard
        node={{ ...baseNode, worker_type: workerType }}
        nodeRun={completedRun}
        workerName="小助手"
        criticName={null}
        onClick={vi.fn()}
      />,
    );

    expect(container.querySelector(iconSelector)).not.toBeInTheDocument();
  });

  it("renders status icon in title row when nodeRun exists", () => {
    const { container } = render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );
    const statusIcons = container.querySelectorAll('[data-testid="runtime-display-status-icon"]');
    expect(statusIcons.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("uses the shared workflow canvas node shell with the editor-card surface", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        runtimeSummary={runtimeSummary}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-node-1");
    expect(card).toHaveAttribute("data-workflow-canvas-node-shell", "true");
    expect(card.className).not.toContain("min-w-[240px]");
    expect(card).toHaveStyle({ width: "296px", height: "156px" });
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("bg-gradient-to-br");
    expect(surface?.className).toContain("border-white/80");
    expect(surface?.className).toContain("from-white");
    expect(surface?.className).toContain("to-slate-100/85");
    expect(surface?.className).toContain("ring-slate-200/70");
    expect(surface?.className).toContain("shadow-[0_14px_32px_rgba(15,23,42,0.12)]");
    expect(surface?.className).not.toContain("border-border/70");
    expect(surface?.className).not.toContain("bg-background");
    expect(surface?.className).not.toContain("shadow-[0_1px_2px_rgba(15,23,42,0.06)]");
    expect(screen.getByTestId("runtime-node-content")).toHaveClass("border-t", "border-border/45");
    expect(screen.getByTestId("runtime-node-content").className).not.toContain("border-y");
    expect(screen.getByLabelText("Reviewing")).toBeInTheDocument();
  });

  it("does not emphasize blocked runtime nodes unless they are selected as the runtime focus", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={{ ...completedRun, status: "blocked" }}
        runtimeSummary={{ ...runtimeSummary, display_status: "blocked" }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-node-1");
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(card).toHaveAttribute("data-runtime-display-status", "blocked");
    expect(card).not.toHaveAttribute("data-runtime-focus");
    expect(surface?.className).toContain("ring-slate-200/70");
    expect(surface?.className).not.toContain("ring-red");
    expect(surface?.className).not.toContain("from-red");
  });

  it("emphasizes only the selected runtime focus node with its status color", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={{ ...completedRun, status: "blocked" }}
        runtimeSummary={{ ...runtimeSummary, display_status: "blocked" }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
        isRuntimeFocus
      />,
    );

    const card = screen.getByTestId("runtime-node-card-node-1");
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(card).toHaveAttribute("data-runtime-display-status", "blocked");
    expect(card).toHaveAttribute("data-runtime-focus", "true");
    expect(surface?.className).toContain("ring-red-300/80");
    expect(surface?.className).toContain("ring-2");
    expect(surface?.className).toContain("from-red-50/90");
    expect(surface?.className).not.toContain("ring-blue");
  });

  it("lays out worker and critic as paired actor slots", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Executor").parentElement).toHaveClass("row-span-2", "grid-rows-subgrid");
    expect(screen.getByText("小助手")).toBeInTheDocument();
    expect(screen.getByText("Reviewer").parentElement).toHaveClass("row-span-2", "grid-rows-subgrid");
    expect(screen.getByText("审核员")).toBeInTheDocument();
    expect(screen.getByText("Executor").closest("[data-workflow-actor-slot]")).toHaveAttribute("data-workflow-actor-slot", "worker");
    expect(screen.getByText("Reviewer").closest("[data-workflow-actor-slot]")).toHaveAttribute("data-workflow-actor-slot", "critic");
  });

  it("renders fixed lane-anchored handles when used inside the canvas", () => {
    render(
      <ReactFlowProvider>
        <RuntimeNodeCard
          node={baseNode}
          nodeRun={completedRun}
          runtimeSummary={runtimeSummary}
          workerName="Tester"
          criticName="Reviewer"
          onClick={vi.fn()}
          handles={["left-target", "right-source", "bottom-source"]}
          lateralHandleTop={RUNTIME_NODE_HEIGHT / 2}
        />
      </ReactFlowProvider>,
    );

    const handles = [...document.querySelectorAll(".react-flow__handle")];
    expect(handles.map((handle) => handle.getAttribute("data-handleid")).sort()).toEqual(["bottom", "left", "right"]);
    expect(document.querySelector('[data-handleid="left"]')).toHaveStyle({ top: `${RUNTIME_NODE_HEIGHT / 2}px` });
    expect(document.querySelector('[data-handleid="right"]')).toHaveStyle({ top: `${RUNTIME_NODE_HEIGHT / 2}px` });
  });

  it("renders gateway nodes without actor artifact or action rows", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          format_schema: { type: "gateway", gateway_kind: "fork", shape: "diamond" },
        }}
        nodeRun={{ ...completedRun, status: "awaiting_critic", worker_output: { summary: "done" } }}
        runtimeSummary={{ ...runtimeSummary, display_status: "completed" }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Branch start")).toBeInTheDocument();
    expect(screen.getByLabelText("Dispatched")).toBeInTheDocument();
    expect(screen.queryByText("Worker:")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic:")).not.toBeInTheDocument();
    expect(screen.queryByText(/Artifacts:/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-node-action-approve")).not.toBeInTheDocument();
  });

  it("renders split nodes with aggregated child issue status inside the runtime card structure", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-1",
          title: "Task split",
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-1", status: "awaiting_split_review" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-1",
          node_run_id: "run-1",
          display_status: "reviewing",
          split_progress: {
            total: 5,
            created: 0,
            running: 0,
            done: 0,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Task split")).toBeInTheDocument();
    expect(screen.getByText("Reviewing")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-card-split-1")).toHaveTextContent("Reviewing");
    expect(screen.getByTestId("runtime-node-type-badge-split-1")).toHaveTextContent("Split");
    expect(screen.getByTestId("runtime-node-split-header")).toHaveClass("justify-between");
    expect(screen.getByTestId("runtime-node-split-header")).toHaveTextContent("Task splitReviewing");
    expect(screen.getByTestId("runtime-node-split-context")).toHaveClass("border-t", "border-border/45");
    expect(screen.getByTestId("runtime-node-split-mode")).toHaveClass("text-muted-foreground");
    expect(screen.getByTestId("runtime-node-split-layout")).toHaveClass(
      "grid",
      "grid-rows-[32px_20px_minmax(0,1fr)]",
    );
    expect(screen.getByLabelText("Reviewing")).toBeInTheDocument();
    expect(screen.getByText("5 child issues")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText("Review 5 tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Executor")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-split-progress")).toHaveClass("border-t", "border-border/45");
    expect(screen.getByTestId("runtime-node-card-split-1").querySelector(".lucide-git-branch")).not.toBeInTheDocument();
  });

  it("shows split planner roles while the split planner is running", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-generating",
          title: "Task split",
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-generating", status: "splitting" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-generating",
          display_status: "in_progress",
          split_progress: null,
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-split-generating");
    expect(card).toHaveTextContent("In progress");
    expect(screen.queryByText("Generating draft tasks")).not.toBeInTheDocument();
    expect(screen.getByText("Wait for child issues")).toBeInTheDocument();
    expect(screen.getByText("Executor")).toBeInTheDocument();
    expect(screen.getByText("Tester")).toBeInTheDocument();
    expect(screen.getAllByText("Reviewer")).toHaveLength(2);
    expect(card.innerHTML).not.toContain("text-amber");
  });

  it.each([
    ["barrier", "Wait for child issues"],
    ["pipeline", "Continue after creation"],
  ] as const)("shows %s mode as user-facing copy", (mode, label) => {
		render(
			<RuntimeNodeCard
				node={{
					...baseNode,
					id: `split-${mode}`,
					format_schema: {
						type: "split",
						split_config: { default_issue_workflow_id: "child-wf-1", mode, max_concurrency: 5, max_failures: 0 },
					},
				}}
				nodeRun={{ ...completedRun, workflow_node_id: `split-${mode}` }}
				workerName="Tester"
				criticName="Reviewer"
				onClick={vi.fn()}
			/>,
		);
		expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("keeps long runtime actor names readable", () => {
    render(
      <RuntimeNodeCard
        node={{ ...baseNode, title: "Long runtime node title that should wrap on the card" }}
        nodeRun={completedRun}
        workerName="Extremely Long Runtime Worker Name For Verification"
        criticName="Extremely Long Runtime Reviewer Name"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText(/Long runtime node title/).className).toContain("line-clamp-2");
    expect(screen.getByText(/Extremely Long Runtime Worker/).className).toContain("line-clamp-2");
  });

  it("renders split child progress as the expansion control without opening the split panel", async () => {
    const onClick = vi.fn();
    const onSplitNodeToggle = vi.fn();

    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-expand",
          title: "Task split",
          format_schema: {
            type: "split",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-expand", status: "split_active" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-expand",
          split_progress: {
            total: 3,
            created: 1,
            running: 1,
            done: 1,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={onClick}
        splitChildCount={3}
        isSplitExpanded={false}
        onSplitNodeToggle={onSplitNodeToggle}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: "Expand child issues" });
    expect(screen.getByTestId("runtime-node-split-layout")).toHaveClass(
      "grid",
      "grid-rows-[32px_20px_minmax(0,1fr)]",
    );
    expect(toggleButton).toHaveAttribute("data-testid", "runtime-node-split-child-toggle");
    expect(toggleButton).toHaveTextContent("3 child issues");
    expect(toggleButton).toHaveTextContent("1 done · 1 running · 1 ready");

    await userEvent.click(toggleButton);

    expect(onSplitNodeToggle).toHaveBeenCalledWith("split-expand");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps split nodes with child expansion keyboard focusable", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-keyboard",
          title: "Task split",
          format_schema: {
            type: "split",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-keyboard", status: "split_active" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-keyboard",
          split_progress: {
            total: 2,
            created: 1,
            running: 1,
            done: 0,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
        splitChildCount={2}
        onSplitNodeToggle={vi.fn()}
      />,
    );

    expect(screen.getByTestId("runtime-node-card-split-keyboard")).toHaveAttribute("tabindex", "0");
  });

  it("marks the split child tray as open when child nodes are expanded", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-open",
          title: "Task split",
          format_schema: {
            type: "split",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-open", status: "split_active" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-open",
          split_progress: {
            total: 2,
            created: 0,
            running: 0,
            done: 2,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
        splitChildCount={2}
        isSplitExpanded
        onSplitNodeToggle={vi.fn()}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: "Collapse child issues" });
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(toggleButton.className).toContain("border-primary/45");
    expect(toggleButton.className).toContain("bg-background");
    expect(toggleButton.className).not.toContain("bg-primary/10");
  });

  it("keeps the visible canvas surface without nesting editor split card chrome", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-chrome",
          title: "Task split",
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-chrome", status: "split_active" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-chrome",
          node_run_id: "run-chrome",
          display_status: "in_progress",
          split_progress: {
            total: 2,
            created: 1,
            running: 1,
            done: 0,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-split-chrome");
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("bg-gradient-to-br");
    expect(surface?.className).toContain("border-white/80");
    expect(surface?.className).not.toContain("bg-transparent");
    expect(surface?.className).not.toContain("border-transparent");
    expect(surface?.className).not.toContain("shadow-none");

    expect(card.querySelector('[data-testid="runtime-node-split-progress"]')).toBeInTheDocument();
    expect(card.innerHTML).not.toContain("bg-card");
    expect(card.innerHTML).not.toContain("shadow-sm");
    expect(card.innerHTML).not.toContain("text-amber");
  });

  it("renders split progress badge when runtime summary includes aggregated progress", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-2",
          title: "Split progress",
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-2", status: "split_active" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-2",
          node_run_id: "run-2",
          display_status: "in_progress",
          split_progress: {
            total: 4,
            created: 1,
            running: 1,
            done: 1,
            failed: 1,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-type-badge-split-2")).toHaveTextContent("Split");
    expect(screen.getByTestId("runtime-node-split-header")).toHaveTextContent("Split progressIn progress");
    expect(screen.getByText("1 done · 1 failed · 1 running · 1 ready")).toBeInTheDocument();
  });

  it("keeps split progress visible after the parent split node completes", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "split-completed",
          title: "Split completed",
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        nodeRun={{ ...completedRun, workflow_node_id: "split-completed", status: "completed" }}
        runtimeSummary={{
          ...runtimeSummary,
          workflow_node_id: "split-completed",
          node_run_id: "run-completed",
          display_status: "completed",
          split_progress: {
            total: 4,
            created: 0,
            running: 0,
            done: 4,
            failed: 0,
            cancelled: 0,
            skipped: 0,
          },
        }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-type-badge-split-completed")).toHaveTextContent("Split");
    expect(screen.getByTestId("runtime-node-split-header")).toHaveTextContent("Split completedCompleted");
    expect(screen.getByText("4 done")).toBeInTheDocument();
  });

  it("uses category-derived semantic shape classes", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "trigger-1",
          format_schema: { template_category: "trigger" },
        }}
        nodeRun={completedRun}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-trigger-1");
    expect(card).toHaveAttribute("data-node-shape", "pill");
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("rounded-full");
  });

  it("lets explicit shape override the category-derived runtime shape", () => {
    render(
      <RuntimeNodeCard
        node={{
          ...baseNode,
          id: "override-1",
          format_schema: { template_category: "human", shape: "diamond" },
        }}
        nodeRun={completedRun}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByTestId("runtime-node-card-override-1");
    expect(card).toHaveAttribute("data-node-shape", "diamond");
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("rounded-lg");
    expect(surface?.className).not.toContain("clip-path");
    const glyph = card.querySelector('[data-node-shape-glyph="diamond"]');
    expect(glyph).toBeInTheDocument();
  });

  // ---- Inline action buttons ----

  function makeNodeRun(status: string): WorkflowNodeRun {
    return { ...completedRun, status } as WorkflowNodeRun;
  }

  const actionStatuses = [
    { status: "awaiting_critic", expectedActions: ["approve", "reject"] },
    { status: "awaiting_input", expectedActions: ["submit", "handback"] },
    { status: "blocked", expectedActions: ["retry", "skip", "complete"] },
    { status: "failed", expectedActions: ["retry", "skip", "complete"] },
  ];

  it.each(actionStatuses)(
    "shows correct action buttons for $status",
    ({ status, expectedActions }) => {
      render(
        <RuntimeNodeCard
          node={baseNode}
          nodeRun={makeNodeRun(status)}
          workerName="Tester"
          criticName={null}
          onClick={vi.fn()}
          onAction={vi.fn()}
        />,
      );
      for (const action of expectedActions) {
        expect(
          screen.getByTestId(`runtime-node-action-${action}`),
        ).toBeInTheDocument();
      }
      // No unexpected buttons
      const allActions = screen.getAllByTestId(/^runtime-node-action-/);
      expect(allActions).toHaveLength(expectedActions.length);
    },
  );

  it("does not render action buttons when onAction is not provided", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={makeNodeRun("awaiting_critic")}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("runtime-node-action-approve"),
    ).not.toBeInTheDocument();
  });

  it("does not render action buttons for non-actionable statuses", () => {
    const nonActionable = ["pending", "working", "completed", "format_checking"];
    for (const status of nonActionable) {
      const { container } = render(
        <RuntimeNodeCard
          node={baseNode}
          nodeRun={makeNodeRun(status)}
          workerName="Tester"
          criticName={null}
          onClick={vi.fn()}
          onAction={vi.fn()}
        />,
      );
      expect(
        container.querySelector('[data-testid^="runtime-node-action-"]'),
      ).toBeNull();
    }
  });

  it("calls onAction with correct nodeRunId and action type", async () => {
    const onAction = vi.fn();
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={makeNodeRun("awaiting_critic")}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
        onAction={onAction}
      />,
    );
    await userEvent.click(screen.getByTestId("runtime-node-action-approve"));
    expect(onAction).toHaveBeenCalledWith("run-1", "approve" as NodeRunActionType);
  });

  it("stops click propagation on action button click", async () => {
    const onCardClick = vi.fn();
    const onAction = vi.fn();
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={makeNodeRun("awaiting_critic")}
        workerName="Tester"
        criticName={null}
        onClick={onCardClick}
        onAction={onAction}
      />,
    );
    await userEvent.click(screen.getByTestId("runtime-node-action-approve"));
    expect(onAction).toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("disables action buttons when loading", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={makeNodeRun("awaiting_critic")}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
        onAction={vi.fn()}
        isActionLoading={{ approve: true }}
      />,
    );
    const approveBtn = screen.getByTestId("runtime-node-action-approve");
    expect(approveBtn).toBeDisabled();
  });

  it("shows approve/reject for awaiting_critic with correct labels", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={makeNodeRun("awaiting_critic")}
        workerName="Tester"
        criticName={null}
        onClick={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("runtime-node-action-approve")).toHaveTextContent("Approve");
    expect(screen.getByTestId("runtime-node-action-reject")).toHaveTextContent("Reject");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { RuntimeNodeCard, RUNTIME_NODE_HEIGHT } from "./runtime-node-card";
import type { NodeRunActionType } from "./runtime-node-card";
import type { WorkflowNode, WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

// Mock @multica/views/i18n for useT hook — handles function selector form
vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: unknown) => {
      if (typeof selector === "function") {
        return selector({
          execution: {
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
              worker_label: "Worker",
              critic_label: "Critic",
              artifacts_label: "Artifacts",
              deliverable_green: "Deliverables approved",
              deliverable_yellow: "Awaiting review",
              deliverable_red: "Deliverables missing",
              deliverable_none: "No required deliverables",
              deliverable_progress: "{{submitted}}/{{total}} · {{approved}} passed",
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
            },
          },
        });
      }
      return String(selector);
    },
  }),
}));

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
  device_id: null,
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
  deliverable_signal: "red",
  required_deliverables_total: 1,
  required_deliverables_submitted: 0,
  required_deliverables_approved: 0,
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
    expect(screen.queryByTestId("runtime-node-deliverables")).not.toBeInTheDocument();
  });

  it("renders deliverable summary as a compact neutral chip", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        runtimeSummary={runtimeSummary}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Artifacts:/)).not.toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-deliverables")).toHaveTextContent("Deliverables missing");
    expect(screen.getByTestId("runtime-node-deliverables")).toHaveTextContent("0/1 · 0 passed");
    expect(screen.getByTestId("runtime-node-deliverables")).toHaveClass("col-span-full", "h-4");
    expect(screen.getByTestId("runtime-node-deliverables").className).not.toContain("ring");
    expect(screen.getByTestId("runtime-node-deliverables").className).not.toContain("border");
    expect(screen.getByTestId("runtime-node-deliverables").className).not.toContain("bg-");
  });

  it("renders Bot icon for agent worker_type", () => {
    const { container } = render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    // lucide-bot class on the svg
    expect(container.querySelector(".lucide-bot")).toBeInTheDocument();
  });

  it("renders Building2 icon for squad worker_type", () => {
    const squadNode: WorkflowNode = {
      ...baseNode,
      worker_type: "squad",
    };
    const { container } = render(
      <RuntimeNodeCard
        node={squadNode}
        nodeRun={completedRun}
        workerName="全栈小队"
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-building-2")).toBeInTheDocument();
  });

  it("renders User icon for human worker_type", () => {
    const humanNode: WorkflowNode = {
      ...baseNode,
      worker_type: "human",
    };
    const { container } = render(
      <RuntimeNodeCard
        node={humanNode}
        nodeRun={completedRun}
        workerName="张伟"
        criticName={null}
        onClick={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-user")).toBeInTheDocument();
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

  it("uses runtime summary display status with the compact deliverable chip", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={{ ...completedRun, status: "completed" }}
        runtimeSummary={runtimeSummary}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Reviewing")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-deliverables")).toHaveTextContent("Deliverables missing");
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
    expect(card).toHaveStyle({ width: "240px", height: "120px" });
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
    expect(screen.getByTestId("runtime-node-deliverables")).toHaveClass("text-muted-foreground");
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

    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("小助手")).toBeInTheDocument();
    expect(screen.getByText("Critic")).toBeInTheDocument();
    expect(screen.getByText("审核员")).toBeInTheDocument();
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
        runtimeSummary={{ ...runtimeSummary, display_status: "completed", deliverable_signal: "red" }}
        workerName="Tester"
        criticName="Reviewer"
        onClick={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Fork gateway")).toBeInTheDocument();
    expect(screen.getByLabelText("Dispatched")).toBeInTheDocument();
    expect(screen.queryByText("Worker:")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic:")).not.toBeInTheDocument();
    expect(screen.queryByText(/Artifacts:/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-node-action-approve")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-node-deliverables")).not.toBeInTheDocument();
  });

  it("renders split nodes with split-specific runtime semantics instead of actor rows", () => {
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
              sub_template_id: "child-wf-1",
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
    expect(screen.getByText("Review 5 tasks")).toBeInTheDocument();
    expect(screen.queryByText("Worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-node-deliverables")).not.toBeInTheDocument();
  });

  it("renders an explicit split expansion button that does not open the split panel", async () => {
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
              sub_template_id: "child-wf-1",
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

    const toggleButton = screen.getByRole("button", { name: "Expand 3 child issue nodes" });
    expect(toggleButton).toHaveTextContent("3 issues");

    await userEvent.click(toggleButton);

    expect(onSplitNodeToggle).toHaveBeenCalledWith("split-expand");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the visible canvas surface and split card chrome for split nodes", () => {
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
              sub_template_id: "child-wf-1",
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

    const splitCard = Array.from(card.querySelectorAll("div")).find((element) =>
      element.textContent?.includes("Task split") &&
      element.className.includes("border-border"),
    );
    expect(splitCard?.className).toContain("border-border");
    expect(splitCard?.className).toContain("bg-card");
    expect(splitCard?.className).not.toContain("border-0");
    expect(splitCard?.className).not.toContain("bg-transparent");
    expect(splitCard?.className).not.toContain("shadow-none");
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
              sub_template_id: "child-wf-1",
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
              sub_template_id: "child-wf-1",
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

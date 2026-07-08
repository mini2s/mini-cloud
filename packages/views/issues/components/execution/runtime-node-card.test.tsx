import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { RuntimeNodeCard } from "./runtime-node-card";
import { WORKER_HEIGHT } from "../../../workflows/components/overview/constants";
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

  it("shows artifact row with names when outputs exist", () => {
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
    expect(screen.getByText(/Artifacts:/)).toBeInTheDocument();
    expect(screen.getByText(/Worker Output/)).toBeInTheDocument();
    expect(screen.getByText(/Critic Output/)).toBeInTheDocument();
  });

  it("does not show artifact row when no outputs exist", () => {
    render(
      <RuntimeNodeCard
        node={baseNode}
        nodeRun={completedRun}
        workerName="小助手"
        criticName="审核员"
        onClick={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Artifacts:/)).not.toBeInTheDocument();
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

  it("uses runtime summary display status and deliverable signal", () => {
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
    expect(screen.getByLabelText("Deliverables red")).toBeInTheDocument();
  });

  it("uses the shared workflow canvas node shell for non-functional styling", () => {
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
    expect(card).toHaveStyle({ width: "224px" });
    const surface = card.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("border-white/80");
    expect(surface?.className).toContain("bg-gradient-to-br");
    expect(surface?.className).toContain("ring-slate-200/70");
    expect(surface?.className).toContain("shadow-[0_14px_32px_rgba(15,23,42,0.12)]");
    expect(surface?.className).not.toContain("border-border/80");
    expect(surface?.className).not.toContain("bg-background");
    expect(surface?.className).not.toContain("shadow-[0_1px_2px_rgba(15,23,42,0.06)]");
    expect(screen.getByLabelText("Reviewing")).toBeInTheDocument();
    expect(screen.getByLabelText("Deliverables red")).toBeInTheDocument();
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
          lateralHandleTop={WORKER_HEIGHT / 2}
        />
      </ReactFlowProvider>,
    );

    const handles = [...document.querySelectorAll(".react-flow__handle")];
    expect(handles.map((handle) => handle.getAttribute("data-handleid")).sort()).toEqual(["bottom", "left", "right"]);
    expect(document.querySelector('[data-handleid="left"]')).toHaveStyle({ top: `${WORKER_HEIGHT / 2}px` });
    expect(document.querySelector('[data-handleid="right"]')).toHaveStyle({ top: `${WORKER_HEIGHT / 2}px` });
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
    expect(screen.queryByLabelText("Deliverables red")).not.toBeInTheDocument();
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

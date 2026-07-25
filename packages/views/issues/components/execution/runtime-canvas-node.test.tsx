import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT,
  RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH,
  RuntimeCanvasNode,
  RuntimeSplitSubflowNode,
  runtimeCanvasNodeTypes,
} from "./runtime-canvas-node";
import type { WorkflowActorIdentity } from "../../../common/workflow-actor-slots";

const mocks = vi.hoisted(() => ({
  runtimeNodeCardProps: null as Record<string, unknown> | null,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => <div data-testid="subflow-handle" />,
  Position: { Left: "left" },
}));

vi.mock("./runtime-node-card", () => ({
  RUNTIME_NODE_HEIGHT: 120,
  RUNTIME_CHILD_ISSUE_NODE_HEIGHT: 96,
  RUNTIME_CHILD_ISSUE_NODE_WIDTH: 240,
  RuntimeNodeCard: ({
    node,
    onClick,
    ...props
  }: {
    node: { id: string; title: string };
    onClick: (nodeId: string) => void;
    [key: string]: unknown;
  }) => {
    mocks.runtimeNodeCardProps = { node, onClick, ...props };
    return (
    <button
      type="button"
      data-testid={`runtime-node-card-${node.id}`}
      className="group relative flex min-w-0 flex-col text-left"
      onClick={() => onClick(node.id)}
    >
      <span
        data-node-shape-surface="true"
        className="pointer-events-none absolute inset-0 border border-white/80 bg-gradient-to-br from-white via-slate-50/95 to-slate-100/85 shadow-[0_14px_32px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/70"
      />
      <span>{node.title}</span>
    </button>
    );
  },
}));

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (_selector: unknown, options?: Record<string, unknown>) => `${options?.count ?? 0} child issues`,
  }),
}));

function childWorkflowNode(id: string, title: string) {
  return {
    id,
    workflow_id: "workflow-1",
    title,
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: null,
    worker_type: "agent",
    worker_id: "agent-1",
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: "stage-1",
    created_at: "",
    updated_at: "",
  };
}

function runtimeSummary(workflowNodeId: string, displayStatus: string) {
  return {
    workflow_node_id: workflowNodeId,
    node_run_id: workflowNodeId,
    display_status: displayStatus,
    active_actor_type: "workflow",
    active_actor_id: "agent-1",
    duration_seconds: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    has_error: false,
    error_message: "",
    split_progress: null,
  };
}

describe("RuntimeSplitSubflowNode", () => {
  it("forwards resolved actor identities to the runtime card", () => {
    const workerIdentity: WorkflowActorIdentity = {
      type: "agent",
      id: "agent-1",
      name: "Runtime Agent",
      typeLabel: "Digital human",
    };
    const criticIdentity: WorkflowActorIdentity = {
      type: "member",
      id: "member-1",
      name: "Reviewer",
      typeLabel: "Member",
    };

    render(
      <RuntimeCanvasNode
        {...({
          id: "node-1",
          data: {
            node: childWorkflowNode("node-1", "Runtime task"),
            nodeRun: null,
            runtimeSummary: null,
            workerName: "Runtime Agent",
            criticName: "Reviewer",
            workerIdentity,
            criticIdentity,
            onOpen: vi.fn(),
          },
        } as any)}
      />,
    );

    expect(mocks.runtimeNodeCardProps).toMatchObject({ workerIdentity, criticIdentity });
  });

  it("uses the compact child issue card height for subflow rows", () => {
    expect(RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT).toBe(96);
    expect(RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH).toBe(240);
  });

  it("registers the boundary renderer used by the shared canvas model", () => {
    expect(runtimeCanvasNodeTypes).toHaveProperty("boundary");
  });

  it("renders dependency lines and canvas-aligned child cards inside the subflow", () => {
    render(
      <RuntimeSplitSubflowNode
        {...({
          id: "split-1:split-subflow",
          data: {
            splitNodeId: "split-1",
            parentTitle: "Task split",
            childIssues: [
              {
                nodeId: "split-1:split-task:task-1",
                issueId: "child-1",
                title: "Layout",
                description: "",
                displayStatus: "in_progress",
                displayStatusLabel: "In progress",
                workerName: "Implementation workflow",
                level: 0,
                rowIndex: 0,
                dependencyNodeIds: [],
                workflowNode: childWorkflowNode("split-1:split-task:task-1", "Layout"),
                runtimeSummary: runtimeSummary("split-1:split-task:task-1", "in_progress"),
              },
              {
                nodeId: "split-1:split-task:task-2",
                issueId: "child-2",
                title: "AI opponent",
                description: "",
                displayStatus: "todo",
                displayStatusLabel: "Todo",
                workerName: "AI workflow",
                level: 1,
                rowIndex: 0,
                dependencyNodeIds: ["split-1:split-task:task-1"],
                workflowNode: childWorkflowNode("split-1:split-task:task-2", "AI opponent"),
                runtimeSummary: runtimeSummary("split-1:split-task:task-2", "todo"),
              },
            ],
            dependencyEdges: [
              {
                sourceNodeId: "split-1:split-task:task-1",
                targetNodeId: "split-1:split-task:task-2",
              },
            ],
            onOpenChild: vi.fn(),
          },
        } as any)}
      />,
    );

    expect(screen.getByTestId("runtime-split-subflow-edge-layer")).toBeInTheDocument();
    const dependencyEdge = screen.getByTestId("runtime-split-subflow-edge-split-1:split-task:task-1-split-1:split-task:task-2");
    expect(dependencyEdge).toHaveClass("text-blue-500");
    expect(dependencyEdge).toHaveAttribute("d", expect.stringContaining("H"));
    expect(dependencyEdge).toHaveAttribute("d", expect.stringContaining("V"));
    expect(dependencyEdge.getAttribute("d")).not.toContain("C");
    expect(screen.getByTestId("runtime-node-card-split-1:split-task:task-1")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-node-card-split-1:split-task:task-1").querySelector('[data-node-shape-surface="true"]')).toHaveClass("bg-gradient-to-br");
  });

  it("opens a child issue without letting the subflow node click override selection", () => {
    const onOpenChild = vi.fn();
    const onParentClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <RuntimeSplitSubflowNode
          {...({
            id: "split-1:split-subflow",
            data: {
              splitNodeId: "split-1",
              parentTitle: "Task split",
              childIssues: [
                {
                  nodeId: "split-1:split-task:task-1",
                  issueId: "child-1",
                  title: "Layout",
                  description: "",
                  displayStatus: "in_progress",
                  displayStatusLabel: "In progress",
                  workerName: "Implementation workflow",
                  level: 0,
                  rowIndex: 0,
                  dependencyNodeIds: [],
                  workflowNode: childWorkflowNode("split-1:split-task:task-1", "Layout"),
                  runtimeSummary: runtimeSummary("split-1:split-task:task-1", "in_progress"),
                },
              ],
              dependencyEdges: [],
              onOpenChild,
            },
          } as any)}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("runtime-node-card-split-1:split-task:task-1"));

    expect(onOpenChild).toHaveBeenCalledWith("split-1:split-task:task-1");
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("collapses the subflow from the panel header without overriding selection", () => {
    const onCollapse = vi.fn();
    const onParentClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <RuntimeSplitSubflowNode
          {...({
            id: "split-1:split-subflow",
            data: {
              splitNodeId: "split-1",
              parentTitle: "Task split",
              childIssues: [
                {
                  nodeId: "split-1:split-task:task-1",
                  issueId: "child-1",
                  title: "Layout",
                  description: "",
                  displayStatus: "in_progress",
                  displayStatusLabel: "In progress",
                  workerName: "Implementation workflow",
                  level: 0,
                  rowIndex: 0,
                  dependencyNodeIds: [],
                  workflowNode: childWorkflowNode("split-1:split-task:task-1", "Layout"),
                  runtimeSummary: runtimeSummary("split-1:split-task:task-1", "in_progress"),
                },
              ],
              dependencyEdges: [],
              onOpenChild: vi.fn(),
              onCollapse,
            },
          } as any)}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("runtime-split-subflow-collapse"));

    expect(onCollapse).toHaveBeenCalledWith("split-1");
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

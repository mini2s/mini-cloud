// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitReviewPanel } from "./split-review-panel";
import type { SplitTasksResponse, WorkflowNode, WorkflowNodeRun } from "@multica/core/types";

const mocks = vi.hoisted(() => ({
  splitTasksData: {
    tasks: [],
    progress: {
      total: 0,
      created: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    },
  } as SplitTasksResponse,
  isLoading: false,
  generateMutateAsync: vi.fn(),
  approveMutateAsync: vi.fn(),
  cancelMutateAsync: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: mocks.splitTasksData,
    isLoading: mocks.isLoading,
  }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  splitTasksOptions: (nodeRunId: string | null | undefined) => ({
    queryKey: ["workflows", "node-runs", nodeRunId ?? "", "split-tasks"],
  }),
  useGenerateSplitTasks: () => ({
    mutateAsync: mocks.generateMutateAsync,
    isPending: false,
  }),
  useApproveSplitTasks: () => ({
    mutateAsync: mocks.approveMutateAsync,
    isPending: false,
  }),
  useCancelSplitNode: () => ({
    mutateAsync: mocks.cancelMutateAsync,
    isPending: false,
  }),
}));

vi.mock("./split-progress-badge", () => ({
  SplitProgressBadge: ({ progress }: { progress: SplitTasksResponse["progress"] }) => (
    <div data-testid="split-progress-badge">
      {progress.total}:{progress.running}:{progress.done}
    </div>
  ),
}));

vi.mock("./split-task-dag", () => ({
  SplitTaskDag: ({ tasks }: { tasks: Array<{ id: string; dependsOn: string[] }> }) => (
    <div data-testid="split-task-dag">{tasks.length}:{tasks.filter((task) => task.dependsOn.length > 0).length}</div>
  ),
}));

const splitNode: WorkflowNode = {
  id: "node-1",
  workflow_id: "wf-1",
  title: "Split implementation",
  description: "Break work into child tasks.",
  position_x: 0,
  position_y: 0,
  format_schema: {
    type: "split",
    split_config: {
      sub_template_id: "child-wf-1",
      mode: "barrier",
      max_concurrency: 3,
      max_failures: 1,
    },
  },
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

const splitNodeRun: WorkflowNodeRun = {
  id: "node-run-1",
  workflow_run_id: "run-1",
  workflow_node_id: "node-1",
  node_title: "Split implementation",
  status: "awaiting_split_review",
  retry_count: 0,
  worker_type: "agent",
  worker_id: "agent-1",
  worker_output: null,
  worker_agent_task_id: null,
  critic_type: "human",
  critic_id: null,
  critic_output: null,
  critic_comment: "",
  critic_agent_task_id: null,
  agent_task_id: null,
  session_id: null,
  runtime_id: null,
  device_id: null,
  started_at: null,
  completed_at: null,
  created_at: "",
  updated_at: "",
};

function renderPanel() {
  return render(
    <SplitReviewPanel
      node={splitNode}
      nodeRun={splitNodeRun}
      wsId="ws-1"
      workflowId="wf-1"
      runId="run-1"
      onClose={vi.fn()}
    />,
  );
}

describe("SplitReviewPanel", () => {
  beforeEach(() => {
    mocks.isLoading = false;
    mocks.splitTasksData = {
      tasks: [
        {
          id: "task-1",
          node_run_id: "node-run-1",
          title: "Implement API contract",
          description: "Update handlers and service flow.",
          suggested_assignee_type: "agent",
          suggested_assignee_id: "agent-1",
          depends_on: [],
          sort_order: 0,
          status: "draft",
          issue_id: null,
          run_id: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "task-2",
          node_run_id: "node-run-1",
          title: "Discarded task",
          description: "",
          suggested_assignee_type: null,
          suggested_assignee_id: null,
          depends_on: ["task-1"],
          sort_order: 1,
          status: "discarded",
          issue_id: null,
          run_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
      progress: {
        total: 2,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };
    mocks.generateMutateAsync.mockReset();
    mocks.approveMutateAsync.mockReset();
    mocks.cancelMutateAsync.mockReset();
  });

  it("renders the run-mode split review shell and current task list", () => {
    renderPanel();

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "run");
    expect(screen.getByText("Split execution")).toBeInTheDocument();
    expect(screen.getByTestId("split-progress-badge")).toHaveTextContent("2:0:0");
    expect(screen.getByText("1. Implement API contract")).toBeInTheDocument();
    expect(screen.getByLabelText("Task title task-1")).toHaveValue("Implement API contract");
    expect(screen.getByLabelText("Dependency task-1 for task-2")).toBeInTheDocument();
    expect(screen.getByText("Task graph")).toBeInTheDocument();
    expect(screen.getByTestId("split-task-dag")).toHaveTextContent("2:1");
    expect(screen.getByRole("button", { name: "Approve selected (1)" })).toBeInTheDocument();
  });

  it("approves all non-discarded split tasks from review state", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Approve selected (1)" }));

    expect(mocks.approveMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      request: {
        approved_task_ids: ["task-1"],
        modifications: [],
      },
    });
  });

  it("requests split task generation for the selected node run", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Regenerate tasks" }));

    expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("requires confirmation before cancelling the split node", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Cancel split" }));

    expect(mocks.cancelMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel split execution?")).toBeInTheDocument();
    expect(screen.getByText("This will stop unfinished child tasks and cancel their child issues.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(mocks.cancelMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("submits partial approval with edits additions deletions and dependency changes", async () => {
    mocks.splitTasksData = {
      tasks: [
        {
          id: "task-1",
          node_run_id: "node-run-1",
          title: "Implement API contract",
          description: "Update handlers and service flow.",
          suggested_assignee_type: "agent",
          suggested_assignee_id: "agent-1",
          depends_on: [],
          sort_order: 0,
          status: "draft",
          issue_id: null,
          run_id: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "task-2",
          node_run_id: "node-run-1",
          title: "Backfill tests",
          description: "Cover the happy path.",
          suggested_assignee_type: null,
          suggested_assignee_id: null,
          depends_on: [],
          sort_order: 1,
          status: "draft",
          issue_id: null,
          run_id: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "task-3",
          node_run_id: "node-run-1",
          title: "Legacy cleanup",
          description: "",
          suggested_assignee_type: null,
          suggested_assignee_id: null,
          depends_on: [],
          sort_order: 2,
          status: "draft",
          issue_id: null,
          run_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
      progress: {
        total: 3,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel();

    await userEvent.clear(screen.getByLabelText("Task title task-1"));
    await userEvent.type(screen.getByLabelText("Task title task-1"), "Implement split API contract");
    await userEvent.clear(screen.getByLabelText("Task description task-1"));
    await userEvent.type(screen.getByLabelText("Task description task-1"), "Update handlers, service flow, and request schemas.");
    await userEvent.click(screen.getByLabelText("Dependency task-2 for task-1"));
    await userEvent.click(screen.getByLabelText("Approve task task-2"));
    await userEvent.click(screen.getByRole("button", { name: "Delete task task-3" }));
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    await userEvent.type(screen.getByLabelText("Task title new-task-1"), "Document rollout follow-up");
    await userEvent.type(screen.getByLabelText("Task description new-task-1"), "Track comms and migration notes.");
    await userEvent.click(screen.getByLabelText("Dependency task-1 for new-task-1"));
    await userEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));

    expect(mocks.approveMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      request: {
        approved_task_ids: ["task-1"],
        modifications: [
          {
            id: "task-1",
            title: "Implement split API contract",
            description: "Update handlers, service flow, and request schemas.",
            depends_on: ["task-2"],
          },
          {
            action: "delete",
            id: "task-3",
          },
          {
            action: "add",
            title: "Document rollout follow-up",
            description: "Track comms and migration notes.",
            depends_on: ["task-1"],
            suggested_assignee_type: null,
            suggested_assignee_id: null,
          },
        ],
      },
    });
  });
});

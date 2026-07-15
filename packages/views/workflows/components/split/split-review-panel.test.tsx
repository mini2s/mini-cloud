// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitReviewPanel } from "./split-review-panel";
import type {
  Issue,
  SplitTasksResponse,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRunCanvasSummaryResponse,
} from "@multica/core/types";

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
  childIssuesData: [] as Issue[],
  childCanvasSummaryData: null as WorkflowRunCanvasSummaryResponse | null,
  isLoading: false,
  generateMutateAsync: vi.fn(),
  recoverMutateAsync: vi.fn(),
  approveMutateAsync: vi.fn(),
  submitChatMutateAsync: vi.fn(),
  cancelMutateAsync: vi.fn(),
  pendingTaskData: {} as { task_id?: string; status?: string },
  lastSplitTasksQuery: null as null | { refetchInterval?: number | false },
  splitTasksRefetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[]; refetchInterval?: number | false }) => {
    const { queryKey } = options;
    if (Array.isArray(queryKey) && queryKey[0] === "chat" && queryKey[1] === "pending-task") {
      return {
        data: mocks.pendingTaskData,
        isLoading: false,
      };
    }

    if (Array.isArray(queryKey) && queryKey.includes("canvas-summary")) {
      return {
        data: mocks.childCanvasSummaryData,
        isLoading: false,
      };
    }

    if (Array.isArray(queryKey) && queryKey.includes("children")) {
      return {
        data: mocks.childIssuesData,
        isLoading: false,
      };
    }

    if (Array.isArray(queryKey) && queryKey.includes("split-tasks")) {
      mocks.lastSplitTasksQuery = options;
      return {
        data: mocks.splitTasksData,
        isLoading: mocks.isLoading,
        refetch: mocks.splitTasksRefetch,
      };
    }

    return {
      data: mocks.splitTasksData,
      isLoading: mocks.isLoading,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@multica/core/issues/queries", () => ({
  childIssuesOptions: (_wsId: string, issueId: string) => ({
    queryKey: ["issues", "ws-1", "children", issueId],
  }),
}));

vi.mock("@multica/core/chat/queries", () => ({
  pendingChatTaskOptions: (sessionId: string) => ({
    queryKey: ["chat", "pending-task", sessionId],
    enabled: !!sessionId,
  }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/test/issues/${id}`,
  }),
}));

vi.mock("../../../navigation", () => ({
  AppLink: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  splitTasksOptions: (wsId: string, nodeRunId: string | null | undefined) => ({
    queryKey: ["workflows", wsId, "node-runs", nodeRunId ?? "", "split-tasks"],
  }),
  workflowRunCanvasSummaryOptions: (_wsId: string, workflowId: string, runId: string) => ({
    queryKey: ["workflows", "ws-1", workflowId, runId, "canvas-summary"],
  }),
  useGenerateSplitTasks: () => ({
    mutateAsync: mocks.generateMutateAsync,
    isPending: false,
  }),
  useRecoverSplitTasks: () => ({
    mutateAsync: mocks.recoverMutateAsync,
    isPending: false,
  }),
  useApproveSplitTasks: () => ({
    mutateAsync: mocks.approveMutateAsync,
    isPending: false,
  }),
  useSubmitSplitReviewChat: () => ({
    mutateAsync: mocks.submitChatMutateAsync,
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

vi.mock("./split-chat-review", () => ({
  SplitChatReview: ({
    disabled,
    onSubmit,
  }: {
    disabled?: boolean;
    onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
  }) => (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onSubmit("把第 2 个 task 拆成前后端", ["att-1"])}
      >
        Submit split chat
      </button>
    </div>
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
      child_workflow_id: "child-wf-1",
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

function renderPanel({
  nodeRun = splitNodeRun,
  parentIssueId,
}: {
  nodeRun?: WorkflowNodeRun;
  parentIssueId?: string;
} = {}) {
  return render(
    <SplitReviewPanel
      node={splitNode}
      nodeRun={nodeRun}
      wsId="ws-1"
      workflowId="wf-1"
      runId="run-1"
      parentIssueId={parentIssueId}
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
    mocks.childIssuesData = [];
    mocks.childCanvasSummaryData = null;
    mocks.generateMutateAsync.mockReset();
    mocks.recoverMutateAsync.mockReset();
    mocks.approveMutateAsync.mockReset();
    mocks.submitChatMutateAsync.mockReset();
    mocks.cancelMutateAsync.mockReset();
    mocks.pendingTaskData = {};
    mocks.lastSplitTasksQuery = null;
    mocks.splitTasksRefetch.mockReset();
  });

  it("renders a readonly review with verdict, draft plan, dependencies, and no manual edit controls", () => {
    renderPanel();

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "run");
    expect(screen.getByText("Ready to create")).toBeInTheDocument();
    expect(screen.getByText("Draft plan")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Ask agent to adjust")).toBeInTheDocument();
    expect(screen.getByTestId("split-progress-badge")).toHaveTextContent("2:0:0");
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Implement API contract")).toBeInTheDocument();
    expect(screen.getByText("依赖：无")).toBeInTheDocument();
    expect(screen.getByText("依赖：01")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Task title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Task description/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete task/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-task-dag")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认创建 1" })).toBeInTheDocument();
  });

  it("approves current draft tasks without sending local modifications", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "确认创建 1" }));
    expect(screen.getByText("确认创建子 issue？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认创建" }));

    expect(mocks.approveMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      request: {
        approved_task_ids: ["task-1"],
      },
    });
  });

  it("does not show draft generation actions during review when a draft already exists", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("offers draft generation only before any split draft exists", async () => {
    mocks.splitTasksData = {
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
    };
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "生成草案" }));

    expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("does not offer draft generation before the split node can generate", () => {
    mocks.splitTasksData = {
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
    };

    renderPanel({
      nodeRun: {
        ...splitNodeRun,
        status: "pending",
      },
    });

    expect(screen.queryByRole("button", { name: "鐢熸垚鑽夋" })).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("describes in-flight draft generation instead of declaring no risk", () => {
    renderPanel({
      nodeRun: {
        ...splitNodeRun,
        status: "splitting",
      },
    });

    expect(screen.getByText("Generating draft")).toBeInTheDocument();
    expect(screen.getByText("Agent 正在生成草案…")).toBeInTheDocument();
    expect(screen.queryByText("No blocking risk")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument();
  });

  it("submits natural language split adjustments through the chat mutation", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Submit split chat" }));

    expect(mocks.submitChatMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      content: "把第 2 个 task 拆成前后端",
      attachmentIds: ["att-1"],
    });
  });

  it("refreshes draft tasks while a split review chat task is running", () => {
    mocks.pendingTaskData = {
      task_id: "123e4567-e89b-12d3-a456-426614174000",
      status: "running",
    };

    renderPanel({
      nodeRun: {
        ...splitNodeRun,
        split_review_chat_session_id: "chat-1",
      },
    });

    expect(mocks.lastSplitTasksQuery?.refetchInterval).toBe(2000);
  });

  it("refetches draft tasks once when split review chat finishes", async () => {
    const nodeRunWithChat = {
      ...splitNodeRun,
      split_review_chat_session_id: "chat-1",
    };
    mocks.pendingTaskData = {
      task_id: "123e4567-e89b-12d3-a456-426614174000",
      status: "running",
    };

    const view = renderPanel({ nodeRun: nodeRunWithChat });
    mocks.splitTasksRefetch.mockClear();
    mocks.pendingTaskData = {};
    view.rerender(
      <SplitReviewPanel
        node={splitNode}
        nodeRun={nodeRunWithChat}
        wsId="ws-1"
        workflowId="wf-1"
        runId="run-1"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mocks.splitTasksRefetch).toHaveBeenCalledTimes(1);
    });
  });

  it("recovers failed split drafts from existing output comments and attachments", async () => {
    renderPanel({
      nodeRun: {
        ...splitNodeRun,
        status: "failed",
        worker_output: { error: "split generation returned no tasks" },
      },
    });

    expect(screen.getByText("split generation returned no tasks")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "恢复已有输出" }));

    expect(mocks.recoverMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("requires confirmation before cancelling the split node", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "取消拆分" }));

    expect(mocks.cancelMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("取消拆分？")).toBeInTheDocument();
    expect(screen.getByText("这会停止未完成的子 task，并取消对应的子 issue。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "确认取消" }));

    expect(mocks.cancelMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("keeps approval payload readonly even when multiple draft tasks are present", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "确认创建 3" }));
    await userEvent.click(screen.getByRole("button", { name: "确认创建" }));

    expect(mocks.approveMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      request: {
        approved_task_ids: ["task-1", "task-2", "task-3"],
      },
    });
  }, 15_000);

  it("shows linked child issue details for materialized split tasks", () => {
    mocks.splitTasksData = {
      tasks: [
        {
          id: "task-1",
          node_run_id: "node-run-1",
          title: "Investigate API key configuration",
          description: "Trace the failing downstream secret lookup.",
          suggested_assignee_type: "agent",
          suggested_assignee_id: "agent-1",
          depends_on: [],
          sort_order: 0,
          status: "failed",
          issue_id: "child-1",
          run_id: "child-run-1",
          created_at: "",
          updated_at: "",
        },
      ],
      progress: {
        total: 1,
        created: 0,
        running: 0,
        done: 0,
        failed: 1,
        cancelled: 0,
        skipped: 0,
      },
    };
    mocks.childIssuesData = [
      {
        id: "child-1",
        workspace_id: "ws-1",
        number: 42,
        identifier: "MUL-42",
        title: "Investigate API key configuration",
        description: null,
        status: "blocked",
        priority: "medium",
        assignee_type: "agent",
        assignee_id: "agent-1",
        creator_type: "member",
        creator_id: "user-1",
        parent_issue_id: "issue-1",
        project_id: null,
        workflow_id: "wf-child-1",
        workflow_run_id: "run-child-1",
        stage_id: null,
        origin_type: "workflow_split",
        origin_id: "task-1",
        position: 0,
        start_date: null,
        due_date: null,
        metadata: {},
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.childCanvasSummaryData = {
      run: {
        id: "run-child-1",
        workflow_id: "wf-child-1",
        workspace_id: "ws-1",
        workflow_title: "Child workflow",
        status: "failed",
        triggered_by_type: "member",
        triggered_by_id: "user-1",
        input: null,
        output: null,
        started_at: "",
        completed_at: "",
        created_at: "",
      },
      node_runs: [],
      node_runtime_summaries: [
        {
          workflow_node_id: "child-node-1",
          node_run_id: "child-node-run-1",
          display_status: "blocked",
          active_actor_type: "agent",
          active_actor_id: "agent-1",
          duration_seconds: null,
          session_id: null,
          runtime_id: null,
          device_id: null,
          has_error: true,
          error_message: "API key is missing",
          split_progress: null,
        },
      ],
    };

    renderPanel({
      nodeRun: { ...splitNodeRun, status: "split_active" },
      parentIssueId: "issue-1",
    });

    expect(screen.getByRole("link", { name: "MUL-42" })).toHaveAttribute("href", "/test/issues/child-1");
    expect(screen.getByText("Child issue")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("Error: API key is missing")).toBeInTheDocument();
  });

  it("keeps a child issue entry available from split task issue_id when child issue details are absent", () => {
    mocks.splitTasksData = {
      tasks: [
        {
          id: "task-1",
          node_run_id: "node-run-1",
          title: "Investigate API key configuration",
          description: "Trace the failing downstream secret lookup.",
          suggested_assignee_type: "agent",
          suggested_assignee_id: "agent-1",
          depends_on: [],
          sort_order: 0,
          status: "running",
          issue_id: "efce2a24-0478-4f0b-bdb6-53166462d0fa",
          run_id: "child-run-1",
          created_at: "",
          updated_at: "",
        },
      ],
      progress: {
        total: 1,
        created: 0,
        running: 1,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };
    mocks.childIssuesData = [];

    renderPanel({
      nodeRun: { ...splitNodeRun, status: "split_active" },
      parentIssueId: "00166814-e167-4599-ba8b-c6be55b73ca0",
    });

    expect(screen.getByTestId("split-node-status")).toHaveTextContent("split_active");
    expect(screen.getByTestId("split-progress-running")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "Open child issue" })).toHaveAttribute(
      "href",
      "/test/issues/efce2a24-0478-4f0b-bdb6-53166462d0fa",
    );
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
  });
});

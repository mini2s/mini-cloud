// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitReviewPanel } from "./split-review-panel";
import type {
  Issue,
  SplitTask,
  SplitTasksResponse,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRunCanvasSummaryResponse,
} from "@multica/core/types";

const i18nMock = vi.hoisted(() => {
  const detailPanel = {
    split_review_eyebrow: "Split review",
    split_progress_eyebrow: "Split progress",
    split_verdict_title: "Child issue readiness",
    split_ready_to_create: "Ready to create",
    split_needs_adjustment: "Needs adjustment",
    split_generating_draft: "Generating draft",
    split_failed: "Split failed",
    split_running_children: "Running child issues",
    split_completed: "Completed",
    split_no_blocking_risk: "No blocking risk",
    split_missing_assignees: "{{count}} child issue(s) need assignees",
    split_verdict_summary: "{{tasks}} child issues - {{assignees}} assignees - {{dependencies}} dependency chains",
    split_settings_summary: "View run settings",
    split_draft_plan: "Child issue draft",
    split_dependencies: "Dependencies and release rules",
    split_ask_agent: "Ask agent to adjust",
    split_loading_draft: "Loading child issue draft...",
    split_loading_dependencies: "Loading dependencies...",
    split_generate_draft: "Generate draft",
    split_regenerate_draft: "Regenerate draft",
    split_generating: "Generating...",
    split_recover_outputs: "Recover existing output",
    split_recovering: "Recovering...",
    split_cancel: "Cancel split",
    split_cancelling: "Cancelling...",
    split_confirm_create: "Confirm create {{count}}",
    split_confirm_create_short: "Confirm create",
    split_confirm_empty: "Confirm no split needed",
    split_creating: "Creating...",
    split_no_creatable_tasks: "No child issues are ready to create yet",
    split_approve_dialog_title: "Create child issues?",
    split_approve_dialog_description: "This will create {{count}} child issues and start their workflows.",
    split_cancel_dialog_title: "Cancel split?",
    split_cancel_dialog_description: "This will stop unfinished child tasks and cancel their child issues.",
    split_keep_running: "Keep running",
    split_confirm_cancel: "Confirm cancel",
    // New keys added for split-node-card, split-draft-ledger, split-dependency-note, and review panel
    split_node_generating_draft_tasks: "Generating draft tasks",
    split_node_review_tasks_one: "Review {{count}} task",
    split_node_review_tasks_other: "Review {{count}} tasks",
    split_node_review_tasks: "Review {{count}} tasks",
    split_node_mode_concurrency: "{{mode}} · concurrency {{concurrency}}",
    split_status_fallback: "pending",
    split_draft_child_issue_label: "Child issue",
    split_draft_open_child_issue: "Open child issue",
    split_draft_error_prefix: "Error: {{message}}",
    split_draft_empty: "No child issue draft has been generated yet.",
    split_draft_untitled_task: "Untitled task",
    split_draft_execution_workflow_for: "Execution workflow for {{title}}",
    split_draft_select_workflow_placeholder: "Select workflow...",
    split_draft_dependencies_label: "Dependencies: {{deps}}",
    split_draft_dependencies_none: "Dependencies: none",
    split_draft_missing_execution_workflow: "Missing execution workflow",
    split_dep_will_appear_after_draft: "Dependencies will appear here after a draft is generated.",
    split_dep_can_start_in_parallel: "These child issues can start in parallel.",
    split_settings_mode_label: "Mode: {{mode}}",
    split_settings_concurrency_label: "Concurrency: {{concurrency}}",
    split_settings_max_failures_label: "Max failures: {{max}}",
    split_stat_total: "Total",
    split_stat_running: "Running",
    split_stat_done: "Done",
    split_stat_failed: "Failed",
    split_blocker_missing_workflow: "Child issue {{index}} is missing execution workflow.",
    split_actions_section: "Actions",
    close_label: "Close node inspector",
  };

  return {
    resources: { detail_panel: detailPanel },
    interpolate: (template: string, values?: Record<string, string | number>) =>
      template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => String(values?.[key] ?? "")),
  };
});

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
  patchDraftMutateAsync: vi.fn(),
  pendingTaskData: {} as { task_id?: string; status?: string },
  workflowOptionsData: [
    {
      id: "child-wf-1",
      workspace_id: "ws-1",
      title: "Implementation workflow",
      description: "",
      status: "active",
      max_retries: 3,
      created_by_type: "member",
      created_by_id: "user-1",
      node_count: 1,
      is_template: false,
      source_template_id: null,
      created_at: "",
      updated_at: "",
    },
  ],
  lastSplitTasksQuery: null as null | { refetchInterval?: number | false },
  splitTasksRefetch: vi.fn(),
  workflowOptionsRefetch: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: typeof i18nMock.resources) => string,
      values?: Record<string, string | number>,
    ) => i18nMock.interpolate(selector(i18nMock.resources), values),
  }),
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

    if (Array.isArray(queryKey) && queryKey.includes("split-issue-workflow-options")) {
      return {
        data: mocks.workflowOptionsData,
        isLoading: false,
        refetch: mocks.workflowOptionsRefetch,
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
  splitIssueWorkflowOptions: (wsId: string, workflowId: string | null | undefined) => ({
    queryKey: ["workflows", wsId, "detail", workflowId ?? "", "split-issue-workflow-options"],
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
  usePatchSplitDraftTask: () => ({
    mutateAsync: mocks.patchDraftMutateAsync,
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
        onClick={() => void onSubmit("Split task 2 into frontend and backend", ["att-1"])}
      >
        Submit split chat
      </button>
    </div>
  ),
}));

const mojibakePattern = /[\uFFFD\u95B3\u9239\u9435\u6D93\u7F02\u6FC0\u701B\u7EEB]/;

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
      default_issue_workflow_id: "child-wf-1",
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

function draftTask(id: string, title: string, overrides: Partial<SplitTask> = {}): SplitTask {
  return {
    id,
    node_run_id: "node-run-1",
    title,
    description: "Update handlers and service flow.",
    workflow_id: "child-wf-1",
    depends_on: [],
    sort_order: 0,
    status: "draft" as const,
    issue_id: null,
    run_id: null,
    version: 1,
    last_error: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

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
        draftTask("task-1", "Implement API contract"),
        draftTask("task-2", "Discarded task", {
          description: "",
          workflow_id: null,
          depends_on: ["task-1"],
          sort_order: 1,
          status: "discarded",
        }),
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

  it("renders a readonly review with verdict, draft plan, dependencies, sticky actions, and no manual edit controls", () => {
    const { container } = renderPanel();

    const approveButton = screen.getByRole("button", { name: "Confirm create 1" });
    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "run");
    expect(screen.getByTestId("split-review-summary")).toHaveClass("rounded-lg", "border");
    expect(screen.getByTestId("split-review-action-bar")).toContainElement(approveButton);
    expect(screen.getByText("Child issue readiness")).toBeInTheDocument();
    expect(screen.getByText("Ready to create")).toBeInTheDocument();
    expect(screen.getByText("Child issue draft")).toBeInTheDocument();
    expect(screen.getByText("Dependencies and release rules")).toBeInTheDocument();
    expect(screen.getByText("Ask agent to adjust")).toBeInTheDocument();
    expect(screen.getByTestId("split-progress-badge")).toHaveTextContent("2:0:0");
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Implement API contract")).toBeInTheDocument();
    expect(screen.getByText("Dependencies: none")).toBeInTheDocument();
    expect(screen.getByText("Dependencies: 01")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Task title/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Task description/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete task/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-task-dag")).not.toBeInTheDocument();
    expect(approveButton.closest(".sticky")).not.toBeNull();
    expect(container).not.toHaveTextContent(mojibakePattern);
  });

  it("approves current draft tasks without sending local modifications", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Confirm create 1" }));
    expect(screen.getByText("Create child issues?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm create" }));

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

    expect(screen.queryByRole("button", { name: "Regenerate draft" })).not.toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));

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

    expect(screen.queryByRole("button", { name: "Generate draft" })).not.toBeInTheDocument();
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
    expect(screen.getByText("Generating...")).toBeInTheDocument();
    expect(screen.queryByText("No blocking risk")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate draft" })).not.toBeInTheDocument();
  });

  it("submits natural language split adjustments through the chat mutation", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Submit split chat" }));

    expect(mocks.submitChatMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      content: "Split task 2 into frontend and backend",
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
    expect(screen.getByRole("button", { name: "Submit split chat" })).toBeDisabled();
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

    await userEvent.click(screen.getByRole("button", { name: "Recover existing output" }));

    expect(mocks.recoverMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("requires confirmation before cancelling the split node", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Cancel split" }));

    expect(mocks.cancelMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel split?")).toBeInTheDocument();
    expect(screen.getByText("This will stop unfinished child tasks and cancel their child issues.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(mocks.cancelMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("keeps approval payload readonly even when multiple draft tasks are present", async () => {
    mocks.splitTasksData = {
      tasks: [
        draftTask("task-1", "Implement API contract"),
        draftTask("task-2", "Backfill tests", {
          description: "Cover the happy path.",
          sort_order: 1,
        }),
        draftTask("task-3", "Legacy cleanup", {
          description: "",
          sort_order: 2,
        }),
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

    await userEvent.click(screen.getByRole("button", { name: "Confirm create 3" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm create" }));

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
        draftTask("task-1", "Investigate API key configuration", {
          description: "Trace the failing downstream secret lookup.",
          status: "failed",
          issue_id: "child-1",
          run_id: "child-run-1",
        }),
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
        workflow_title: "Implementation workflow",
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
        draftTask("task-1", "Investigate API key configuration", {
          description: "Trace the failing downstream secret lookup.",
          status: "running",
          issue_id: "efce2a24-0478-4f0b-bdb6-53166462d0fa",
          run_id: "child-run-1",
        }),
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

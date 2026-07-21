// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
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
    split_recover_outputs: "Generate draft from output",
    split_recovering: "Generating draft...",
    split_reset_original: "Reset to agent proposal",
    split_resetting_original: "Resetting...",
    split_cancel: "Cancel split",
    split_cancelling: "Cancelling...",
    split_confirm_create: "Confirm create {{count}}",
    split_confirm_create_short: "Confirm create",
    split_approve_dialog_cancel: "Cancel",
    split_confirm_empty: "Confirm no split needed",
    split_creating: "Creating...",
    split_no_creatable_tasks: "No child issues are ready to create yet",
    split_approve_dialog_title: "Create child issues?",
    split_approve_dialog_description: "This will create {{count}} child issues and start their workflows.",
    split_cancel_dialog_title: "Cancel split?",
    split_cancel_dialog_description: "This will stop unfinished child tasks and cancel their child issues.",
		split_planner_label: "Planner: {{planner}}",
		split_elapsed: "Elapsed: {{elapsed}}",
		split_generation_slow: "Planner is still generating drafts",
		split_cancel_affected_count: "{{count}} child tasks will be cancelled",
		split_completed_summary: "{{total}} tasks: {{done}} done, {{failed}} failed, {{cancelled}} cancelled",
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
    split_draft_issue_status_label: "Issue status",
    split_draft_run_status_label: "Run result",
    split_draft_workflow_label: "Workflow",
    split_draft_open_child_issue: "Open child issue",
    split_draft_error_prefix: "Error: {{message}}",
    split_draft_empty: "No child issue draft has been generated yet.",
    split_draft_untitled_task: "Untitled task",
    split_draft_execution_workflow_for: "Execution workflow for {{title}}",
    split_draft_select_workflow_placeholder: "Select workflow...",
    split_draft_dependencies_label: "Dependencies: {{deps}}",
    split_draft_dependencies_none: "Dependencies: none",
    split_draft_missing_execution_workflow: "Missing execution workflow",
    split_draft_expand_details: "View details",
    split_draft_collapse_details: "Hide details",
    split_draft_edit: "Edit draft",
    split_draft_save: "Save draft",
    split_draft_cancel_edit: "Cancel edit",
    split_draft_discard: "Discard draft",
    split_draft_restore: "Restore draft",
    split_draft_discarded_group: "{{count}} discarded drafts",
    split_draft_show_discarded: "Show discarded drafts",
    split_draft_hide_discarded: "Hide discarded drafts",
    split_draft_title_label: "Draft title",
    split_draft_description_label: "Draft description",
    split_draft_edit_failed: "Failed to update draft.",
		split_draft_version: "v{{version}}",
		split_draft_recovered: "Recovered",
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
  resetOriginalMutateAsync: vi.fn(),
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
  useResetSplitTasksToOriginal: () => ({
    mutateAsync: mocks.resetOriginalMutateAsync,
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
  runtime_selection_reason: null,
  failure_reason: null,
  device_id: null,
  split_review_chat_session_id: null,
  split_config_version: 1,
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
    draft_key: null,
    draft_source: "agent",
    last_error: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderPanel({
  nodeRun = splitNodeRun,
  parentIssueId,
	plannerName,
}: {
  nodeRun?: WorkflowNodeRun;
  parentIssueId?: string;
	plannerName?: string;
} = {}) {
  return render(
    <SplitReviewPanel
      node={splitNode}
      nodeRun={nodeRun}
      wsId="ws-1"
      workflowId="wf-1"
      runId="run-1"
      parentIssueId={parentIssueId}
		plannerName={plannerName}
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
          workflow_id: "",
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
    mocks.resetOriginalMutateAsync.mockReset();
    mocks.approveMutateAsync.mockReset();
    mocks.submitChatMutateAsync.mockReset();
    mocks.cancelMutateAsync.mockReset();
    mocks.pendingTaskData = {};
    mocks.lastSplitTasksQuery = null;
    mocks.splitTasksRefetch.mockReset();
  });

	it("shows planner, elapsed time, and the slow-generation message after 60 seconds", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-07-19T00:01:01Z"));
			renderPanel({
				nodeRun: { ...splitNodeRun, status: "splitting", started_at: "2026-07-19T00:00:00Z" },
				plannerName: "Split Planner Code",
			});
			expect(screen.getByText("Planner: Split Planner Code")).toBeInTheDocument();
			expect(screen.getByText("Elapsed: 1:01")).toBeInTheDocument();
			expect(screen.getByText("Planner is still generating drafts")).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

  it("renders a review with verdict, draft plan, dependencies, sticky actions, and draft quick actions", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    const approveButton = screen.getByRole("button", { name: "Confirm create 1" });
    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "run");
    expect(screen.getByTestId("split-review-summary")).not.toHaveClass("border-l-4", "border-l-primary/70");
    expect(screen.queryByTestId("split-draft-command-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
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
    expect(screen.getByText("1 discarded drafts")).toBeInTheDocument();
    expect(screen.queryByText("Discarded task")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit draft" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show discarded drafts" }));

    expect(screen.getByText("Discarded task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore draft" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Draft title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Draft description" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete task/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-task-dag")).not.toBeInTheDocument();
    expect(approveButton.closest(".sticky")).not.toBeNull();
    expect(container).not.toHaveTextContent(mojibakePattern);
  });

  it("groups discarded draft rows after a chat adjustment while approving only active drafts", async () => {
    const user = userEvent.setup();
    mocks.splitTasksData = {
      tasks: [
        draftTask("task-1", "Build project shell", {
          status: "discarded",
          sort_order: 0,
        }),
        draftTask("task-2", "Render board", {
          status: "discarded",
          sort_order: 1,
        }),
        draftTask("task-3", "Implement game logic", {
          sort_order: 2,
          depends_on: ["task-merged"],
        }),
        draftTask("task-merged", "Build shell and board rendering", {
          sort_order: 3,
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

    renderPanel();

    expect(screen.getByText("2 discarded drafts")).toBeInTheDocument();
    expect(screen.queryByText("Build project shell")).not.toBeInTheDocument();
    expect(screen.queryByText("Render board")).not.toBeInTheDocument();
    expect(screen.getByText("Implement game logic")).toBeInTheDocument();
    expect(screen.getByText("Build shell and board rendering")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm create 2" })).toBeInTheDocument();
    expect(screen.getByText("Dependencies: 02")).toBeInTheDocument();
    expect(screen.getByText("02 -> 01")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show discarded drafts" }));

    expect(screen.getByText("Build project shell")).toBeInTheDocument();
    expect(screen.getByText("Render board")).toBeInTheDocument();
  });

  it("uses visible draft numbers for active blockers and ignores discarded draft risks", () => {
    mocks.splitTasksData = {
      tasks: [
        draftTask("discarded-1", "Discarded missing workflow", {
          workflow_id: "",
          status: "discarded",
          sort_order: 0,
        }),
        draftTask("active-2", "Active missing workflow", {
          workflow_id: "",
          sort_order: 1,
        }),
      ],
      progress: {
        total: 1,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel();

    expect(screen.getByText("Child issue 01 is missing execution workflow.")).toBeInTheDocument();
    expect(screen.queryByText("Child issue 1 is missing execution workflow.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-draft-risk-discarded-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("split-draft-risk-active-2")).toBeInTheDocument();
  });

  it("approves current draft tasks without sending local modifications", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Confirm create 1" }));
    expect(screen.getByText("Create child issues?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel split" })).not.toBeInTheDocument();
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

  it("shows reset but not draft generation actions during review when a draft already exists", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: "Regenerate draft" })).not.toBeInTheDocument();
    const draftSection = screen
      .getByText("Child issue draft")
      .closest('[data-testid="node-detail-section"]');
    expect(draftSection).not.toBeNull();
    const resetButton = screen.getByRole("button", { name: "Reset to agent proposal" });
    expect(draftSection).toContainElement(resetButton);
    expect(screen.queryByTestId("split-draft-command-bar")).not.toBeInTheDocument();
  });

  it("places the overall reset action in the draft section header when generation is also available", () => {
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

    const draftSection = screen
      .getByText("Child issue draft")
      .closest('[data-testid="node-detail-section"]');
    expect(draftSection).not.toBeNull();
    expect(within(draftSection as HTMLElement).getByRole("button", { name: "Reset to agent proposal" }))
      .toBeInTheDocument();
    expect(screen.getByTestId("split-draft-command-bar")).toContainElement(
      screen.getByRole("button", { name: "Generate draft" }),
    );
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

    expect(screen.getByRole("button", { name: "Reset to agent proposal" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    expect(mocks.generateMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("keeps the overall reset action available when the draft list is empty", async () => {
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

    await userEvent.click(screen.getByRole("button", { name: "Reset to agent proposal" }));

    expect(mocks.resetOriginalMutateAsync).toHaveBeenCalledWith({
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

    await userEvent.click(screen.getByRole("button", { name: "Generate draft from output" }));

    expect(mocks.recoverMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

  it("does not repeat the raw failed status in the panel header and readiness card", () => {
    mocks.splitTasksData = {
      tasks: [
        draftTask("task-1", "Failed child issue", {
          status: "failed",
          issue_id: "child-1",
        }),
      ],
      progress: {
        total: 1,
        created: 1,
        running: 0,
        done: 0,
        failed: 1,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel({
      nodeRun: {
        ...splitNodeRun,
        status: "failed",
      },
    });

    expect(screen.getByText("Split failed")).toBeInTheDocument();
    expect(screen.queryByTestId("split-node-status")).not.toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });

  it("resets edited review drafts to the original agent proposal", async () => {
    mocks.splitTasksData = {
      tasks: [draftTask("task-1", "Manual edited title")],
      progress: {
        total: 1,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Reset to agent proposal" }));

    expect(mocks.resetOriginalMutateAsync).toHaveBeenCalledWith({
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
		expect(screen.getByText("1 child tasks will be cancelled")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(mocks.cancelMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });

	it("shows the number of active child tasks affected by cancellation", async () => {
		mocks.splitTasksData = {
			tasks: [
				draftTask("a", "A"),
				draftTask("b", "B", { status: "created" }),
				draftTask("c", "C", { status: "running" }),
				draftTask("d", "D", { status: "done" }),
				draftTask("e", "E", { status: "cancelled" }),
			],
			progress: { total: 5, created: 1, running: 1, done: 1, failed: 0, cancelled: 1, skipped: 0 },
		};
		renderPanel();
		await userEvent.click(screen.getByRole("button", { name: "Cancel split" }));
		expect(screen.getByText("3 child tasks will be cancelled")).toBeInTheDocument();
	});

	it("summarizes completed child outcomes", () => {
		mocks.splitTasksData = {
			tasks: [draftTask("a", "A", { status: "done" }), draftTask("b", "B", { status: "failed" }), draftTask("c", "C", { status: "cancelled" })],
			progress: { total: 3, created: 0, running: 0, done: 1, failed: 1, cancelled: 1, skipped: 0 },
		};
		renderPanel({ nodeRun: { ...splitNodeRun, status: "completed" } });
		expect(screen.getByText("3 tasks: 1 done, 1 failed, 1 cancelled")).toBeInTheDocument();
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
		expect(screen.getByText("C")).toBeInTheDocument();
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

  it("submits manual draft text edits through the split draft patch mutation", async () => {
    mocks.splitTasksData = {
      tasks: [
        draftTask("task-1", "Implement API contract", {
          description: "Cover the old handler.",
          version: 7,
        }),
      ],
      progress: {
        total: 1,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    await userEvent.clear(screen.getByLabelText("Draft title"));
    await userEvent.type(screen.getByLabelText("Draft title"), "Manual title");
    await userEvent.clear(screen.getByLabelText("Draft description"));
    await userEvent.type(screen.getByLabelText("Draft description"), "Manual description");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(mocks.patchDraftMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      taskId: "task-1",
      request: {
        title: "Manual title",
        description: "Manual description",
        expected_version: 7,
      },
    });
  });

  it("keeps discarded drafts available in history and excludes them from approval", async () => {
    const user = userEvent.setup();
    mocks.splitTasksData = {
      tasks: [
        draftTask("task-1", "Active draft"),
        draftTask("task-2", "Discarded draft", {
          status: "discarded",
          sort_order: 1,
        }),
      ],
      progress: {
        total: 1,
        created: 0,
        running: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      },
    };

    renderPanel();

    expect(screen.getByText("1 discarded drafts")).toBeInTheDocument();
    expect(screen.queryByText("Discarded draft")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm create 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm create" }));

    expect(mocks.approveMutateAsync).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      workflowId: "wf-1",
      runId: "run-1",
      request: {
        approved_task_ids: ["task-1"],
      },
    });

    await user.click(screen.getByRole("button", { name: "Show discarded drafts" }));
    expect(screen.getByText("Discarded draft")).toBeInTheDocument();
  });

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
        runtime_id: null,
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
    expect(screen.getByText("Issue status: blocked")).toBeInTheDocument();
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

    expect(screen.queryByTestId("split-node-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("split-progress-running")).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "Open child issue" })).toHaveAttribute(
      "href",
      "/test/issues/efce2a24-0478-4f0b-bdb6-53166462d0fa",
    );
    expect(screen.getByText("Run result: Running")).toBeInTheDocument();
  });
});

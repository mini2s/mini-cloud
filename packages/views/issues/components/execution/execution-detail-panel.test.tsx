import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { ExecutionDetailPanel } from "./execution-detail-panel";
import type { WorkflowNode, WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

const mockSetActiveSession = vi.fn();
const mockSetOpen = vi.fn();
const mockIsEmbeddedInCostrict = vi.fn(() => false);
const mockPostCostrictNavigateToSession = vi.fn();
const mockListTaskMessages = vi.fn();
const mockReviewNodeRun = vi.fn();
const mockReviewNodeRunDeliverable = vi.fn();
const mockInvalidateQueries = vi.fn();
let mockChatSessions = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    workspace_id: "ws-1",
    agent_id: "a1",
    creator_id: "u1",
    title: "Runtime session",
    status: "active",
    session_id: "sess-1",
    has_unread: false,
    created_at: "",
    updated_at: "",
  },
];

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown } = {}) => {
    const key = JSON.stringify(opts.queryKey ?? []);
    // NodeRunDeliverables queries submissions under a key ending in "deliverables".
    if (key.includes("deliverables")) {
      return { data: mockDeliverableSubmissions };
    }
    return { data: mockChatSessions };
  },
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  useMutation: (opts: { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: () => Promise<void> | void }) => ({
    mutate: (vars: unknown) => {
      void opts.mutationFn(vars).then(() => opts.onSuccess?.());
    },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const mockDeliverableSubmissions = {
  deliverables: [
    {
      id: "del-1",
      workflow_node_id: "n1",
      title: "Code changes",
      kind: "pull_request",
      required: true,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    },
  ],
  submissions: [
    {
      id: "sub-1",
      deliverable_id: "del-1",
      workflow_node_run_id: "r1",
      status: "submitted",
      pull_request_url: "http://gitea.test/t-ws1/wf-n1/pulls/7",
      content: null,
      attachment_id: null,
      review_comment: null,
      submitted_by_type: "agent",
      submitted_by_id: "a1",
      submitted_at: null,
      reviewed_at: null,
      created_at: "",
      updated_at: "",
    },
  ],
};

vi.mock("@multica/core/chat/queries", () => ({
  chatSessionsOptions: () => ({ queryKey: ["chat", "sessions"] }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowKeys: {
    nodeRunDeliverables: (nodeRunId: string) => ["workflows", "node-runs", nodeRunId, "deliverables"],
    nodeRuns: (wsId: string, workflowId: string, runId: string) => ["workflows", wsId, workflowId, runId, "node-runs"],
    runCanvasSummary: (wsId: string, workflowId: string, runId: string) => ["workflows", wsId, workflowId, runId, "canvas-summary"],
  },
  nodeRunDeliverableSubmissionsOptions: (_wsId: string, nodeRunId: string) => ({
    queryKey: ["workflows", "node-runs", nodeRunId, "deliverables"],
    queryFn: () => [],
  }),
  useSubmitNodeRun: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSkipNodeRun: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../../workflows/components/node-run-control-actions", () => ({
  NodeRunControlActions: () => null,
}));

vi.mock("@multica/core/chat", () => ({
  useChatStore: (selector: (state: { setActiveSession: typeof mockSetActiveSession; setOpen: typeof mockSetOpen }) => unknown) =>
    selector({
      setActiveSession: mockSetActiveSession,
      setOpen: mockSetOpen,
    }),
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mockIsEmbeddedInCostrict(),
  postCostrictNavigateToSession: (args: unknown) => mockPostCostrictNavigateToSession(args),
}));

// Stub the upload mutations so human-worker upload controls render without
// pulling in useWorkspaceId / the real API client.
vi.mock("@multica/core/issues/mutations", () => ({
  useUploadIssueDeliverable: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
  useUploadIssueDeliverablePR: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listTaskMessages: (taskId: string) => mockListTaskMessages(taskId),
    reviewNodeRun: (nodeRunId: string, approved: boolean, comment?: string) =>
      mockReviewNodeRun(nodeRunId, approved, comment),
    reviewNodeRunDeliverable: (nodeRunId: string, submissionId: string, body: unknown) =>
      mockReviewNodeRunDeliverable(nodeRunId, submissionId, body),
  },
}));

vi.mock("../../../common/task-transcript", () => ({
  buildTimeline: (msgs: Array<{ seq: number; type: string; content?: string }>) =>
    msgs.map((msg) => ({ seq: msg.seq, type: msg.type, content: msg.content })),
  AgentTranscriptDialog: ({
    open,
    task,
    items,
    agentName,
  }: {
    open: boolean;
    task: { id: string };
    items: Array<{ content?: string }>;
    agentName: string;
  }) =>
    open ? (
      <div role="dialog" aria-label="Task transcript">
        <span>{task.id}</span>
        <span>{agentName}</span>
        {items.map((item, index) => (
          <p key={index}>{item.content}</p>
        ))}
      </div>
    ) : null,
}));

// Mock @multica/views/i18n for useT hook — handles function selector form
vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: unknown, values?: Record<string, string>) => {
      if (typeof selector === "function") {
        const template = selector({
          detail: {
            desc_label: "Description",
          },
          node_run: {
            deliverables: {
              heading: "Deliverable PRs",
              pull_request_label: "Pull request",
            },
          },
          execution: {
            card: {
              actions: {
                approve: "Approve",
                reject: "Reject",
              },
            },
            display_status: {
              pending: "Pending",
              todo: "Todo",
              in_progress: "In progress",
              reviewing: "Reviewing",
              completed: "Completed",
              failed: "Failed",
              blocked: "Blocked",
              cancelled: "Cancelled",
              dispatched: "Dispatched",
              joined: "Joined",
              waiting_upstream: "Waiting for upstream",
            },
            detail_panel: {
              status_path: "Status Path",
              section_status_next_step: "Status and next step",
              section_deliverables: "Deliverables and links",
              section_worker_critic: "Worker and critic",
              section_actions: "Node actions",
              section_runtime_facts: "Runtime facts",
              section_evidence_preview: "Evidence preview",
              section_child_progress: "Child progress",
              section_primary: "Primary",
              section_primary_desc: "Active handler and diagnostic context.",
              section_agent_operations: "Agent operations",
              section_agent_operations_desc: "Session and recovery actions for this node run.",
              section_runtime: "Runtime",
              section_runtime_desc: "Timing, retries, errors, and raw outputs.",
              worker: "Worker",
              critic: "Critic",
              not_configured: "Not configured",
              worker_output: "Worker Output",
              critic_output: "Critic Output",
              metadata: "Metadata",
              started_at: "Started At",
              completed_at: "Completed At",
              duration: "Duration",
              retry_count: "Retry Count",
              error: "Error",
              view_full_issue: "View full issue",
              open_child_issue: "Open child issue",
              view_evidence: "View evidence",
              parent_split: "Parent split",
              child_assignee: "Assignee",
              reason: "Reason",
              no_deliverables: "No deliverables yet",
              no_runtime_data: "No runtime data yet.",
              gateway_no_worker: "Gateway runtime is automatic and has no worker or critic.",
              unblock: "Unblock",
              retry: "Retry",
              review_comment: "Review Comment",
              review_comment_required: "Please add a review comment before approving or rejecting",
              execution_summary: "Execution summary",
              execution_summary_placeholder: "Optional: briefly describe the completed work",
              submit_result: "Submit result",
              submitting_result: "Submitting...",
              skip_node: "Skip node",
              skip_dialog_title: "Skip this node?",
              skip_dialog_description: "This node will be marked as skipped.",
              skip_dialog_cancel: "Cancel",
              skip_dialog_confirm: "Confirm skip",
              dock_review_title: "Human review",
              dock_review_subtitle: "Your review comment is archived to Gitea with the decision.",
              dock_submit_title: "Deliverable submission",
              dock_submit_subtitle: "The node enters review once deliverables are submitted.",
              open_session: "Open session",
            },
          },
          });
        if (!values) return template;
        return Object.entries(values).reduce(
          (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
          template,
        );
      }
      return String(selector);
    },
  }),
}));

const node: WorkflowNode = {
  id: "n1",
  workflow_id: "w1",
  title: "编码",
  description: "",
  position_x: 0,
  position_y: 0,
  format_schema: null,
  worker_type: "agent",
  worker_id: "a1",
  critic_type: "agent",
  critic_id: "a2",
  critic_api_url: null,
  sort_order: 0,
  stage_id: null,
  created_at: "2026-06-25T10:00:00Z",
  updated_at: "2026-06-25T10:00:00Z",
};

const run: WorkflowNodeRun = {
  id: "r1",
  workflow_run_id: "wr1",
  workflow_node_id: "n1",
  node_title: "编码",
  status: "working",
  retry_count: 0,
  worker_type: "agent",
  worker_id: "a1",
  worker_output: { pr: "#42" },
  worker_agent_task_id: null,
  critic_type: "agent",
  critic_id: "a2",
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
  started_at: "2026-06-25T10:00:00Z",
  completed_at: null,
  created_at: "2026-06-25T10:00:00Z",
  updated_at: "2026-06-25T10:05:00Z",
};

const runtimeSummary: WorkflowNodeRuntimeSummary = {
  workflow_node_id: "n1",
  node_run_id: "r1",
  display_status: "completed",
  active_actor_type: "agent",
  active_actor_id: "a1",
  duration_seconds: 15,
  session_id: null,
  runtime_id: null,
  device_id: null,
  has_error: false,
  error_message: "",
  split_progress: null,
};

describe("ExecutionDetailPanel", () => {
  beforeEach(() => {
    mockSetActiveSession.mockClear();
    mockSetOpen.mockClear();
    mockIsEmbeddedInCostrict.mockReturnValue(false);
    mockPostCostrictNavigateToSession.mockClear();
    mockListTaskMessages.mockReset();
    mockListTaskMessages.mockResolvedValue([
      {
        task_id: "task-1",
        seq: 1,
        type: "text",
        content: "implemented the fix",
        tool: "",
        input: null,
        output: "",
        created_at: "2026-06-25T10:01:00Z",
      },
    ]);
    mockReviewNodeRun.mockResolvedValue({});
    mockReviewNodeRunDeliverable.mockResolvedValue({});
    mockInvalidateQueries.mockResolvedValue(undefined);
    mockChatSessions = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        workspace_id: "ws-1",
        agent_id: "a1",
        creator_id: "u1",
        title: "Runtime session",
        status: "active",
        session_id: "sess-1",
        has_unread: false,
        created_at: "",
        updated_at: "",
      },
    ];
  });

  it("renders node title in header", () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );
    expect(screen.getByText("编码")).toBeInTheDocument();
  });

  it("uses the fixed shared detail shell in run mode", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "run");
    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveClass("w-[min(800px,calc(100vw-2rem))]");
    expect(screen.getByTestId("runtime-diagnostic-summary")).not.toHaveClass("rounded-lg", "border");
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "status-next-step",
      "evidence-preview",
      "worker-critic",
      "runtime-facts",
    ]);
  });

  it("uses responsive runtime columns and keeps actions in the fixed footer", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node", session_id: "sess-1" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        onOpenIssue={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByTestId("runtime-detail-grid")).toHaveClass("grid-cols-1", "min-[1280px]:grid-cols-2");
    expect(screen.getByTestId("runtime-detail-primary-column")).toContainElement(
      screen.getByRole("heading", { name: "Status and next step" }),
    );
    expect(screen.getByTestId("runtime-detail-context-column")).toContainElement(
      screen.getByRole("heading", { name: "Worker and critic" }),
    );
    const footer = screen.getByTestId("node-detail-panel-footer");
    expect(footer).toContainElement(screen.getByRole("button", { name: "Open session" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "View full issue" }));
  });

  it("renders an explicit full issue action when provided", async () => {
    const onOpenIssue = vi.fn();

    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Child issue node" }}
        nodeRun={null}
        workerName="Backend assistant"
        criticName={null}
        onClose={vi.fn()}
        onOpenIssue={onOpenIssue}
        wsId="ws-1"
      />,
    );

    await userEvent.click(screen.getAllByRole("button", { name: "View full issue" })[0]!);

    expect(onOpenIssue).toHaveBeenCalledTimes(1);
  });

  it("does not render generic connections or empty actions sections in run mode", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByText("No runtime actions are available.")).not.toBeInTheDocument();
  });

  it("keeps status context in receipt mode without a status path", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node", status: "format_failed" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getAllByTestId("runtime-display-status-icon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Status and next step")).toBeInTheDocument();
    expect(screen.queryByText("Status Path")).not.toBeInTheDocument();
    expect(screen.queryByText("Current status")).not.toBeInTheDocument();
  });

  it("shows a failed node and its projected agent task error", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{
          ...run,
          node_title: "Run node",
          status: "failed",
          worker_output: null,
        }}
        runtimeSummary={{
          ...runtimeSummary,
          display_status: "blocked",
          has_error: true,
          error_message: "Max turns reached",
        }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    expect(screen.getAllByText("Max turns reached").length).toBeGreaterThan(0);
  });

  it("opens the matching chat session from a runtime session id in run mode", async () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node", session_id: "sess-1" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open session" }));

    expect(screen.getByTestId("runtime-primary-actions")).toContainElement(screen.getByRole("button", { name: "Open session" }));
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "status-next-step",
      "evidence-preview",
      "worker-critic",
      "runtime-facts",
    ]);
    expect(mockSetActiveSession).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(mockSetOpen).toHaveBeenCalledWith(true);
  });

  it("asks CoStrict to open the runtime session in a new browser tab when embedded", async () => {
    mockIsEmbeddedInCostrict.mockReturnValue(true);
    mockPostCostrictNavigateToSession.mockReturnValue(true);

    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node", session_id: "sess-1" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open session" }));

    expect(mockPostCostrictNavigateToSession).toHaveBeenCalledWith({
      sessionId: "sess-1",
      newTab: true,
    });
    expect(mockSetActiveSession).not.toHaveBeenCalled();
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  it("falls back to the matching chat session when CoStrict navigation cannot post to a parent frame", async () => {
    mockIsEmbeddedInCostrict.mockReturnValue(true);
    mockPostCostrictNavigateToSession.mockReturnValue(false);

    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{ ...run, node_title: "Run node", session_id: "sess-1" }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open session" }));

    expect(mockPostCostrictNavigateToSession).toHaveBeenCalledWith({
      sessionId: "sess-1",
      newTab: true,
    });
    expect(mockSetActiveSession).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(mockSetOpen).toHaveBeenCalledWith(true);
  });

  it("opens the task transcript when a runtime session has no matching chat session", async () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Run node" }}
        nodeRun={{
          ...run,
          node_title: "Run node",
          session_id: "orphan-runtime-session",
          worker_agent_task_id: "task-1",
        }}
        workerName="Backend assistant"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open session" }));

    await waitFor(() => expect(mockListTaskMessages).toHaveBeenCalledWith("task-1"));
    expect(await screen.findByRole("dialog", { name: "Task transcript" })).toBeInTheDocument();
    expect(screen.getByText("implemented the fix")).toBeInTheDocument();
    expect(mockSetActiveSession).not.toHaveBeenCalled();
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  it("calls onClose when clicking mask", async () => {
    const onClose = vi.fn();
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={onClose}
        wsId="ws-1"
      />,
    );
    await userEvent.click(screen.getByTestId("detail-panel-mask"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", async () => {
    const onClose = vi.fn();
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={onClose}
        wsId="ws-1"
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows 'Not configured' when no critic", () => {
    const noCriticNode: WorkflowNode = {
      ...node,
      critic_type: "" as WorkflowNode["critic_type"],
      critic_id: null,
    };
    render(
      <ExecutionDetailPanel
        node={noCriticNode}
        nodeRun={run}
        workerName="后端助手"
        criticName={null}
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument();
  });

  it("renders metadata with retry_count always visible", () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );
    expect(screen.getByText("Runtime facts")).toBeInTheDocument();
    expect(screen.getByText("Retry Count")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders duration in human-readable format when completed", () => {
    const completedRun = {
      ...run,
      status: "completed" as const,
      started_at: "2026-06-25T10:00:00Z",
      completed_at: "2026-06-25T10:05:30Z",
    };
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={completedRun}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );
    expect(screen.getByText("5m 30s")).toBeInTheDocument();
  });

  it("renders long duration with hours instead of large minute counts", () => {
    const completedRun = {
      ...run,
      status: "completed" as const,
      started_at: "2026-06-25T10:00:00Z",
      completed_at: "2026-06-26T04:00:00Z",
    };
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={completedRun}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByText("18h")).toBeInTheDocument();
    expect(screen.queryByText("1080m")).not.toBeInTheDocument();
  });

  it("renders ordinary node details as a receipt without raw JSON by default", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Build API", worker_id: "agent-1", critic_id: "agent-2" }}
        nodeRun={{
          ...run,
          status: "completed",
          worker_output: { nested: { raw: true } },
          critic_output: { approved: true },
        }}
        workerName="Builder"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    const sections = screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"));
    expect(sections).toEqual(["status-next-step", "evidence-preview", "worker-critic", "runtime-facts"]);
    expect(screen.queryByText(/"nested"/)).not.toBeInTheDocument();
    expect(screen.getByText("View evidence")).toBeInTheDocument();
  });

  it("reveals raw evidence only after requesting it", async () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={{ ...run, worker_output: { nested: { raw: true } } }}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.queryByText(/"nested"/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("View evidence"));
    expect(screen.getByText(/"nested"/)).toBeInTheDocument();
  });

  it("renders child issue mode with parent split context", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, title: "Child issue" }}
        nodeRun={{ ...run, status: "blocked", worker_output: { error: "Missing input" } }}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        onOpenIssue={vi.fn()}
        isChildIssue
        parentSplitTitle="Split work"
        childAssigneeName="Issue workflow"
        wsId="ws-1"
      />,
    );

    const sections = screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"));
    expect(sections).toEqual(["status-next-step", "evidence-preview", "child-progress", "worker-critic", "runtime-facts"]);
    expect(screen.getAllByText("Open child issue").length).toBeGreaterThan(0);
    expect(screen.getByText("Split work")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getAllByText("Issue workflow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing input").length).toBeGreaterThan(0);
  });

  it("does not treat an issue link as a run-mode agent operation", () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="demo111"
        issueId="33cf28ab-f5ce-4ff7-b199-fb4a6c32064c"
      />,
    );

    expect(screen.queryByText("View full issue")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent operations")).not.toBeInTheDocument();
  });

  it("renders unblock button when status is blocked and onUnblock provided", () => {
    const blockedRun = { ...run, status: "blocked" as const };
    const onUnblock = vi.fn();
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={blockedRun}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
        onUnblock={onUnblock}
      />,
    );
    expect(screen.getByText("Unblock")).toBeInTheDocument();
  });

  it("renders retry button when status is failed and onRetry provided", () => {
    const failedRun = { ...run, status: "failed" as const };
    const onRetry = vi.fn();
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={failedRun}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("renders retry button when status is format_failed and onRetry provided", () => {
    const formatFailedRun = { ...run, status: "format_failed" as const };
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={formatFailedRun}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.queryByText("Agent operations")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "status-next-step",
      "evidence-preview",
      "worker-critic",
      "runtime-facts",
    ]);
  });

  it("shows gateway runtime semantics without worker critic or actions", () => {
    render(
      <ExecutionDetailPanel
        node={{
          ...node,
          title: "Fan out",
          format_schema: { type: "gateway", gateway_kind: "fork", shape: "diamond" },
        }}
        nodeRun={{ ...run, status: "completed", worker_output: { summary: "ignored" } }}
        runtimeSummary={runtimeSummary}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Fork gateway")).toBeInTheDocument();
    expect(screen.getByText("Automatically completes and fans out to all downstream nodes.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Dispatched").length).toBeGreaterThan(0);
    expect(screen.queryByText("Worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic")).not.toBeInTheDocument();
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it("renders the deliverable PR link so reviewers can jump to it", () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    const link = screen.getByRole("link", { name: /Pull request/i });
    expect(link).toHaveAttribute("href", "http://gitea.test/t-ws1/wf-n1/pulls/7");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("reviews deliverables before approving a human critic node run", async () => {
    const user = userEvent.setup();
    render(
      <ExecutionDetailPanel
        node={{ ...node, critic_type: "human", critic_id: null }}
        nodeRun={{ ...run, status: "awaiting_critic", critic_type: "human", critic_id: null }}
        workerName="Worker"
        criticName={null}
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        mayReview
      />,
    );

    await user.type(screen.getByPlaceholderText("Review Comment"), "人工评审通过");
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mockReviewNodeRunDeliverable).toHaveBeenCalledWith("r1", "sub-1", {
        status: "approved",
        review_comment: "人工评审通过",
      });
    });
    expect(mockReviewNodeRun).toHaveBeenCalledWith("r1", true, "人工评审通过");
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workflows", "node-runs", "r1", "deliverables"],
    });
  });

  it("shows human review actions while the node is critic_reviewing", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, critic_type: "human", critic_id: null }}
        nodeRun={{ ...run, status: "critic_reviewing", critic_type: "human", critic_id: null }}
        workerName="Worker"
        criticName={null}
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        mayReview
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    const actionDock = screen.getByTestId("node-action-dock");
    const actorSection = screen.getByText("Worker and critic").closest('[data-section="worker-critic"]');
    expect(actionDock).toContainElement(screen.getByRole("button", { name: "Approve" }));
    expect(actorSection).not.toContainElement(screen.getByRole("button", { name: "Approve" }));
  });

  it("renders the human submit action for the assigned worker", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, worker_type: "human", worker_id: "user-1" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human", worker_id: "user-1" }}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit result" })).toBeInTheDocument();
  });

  it("does not render review actions for another member", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, critic_type: "human", critic_id: "user-2" }}
        nodeRun={{
          ...run,
          status: "critic_reviewing",
          critic_type: "human",
          critic_id: "user-2",
        }}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        currentUserId="user-3"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("places the human review dock with deliverables in the panel footer", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, critic_type: "human", critic_id: null }}
        nodeRun={{ ...run, status: "awaiting_critic", critic_type: "human", critic_id: null }}
        workerName="Worker"
        criticName={null}
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        mayReview
      />,
    );

    const footer = screen.getByTestId("node-detail-panel-footer");
    const dock = screen.getByTestId("node-action-dock");
    expect(footer).toContainElement(dock);
    expect(dock).toContainElement(screen.getByText("Human review"));
    expect(dock).toContainElement(screen.getByRole("link", { name: /Pull request/i }));
    expect(dock).toContainElement(screen.getByPlaceholderText("Review Comment"));
    expect(dock).toContainElement(screen.getByRole("button", { name: "Approve" }));
    expect(dock).toContainElement(screen.getByRole("button", { name: "Reject" }));
  });

  it("keeps an existing review visible but hides review actions without permission", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, critic_type: "human", critic_id: "critic-user" }}
        nodeRun={{
          ...run,
          status: "awaiting_critic",
          critic_type: "human",
          critic_id: "critic-user",
          critic_comment: "Please update the tests",
        }}
        workerName="Worker"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="wf-1"
        runId="wr1"
        mayReview={false}
      />,
    );

    expect(screen.getByText(/Please update the tests/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Review Comment")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows the deliverable submission dock for human worker runs", () => {
    render(
      <ExecutionDetailPanel
        node={{ ...node, worker_type: "human", worker_id: null }}
        nodeRun={{ ...run, status: "working", worker_type: "human", worker_id: null }}
        workerName="Member"
        criticName="Reviewer"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
      />,
    );

    const footer = screen.getByTestId("node-detail-panel-footer");
    const dock = screen.getByTestId("node-action-dock");
    expect(footer).toContainElement(dock);
    expect(dock).toHaveTextContent("Deliverable submission");
    expect(screen.queryByPlaceholderText("Review Comment")).not.toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { ExecutionDetailPanel } from "./execution-detail-panel";
import type { WorkflowNode, WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

const mockSetActiveSession = vi.fn();
const mockSetOpen = vi.fn();
const mockIsEmbeddedInCostrict = vi.fn(() => false);
const mockPostCostrictNavigateToSession = vi.fn();
const mockChatSessions = [
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
  useQuery: () => ({ data: mockChatSessions }),
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatSessionsOptions: () => ({ queryKey: ["chat", "sessions"] }),
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

// Mock @multica/views/i18n for useT hook — handles function selector form
vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: unknown, values?: Record<string, string>) => {
      if (typeof selector === "function") {
        const template = selector({
          detail: {
            desc_label: "Description",
          },
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
            detail_panel: {
              status_path: "Status Path",
              section_primary: "Primary",
              section_primary_desc: "Active handler and diagnostic context.",
              section_agent_operations: "Agent operations",
              section_agent_operations_desc: "Session and recovery actions for this node run.",
              section_deliverables: "Deliverables",
              section_deliverables_desc: "Submitted outputs and review artifacts.",
              section_runtime: "Runtime",
              section_runtime_desc: "Timing, retries, errors, and raw outputs.",
              worker: "Worker",
              critic: "Critic",
              not_configured: "Not configured",
              worker_output: "Worker Output",
              critic_output: "Critic Output",
              attachments: "Artifacts",
              deliverable_status_label: "Deliverable status",
              deliverable_status_green: "Approved",
              deliverable_status_yellow: "Submitted for review",
              deliverable_status_red: "Missing or rejected",
              deliverable_status_none: "No required deliverables",
              deliverable_progress: "{{submitted}}/{{total}} submitted, {{approved}} approved",
              no_output: "No output yet",
              metadata: "Metadata",
              started_at: "Started At",
              completed_at: "Completed At",
              duration: "Duration",
              retry_count: "Retry Count",
              error: "Error",
              view_full_issue: "View full issue",
              unblock: "Unblock",
              retry: "Retry",
              review_comment: "Review Comment",
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
  device_id: null,
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
  deliverable_signal: "none",
  required_deliverables_total: 0,
  required_deliverables_submitted: 0,
  required_deliverables_approved: 0,
  duration_seconds: 15,
  session_id: null,
  runtime_id: null,
  device_id: null,
  has_error: false,
  error_message: "",
};

describe("ExecutionDetailPanel", () => {
  beforeEach(() => {
    mockSetActiveSession.mockClear();
    mockSetOpen.mockClear();
    mockIsEmbeddedInCostrict.mockReturnValue(false);
    mockPostCostrictNavigateToSession.mockClear();
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
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "primary",
      "deliverables",
      "runtime",
    ]);
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

  it("keeps status context without duplicating the current status row", () => {
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
    expect(screen.getByText("Status Path")).toBeInTheDocument();
    expect(screen.getByTestId("status-icon")).toBeInTheDocument();
    expect(screen.queryByText("Current status")).not.toBeInTheDocument();
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

    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "primary",
      "agent-operations",
      "deliverables",
      "runtime",
    ]);
    expect(mockSetActiveSession).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(mockSetOpen).toHaveBeenCalledWith(true);
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

  it("renders artifact section with empty state when no outputs", () => {
    const noOutputRun = { ...run, worker_output: null };
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={noOutputRun}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("No output yet")).toBeInTheDocument();
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
    expect(screen.getByText("Metadata")).toBeInTheDocument();
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
    expect(screen.getByText("Agent operations")).toBeInTheDocument();
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "primary",
      "agent-operations",
      "deliverables",
      "runtime",
    ]);
  });

  it("shows gateway runtime semantics without worker critic artifacts or actions", () => {
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
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it("shows deliverable signal and counts in the detail panel", () => {
    render(
      <ExecutionDetailPanel
        node={node}
        nodeRun={run}
        runtimeSummary={{
          ...runtimeSummary,
          deliverable_signal: "yellow",
          required_deliverables_total: 2,
          required_deliverables_submitted: 1,
          required_deliverables_approved: 0,
        }}
        workerName="后端助手"
        criticName="审核员"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByText("Deliverable status")).toBeInTheDocument();
    expect(screen.getByText("Submitted for review")).toBeInTheDocument();
    expect(screen.getByText("1/2 submitted, 0 approved")).toBeInTheDocument();
  });
});

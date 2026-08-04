// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@multica/core/api";
import type {
  SplitTasksResponse,
  WorkflowNode,
  WorkflowNodeDeliverable,
  WorkflowNodeDeliverableSubmission,
  WorkflowNodeRun,
} from "@multica/core/types";
import { SplitReviewPanel } from "./split-review-panel";

const mocks = vi.hoisted(() => ({
  data: null as SplitTasksResponse | null,
  approve: vi.fn(),
  reject: vi.fn(),
  generate: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  refetchDeliverables: vi.fn(),
  navigateToSession: vi.fn(),
  sessionPermission: { can_observe: false },
  embedded: false,
  currentUserId: "reviewer-1" as string | null,
  deliverableData: {
    deliverables: [] as WorkflowNodeDeliverable[],
    submissions: [] as WorkflowNodeDeliverableSubmission[],
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { kind?: string; nodeRunId?: string }) => ({
    data: options.kind === "split" ? mocks.data : mocks.deliverableData,
    isLoading: false,
    refetch: options.nodeRunId === "run-node-1" ? mocks.refetchDeliverables : vi.fn(),
  }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  splitTasksOptions: () => ({ kind: "split" }),
  nodeRunDeliverableSubmissionsOptions: (_wsId: string, nodeRunId: string) => ({ kind: "deliverables", nodeRunId }),
  useApproveSplitTasks: () => ({ mutate: mocks.approve, isPending: false }),
  useRejectSplitTasks: () => ({ mutate: mocks.reject, isPending: false }),
  useGenerateSplitTasks: () => ({ mutate: mocks.generate, isPending: false }),
  useRetrySplitTask: () => ({ mutate: mocks.retry, isPending: false }),
  useCancelSplitNode: () => ({ mutate: mocks.cancel, isPending: false }),
  useSessionPermission: () => ({ data: mocks.sessionPermission }),
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mocks.embedded,
  postCostrictNavigateToSession: mocks.navigateToSession,
}));

vi.mock("@multica/core/auth", () => {
  const getState = () => ({ user: mocks.currentUserId ? { id: mocks.currentUserId } : null });
  const useAuthStore = Object.assign(
    (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState },
  );
  return { useAuthStore };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: {
        detail_panel: Record<string, string>;
        execution: {
          detail_panel: Record<string, string>;
          display_status: Record<string, string>;
        };
      }) => string,
      values?: Record<string, string | number>,
    ) => {
      const displayStatus = new Proxy({
        pending: "Pending",
        todo: "Todo",
        in_progress: "In progress",
        reviewing: "Reviewing",
        completed: "Completed",
        failed: "Failed",
        blocked: "Blocked",
        cancelled: "Cancelled",
      } as Record<string, string>, {
        get: (target, property: string) => target[property] ?? property,
      });
      const detailPanel = new Proxy({
          split_plan_eyebrow: "Split plan",
          split_plan_close: "Close split plan",
          split_generation_label: "Generation {{generation}}",
          split_status_fallback: "Not started",
          split_cancel: "Cancel",
          split_generate_new_plan: "Generate new plan",
          split_plan_status: "Plan status",
          split_review_instruction: "Review the submitted task plan.",
          split_plan_explanation: "Generate a task plan for review.",
          split_review_decision: "Review decision",
          split_review_comment_placeholder: "Add review guidance",
          split_reject: "Reject",
          split_approve_snapshot: "Approve snapshot",
          split_materialization_progress: "Materialization progress",
          split_materialized: "Materialized",
          split_retry_waiting: "Waiting to retry",
          split_manual_retry: "Manual retry",
          split_issue_created: "Issue created",
          split_pending: "Pending",
          split_retry: "Retry",
          split_drawer_approve: "Approve snapshot",
          split_drawer_retry_failed: "Retry",
          split_drawer_more: "More information",
          split_drawer_regenerate: "Regenerate plan",
          split_drawer_cancel: "Cancel split",
          split_drawer_view_children: "View child issues",
          split_drawer_previous: "Previous node deliverable",
          split_drawer_previous_empty: "No previous deliverable",
          split_drawer_validation_count: "Validation issues: {{count}}",
          split_validation_detail: "Line {{line}} · {{field}}: {{message}}",
          split_drawer_validation_hint: "Fix the validation issues and try again.",
          task_drawer_issue_description: "Task description",
          task_drawer_issue_description_empty: "No description",
          open_session: "Open session",
        } as Record<string, string>, {
          get: (target, property: string) => target[property] ?? property,
        });
      const resources = {
        detail_panel: detailPanel,
        execution: { detail_panel: detailPanel, display_status: displayStatus },
      };
      return selector(resources).replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

vi.mock("../../../common/workflow-node-detail-panel-shell", () => ({
  WorkflowNodeDetailPanelShell: ({ children, footer, badges, badgeActions }: { children: React.ReactNode; footer?: React.ReactNode; badges?: React.ReactNode; badgeActions?: React.ReactNode }) => (
    <div>
      <div data-testid="split-panel-badges">{badges}</div>
      <div data-testid="split-panel-badge-actions">{badgeActions}</div>
      {children}
      {footer ? <div data-testid="node-detail-panel-footer">{footer}</div> : null}
    </div>
  ),
  NodeDetailSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section><h2>{title}</h2>{children}</section>
  ),
}));

vi.mock("../node-run-deliverables", () => ({
  NodeRunDeliverables: () => <div>task.md pull request</div>,
}));

const node = { id: "node-1", title: "Plan work" } as WorkflowNode;
const baseRun = {
  id: "run-node-1",
  status: "awaiting_split_review",
  critic_type: "human",
  critic_id: "reviewer-1",
} as WorkflowNodeRun;

function response(overrides: Partial<SplitTasksResponse> = {}): SplitTasksResponse {
  return {
    tasks: [],
    progress: {
      total: 0, created: 0, running: 0, done: 0,
      failed: 0, cancelled: 0, skipped: 0,
      materialized: 0, retry_waiting: 0, exhausted: 0,
    },
    split_plan_generation: 2,
    submission_id: "submission-2",
    archive_status: "not_started",
    archive_error: "",
    ...overrides,
  };
}

function exhaustedResponse(): SplitTasksResponse {
  return response({
    tasks: [{
      id: "task-1", node_run_id: "run-node-1", title: "Build API", description: "",
      workflow_id: "child-wf", assignee_type: "member", assignee_id: "member-1",
      depends_on: [], sort_order: 0, status: "failed", issue_id: null, run_id: null,
      last_error: { code: "split_assignee_invalidated", message: "Assignee inactive", child_issue_id: null, workflow_run_id: null, node_run_id: null, occurred_at: "" },
      created_at: "", updated_at: "", materialize_retry_count: 4, materialize_next_attempt_at: null,
    }],
    progress: {
      total: 1, created: 0, running: 0, done: 0, failed: 1,
      cancelled: 0, skipped: 0, materialized: 0, retry_waiting: 0, exhausted: 1,
    },
  });
}

describe("SplitReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data = response();
    mocks.deliverableData = { deliverables: [], submissions: [] };
    mocks.sessionPermission = { can_observe: false };
    mocks.embedded = false;
    mocks.currentUserId = "reviewer-1";
  });

  it("shows the task-plan pull request number", () => {
    mocks.deliverableData = {
      deliverables: [{
        id: "deliverable-1",
        workflow_node_id: "node-1",
        title: "task.md",
        description: "Split plan",
        required: true,
        sort_order: 0,
        created_at: "",
        updated_at: "",
      }],
      submissions: [{
        id: "submission-2",
        workflow_node_run_id: "run-node-1",
        deliverable_id: "deliverable-1",
        submitted_by_type: "agent",
        submitted_by_id: "agent-1",
        status: "submitted",
        content: "",
        attachment_id: null,
        pull_request_url: "https://gitea.test/team/repo/pulls/42",
        pull_request_title: "Break work into implementation tasks",
        review_comment: "",
        submitted_at: "2026-08-03T10:00:00Z",
        reviewed_at: null,
        created_at: "",
        updated_at: "",
      }],
    };

    render(<SplitReviewPanel node={node} nodeRun={baseRun} issueDescription="Break the parent task into implementation units." wsId="ws-1" onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "PR#42" })).toBeInTheDocument();
    expect(screen.getByText("Break work into implementation tasks")).toBeInTheDocument();
    expect(screen.queryByText("task.md")).not.toBeInTheDocument();
    expect(screen.getByText("Break the parent task into implementation units.")).toBeInTheDocument();
  });

  it.each([
    ["there is no previous node", null],
    ["the previous node has no deliverable", { id: "previous-run", node_title: "Previous work" } as WorkflowNodeRun],
  ] as const)("hides the previous-deliverable section when %s", (_scenario, previousNodeRun) => {
    render(
      <SplitReviewPanel
        node={node}
        nodeRun={baseRun}
        previousNodeRun={previousNodeRun}
        wsId="ws-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Previous node deliverable")).not.toBeInTheDocument();
    expect(screen.queryByText("No previous deliverable")).not.toBeInTheDocument();
    expect(screen.getByText("Task description")).toBeInTheDocument();
    const description = screen.getByTestId("node-issue-description");
    expect(description).toHaveTextContent("No description");
    expect(description).not.toHaveClass("border", "bg-muted/40");
  });

  it("refetches deliverables when the node enters split review", () => {
    const { rerender } = render(
      <SplitReviewPanel
        node={node}
        nodeRun={{ ...baseRun, status: "splitting" }}
        wsId="ws-1"
        onClose={vi.fn()}
      />,
    );
    mocks.refetchDeliverables.mockClear();
    rerender(
      <SplitReviewPanel
        node={node}
        nodeRun={baseRun}
        wsId="ws-1"
        onClose={vi.fn()}
      />,
    );

    expect(mocks.refetchDeliverables).toHaveBeenCalledTimes(1);
  });

  it("approves the exact generation and submission", () => {
    render(<SplitReviewPanel node={node} nodeRun={baseRun} wsId="ws-1" workflowId="wf-1" runId="run-1" onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve snapshot" }));

    expect(mocks.approve).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: "run-node-1",
      request: { expected_split_generation: 2, expected_submission_id: "submission-2", review_comment: undefined },
    }), expect.any(Object));
  });

  it("hides review and plan-management actions from a non-reviewer", () => {
    mocks.currentUserId = "member-2";

    render(<SplitReviewPanel node={node} nodeRun={baseRun} wsId="ws-1" onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Approve snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel split" })).not.toBeInTheDocument();
  });

  it("hides reviewer actions when the configured critic is not human", () => {
    render(
      <SplitReviewPanel
        node={node}
        nodeRun={{ ...baseRun, critic_type: "agent" }}
        wsId="ws-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Approve snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).not.toBeInTheDocument();
  });

  it.each([
    ["awaiting_split_review", "Reviewing", "text-violet-500"],
    ["materializing", "In progress", "text-blue-500"],
    ["completed", "Completed", "text-green-500"],
  ] as const)("uses the node-card status presentation for %s", (status, label, iconClass) => {
    render(<SplitReviewPanel node={node} nodeRun={{ ...baseRun, status }} wsId="ws-1" onClose={vi.fn()} />);

    const badges = screen.getByTestId("split-panel-badges");
    expect(badges).toHaveTextContent(label);
    expect(within(badges).getByTestId("runtime-display-status-icon")).toHaveClass(iconClass);
  });

  it("does not render a footer when there are no available actions", () => {
    mocks.data = response({ split_plan_generation: 0, submission_id: null });
    render(<SplitReviewPanel node={node} nodeRun={{ ...baseRun, status: "splitting" }} wsId="ws-1" onClose={vi.fn()} />);

    expect(screen.queryByTestId("node-detail-panel-footer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More information" })).not.toBeInTheDocument();
  });

  it("shows validation details from a lightweight header hover card", async () => {
    const user = userEvent.setup();
    mocks.generate.mockImplementationOnce((_variables: unknown, options: { onError: (error: unknown) => void }) => {
      options.onError(new ApiError("Invalid split plan", 422, "Unprocessable Entity", {
        details: [{ line: 4, field: "assignee_id", message: "Choose an assignee" }],
      }));
    });

    render(<SplitReviewPanel node={node} nodeRun={baseRun} wsId="ws-1" onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Regenerate plan" }));

    const moreInformation = await screen.findByRole("button", { name: /More information/ });
    expect(screen.getByTestId("split-panel-badge-actions")).toContainElement(moreInformation);
    await user.hover(moreInformation);
    expect(await screen.findByText(/Choose an assignee/)).toBeInTheDocument();
  });

  it.each(["materializing", "blocked"] as const)("retries an exhausted materialization row while %s", (status) => {
    mocks.data = exhaustedResponse();
    render(<SplitReviewPanel node={node} nodeRun={{ ...baseRun, status }} wsId="ws-1" onClose={vi.fn()} />);

    const footer = screen.getByTestId("node-detail-panel-footer");
    expect(footer).not.toHaveTextContent("In progress");
    fireEvent.click(within(footer).getByRole("button", { name: "Retry" }));

    expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      request: { expected_split_generation: 2 },
    }), expect.any(Object));
  });

  it.each(["materializing", "blocked"] as const)("hides failed-task retry from a non-reviewer while %s", (status) => {
    mocks.currentUserId = "member-2";
    mocks.data = exhaustedResponse();

    render(<SplitReviewPanel node={node} nodeRun={{ ...baseRun, status }} wsId="ws-1" onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows View child issues directly in the footer", () => {
    const onViewChildren = vi.fn();
    render(
      <SplitReviewPanel
        node={node}
        nodeRun={{ ...baseRun, status: "split_active" }}
        wsId="ws-1"
        onClose={vi.fn()}
        onViewChildren={onViewChildren}
      />,
    );

    const footer = screen.getByTestId("node-detail-panel-footer");
    fireEvent.click(within(footer).getByRole("button", { name: "View child issues" }));
    expect(onViewChildren).toHaveBeenCalledOnce();
  });

  it("keeps split actions and Open session in one footer action row", () => {
    mocks.embedded = true;
    mocks.sessionPermission = { can_observe: true };

    render(
      <SplitReviewPanel
        node={node}
        nodeRun={{ ...baseRun, session_id: "session-1" }}
        wsId="ws-1"
        onClose={vi.fn()}
      />,
    );

    const actionRow = screen.getByTestId("split-node-action-toolbar");
    expect(actionRow).toHaveClass("flex", "flex-nowrap");
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Open session" }));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Regenerate plan" }));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Cancel split" }));
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(mocks.navigateToSession).toHaveBeenCalledWith({ sessionId: "session-1", newTab: true });
  });
});

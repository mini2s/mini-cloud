// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowNode,
  WorkflowNodeDeliverable,
  WorkflowNodeDeliverableSubmission,
  WorkflowNodeRun,
} from "@multica/core/types";
import { formatPullRequestLabel } from "../../../common/node-deliverable-drawer-ui";
import { TaskNodeDetailPanel } from "./task-node-detail-panel";

const mocks = vi.hoisted(() => ({
  reviewNodeRun: vi.fn(),
  reviewDeliverable: vi.fn(),
  uploadIssueDeliverable: vi.fn(),
  submitNodeRun: vi.fn(),
  invalidateQueries: vi.fn(),
  submitNodeRunAction: vi.fn(),
  skipNodeRun: vi.fn(),
  navigateToSession: vi.fn(),
  toastError: vi.fn(),
  sessionPermission: { can_observe: false },
  embedded: false,
}));

const makeCurrentData = (): {
  deliverables: WorkflowNodeDeliverable[];
  submissions: WorkflowNodeDeliverableSubmission[];
} => ({
  deliverables: [
    { id: "d1", workflow_node_id: "node-1", title: "api.md", description: "Design document · deliverable", required: true, sort_order: 0, created_at: "", updated_at: "" },
    { id: "d2", workflow_node_id: "node-1", title: "test-plan.md", description: "Test plan · deliverable", required: true, sort_order: 1, created_at: "", updated_at: "" },
  ],
  submissions: [
    { id: "s1", workflow_node_run_id: "run-1", deliverable_id: "d1", submitted_by_type: "agent", submitted_by_id: "agent-1", status: "submitted", content: "", attachment_id: "file-1", pull_request_url: "", review_comment: "", submitted_at: "2026-08-03T10:00:00Z", reviewed_at: null, created_at: "", updated_at: "" },
  ],
});

let currentData = makeCurrentData();

const makePreviousData = () => ({
  deliverables: [
    { id: "pd1", workflow_node_id: "previous", title: "task.md", description: "Split plan", required: true, sort_order: 0, created_at: "", updated_at: "" },
  ],
  submissions: [
    { id: "ps1", workflow_node_run_id: "previous-run", deliverable_id: "pd1", submitted_by_type: "system", submitted_by_id: null, status: "approved", content: "", attachment_id: null, pull_request_url: "https://gitea.test/pulls/0", review_comment: "", submitted_at: "2026-08-03T09:00:00Z", reviewed_at: "2026-08-03T09:30:00Z", created_at: "", updated_at: "" },
  ],
});

let previousData = makePreviousData();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { nodeRunId?: string }) => ({ data: options.nodeRunId === "previous-run" ? previousData : currentData }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: (options: { mutationFn: (approved: boolean) => Promise<void>; onSuccess?: () => Promise<void> }) => ({
    mutate: (approved: boolean) => void options.mutationFn(approved).then(() => options.onSuccess?.()),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  nodeRunDeliverableSubmissionsOptions: (_wsId: string, nodeRunId: string) => ({ nodeRunId }),
  workflowKeys: {
    nodeRunDeliverables: (id: string) => ["deliverables", id],
    nodeRuns: () => ["node-runs"],
    runCanvasSummary: () => ["summary"],
  },
  useSessionPermission: () => ({ data: mocks.sessionPermission }),
  useSubmitNodeRun: () => ({
    mutate: mocks.submitNodeRunAction,
    isPending: false,
    isError: false,
    error: null,
  }),
  useSkipNodeRun: () => ({
    mutate: mocks.skipNodeRun,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    reviewNodeRun: mocks.reviewNodeRun,
    reviewNodeRunDeliverable: mocks.reviewDeliverable,
    uploadIssueDeliverable: mocks.uploadIssueDeliverable,
    submitNodeRun: mocks.submitNodeRun,
  },
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mocks.embedded,
  postCostrictNavigateToSession: mocks.navigateToSession,
}));

vi.mock("../../../workflows/components/node-run-control-actions", () => ({
  NodeRunControlActions: ({ nodeRun }: { nodeRun: WorkflowNodeRun }) => nodeRun.runtime_id
    ? <button type="button">Runtime controls</button>
    : null,
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: mocks.toastError } }));

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: (resource: unknown) => string, values?: Record<string, string | number>) => {
      const labels: Record<string, string> = {
        task_drawer_eyebrow: "Task node",
        task_drawer_close: "Close task node",
        task_drawer_line_todo: "Submit documents and PR links.",
        task_drawer_line_running: "Worker is executing.",
        task_drawer_line_review: "Review in Gitea.",
        task_drawer_line_completed: "All deliverables approved.",
        task_drawer_critic: "Critic {{name}}",
        task_drawer_issue_description: "Task description",
        task_drawer_issue_description_empty: "No description",
        task_drawer_previous: "Previous node deliverable",
        task_drawer_previous_empty: "No previous deliverable",
        task_drawer_current_plain: "Current deliverables",
        task_drawer_current: "Current deliverables ({{count}})",
        task_drawer_deliverables_todo: "Submit a document or PR link",
        task_drawer_deliverables_todo_submitted: "{{count}} submitted",
        task_drawer_deliverables_running: "{{count}} submitted",
        task_drawer_deliverables_running_empty: "Nothing submitted yet",
        task_drawer_deliverables_review: "{{count}} deliverables to review",
        task_drawer_deliverables_completed: "{{count}} deliverables approved",
        task_drawer_empty: "No deliverables yet",
        task_drawer_document: "Document",
        task_drawer_pr: "PR",
        task_drawer_pull_request: "Pull request",
        task_drawer_merged: "merged",
        task_drawer_previous_hint: "View in Gitea",
        task_drawer_pending: "Not submitted",
        task_drawer_approved: "Approved",
        task_drawer_uploaded: "Uploaded",
        task_drawer_review_passed: "Review passed",
        task_drawer_wait_critic: "Awaiting Critic review",
        task_drawer_wait_submission: "Waiting for Worker",
        task_drawer_review_in_gitea: "Review in Gitea",
        task_drawer_merged_hint: "Approved · merged",
        task_drawer_submitted_at: "Submitted",
        task_drawer_submit_document: "Submit document",
        task_drawer_submit_link: "Submit link",
        task_drawer_link_placeholder: "Paste a PR link",
        task_drawer_confirm_link: "Confirm",
        task_drawer_submit_failed: "Failed to submit deliverables",
        task_drawer_submit_hint: "Each submission adds one item",
        task_drawer_submit_form_hint: "Choose a deliverable",
        task_drawer_more: "More information",
        task_drawer_runtime_info: "Runtime information",
        task_drawer_review_placeholder: "Review comment",
        task_drawer_rerun: "Run again",
        task_drawer_cancel: "Cancel execution",
        execution_summary: "Execution summary",
        submit_result: "Submit",
        upload_pr_invalid: "Enter a valid link",
        deliverables_section: "Deliverables",
        cancel: "Cancel",
        not_configured: "Not configured",
        approve: "Approve",
        reject: "Reject",
        pending: "Pending",
        todo: "Todo",
        in_progress: "In progress",
        reviewing: "Reviewing",
        completed: "Completed",
        failed: "Failed",
        blocked: "Blocked",
        cancelled: "Cancelled",
        task_drawer_rejected: "Rejected",
        task_drawer_submitted: "Submitted",
        task_drawer_review_rejected: "Review rejected",
        worker_output: "Worker output",
        critic_output: "Critic output",
        critic_comment: "Critic comment",
        completed_at: "Completed",
        error: "Error",
        no_output: "No output",
        open_session: "Open session",
        open_session_missing: "No session bound",
        open_session_denied: "No permission to view this session",
        open_session_unavailable: "Session unavailable",
        task_drawer_retry: "Retry",
        skip_node: "Skip node",
        skip_dialog_title: "Skip this node?",
        skip_dialog_description: "This node will be marked as skipped.",
        skip_dialog_cancel: "Cancel",
        skip_dialog_confirm: "Confirm skip",
      };
      const proxy = new Proxy({}, { get: (_target, property: string) => labels[property] ?? property });
      const value = selector({
        execution: { detail_panel: proxy, card: { actions: proxy }, display_status: proxy },
        node_run: { deliverables: proxy },
      });
      return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

const node = {
  id: "node-1",
  title: "Implement notification API",
  worker_type: "agent",
  critic_type: "human",
} as WorkflowNode;

const run = {
  id: "run-1",
  workflow_node_id: "node-1",
  node_title: node.title,
  status: "working",
  worker_type: "agent",
  critic_type: "human",
  retry_count: 1,
  worker_output: { summary: "API draft complete" },
  critic_output: null,
  critic_comment: "",
  started_at: "2026-08-03T10:00:00Z",
  completed_at: null,
} as WorkflowNodeRun;

const previousRun = { id: "previous-run", node_title: "Split notification work" } as WorkflowNodeRun;

describe("TaskNodeDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentData = makeCurrentData();
    previousData = makePreviousData();
    mocks.sessionPermission = { can_observe: false };
    mocks.embedded = false;
    mocks.reviewNodeRun.mockResolvedValue({});
    mocks.reviewDeliverable.mockResolvedValue({});
    mocks.uploadIssueDeliverable.mockResolvedValue({ ok: true });
    mocks.submitNodeRun.mockResolvedValue({});
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.navigateToSession.mockReturnValue(true);
  });

  it.each([
    ["https://gitea.test/team/repo/pulls/3", "PR#3"],
    ["https://github.com/multica-ai/multica/pull/192", "PR#192"],
    ["https://gitlab.test/team/repo/-/merge_requests/27", "PR#27"],
    ["https://bitbucket.test/team/repo/pull-requests/8?tab=diff", "PR#8"],
    ["not-a-pull-request", "Pull request"],
  ])("formats pull request link %s as %s", (url, expected) => {
    expect(formatPullRequestLabel(url, "Pull request")).toBe(expected);
  });

  it("renders the canonical 620px running task drawer", async () => {
    const user = userEvent.setup();
    render(<TaskNodeDetailPanel node={node} nodeRun={run} previousNodeRun={previousRun} issueDescription="Implement the notification endpoint." workerName="worker-claude" criticName="critic-gpt" onClose={vi.fn()} wsId="ws-1" />);

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveClass("w-[620px]");
    expect(screen.getByText("Task node")).toBeInTheDocument();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(screen.getByText("Implement the notification endpoint.")).toBeInTheDocument();
    const sectionHeadings = screen.getAllByRole("heading", { level: 3 });
    expect(sectionHeadings[0]).toHaveTextContent("Task description");
    expect(sectionHeadings[1]).toHaveTextContent("Previous node deliverable");
    expect(screen.getByText("Split notification work")).toBeInTheDocument();
    expect(screen.getByText("Current deliverables (1)")).toBeInTheDocument();
    expect(screen.getByText("api.md")).toBeInTheDocument();
    expect(screen.queryByText("Not submitted")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel execution" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-detail-panel-footer")).not.toBeInTheDocument();

    const moreInformation = screen.getByRole("button", { name: "More information" });
    expect(screen.getByTestId("node-detail-panel-badge-actions")).toContainElement(moreInformation);
    await user.hover(moreInformation);
    expect(await screen.findByText("Runtime information")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Cancel execution" })).not.toBeInTheDocument();
  });

  it("shows the submission title instead of the deliverable definition title", () => {
    currentData = {
      deliverables: [{
        id: "d1",
        workflow_node_id: "node-1",
        title: "generic-deliverable.md",
        description: "",
        required: true,
        sort_order: 0,
        created_at: "",
        updated_at: "",
      }],
      submissions: [{
        ...makeCurrentData().submissions[0]!,
        pull_request_title: "Implement notification endpoint",
      }],
    };

    render(<TaskNodeDetailPanel node={node} nodeRun={run} workerName="worker" criticName="critic" onClose={vi.fn()} wsId="ws-1" />);

    expect(screen.getByText("Implement notification endpoint")).toBeInTheDocument();
    expect(screen.queryByText("generic-deliverable.md")).not.toBeInTheDocument();
  });

  it.each([
    ["there is no previous node", null],
    ["the previous node has no deliverable", previousRun],
  ] as const)("hides the previous-deliverable section when %s", (_scenario, previousNodeRun) => {
    if (previousNodeRun) previousData = { deliverables: [], submissions: [] };

    render(
      <TaskNodeDetailPanel
        node={node}
        nodeRun={run}
        previousNodeRun={previousNodeRun}
        workerName="worker"
        criticName="critic"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.queryByText("Previous node deliverable")).not.toBeInTheDocument();
    expect(screen.queryByText("No previous deliverable")).not.toBeInTheDocument();
  });

  it("shows plain fallback text when the task description is missing", () => {
    render(
      <TaskNodeDetailPanel
        node={node}
        nodeRun={run}
        workerName="worker"
        criticName="critic"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByText("Task description")).toBeInTheDocument();
    const description = screen.getByTestId("node-issue-description");
    expect(description).toHaveTextContent("No description");
    expect(description).not.toHaveClass("border", "bg-muted/40");
  });

  it("keeps the summary and submission actions docked in the footer for a human worker", () => {
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human" }}
        previousNodeRun={previousRun}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit link" })).toBeInTheDocument();
    expect(screen.getByTestId("node-run-delivery-form")).toBeInTheDocument();
    expect(screen.getByTestId("node-detail-panel-footer"))
      .toContainElement(screen.getByTestId("node-run-delivery-form"));
    expect(screen.getByRole("textbox", { name: "Execution summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("opens the native file picker directly from Submit document", () => {
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human" }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    const fileInput = screen.getByTestId("task-delivery-file-input") as HTMLInputElement;
    const openPicker = vi.spyOn(fileInput, "click");

    fireEvent.click(screen.getByRole("button", { name: "Submit document" }));

    expect(openPicker).toHaveBeenCalledOnce();
  });

  it("shows an inline link editor that can be confirmed or cancelled", () => {
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human" }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    const actions = within(screen.getByTestId("task-delivery-actions"));
    fireEvent.click(actions.getByRole("button", { name: "Submit link" }));

    const linkInput = actions.getByRole("textbox", { name: "Submit link" });
    fireEvent.change(linkInput, { target: { value: "https://gitea.test/pulls/42" } });
    fireEvent.click(actions.getByRole("button", { name: "Confirm" }));

    expect(actions.queryByRole("textbox", { name: "Submit link" })).not.toBeInTheDocument();
    expect(actions.getByText("https://gitea.test/pulls/42")).toBeInTheDocument();

    fireEvent.click(actions.getByRole("button", { name: "Submit link" }));
    fireEvent.change(actions.getByRole("textbox", { name: "Submit link" }), {
      target: { value: "https://gitea.test/pulls/43" },
    });
    fireEvent.click(actions.getByRole("button", { name: "Cancel" }));

    expect(actions.queryByRole("textbox", { name: "Submit link" })).not.toBeInTheDocument();
    expect(actions.queryByText("https://gitea.test/pulls/43")).not.toBeInTheDocument();
  });

  it("submits a confirmed link from the persistent footer", async () => {
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human" }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    const actions = within(screen.getByTestId("task-delivery-actions"));
    fireEvent.click(actions.getByRole("button", { name: "Submit link" }));
    fireEvent.change(actions.getByRole("textbox", { name: "Submit link" }), {
      target: { value: "https://gitea.test/pulls/42" },
    });
    fireEvent.click(actions.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mocks.uploadIssueDeliverable).toHaveBeenCalledWith(
        "issue-1",
        [],
        undefined,
        "d1",
        ["https://gitea.test/pulls/42"],
      );
    });
    expect(mocks.submitNodeRun).not.toHaveBeenCalled();
  });

  it("reviews every submitted deliverable before approving the node", async () => {
    render(<TaskNodeDetailPanel node={node} nodeRun={{ ...run, status: "awaiting_critic" }} previousNodeRun={previousRun} workerName="worker-claude" criticName="critic-gpt" onClose={vi.fn()} wsId="ws-1" mayReview />);

    fireEvent.change(screen.getByPlaceholderText("Review comment"), { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(mocks.reviewDeliverable).toHaveBeenCalledWith("run-1", "s1", {
      status: "approved",
      review_comment: "Looks good",
    });
    await waitFor(() => {
      expect(mocks.reviewNodeRun).toHaveBeenCalledWith("run-1", true, "Looks good");
    });
  });

  it("shows approved deliverables in the completed state", () => {
    render(<TaskNodeDetailPanel node={node} nodeRun={{ ...run, status: "completed", completed_at: "2026-08-03T10:20:00Z" }} previousNodeRun={previousRun} workerName="worker-claude" criticName="critic-gpt" onClose={vi.fn()} wsId="ws-1" />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getAllByText("Approved")).toHaveLength(1);
    expect(screen.queryByText("All 1 deliverables were approved")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-detail-panel-footer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run again" })).not.toBeInTheDocument();
  });

  it.each([
    ["critic_reviewing", "Reviewing", "text-violet-500"],
    ["critic_rework", "Blocked", "text-red-500"],
    ["skipped", "Cancelled", "text-muted-foreground"],
  ] as const)("uses the node-card status presentation for %s", (status, label, iconClass) => {
    render(
      <TaskNodeDetailPanel
        node={node}
        nodeRun={{ ...run, status }}
        workerName="worker-claude"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("runtime-display-status-icon")[0]).toHaveClass(iconClass);
  });

  it("lets a human worker submit a summary when the node has no deliverables", () => {
    currentData = { deliverables: [], submissions: [] };
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{ ...run, status: "worker_assigned", worker_type: "human", worker_id: "user-1" }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        issueId="issue-1"
        workflowId="workflow-1"
        runId="workflow-run-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Execution summary" }), {
      target: { value: "No artifact was required" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(mocks.submitNodeRunAction).toHaveBeenCalledWith({
      nodeRunId: "run-1",
      workflowId: "workflow-1",
      runId: "workflow-run-1",
      output: { summary: "No artifact was required" },
    });
  });

  it("restores skip and runtime controls from the previous task drawer", () => {
    currentData = { deliverables: [], submissions: [] };
    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{
          ...run,
          status: "blocked",
          worker_type: "human",
          worker_id: "user-1",
          runtime_id: "runtime-1",
        }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        workflowId="workflow-1"
        runId="workflow-run-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Skip node" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Runtime controls" })).toBeInTheDocument();
  });

  it("keeps node controls and Open session in one footer action row", () => {
    mocks.embedded = true;
    mocks.sessionPermission = { can_observe: true };
    currentData = { deliverables: [], submissions: [] };

    render(
      <TaskNodeDetailPanel
        node={{ ...node, worker_type: "human" }}
        nodeRun={{
          ...run,
          status: "blocked",
          worker_type: "human",
          worker_id: "user-1",
          runtime_id: "runtime-1",
          session_id: "session-1",
        }}
        workerName="human-worker"
        criticName="critic-gpt"
        onClose={vi.fn()}
        wsId="ws-1"
        currentUserId="user-1"
        currentMember={{ role: "member", status: "active" }}
      />,
    );

    const actionRow = screen.getByTestId("node-run-action-toolbar");
    expect(actionRow).toHaveClass("flex", "flex-nowrap");
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Skip node" }));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Runtime controls" }));
    expect(actionRow).toContainElement(screen.getByRole("button", { name: "Open session" }));
  });

  it("keeps Open session visible and toasts the reason when entry is blocked", () => {
    mocks.embedded = true;
    const sessionRun = { ...run, session_id: "session-1" };
    const first = render(
      <TaskNodeDetailPanel node={node} nodeRun={sessionRun} workerName="worker" criticName="critic" onClose={vi.fn()} wsId="ws-1" />,
    );
    const deniedButton = screen.getByRole("button", { name: "Open session" });
    fireEvent.click(deniedButton);
    expect(mocks.navigateToSession).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("No permission to view this session");
    first.unmount();

    mocks.sessionPermission = { can_observe: true };
    render(
      <TaskNodeDetailPanel node={node} nodeRun={sessionRun} workerName="worker" criticName="critic" onClose={vi.fn()} wsId="ws-1" />,
    );
    const footer = screen.getByTestId("node-detail-panel-footer");
    const openSession = within(footer).getByRole("button", { name: "Open session" });
    fireEvent.click(openSession);
    expect(mocks.navigateToSession).toHaveBeenCalledWith({ sessionId: "session-1", newTab: true });
  });

  it("shows Retry directly in the footer instead of More information", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <TaskNodeDetailPanel
        node={node}
        nodeRun={{ ...run, status: "failed" }}
        workerName="worker"
        criticName="critic"
        onClose={vi.fn()}
        onRetry={onRetry}
        wsId="ws-1"
      />,
    );

    const footer = screen.getByTestId("node-detail-panel-footer");
    fireEvent.click(within(footer).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    await user.hover(screen.getByRole("button", { name: "More information" }));
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("keeps rejected submissions and complete runtime diagnostics visible", async () => {
    const user = userEvent.setup();
    currentData = {
      ...makeCurrentData(),
      submissions: [{
        ...makeCurrentData().submissions[0]!,
        status: "rejected",
        review_comment: "Needs a regression test",
      }],
    };
    render(
      <TaskNodeDetailPanel
        node={node}
        nodeRun={{
          ...run,
          status: "failed",
          worker_output: { error: "worker failed", summary: "worker details" },
          critic_output: { message: "critic details" },
          critic_comment: "Please revise",
          completed_at: "2026-08-03T10:20:00Z",
        }}
        workerName="worker"
        criticName="critic"
        onClose={vi.fn()}
        wsId="ws-1"
      />,
    );

    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Needs a regression test")).toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "More information" }));
    await screen.findByText("Worker output");
    expect(screen.getByText("Worker output")).toBeInTheDocument();
    expect(screen.getByText("Critic output")).toBeInTheDocument();
    expect(screen.getByText("Critic comment")).toBeInTheDocument();
    expect(screen.getByText("Please revise")).toBeInTheDocument();
    expect(screen.getAllByText("worker failed").length).toBeGreaterThan(0);
  });
});

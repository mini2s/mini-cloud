// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { formatPullRequestLabel } from "../../../common/node-deliverable-drawer-ui";
import { TaskNodeDetailPanel } from "./task-node-detail-panel";

const mocks = vi.hoisted(() => ({
  reviewNodeRun: vi.fn(),
  reviewDeliverable: vi.fn(),
  uploadIssueDeliverable: vi.fn(),
  submitNodeRun: vi.fn(),
  invalidateQueries: vi.fn(),
}));

const currentData = {
  deliverables: [
    { id: "d1", workflow_node_id: "node-1", title: "api.md", description: "Design document · deliverable", required: true, sort_order: 0, created_at: "", updated_at: "" },
    { id: "d2", workflow_node_id: "node-1", title: "test-plan.md", description: "Test plan · deliverable", required: true, sort_order: 1, created_at: "", updated_at: "" },
  ],
  submissions: [
    { id: "s1", workflow_node_run_id: "run-1", deliverable_id: "d1", submitted_by_type: "agent", submitted_by_id: "agent-1", status: "submitted", content: "", attachment_id: "file-1", pull_request_url: null, review_comment: "", submitted_at: "2026-08-03T10:00:00Z", reviewed_at: null, created_at: "", updated_at: "" },
  ],
};

const previousData = {
  deliverables: [
    { id: "pd1", workflow_node_id: "previous", title: "task.md", description: "Split plan", required: true, sort_order: 0, created_at: "", updated_at: "" },
  ],
  submissions: [
    { id: "ps1", workflow_node_run_id: "previous-run", deliverable_id: "pd1", submitted_by_type: "system", submitted_by_id: null, status: "approved", content: "", attachment_id: null, pull_request_url: "https://gitea.test/pulls/0", review_comment: "", submitted_at: "2026-08-03T09:00:00Z", reviewed_at: "2026-08-03T09:30:00Z", created_at: "", updated_at: "" },
  ],
};

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
  isEmbeddedInCostrict: () => false,
  postCostrictNavigateToSession: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (selector: (resource: unknown) => string, values?: Record<string, string | number>) => {
      const labels: Record<string, string> = {
        task_drawer_eyebrow: "Task node",
        task_drawer_close: "Close task node",
        task_drawer_status_todo: "To do",
        task_drawer_status_running: "Running",
        task_drawer_status_review: "Awaiting review",
        task_drawer_status_completed: "Completed",
        task_drawer_line_todo: "Submit documents and PR links.",
        task_drawer_line_running: "Worker is executing.",
        task_drawer_line_review: "Review in Gitea.",
        task_drawer_line_completed: "All deliverables approved.",
        task_drawer_critic: "Critic {{name}}",
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
        task_drawer_more: "More operations",
        task_drawer_review_placeholder: "Review comment",
        task_drawer_footer_running: "Worker is executing…",
        task_drawer_footer_completed: "All {{count}} deliverables were approved",
        task_drawer_rerun: "Run again",
        execution_summary: "Execution summary",
        submit_result: "Submit",
        upload_pr_invalid: "Enter a valid link",
        deliverables_section: "Deliverables",
        cancel: "Cancel",
        not_configured: "Not configured",
        approve: "Approve",
        reject: "Reject",
      };
      const proxy = new Proxy({}, { get: (_target, property: string) => labels[property] ?? property });
      const value = selector({
        execution: { detail_panel: proxy, card: { actions: proxy } },
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
    mocks.reviewNodeRun.mockResolvedValue({});
    mocks.reviewDeliverable.mockResolvedValue({});
    mocks.uploadIssueDeliverable.mockResolvedValue({ ok: true });
    mocks.submitNodeRun.mockResolvedValue({});
    mocks.invalidateQueries.mockResolvedValue(undefined);
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

  it("renders the canonical 620px running task drawer", () => {
    render(<TaskNodeDetailPanel node={node} nodeRun={run} previousNodeRun={previousRun} workerName="worker-claude" criticName="critic-gpt" onClose={vi.fn()} wsId="ws-1" />);

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveClass("w-[620px]");
    expect(screen.getByText("Task node")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Split notification work")).toBeInTheDocument();
    expect(screen.getByText("Current deliverables (1)")).toBeInTheDocument();
    expect(screen.getByText("api.md")).toBeInTheDocument();
    expect(screen.queryByText("Not submitted")).not.toBeInTheDocument();
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
    expect(screen.getByText("All 1 deliverables were approved")).toBeInTheDocument();
  });
});

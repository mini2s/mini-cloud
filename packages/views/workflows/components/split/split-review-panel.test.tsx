// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  deliverableData: {
    deliverables: [] as WorkflowNodeDeliverable[],
    submissions: [] as WorkflowNodeDeliverableSubmission[],
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { kind?: string }) => ({
    data: options.kind === "split" ? mocks.data : mocks.deliverableData,
    isLoading: false,
  }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  splitTasksOptions: () => ({ kind: "split" }),
  nodeRunDeliverableSubmissionsOptions: () => ({ kind: "deliverables" }),
  useApproveSplitTasks: () => ({ mutate: mocks.approve, isPending: false }),
  useRejectSplitTasks: () => ({ mutate: mocks.reject, isPending: false }),
  useGenerateSplitTasks: () => ({ mutate: mocks.generate, isPending: false }),
  useRetrySplitTask: () => ({ mutate: mocks.retry, isPending: false }),
  useCancelSplitNode: () => ({ mutate: mocks.cancel, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@multica/views/i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: { detail_panel: Record<string, string> }) => string,
      values?: Record<string, string | number>,
    ) => {
      const resources = {
        detail_panel: new Proxy({
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
          split_drawer_more: "More operations",
        } as Record<string, string>, {
          get: (target, property: string) => target[property] ?? property,
        }),
      };
      return selector(resources).replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values?.[key] ?? ""));
    },
  }),
}));

vi.mock("../../../common/workflow-node-detail-panel-shell", () => ({
  WorkflowNodeDetailPanelShell: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>{children}{footer}</div>
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

describe("SplitReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.data = response();
    mocks.deliverableData = { deliverables: [], submissions: [] };
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
        review_comment: "",
        submitted_at: "2026-08-03T10:00:00Z",
        reviewed_at: null,
        created_at: "",
        updated_at: "",
      }],
    };

    render(<SplitReviewPanel node={node} nodeRun={baseRun} wsId="ws-1" onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "PR#42" })).toBeInTheDocument();
  });

  it("approves the exact generation and submission", () => {
    render(<SplitReviewPanel node={node} nodeRun={baseRun} wsId="ws-1" workflowId="wf-1" runId="run-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve snapshot" }));

    expect(mocks.approve).toHaveBeenCalledWith(expect.objectContaining({
      nodeRunId: "run-node-1",
      request: { expected_split_generation: 2, expected_submission_id: "submission-2", review_comment: undefined },
    }), expect.any(Object));
  });

  it("shows an exhausted row after node failure and retries only that row", () => {
    mocks.data = response({
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
    render(<SplitReviewPanel node={node} nodeRun={{ ...baseRun, status: "materializing" }} wsId="ws-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /More operations/ }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mocks.retry).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      request: { expected_split_generation: 2 },
    }), expect.any(Object));
  });
});

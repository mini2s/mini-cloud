// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { WorkflowRunPage } from "./workflow-run-page";

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  nodes: [] as unknown[],
  edges: [] as unknown[],
  nodeRuns: [] as unknown[],
  resolutions: [] as unknown[],
  members: [] as unknown[],
  cancelMutate: vi.fn(),
  reviewMutate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key.includes("run")) return { data: mocks.run, isLoading: false };
    if (key.includes("nodes")) return { data: mocks.nodes, isLoading: false };
    if (key.includes("edges")) return { data: mocks.edges, isLoading: false };
    if (key.includes("node-runs")) return { data: mocks.nodeRuns, isLoading: false };
    if (key.includes("role-resolutions")) return { data: mocks.resolutions, isLoading: false };
    if (key.includes("members")) return { data: mocks.members, isLoading: false };
    return { data: undefined, isLoading: false };
  },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "user-1" } }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["workspaces", "members"] }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowRunOptions: (_wsId: string, workflowId: string, runId: string) => ({
    queryKey: ["workflows", workflowId, runId, "run"],
  }),
  workflowNodesOptions: () => ({ queryKey: ["workflows", "nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["workflows", "edges"] }),
  workflowNodeRunsOptions: () => ({ queryKey: ["workflows", "node-runs"] }),
  nodeRunDeliverableSubmissionsOptions: () => ({ queryKey: ["workflows", "node-run-deliverables"] }),
  workflowRoleResolutionsOptions: () => ({ queryKey: ["workflows", "role-resolutions"] }),
  useAssignWorkflowRoleResolutions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryWorkflowRoleResolutions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelWorkflowRun: () => ({ mutate: mocks.cancelMutate, isPending: false }),
  useSubmitNodeRun: () => ({ mutate: vi.fn(), isPending: false }),
  useReviewNodeRun: () => ({ mutate: mocks.reviewMutate, isPending: false }),
  useSkipNodeRun: () => ({ mutate: vi.fn(), isPending: false }),
  useSessionPermission: () => ({ data: { can_control: false } }),
  useTakeoverNodeRun: () => ({ mutate: vi.fn(), isPending: false }),
  useHandbackNodeRun: () => ({ mutate: vi.fn(), isPending: false }),
  useFinalizeNodeRun: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatSessionsOptions: () => ({ queryKey: ["chat-sessions"] }),
}));

vi.mock("@multica/core/runtimes/queries", () => ({
  myRuntimePermissionOptions: () => ({ queryKey: ["runtime-permission"] }),
}));

vi.mock("@multica/core/permissions", () => ({
  useNodeRunControlPermission: () => ({ allowed: false }),
}));

vi.mock("@multica/core/chat", () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ setActiveSession: vi.fn(), setOpen: vi.fn() }),
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => false,
  postCostrictNavigateToSession: vi.fn(),
}));

vi.mock("@multica/core/issues/mutations", () => ({
  useUploadIssueDeliverable: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../../layout/page-header", () => ({
  PageHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("./dag-canvas", () => ({
  DAGCanvas: ({ onNodeClick, nodeStatuses }: {
    onNodeClick?: (nodeId: string) => void;
    nodeStatuses?: Record<string, { status: string }>;
  }) => (
    <div>
      <span data-testid="canvas-status">{nodeStatuses?.["split-node"]?.status}</span>
      <button type="button" onClick={() => onNodeClick?.("split-node")}>
        Open canvas split
      </button>
    </div>
  ),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./split/split-review-panel", () => ({
  SplitReviewPanel: ({ nodeRun, onClose }: { nodeRun: { status: string } | null; onClose: () => void }) => (
    <div data-testid="workflow-run-split-panel">
      <span>{nodeRun?.status ?? "no-run"}</span>
      <button type="button" onClick={onClose}>Close split panel</button>
    </div>
  ),
}));

vi.mock("../../i18n", () => {
  const translations = {
    detail: { not_found: "Not found", no_nodes: "No nodes" },
    run: { status: { running: "Running" }, cancel: "Cancel run", cancelling: "Cancelling" },
    cancel_dialog: {
      title: "Cancel workflow run?",
      description: "This will stop unfinished node runs and cancel active child tasks.",
      keep: "Keep running",
      confirm: "Confirm cancel",
    },
    node_run: {
      status: {
        split_active: "Split Active",
        awaiting_split_review: "Awaiting Split Review",
      },
      retry_count: "{{current}}/{{max}}",
      worker_output: "Worker Output",
      submit: "Submit",
      submitting: "Submitting",
      approve: "Approve",
      request_rework: "Request rework",
      skip: "Skip",
      review_comment_placeholder: "Review comment",
      split_details: "Open split details",
      deliverables: {
        heading: "Deliverable PRs",
        pull_request_label: "Pull request",
        upload_button: "Upload deliverable",
        upload_heading: "Submit a document",
        upload_placeholder: "markdown",
        upload_submit: "Submit",
        uploading: "Submitting",
      },
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const splitNode = {
  id: "split-node",
  workflow_id: "wf-1",
  title: "Split node",
  description: "",
  position_x: 0,
  position_y: 0,
  format_schema: { type: "split", split_config: { mode: "barrier", max_concurrency: 3, max_failures: 0 } },
  worker_type: "agent",
  worker_id: null,
  critic_type: "human",
  critic_id: null,
  critic_api_url: null,
  sort_order: 0,
  stage_id: null,
  created_at: "",
  updated_at: "",
};

const splitNodeRun = {
  id: "node-run-1",
  workflow_run_id: "run-1",
  workflow_node_id: "split-node",
  node_title: "Split node",
  status: "split_active",
  retry_count: 0,
  worker_type: "agent",
  worker_id: null,
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

describe("WorkflowRunPage", () => {
  beforeEach(() => {
    mocks.run = {
      id: "run-1",
      workflow_id: "wf-1",
      workspace_id: "ws-1",
      workflow_title: "Workflow",
      status: "running",
      triggered_by_type: "member",
      triggered_by_id: null,
      input: null,
      output: null,
      started_at: "",
      completed_at: null,
      created_at: "",
    };
    mocks.nodes = [splitNode];
    mocks.edges = [];
    mocks.nodeRuns = [splitNodeRun];
    mocks.cancelMutate.mockReset();
    mocks.reviewMutate.mockReset();
  });

  it("localizes split node run status on the canvas", () => {
    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    expect(screen.getByTestId("canvas-status")).toHaveTextContent("Split Active");
    expect(screen.queryByText("split_active")).not.toBeInTheDocument();
  });

  it("opens split review panel from the canvas split node", () => {
    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Open canvas split" }));

    expect(screen.getByTestId("workflow-run-split-panel")).toHaveTextContent("split_active");
  });

  it("opens split review panel from the node run list split entry", () => {
    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Open split details" }));

    expect(screen.getByTestId("workflow-run-split-panel")).toHaveTextContent("split_active");
  });

  it("confirms before cancelling a running workflow run", () => {
    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    expect(mocks.cancelMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Cancel workflow run?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(mocks.cancelMutate).toHaveBeenCalledWith({ workflowId: "wf-1", runId: "run-1" });
  });

  it("shows human deliverable upload and review actions for direct issue runs", () => {
    mocks.run = {
      ...(mocks.run as Record<string, unknown>),
      input: { issue_id: "issue-1" },
    };
    mocks.nodeRuns = [{
      ...splitNodeRun,
      status: "critic_reviewing",
      worker_type: "human",
      worker_output: { pull_request_url: "http://localhost:23000/t-demo/deliverable-archive/pulls/1" },
    }];

    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    expect(screen.getByRole("button", { name: "Upload deliverable" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Review comment"), {
      target: { value: "Looks good" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(mocks.reviewMutate).toHaveBeenCalledWith({
      nodeRunId: "node-run-1",
      approved: true,
      comment: "Looks good",
      workflowId: "wf-1",
      runId: "run-1",
    });
  });
});

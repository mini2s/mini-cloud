// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { WorkflowRunPage } from "./workflow-run-page";

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  nodeRuns: [] as unknown[],
  resolutions: [] as unknown[],
  members: [] as unknown[],
  cancelMutate: vi.fn(),
  executionPanoramaProps: null as null | {
    workflowId: string;
    runId: string | null;
    wsId: string;
    issueId?: string;
    fillAvailableHeight?: boolean;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key.includes("run")) return { data: mocks.run, isLoading: false };
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
  workflowNodeRunsOptions: () => ({ queryKey: ["workflows", "node-runs"] }),
  workflowRoleResolutionsOptions: () => ({ queryKey: ["workflows", "role-resolutions"] }),
  useAssignWorkflowRoleResolutions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryWorkflowRoleResolutions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelWorkflowRun: () => ({ mutate: mocks.cancelMutate, isPending: false }),
}));

vi.mock("../../layout/page-header", () => ({
  PageHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("./dag-canvas", () => ({
  DAGCanvas: () => <div data-testid="legacy-dag-canvas" />,
}));

vi.mock("./node-run-card", () => ({
  NodeRunCard: () => <div data-testid="legacy-node-run-card" />,
}));

vi.mock("../../issues/components/execution", () => ({
  ExecutionPanoramaPage: (props: NonNullable<typeof mocks.executionPanoramaProps>) => {
    mocks.executionPanoramaProps = props;
    return <div data-testid="execution-panorama" />;
  },
}));

vi.mock("../../i18n", () => {
  const translations = {
    detail: { not_found: "Not found", no_nodes: "No nodes" },
    run: {
      status: { running: "Running" },
      cancel: "Cancel run",
      cancelling: "Cancelling",
      historical_config_incomplete: "Historical configuration may be incomplete",
    },
    cancel_dialog: {
      title: "Cancel workflow run?",
      description: "This will stop unfinished node runs and cancel active child tasks.",
      keep: "Keep running",
      confirm: "Confirm cancel",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

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
    mocks.nodeRuns = [];
    mocks.cancelMutate.mockReset();
    mocks.executionPanoramaProps = null;
  });

  it("renders the shared execution panorama with run context", () => {
    mocks.run = {
      ...(mocks.run as Record<string, unknown>),
      input: { issue_id: "issue-1" },
    };

    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    expect(screen.getByTestId("execution-panorama")).toBeInTheDocument();
    expect(mocks.executionPanoramaProps).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
      wsId: "ws-1",
      issueId: "issue-1",
      fillAvailableHeight: true,
    });
    expect(screen.queryByTestId("legacy-dag-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-node-run-card")).not.toBeInTheDocument();
  });

  it("omits a malformed issue id from the panorama context", () => {
    mocks.run = {
      ...(mocks.run as Record<string, unknown>),
      input: { issue_id: 42 },
    };

    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    expect(mocks.executionPanoramaProps).toEqual(expect.objectContaining({
      issueId: undefined,
    }));
  });

  it("marks a legacy run whose historical configuration is incomplete", () => {
    mocks.run = {
      ...(mocks.run as Record<string, unknown>),
      definition_schema_version: 0,
      definition_snapshot: null,
    };

    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    expect(screen.getByText("Historical configuration may be incomplete")).toBeInTheDocument();
  });

  it("confirms before cancelling a running workflow run", () => {
    render(<WorkflowRunPage workflowId="wf-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    expect(mocks.cancelMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Cancel workflow run?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));

    expect(mocks.cancelMutate).toHaveBeenCalledWith({ workflowId: "wf-1", runId: "run-1" });
  });

});

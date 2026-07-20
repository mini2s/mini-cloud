// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@multica/core/api";
import { WorkflowRunPage } from "./workflow-run-page";

const mocks = vi.hoisted(() => ({
  run: {} as Record<string, unknown>,
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  nodeRuns: [] as Array<Record<string, unknown>>,
  resolutions: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  assign: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  refetchResolutions: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey[0];
    if (key === "run") return { data: mocks.run, isLoading: false };
    if (key === "nodes") return { data: mocks.nodes, isLoading: false };
    if (key === "edges") return { data: mocks.edges, isLoading: false };
    if (key === "node-runs") return { data: mocks.nodeRuns, isLoading: false };
    if (key === "resolutions") return { data: mocks.resolutions, refetch: mocks.refetchResolutions };
    if (key === "members") return { data: mocks.members };
    return { data: [] };
  },
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "owner-1" } }),
}));
vi.mock("@multica/core/workspace/queries", () => ({ memberListOptions: () => ({ queryKey: ["members"] }) }));
vi.mock("@multica/core/workflows/queries", () => ({
  workflowRunOptions: () => ({ queryKey: ["run"] }),
  workflowNodesOptions: () => ({ queryKey: ["nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["edges"] }),
  workflowNodeRunsOptions: () => ({ queryKey: ["node-runs"] }),
  workflowRoleResolutionsOptions: () => ({ queryKey: ["resolutions"] }),
  useAssignWorkflowRoleResolutions: () => ({ mutateAsync: mocks.assign, isPending: false }),
  useRetryWorkflowRoleResolutions: () => ({ mutateAsync: mocks.retry, isPending: false }),
  useCancelWorkflowRun: () => ({ mutate: mocks.cancel, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("../../layout/page-header", () => ({ PageHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
vi.mock("./dag-canvas", () => ({ DAGCanvas: () => <div>Canvas</div> }));
vi.mock("./node-run-card", () => ({ NodeRunCard: () => <div>Node run</div> }));
vi.mock("@xyflow/react", () => ({ ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

vi.mock("../../i18n", () => {
  const translations = {
    detail: { not_found: "Not found", no_nodes: "No nodes" },
    node_run: { status: {} },
    run: {
      status: { resolving_roles: "Resolving roles", waiting_role_assignment: "Waiting", running: "Running" },
      cancelling: "Cancelling", cancel: "Cancel", node_runs: "Node runs",
      roles: {
        resolving: "Resolving workflow roles", waiting: "Waiting for role assignment",
        invalidated: "A member is no longer active", title: "Role assignments", retry: "Retry",
        retry_started: "Retry started", retry_failed: "Retry failed", unknown_node: "Unknown node",
        worker: "Worker", critic: "Critic", status: { pending: "Pending", resolved: "Resolved", needs_human: "Needs human", invalidated: "Invalidated" },
        select_member: "Select member", assigned_to: "Assigned", reason: "Reason",
        notification_failed: "Notification failed", assigning: "Assigning",
        assign_continue: "Confirm assignment", assignment_saved: "Assignment saved",
        assignment_conflict: "Assignment conflict", assignment_failed: "Assignment failed",
      },
    },
  };
  return { useT: () => ({ t: (selector: (value: typeof translations) => string) => selector(translations) }) };
});

const unresolvedResolution = {
  id: "resolution-1", workflow_run_id: "run-1", workflow_node_run_id: "node-run-1",
  slot_type: "worker", role_id: "role-1", role_name: "Developer", role_description: "Builds changes",
  status: "needs_human", resolved_user_id: null, source: null, reason_code: "insufficient_data",
  reason_detail: "No unique match", version: 3, resolved_by: null, resolved_at: null,
  notification_status: null, created_at: "", updated_at: "",
};

describe("WorkflowRunPage role assignment", () => {
  beforeEach(() => {
    mocks.run = { id: "run-1", workflow_title: "Release", status: "waiting_role_assignment", triggered_by_id: "starter-1" };
    mocks.nodes = [];
    mocks.edges = [];
    mocks.nodeRuns = [{ id: "node-run-1", workflow_node_id: "node-1", node_title: "Implement", status: "blocked" }];
    mocks.resolutions = [unresolvedResolution];
    mocks.members = [
      { user_id: "owner-1", name: "Owner", role: "owner", status: "active" },
      { user_id: "worker-1", name: "Active worker", role: "member", status: "active" },
      { user_id: "inactive-1", name: "Inactive worker", role: "member", status: "inactive" },
    ];
    mocks.assign.mockReset().mockResolvedValue(undefined);
    mocks.retry.mockReset().mockResolvedValue(undefined);
    mocks.cancel.mockReset();
    mocks.refetchResolutions.mockReset().mockResolvedValue(undefined);
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  it("only offers active members and submits the optimistic version", async () => {
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    expect(screen.getByText("Waiting for role assignment")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactive worker" })).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Confirm assignment" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "worker-1" } });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith([
      { resolution_id: "resolution-1", user_id: "worker-1", version: 3 },
    ]));
  });

  it("refetches and reports a 409 optimistic-lock conflict", async () => {
    mocks.assign.mockRejectedValue(new ApiError("conflict", 409, "Conflict"));
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "worker-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
    await waitFor(() => expect(mocks.refetchResolutions).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith("Assignment conflict");
  });

  it("shows resolving state and allows cancellation", () => {
    mocks.run = { ...mocks.run, status: "resolving_roles" };
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    expect(screen.getByText("Resolving workflow roles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.cancel).toHaveBeenCalledWith({ workflowId: "workflow-1", runId: "run-1" });
  });
});

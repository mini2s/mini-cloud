// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@multica/core/api";
import { WorkflowRunPage } from "./workflow-run-page";

const mocks = vi.hoisted(() => ({
  run: {} as Record<string, unknown>,
  nodeRuns: [] as Array<Record<string, unknown>>,
  resolutions: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  assign: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  refetchResolutions: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  currentUserId: "owner-1" as string | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey[0];
    if (key === "run") return { data: mocks.run, isLoading: false };
    if (key === "node-runs") return { data: mocks.nodeRuns, isLoading: false };
    if (key === "resolutions") return { data: mocks.resolutions, refetch: mocks.refetchResolutions };
    if (key === "members") return { data: mocks.members };
    return { data: [] };
  },
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: mocks.currentUserId ? { id: mocks.currentUserId } : null,
  }),
}));
vi.mock("@multica/core/workspace/queries", () => ({ memberListOptions: () => ({ queryKey: ["members"] }) }));
vi.mock("@multica/core/workflows/queries", () => ({
  workflowRunOptions: () => ({ queryKey: ["run"] }),
  workflowNodeRunsOptions: () => ({ queryKey: ["node-runs"] }),
  workflowRoleResolutionsOptions: () => ({ queryKey: ["resolutions"] }),
  useAssignWorkflowRoleResolutions: () => ({ mutateAsync: mocks.assign, isPending: false }),
  useRetryWorkflowRoleResolutions: () => ({ mutateAsync: mocks.retry, isPending: false }),
  useCancelWorkflowRun: () => ({ mutate: mocks.cancel, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("../../layout/page-header", () => ({ PageHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
vi.mock("../../issues/components/execution", () => ({
  ExecutionPanoramaPage: () => <div data-testid="execution-panorama" />,
}));

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
        retry_started: "Retry started", retry_failed: "重新启动自动角色解析失败，请稍后重试。", unknown_node: "Unknown node",
        retry_errors: {
          rate_limited: "操作过于频繁，请一分钟后再试。",
          workspace_limit: "当前自动角色解析任务较多，请稍后再试。",
          already_active: "自动角色解析正在进行，请勿重复操作。",
          no_unresolved: "所有角色均已解决，无需重新映射。",
          unavailable: "自动角色解析服务当前不可用，请人工指定角色。",
          stage_started: "工作流已进入后续阶段，不能重新映射角色。",
          run_not_found: "工作流运行不存在或已被删除。",
          permission_denied: "你没有重新映射角色的权限。",
          conflict: "当前状态不允许重新映射，请刷新页面后重试。",
          limited: "当前无法重新映射，请稍后再试。",
        },
        worker: "Worker", critic: "Critic", status: { pending: "Pending", resolved: "Resolved", needs_human: "Needs human", invalidated: "Invalidated" },
        select_member: "Select member", select_member_for_role: "Select member for role",
        mapping_pending: "Waiting for member", mapping_source_llm: "Automatically mapped",
        mapping_source_manual: "Manually assigned", assigned_to: "Assigned", reason: "原因：{{reason}}",
        reason_codes: {
          matched_position: "Position matched",
          matched_department: "Department matched",
          insufficient_data: "Insufficient role or member information",
          no_candidate: "没有符合条件的候选成员",
          candidate_limit_exceeded: "Too many candidates",
          slot_limit_exceeded: "Too many roles",
          input_limit_exceeded: "Role matching input is too large",
          org_service_unavailable: "Organization service unavailable",
          invalid_org_identity: "Invalid organization identity",
          prompt_injection_suspected: "Role information requires manual review",
          invalid_model_output: "Invalid automatic matching result",
          resolver_not_configured: "Automatic role resolution is not configured",
          resolver_unavailable: "Automatic role resolution is unavailable",
          member_inactive: "The assigned member is inactive",
          manual_assignment: "Manually assigned",
          unknown: "Automatic role matching failed",
        },
        notification_failed: "Notification failed", assigning: "Assigning",
        assign_continue: "Confirm assignment", assignment_saved: "Assignment saved",
        assignment_conflict: "Assignment conflict", assignment_failed: "Assignment failed",
        assignment_permission_required: "Only authorized members can assign roles",
      },
    },
    builtin_roles: {
      developer: { name: "研发", description: "实现变更" },
      qa: { name: "测试", description: "验证变更" },
      tech_lead: { name: "技术负责人", description: "统筹技术决策" },
    },
    cancel_dialog: {
      title: "Cancel workflow run?",
      description: "This will stop unfinished node runs.",
      keep: "Keep running",
      confirm: "Confirm cancel",
    },
  };
  return {
    useT: () => ({
      t: (
        selector: (value: typeof translations) => string,
        values?: Record<string, string>,
      ) => {
        const template = selector(translations);
        return Object.entries(values ?? {}).reduce(
          (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
          template,
        );
      },
    }),
  };
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
    mocks.currentUserId = "owner-1";
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

  it("localizes reason codes without exposing free-form audit details", () => {
    mocks.resolutions = [{
      ...unresolvedResolution,
      reason_code: "no_candidate",
      reason_detail: "No eligible candidate matched this role",
    }];

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    expect(screen.getByText("原因：没有符合条件的候选成员")).toBeInTheDocument();
    expect(screen.queryByText(/no_candidate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No eligible candidate matched this role/)).not.toBeInTheDocument();
  });

  it("shows manual assignment controls from the resolution status even if the run status lags", () => {
    mocks.run = { ...mocks.run, status: "running" };

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm assignment" })).toBeInTheDocument();
  });

  it("allows any active workspace member to assign unresolved roles", () => {
    mocks.currentUserId = "member-2";
    mocks.members.push({
      user_id: "member-2",
      name: "Active member",
      role: "member",
      status: "active",
    });
    mocks.run = { ...mocks.run, triggered_by_id: null };

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByText("Only authorized members can assign roles")).not.toBeInTheDocument();
  });

  it("explains why manual assignment controls are unavailable to an inactive member", () => {
    mocks.currentUserId = "member-2";
    mocks.members.push({
      user_id: "member-2",
      name: "Inactive member",
      role: "member",
      status: "inactive",
    });

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    expect(screen.getByText("Only authorized members can assign roles")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("refetches and reports a 409 optimistic-lock conflict", async () => {
    mocks.assign.mockRejectedValue(new ApiError("conflict", 409, "Conflict"));
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "worker-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
    await waitFor(() => expect(mocks.refetchResolutions).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith("Assignment conflict");
  });

  it("sends exactly one retry request for one retry action", async () => {
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(mocks.retry).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Retry started");
  });

  it("localizes a structured retry failure without exposing the English API message", async () => {
    mocks.retry.mockRejectedValue(new ApiError(
      "workflow role resolution retry rate limited",
      429,
      "Too Many Requests",
      {
        code: "workflow_role_retry_rate_limited",
        error: "workflow role resolution retry rate limited",
      },
    ));

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("操作过于频繁，请一分钟后再试。");
    });
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      "workflow role resolution retry rate limited",
    );
  });

  it("uses a localized fallback for an unknown retry failure", async () => {
    mocks.retry.mockRejectedValue(new Error("Network request failed"));

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "重新启动自动角色解析失败，请稍后重试。",
      );
    });
  });

  it("shows resolving state and allows cancellation", () => {
    mocks.run = { ...mocks.run, status: "resolving_roles" };
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    expect(screen.getByText("Resolving workflow roles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(mocks.cancel).toHaveBeenCalledWith({ workflowId: "workflow-1", runId: "run-1" });
  });

  it("localizes builtin role identifiers emitted by the backend snapshot", () => {
    mocks.resolutions = [{
      ...unresolvedResolution,
      role_name: "developer",
      role_description: "developer",
    }];
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    expect(screen.getByText(/研发/)).toBeInTheDocument();
    expect(screen.getByText(/实现变更/)).toBeInTheDocument();
    expect(screen.queryByText("developer")).not.toBeInTheDocument();
  });

  it("renders custom role names verbatim without localization", () => {
    mocks.resolutions = [{
      ...unresolvedResolution,
      role_name: "Code Reviewer",
      role_description: "Reviews PRs",
    }];
    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);
    expect(screen.getByText(/Code Reviewer/)).toBeInTheDocument();
    expect(screen.getByText(/Reviews PRs/)).toBeInTheDocument();
  });

  it("shows the resolved role-to-member relationship and mapping source", () => {
    mocks.run = { ...mocks.run, status: "running" };
    mocks.resolutions = [{
      ...unresolvedResolution,
      role_name: "developer",
      role_description: "developer",
      status: "resolved",
      resolved_user_id: "worker-1",
      source: "llm",
    }];

    render(<WorkflowRunPage workflowId="workflow-1" runId="run-1" />);

    const mapping = screen.getByTestId("role-mapping-resolution-1");
    expect(mapping).toHaveTextContent("研发");
    expect(mapping).toHaveTextContent("Active worker");
    expect(screen.getByText("Automatically mapped")).toBeInTheDocument();
  });
});

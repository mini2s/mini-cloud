// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "./assignee-picker";
import type { Agent, Workflow } from "@multica/core/types";

const agents: Agent[] = [
  { id: "general", workspace_id: "", runtime_id: "", name: "Split Planner (General)", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: true, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
  { id: "code", workspace_id: "", runtime_id: "", name: "Split Planner (Code)", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: true, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
  { id: "custom", workspace_id: "", runtime_id: "", name: "Custom Planner", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: false, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
];

const workflows: Workflow[] = [{
  id: "workflow-1",
  workspace_id: "ws-1",
  title: "Release workflow",
  description: "",
  status: "active",
  max_retries: 3,
  created_by_type: "member",
  created_by_id: "user-1",
  node_count: 1,
  is_template: false,
  source_template_id: null,
  default_runtime_selection_policy: "idle_first",
  default_runtime_id: null,
  custom_roles: [],
  created_at: "",
  updated_at: "",
}];

const templateWorkflow: Workflow = {
  ...workflows[0]!,
  id: "template-1",
  title: "Release template",
  is_template: true,
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key.includes("agents")) return { data: agents };
    if (key.includes("members")) return { data: [] };
    if (key.includes("squads")) return { data: [] };
    if (key.includes("workflow-templates")) {
      return { data: { workflows: [templateWorkflow], total: 1 } };
    }
    if (key.includes("workflows")) return { data: workflows };
    if (key.includes("runtimes")) return { data: [] };
    return { data: [] };
  },
  useQueryClient: () => ({ fetchQuery: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock("@multica/core/auth", () => ({ useAuthStore: () => ({ id: "user-1" }) }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: () => null }) }));
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
  squadListOptions: () => ({ queryKey: ["squads"] }),
  assigneeFrequencyOptions: () => ({ queryKey: ["frequency"] }),
}));
vi.mock("@multica/core/workflows/queries", () => ({
  workflowActiveListOptions: () => ({ queryKey: ["workflows"] }),
  workflowTemplateListOptions: () => ({ queryKey: ["workflow-templates"] }),
  workflowNodesOptions: () => ({ queryKey: ["workflow-nodes"] }),
}));
vi.mock("@multica/core/runtimes/queries", () => ({ runtimeListOptions: () => ({ queryKey: ["runtimes"] }) }));
vi.mock("@multica/core/api", () => ({ api: {} }));
vi.mock("@multica/core/permissions", () => ({ canAssignAgentToIssue: () => ({ allowed: true }) }));
vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (selector: (value: any) => string) => selector({
      pickers: {
        assignee: {
          search_placeholder: "Search",
          trigger_unassigned: "Unassigned",
          agents_group: "Agents",
          builtin_label: "Built-in",
          workflows_group: "Workflows",
          members_group: "Members",
          squads_group: "Squads",
          role_label: "Roles",
          template_label: "Template",
          no_runtime_available: "No runtime",
        },
      },
    }),
  }),
}));
vi.mock("../../../common/actor-avatar", () => ({ ActorAvatar: () => <span data-testid="avatar" /> }));
vi.mock("../../../agents/components/runtime-select-dialog", () => ({ RuntimeSelectDialog: () => null }));
vi.mock("../../../workflows/components/use-usable-workflow-runtimes", () => ({
  useUsableWorkflowRuntimes: (runtimes: unknown[]) => ({ runtimes, isLoading: false }),
}));
vi.mock("../../../workflows/components/workflow-runtime-strategy-dialog", () => ({
  WorkflowRuntimeStrategyDialog: ({
    initialValue,
    onConfirm,
  }: {
    initialValue: { policy: string; runtimeId: string | null };
    onConfirm: (value: { policy: string; runtimeId: string | null }) => void;
  }) => (
    <button type="button" onClick={() => onConfirm(initialValue)}>
      Confirm workflow runtime
    </button>
  ),
}));

describe("AssigneePicker agentFilter", () => {
  it("keeps the unassigned option by default", () => {
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        trigger={<span>Choose assignee</span>}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("can hide the unassigned option and label the embedded picker", () => {
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        allowUnassigned={false}
        ariaLabel="Assignee for Task A"
        trigger={<span>Choose assignee</span>}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Assignee for Task A")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("can use a context-specific empty trigger label without changing the unassigned option", () => {
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        allowUnassigned={false}
        emptyTriggerLabel="Responsible member"
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("Responsible member")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("filters agent picker options without changing saved assignee rendering", () => {
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        includeWorkflows={false}
        skipBuiltinRuntimeSelection
        open
        onOpenChange={vi.fn()}
        agentFilter={(agent) => agent.name === "Split Planner (General)" || !agent.name.startsWith("Split Planner (")}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("Split Planner (General)")).toBeInTheDocument();
    expect(screen.getByText("Custom Planner")).toBeInTheDocument();
    expect(screen.queryByText("Split Planner (Code)")).not.toBeInTheDocument();
  });

  it("submits the workflow default strategy as this run's snapshot", async () => {
    const onUpdate = vi.fn();
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        open
        onOpenChange={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByText("Release workflow"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm workflow runtime" }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        assignee_type: "workflow",
        assignee_id: "workflow-1",
        runtime_id: null,
        runtime_selection_policy: "idle_first",
      });
    });
  });

  it("does not include templates in runnable workflow options", () => {
    render(
      <AssigneePicker
        assigneeType={null}
        assigneeId={null}
        open
        onOpenChange={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("Release workflow")).toBeInTheDocument();
    expect(screen.queryByText("Release template")).not.toBeInTheDocument();
  });
});

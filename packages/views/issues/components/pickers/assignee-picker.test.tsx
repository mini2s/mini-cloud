// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "./assignee-picker";
import type { Agent } from "@multica/core/types";

const agents: Agent[] = [
  { id: "general", workspace_id: "", runtime_id: "", name: "Split Planner (General)", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: true, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
  { id: "code", workspace_id: "", runtime_id: "", name: "Split Planner (Code)", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: true, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
  { id: "custom", workspace_id: "", runtime_id: "", name: "Custom Planner", description: "", instructions: "", avatar_url: null, runtime_mode: "local", runtime_config: {}, custom_env: {}, custom_args: [], custom_env_redacted: false, visibility: "workspace", status: "idle", max_concurrent_tasks: 1, model: "", plugin_id: null, is_builtin: false, owner_id: null, skills: [], created_at: "", updated_at: "", archived_at: null, archived_by: null },
];

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key.includes("agents")) return { data: agents };
    if (key.includes("members")) return { data: [] };
    if (key.includes("squads")) return { data: [] };
    if (key.includes("workflows")) return { data: [] };
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

describe("AssigneePicker agentFilter", () => {
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
});

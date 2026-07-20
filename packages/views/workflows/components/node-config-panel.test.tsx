// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "./node-config-panel";
import type { WorkflowNode, WorkflowNodeRun, WorkflowStage } from "@multica/core/types";

const mocks = vi.hoisted(() => ({
  cacheNodeEdits: vi.fn(),
  deleteNodeMutateAsync: vi.fn(),
  assignStageMutate: vi.fn(),
  createStageMutateAsync: vi.fn(),
  createDeliverableMutateAsync: vi.fn(),
  updateDeliverableMutateAsync: vi.fn(),
  deleteDeliverableMutateAsync: vi.fn(),
  saveNode: vi.fn(),
  navigationPush: vi.fn(),
  nodeEdits: {} as Record<string, unknown>,
  deliverables: [] as unknown[],
  roles: [] as Array<{ id: string; name: string; description: string }>,
  assigneePickerCalls: [] as Array<{
    assigneeType: string | null;
    assigneeId: string | null;
    includeWorkflows?: boolean;
  }>,

}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => ({
    data: opts.queryKey.includes("roles") ? mocks.roles : mocks.deliverables,
  }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    settings: () => "/ws/settings",
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush }),
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowNodeDeliverablesOptions: () => ({ queryKey: ["deliverables"] }),
  workflowRolesOptions: () => ({ queryKey: ["roles"] }),
  useAssignNodeToStage: () => ({ mutate: mocks.assignStageMutate, isPending: false }),
  useCreateStage: () => ({ mutateAsync: mocks.createStageMutateAsync, isPending: false, error: null }),
  useDeleteNode: () => ({ mutateAsync: mocks.deleteNodeMutateAsync, isPending: false }),
  useCreateWorkflowNodeDeliverable: () => ({ mutateAsync: mocks.createDeliverableMutateAsync, isPending: false }),
  useUpdateWorkflowNodeDeliverable: () => ({ mutateAsync: mocks.updateDeliverableMutateAsync, isPending: false }),
  useDeleteWorkflowNodeDeliverable: () => ({ mutateAsync: mocks.deleteDeliverableMutateAsync, isPending: false }),
}));

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: (selector: (state: unknown) => unknown) =>
    selector({
      nodeEdits: mocks.nodeEdits,
      _undoRedoVersion: 0,
      cacheNodeEdits: mocks.cacheNodeEdits,
    }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (type: string, id: string) => {
      if (type === "agent" && id === "agent-1") return "Builder Agent";
      if (type === "agent" && id === "agent-2") return "Reviewer Agent";
      return null;
    },
  }),
}));

vi.mock("../../issues/components/pickers/assignee-picker", () => ({
  AssigneePicker: ({
    assigneeType,
    assigneeId,
    includeWorkflows,
    trigger,
    triggerRender,
    onUpdate,
    onRoleChange,
  }: {
    assigneeType: string | null;
    assigneeId: string | null;
    includeWorkflows?: boolean;
    trigger?: ReactNode;
    triggerRender?: ReactElement;
    onUpdate: (updates: { assignee_type: string | null; assignee_id: string | null }) => void;
    onRoleChange?: (role: string | null) => void;
  }) =>
    {
      mocks.assigneePickerCalls.push({ assigneeType, assigneeId, includeWorkflows });
      return (
        <div>
          {triggerRender
            ? cloneElement(triggerRender, {}, trigger)
            : (
              <button type="button">
                Assignee picker {assigneeType ?? "none"} {assigneeId ?? "unassigned"}
              </button>
            )}
          <button
            type="button"
            onClick={() => onUpdate({ assignee_type: "member", assignee_id: "member-1" })}
          >
            Select member
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ assignee_type: "squad", assignee_id: "squad-1" })}
          >
            Select squad
          </button>
          <button type="button" onClick={() => onRoleChange?.("developer")}>
            Select developer role
          </button>
        </div>
      );
    },
}));

vi.mock("./node-deliverables-editor", () => ({
  NodeDeliverablesEditor: () => <div data-testid="deliverables-editor">Deliverables editor</div>,
}));

vi.mock("./node-data-preview", () => ({
  NodeDataPreview: ({ nodeRun }: { nodeRun?: WorkflowNodeRun | null }) => (
    <div data-testid="node-data-preview">{nodeRun?.status ?? "no-data"}</div>
  ),
}));

vi.mock("../../i18n", () => {
  const translations = {
    detail: {
      create_dialog: { create: "Create" },
      toast_saved: "Workflow saved",
      toast_save_failed: "Failed to save workflow",
    },
    overview: {
      stage_canvas: { unassigned: "Unassigned" },
      stage_dialog: { cancel: "Cancel" },
    },
    detail_panel: {
      eyebrow: "Node inspector",
      close_label: "Close node inspector",
      section_primary: "Primary",
      section_primary_desc: "Definition fields and ownership for this workflow node.",
      section_annotation_binding: "Annotation binding",
      section_annotation_binding_desc: "Attach this note to a workflow node.",
      section_deliverables: "Deliverables",
      section_deliverables_desc: "Required documents or pull requests for this node.",
      section_runtime: "Runtime",
      section_runtime_desc: "Latest run context for this node.",
      section_connections: "Connections",
      section_connections_desc: "Canvas topology stays visible in the editor while details focus on the selected node.",
      section_actions: "Actions",
      section_actions_desc: "Definition-level operations for this node.",
      badge_latest_run: "Latest run: {{status}}",
      badge_no_run_data: "No run data",
      badge_no_run: "No run",
      badge_valid: "Valid",
      badge_invalid: "Invalid",
      badge_configured: "Configured",
      badge_needs_assignee: "Needs assignee",
      badge_optional: "Optional",
      label_bind_to_node: "Bind to Node",
      label_worker_role: "Worker role",
      label_critic_role: "Critic role",
      select_node: "Select a node...",
      select_role: "Select a role...",
      actor_role_hint: "Resolved when the workflow runs",
      actor_assignee_hint: "Pick a concrete assignee for predictable execution",
      empty_worker_role: "No worker role selected",
      empty_worker: "No worker selected",
      empty_critic_role: "No critic role selected",
      empty_critic: "No critic selected",
      empty_unknown_node: "Unknown node",
      picker_empty_prefix: "Select existing",
      gateway_label_fork: "Fork gateway",
      gateway_label_join: "Join gateway",
      gateway_label_default: "Gateway",
      gateway_desc_fork: "Automatically completes and fans out to all downstream nodes.",
      gateway_desc_join: "Waits for all upstream nodes to finish, then automatically completes and continues downstream.",
      gateway_desc_invalid: "Gateway kind is invalid. Choose Fork or Join before publishing.",
      gateway_subtitle: "Gateway nodes control DAG flow and do not run worker or critic tasks.",
      worker_subtitle: "Who performs this workflow step.",
      critic_subtitle: "Who reviews or validates the worker output.",
      worker_critic_divider: "Worker output moves to Critic review",
      deliverables_not_applicable_gateway: "Gateway nodes do not define deliverables.",
      deliverables_not_applicable_annotation: "Annotation nodes do not define deliverables.",
      runtime_status_label: "Status: {{status}}",
      runtime_hint: "Worker output, critic output and comments remain available in this runtime section.",
      runtime_no_data: "No run data for this node yet.",
      connections_stage: "Stage: {{stage}}",
      connections_gateway_hint: "Gateway edge counts and topology are shown on the canvas.",
      connections_bound_to: "Bound to: {{node}}",
      save_changes: "Save changes",
      actions_disabled: "Node actions are disabled in this context.",
      deliverable_default_title: "New deliverable",
    },
    node: {
      title: "Node inspector",
      description: "Description",
      title_placeholder: "Node name",
      description_placeholder: "What does this node do?",
      stage_label: "Stage",
      stage_create_option: "Create new stage...",
      stage_create_name_placeholder: "Stage name",
      stage_create_description_placeholder: "Description (optional)",
      section_worker: "Worker",
      worker_type_human: "Human",
      worker_type_agent: "Agent",
      worker_type_squad: "Squad",
      worker_type_role: "Role",
      section_critic: "Critic",
      critic_type_human: "Human",
      critic_type_agent: "Agent",
      critic_type_squad: "Squad",
      critic_type_api: "API",
      critic_type_role: "Role",
      worker_id_label: "Assignee",
      critic_id_label: "Reviewer",
      critic_api_url_label: "API URL",
      critic_api_url_hint: "POST endpoint that receives worker output for automated review",
      tabs: { config: "Config", data: "Data", runs: "Runs" },
      saving: "Saving...",
      delete: "Delete Node",
      toast_deleted: "Node deleted",
      toast_delete_failed: "Failed to delete node",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

const node: WorkflowNode = {
  id: "node-1",
  workflow_id: "wf-1",
  title: "Implement change",
  description: "Make the scoped code change.",
  worker_type: "agent",
  worker_id: "agent-1",
  critic_type: "agent",
  critic_id: "agent-2",
  critic_api_url: null,
  stage_id: "stage-1",
  format_schema: null,
  position_x: 100,
  position_y: 0,
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

const stages: WorkflowStage[] = [
  {
    id: "stage-1",
    workflow_id: "wf-1",
    name: "Build",
    description: "",
    sort_order: 0,
    node_count: 1,
    created_at: "",
    updated_at: "",
  },
];

function renderPanel(recentNodeRun: WorkflowNodeRun | null = null) {
  return render(
    <NodeConfigPanel
      node={node}
      workflowId="wf-1"
      stages={stages}
      recentNodeRun={recentNodeRun}
      onClose={vi.fn()}
      onSaveNode={mocks.saveNode}
    />,
  );
}

describe("NodeConfigPanel", () => {
  beforeEach(() => {
    mocks.cacheNodeEdits.mockReset();
    mocks.saveNode.mockReset();
    mocks.nodeEdits = {};
    mocks.deliverables = [];
    mocks.roles = [{ id: "role-developer", name: "Developer", description: "Builds the change." }];
    mocks.assigneePickerCalls = [];
  });

  it("renders unified direct participant pickers for Worker and Critic", () => {
    renderPanel();

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveAttribute("data-mode", "edit");
    expect(screen.queryByRole("tab", { name: "Config" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Worker type Human" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Critic type Agent" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Builder Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewer Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assignee" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reviewer" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Worker role" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "API" })).toBeInTheDocument();
    expect(mocks.assigneePickerCalls).toEqual(
      expect.arrayContaining([
        { assigneeType: "agent", assigneeId: "agent-1", includeWorkflows: false },
        { assigneeType: "agent", assigneeId: "agent-2", includeWorkflows: false },
      ]),
    );
    expect(mocks.assigneePickerCalls.every((call) => call.includeWorkflows === false)).toBe(true);
  });

  it("updates Worker type from the unified participant picker selection", () => {
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "Select member" })[0]!);

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      worker_type: "human",
      worker_id: "member-1",
      worker_role_id: null,
    });
  });

  it("renders a node save action when local edits exist", () => {
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mocks.saveNode).toHaveBeenCalledTimes(1);
  });

  it("uses the fixed shared detail section order in edit mode", () => {
    renderPanel();

    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "primary",
      "deliverables",
      "runtime",
      "connections",
      "actions",
    ]);
  });

  it("does not render legacy nested subsection cards inside the shared primary section", () => {
    renderPanel();

    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.queryByText("Basics")).not.toBeInTheDocument();
  });

  it("selects a Worker role placeholder and clears the concrete assignment", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Worker role" }));
    const roleSelect = screen.getByRole("option", { name: "Developer" }).parentElement;
    expect(roleSelect).not.toBeNull();
    fireEvent.change(roleSelect!, { target: { value: "role-developer" } });

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      worker_type: "human",
      worker_id: null,
      worker_role_id: "role-developer",
    });
  });

  it("switches Critic to API and shows the API URL field", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "API" }));

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      critic_type: "api",
      critic_id: null,
      critic_role_id: null,
      critic_api_url: null,
    });
    expect(screen.getByLabelText("Critic API URL")).toBeInTheDocument();
  });

  it("surfaces recent run status context in the inspector", () => {
    renderPanel({
      id: "node-run-1",
      workflow_run_id: "run-1",
      workflow_node_id: "node-1",
      node_title: "Implement change",
      status: "critic_rework",
      retry_count: 0,
      worker_type: "agent",
      worker_id: "agent-1",
      worker_output: null,
      worker_agent_task_id: null,
      critic_type: "agent",
      critic_id: "agent-2",
      critic_output: null,
      critic_comment: "Needs another pass",
      critic_agent_task_id: null,
      agent_task_id: null,
      session_id: null,
      runtime_id: null,
      device_id: null,
      started_at: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    });

    expect(screen.getByText("Latest run: {{status}}")).toBeInTheDocument();
  });

  it("shows gateway semantics without worker critic or deliverable editors", () => {
    render(
      <NodeConfigPanel
        node={{
          ...node,
          id: "fork-1",
          title: "Fork",
          worker_id: null,
          critic_id: null,
          format_schema: { type: "gateway", gateway_kind: "fork", shape: "diamond" },
        }}
        workflowId="wf-1"
        stages={stages}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Fork gateway")).toBeInTheDocument();
    expect(screen.getByText("Automatically completes and fans out to all downstream nodes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Builder Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reviewer Agent" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("deliverables-editor")).not.toBeInTheDocument();
  });
});

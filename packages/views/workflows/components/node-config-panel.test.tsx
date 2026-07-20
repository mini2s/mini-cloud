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
  saveNode: vi.fn(),
  nodeEdits: {} as Record<string, unknown>,
  assigneePickerCalls: [] as Array<{
    assigneeType: string | null;
    assigneeId: string | null;
    includeWorkflows?: boolean;
  }>,
  workflows: [
    { id: "wf-1", title: "Parent workflow", status: "active", is_template: false },
    { id: "child-wf-1", title: "Default child flow", status: "active", is_template: false },
    { id: "child-wf-2", title: "Shipping child flow", status: "active", is_template: false },
  ] as Array<{ id: string; title: string; status: string; is_template: boolean }>,
  roles: [
    { id: "role-1", name: "Implementer" },
    { id: "role-2", name: "Reviewer" },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: unknown[] }) =>
    options.queryKey?.[0] === "workflows"
        ? { data: mocks.workflows.filter((workflow) => workflow.status === "active") }
      : { data: mocks.roles },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowRolesOptions: () => ({ queryKey: ["workflow-roles"] }),
  workflowActiveListOptions: () => ({ queryKey: ["workflows"] }),
  useAssignNodeToStage: () => ({ mutate: mocks.assignStageMutate, isPending: false }),
  useCreateStage: () => ({ mutateAsync: mocks.createStageMutateAsync, isPending: false, error: null }),
  useDeleteNode: () => ({ mutateAsync: mocks.deleteNodeMutateAsync, isPending: false }),
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
  }: {
    assigneeType: string | null;
    assigneeId: string | null;
    includeWorkflows?: boolean;
    trigger?: ReactNode;
    triggerRender?: ReactElement;
    onUpdate: (updates: { assignee_type: string | null; assignee_id: string | null }) => void;
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
        </div>
      );
    },
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
      section_readiness: "Readiness",
      section_readiness_desc: "Confirm the node can run before publishing.",
      section_primary: "Node intent",
      section_primary_desc: "Definition fields for this workflow node.",
      section_worker_critic: "Worker and critic",
      section_worker_critic_desc: "Assign who performs and reviews this node.",
      section_split_behavior: "Split behavior",
      section_split_behavior_desc: "Control child issue release, concurrency, and failure handling.",
      section_annotation_binding: "Annotation binding",
      section_annotation_binding_desc: "Attach this note to a workflow node.",
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
      badge_needs_default_issue_workflow: "Needs default issue workflow",
      readiness_worker_ready: "Worker ready",
      readiness_worker_missing: "Worker missing",
      readiness_critic_ready: "Critic ready",
      readiness_critic_optional: "Critic optional",
      readiness_split_ready: "Default issue workflow ready",
      readiness_split_missing: "Default issue workflow missing",
      label_bind_to_node: "Bind to Node",
      label_worker_role: "Worker role",
      label_critic_role: "Critic role",
      split_title: "Split settings",
      split_subtitle: "Configure the planner agent, default issue workflow, and runtime limits for task splitting.",
      split_review_required_title: "Human review is required",
      split_review_required_hint: "Generated split tasks always stop for human review before child issues are created.",
      split_worker_subtitle: "The Agent that generates the task splitting plan.",
      split_critic_subtitle: "The reviewer that approves generated split drafts.",
      split_default_issue_workflow_label: "Default issue workflow",
      split_default_issue_workflow_placeholder: "Select default issue workflow...",
      split_release_mode_label: "Release downstream work",
      split_release_after_finish: "After child issues finish",
      split_release_after_created: "After child issues are created",
      split_mode_hint: "Barrier waits for child tasks; Pipeline releases downstream after issue creation.",
      split_concurrency_question: "How many child issues can run at once?",
      split_concurrency_hint: "Run at most this many child issues at once.",
      split_failure_tolerance_label: "Failure tolerance",
			connection_upstream_count: "2 upstream",
			connection_downstream_count: "1 downstream",
			trial_run: "Trial run",
      split_max_failures_hint: "Barrier mode fails the parent split when child failures exceed this number.",
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
      runtime_status_label: "Status: {{status}}",
      runtime_hint: "Worker output, critic output and comments remain available in this runtime section.",
      runtime_no_data: "No run data for this node yet.",
      connections_stage: "Stage: {{stage}}",
      connections_gateway_hint: "Gateway edge counts and topology are shown on the canvas.",
      connections_bound_to: "Bound to: {{node}}",
      save_changes: "Save changes",
      actions_disabled: "Node actions are disabled in this context.",
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
    preflight: {
      detail_split_planner_missing: "Assign an Agent to this split node",
      detail_split_critic_missing: "Assign a Critic to review split drafts",
      detail_split_critic_automated: "Automated split draft critics can approve risky task plans",
      detail_split_default_issue_workflow_missing: "Split node needs a default issue workflow",
      detail_split_default_issue_workflow_invalid: "Split default issue workflow is unavailable",
      detail_split_default_issue_workflow_inactive: "Split default issue workflow must be active",
      detail_split_default_issue_workflow_nested: "Split default issue workflow cannot contain another split node",
      detail_split_default_issue_workflow_self: "Split default issue workflow cannot be the current workflow",
      detail_split_max_concurrency_invalid: "Split concurrency must be an integer from 1 to 50",
      detail_worker_missing: "Assign a worker to this node",
      detail_stage_missing: "Assign this node to a stage",
      detail_invalid_critic: "Critic ID not found in available agents",
      detail_dag_cycle: "Nodes form a cycle: {{path}}",
      detail_gateway_fork_outgoing: "Fork gateway needs at least two downstream nodes",
      detail_gateway_join_incoming: "Join gateway needs at least two upstream nodes",
      detail_gateway_kind_invalid: "Gateway type must be Fork or Join",
      detail_gateway_join_multiple_outgoing: "Join gateway usually continues to one downstream node",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string, options?: Record<string, string>) => {
        let value = selector(translations);
        if (options) for (const [k, r] of Object.entries(options)) value = value.replace(`{{${k}}}`, String(r));
        return value;
      },
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
    expect(screen.getAllByRole("button", { name: "Assignee" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reviewer" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Role" })).toHaveLength(2);
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

    expect(screen.getByTestId("node-readiness-summary")).toHaveClass("rounded-lg", "border");
    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "readiness",
      "primary",
      "worker-critic",
      "actions",
    ]);
  });

  it("does not render legacy nested subsection cards inside the shared primary section", () => {
    renderPanel();

    expect(screen.getByText("Node intent")).toBeInTheDocument();
    expect(screen.queryByText("Basics")).not.toBeInTheDocument();
  });

  it("switches Worker to Role and clears the previous worker assignment", () => {
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "Role" })[0]!);

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      worker_type: "role",
      worker_id: null,
    });
    expect(screen.getByLabelText("Worker role")).toBeInTheDocument();
  });

  it("switches Critic to API and shows the API URL field", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "API" }));

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      critic_type: "api",
      critic_id: null,
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
      split_review_chat_session_id: null,
      split_config_version: 1,
      started_at: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    });

    expect(screen.getByText("Latest run: critic_rework")).toBeInTheDocument();
  });

  it("shows gateway semantics without worker or critic editors", () => {
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
  });

  it("renders split settings with worker and critic", () => {
    render(
      <NodeConfigPanel
        node={{
          ...node,
          id: "split-1",
          title: "Split rollout",
          critic_id: null,
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-2",
              mode: "barrier",
              max_concurrency: 3,
              max_failures: 1,
            },
          },
        }}
        workflowId="wf-1"
        stages={stages}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Split settings")).toBeInTheDocument();
    expect(screen.getByText("Human review is required")).toBeInTheDocument();
    expect(screen.getByText("Generated split tasks always stop for human review before child issues are created.")).toBeInTheDocument();
    expect(screen.getByLabelText("Default issue workflow")).toHaveValue("child-wf-2");
    expect(screen.getByLabelText("How many child issues can run at once?")).toHaveValue(3);
    expect(screen.getByLabelText("Failure tolerance")).toHaveValue(1);
    expect(screen.getAllByText("Worker").length).toBeGreaterThan(0);
    expect(screen.getByText("The Agent that generates the task splitting plan.")).toBeInTheDocument();
    expect(screen.getAllByText("Critic").length).toBeGreaterThan(0);
    expect(screen.getByText("The reviewer that approves generated split drafts.")).toBeInTheDocument();
  });

	it("orders split sections and shows readiness, connections, and trial run", () => {
		const onTrialRun = vi.fn();
    render(
      <NodeConfigPanel
        node={{
          ...node,
          id: "split-1",
          title: "Split work",
          critic_id: null,
          format_schema: {
            type: "split",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 1,
            },
          },
        }}
        workflowId="wf-1"
        stages={stages}
        onClose={vi.fn()}
				preflightIssues={[{
					checkId: "split-critic-automated",
					severity: "warning",
					blocking: false,
					nodeId: "split-1",
					message: "Automated split draft critics can approve risky task plans",
				}]}
				incomingCount={2}
				outgoingCount={1}
				onTrialRun={onTrialRun}
      />,
    );

    expect(screen.getAllByTestId("node-detail-section").map((section) => section.getAttribute("data-section"))).toEqual([
      "readiness",
      "primary",
      "worker-critic",
			"split-behavior",
			"connections",
      "actions",
    ]);
		expect(screen.getByText("Automated split draft critics can approve risky task plans")).toBeInTheDocument();
		expect(screen.getByText("2 upstream")).toBeInTheDocument();
		expect(screen.getByText("1 downstream")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Trial run" }));
		expect(onTrialRun).toHaveBeenCalledOnce();
  });

  it("updates split format_schema fields without dropping existing metadata", () => {
    render(
      <NodeConfigPanel
        node={{
          ...node,
          id: "split-1",
          title: "Split rollout",
          critic_id: null,
          format_schema: {
            type: "split",
            template_id: "task-splitter",
            template_category: "logic",
            shape: "rectangle",
            split_config: {
              default_issue_workflow_id: "child-wf-1",
              mode: "barrier",
              max_concurrency: 5,
              max_failures: 0,
            },
          },
        }}
        workflowId="wf-1"
        stages={stages}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Default issue workflow"), {
      target: { value: "child-wf-2" },
    });
    expect(mocks.cacheNodeEdits).toHaveBeenLastCalledWith("split-1", {
      format_schema: {
        type: "split",
        template_id: "task-splitter",
        template_category: "logic",
        shape: "rectangle",
        split_config: {
          default_issue_workflow_id: "child-wf-2",
          mode: "barrier",
          max_concurrency: 5,
          max_failures: 0,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "After child issues are created" }));
    expect(mocks.cacheNodeEdits).toHaveBeenLastCalledWith("split-1", {
      format_schema: {
        type: "split",
        template_id: "task-splitter",
        template_category: "logic",
        shape: "rectangle",
        split_config: {
          default_issue_workflow_id: "child-wf-1",
          mode: "pipeline",
          max_concurrency: 5,
          max_failures: 0,
        },
      },
    });

    fireEvent.change(screen.getByLabelText("How many child issues can run at once?"), {
      target: { value: "7" },
    });
    expect(mocks.cacheNodeEdits).toHaveBeenLastCalledWith("split-1", {
      format_schema: {
        type: "split",
        template_id: "task-splitter",
        template_category: "logic",
        shape: "rectangle",
        split_config: {
          default_issue_workflow_id: "child-wf-1",
          mode: "barrier",
          max_concurrency: 7,
          max_failures: 0,
        },
      },
    });
  });
});

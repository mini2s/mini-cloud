// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "./node-config-panel";
import type { WorkflowNode, WorkflowNodeRun, WorkflowStage } from "@multica/core/types";
import enWorkflows from "../../locales/en/workflows.json";
import zhHansWorkflows from "../../locales/zh-Hans/workflows.json";

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
    agentFilter?: (agent: { name: string; is_builtin: boolean }) => boolean;
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
    agentFilter,
    trigger,
    triggerRender,
    onUpdate,
  }: {
    assigneeType: string | null;
    assigneeId: string | null;
    includeWorkflows?: boolean;
    agentFilter?: (agent: { name: string; is_builtin: boolean }) => boolean;
    trigger?: ReactNode;
    triggerRender?: ReactElement;
    onUpdate: (updates: { assignee_type: string | null; assignee_id: string | null }) => void;
  }) =>
    {
      mocks.assigneePickerCalls.push({ assigneeType, assigneeId, includeWorkflows, agentFilter });
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
      eyebrow: "Node settings",
      close_label: "Close node inspector",
      section_readiness: "Activation check",
      section_readiness_desc: "Check what must be ready before this workflow can be enabled.",
      section_primary: "Basic information",
      section_primary_desc: "Name and describe what this step should do.",
      section_worker_critic: "Executor and reviewer",
      section_worker_critic_desc: "Choose who performs this step and who reviews it.",
      section_split_behavior: "Split rules",
      section_split_behavior_desc: "Choose the child issue workflow and when downstream steps continue.",
      section_annotation_binding: "Annotation binding",
      section_annotation_binding_desc: "Attach this note to a workflow node.",
      section_runtime: "Run status",
      section_runtime_desc: "Latest run context for this step.",
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
      readiness_worker_ready: "Executor ready",
      readiness_worker_missing: "Executor missing",
      readiness_critic_ready: "Reviewer ready",
      readiness_critic_optional: "Reviewer optional",
      readiness_split_ready: "Default issue workflow ready",
      readiness_split_missing: "Default issue workflow missing",
      label_bind_to_node: "Bind to Node",
      label_worker_role: "Executor role",
      label_critic_role: "Reviewer role",
      split_title: "Split rules",
      split_subtitle: "Choose the child issue workflow, review step, and runtime limits.",
      split_review_required_title: "Human review is required",
      split_review_required_hint: "Generated split tasks always stop for human review before child issues are created.",
      split_worker_subtitle: "The split planner that drafts child issues.",
      split_critic_subtitle: "The reviewer that approves generated drafts.",
      split_default_issue_workflow_label: "Child issue default workflow",
      split_default_issue_workflow_placeholder: "Select child issue workflow...",
      split_release_mode_label: "When should downstream steps continue?",
      split_release_after_finish: "After child issues finish",
      split_release_after_created: "After child issues are created",
      split_mode_hint: "Wait mode continues after child issues finish. Continue mode starts downstream after child issues are created.",
      split_concurrency_question: "How many child issues can run at once?",
      split_concurrency_hint: "This limits child issues running at the same time.",
      split_failure_tolerance_label: "Allowed failed child issues",
			connection_upstream_count: "2 upstream",
			connection_downstream_count: "1 downstream",
			trial_run: "Test this split",
      split_max_failures_hint: "If failures exceed this number, the parent split fails.",
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
      gateway_label_fork: "Branch start",
      gateway_label_join: "Join point",
      gateway_label_default: "Branch node",
      gateway_desc_fork: "Automatically starts every downstream branch.",
      gateway_desc_join: "Waits for upstream branches, then continues downstream.",
      gateway_desc_invalid: "Gateway kind is invalid. Choose Fork or Join before publishing.",
      gateway_subtitle: "Branch nodes control flow automatically and do not need an executor or reviewer.",
      worker_subtitle: "Who performs this workflow step.",
      critic_subtitle: "Who reviews or validates the output.",
      worker_critic_divider: "Executor output moves to reviewer approval",
      runtime_status_label: "Status: {{status}}",
      runtime_hint: "Executor output, reviewer output, and comments remain available here.",
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
  it("keeps workflow editor copy aligned in English and Simplified Chinese locales", () => {
    expect(enWorkflows.detail_panel).toMatchObject({
      eyebrow: "Node settings",
      section_readiness: "Activation check",
      section_primary: "Basic information",
      section_worker_critic: "Executor and reviewer",
      section_split_behavior: "Split rules",
      split_default_issue_workflow_label: "Child issue default workflow",
      gateway_label_fork: "Branch start",
      split_planner_label: "Split planner: {{planner}}",
    });
    expect(enWorkflows.panorama.card).toEqual({
      worker_label: "Worker",
      critic_label: "Critic",
    });
    expect(zhHansWorkflows.panorama.card).toEqual({
      worker_label: "执行者",
      critic_label: "审核者",
    });
    expect(zhHansWorkflows.detail_panel).toMatchObject({
      eyebrow: "节点设置",
      section_readiness: "启用检查",
      section_primary: "基本信息",
      section_worker_critic: "执行者和审核者",
      section_split_behavior: "拆分规则",
      split_default_issue_workflow_label: "子 issue 默认 workflow",
      gateway_label_fork: "分支开始",
      split_planner_label: "拆分规划者：{{planner}}",
    });
  });
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
    expect(screen.queryByText("Pick a concrete assignee for predictable execution")).not.toBeInTheDocument();
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

    expect(screen.getByText("Basic information")).toBeInTheDocument();
    expect(screen.queryByText("Basics")).not.toBeInTheDocument();
  });

  it("switches Worker to Role and clears the previous worker assignment", () => {
    renderPanel();

    fireEvent.click(screen.getAllByRole("button", { name: "Role" })[0]!);

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      worker_type: "human",
      worker_id: null,
      worker_role_id: "role-1",
    });
    expect(screen.getByLabelText("Executor role")).toBeInTheDocument();
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

    expect(screen.getByText("Branch start")).toBeInTheDocument();
    expect(screen.getByText("Automatically starts every downstream branch.")).toBeInTheDocument();
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

    expect(screen.getAllByText("Split rules")).toHaveLength(1);
    expect(screen.getByText("Human review is required")).toBeInTheDocument();
    expect(screen.getByText("Generated split tasks always stop for human review before child issues are created.")).toBeInTheDocument();
    expect(screen.getByLabelText("Child issue default workflow")).toHaveValue("child-wf-2");
    expect(screen.getByLabelText("How many child issues can run at once?")).toHaveValue(3);
    expect(screen.getByLabelText("Allowed failed child issues")).toHaveValue(1);
    expect(screen.getAllByText("Worker").length).toBeGreaterThan(0);
    expect(screen.getByText("The split planner that drafts child issues.")).toBeInTheDocument();
    expect(screen.getAllByText("Critic").length).toBeGreaterThan(0);
    expect(screen.getByText("The reviewer that approves generated drafts.")).toBeInTheDocument();
    const splitPlannerPicker = mocks.assigneePickerCalls.find(
      (call) => call.assigneeId === "agent-1" && typeof call.agentFilter === "function",
    );
    expect(splitPlannerPicker?.agentFilter?.({ name: "Split Planner (General)", is_builtin: true })).toBe(true);
    expect(splitPlannerPicker?.agentFilter?.({ name: "Split Planner (Code)", is_builtin: true })).toBe(false);
    expect(splitPlannerPicker?.agentFilter?.({ name: "Custom Planner", is_builtin: false })).toBe(true);
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
		fireEvent.click(screen.getByRole("button", { name: "Test this split" }));
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

    fireEvent.change(screen.getByLabelText("Child issue default workflow"), {
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

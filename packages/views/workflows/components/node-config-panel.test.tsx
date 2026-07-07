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
  roles: [
    { id: "role-1", name: "Implementer" },
    { id: "role-2", name: "Reviewer" },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.roles }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowRolesOptions: () => ({ queryKey: ["workflow-roles"] }),
  useAssignNodeToStage: () => ({ mutate: mocks.assignStageMutate, isPending: false }),
  useCreateStage: () => ({ mutateAsync: mocks.createStageMutateAsync, isPending: false, error: null }),
  useDeleteNode: () => ({ mutateAsync: mocks.deleteNodeMutateAsync, isPending: false }),
}));

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: (selector: (state: unknown) => unknown) =>
    selector({
      nodeEdits: {},
      _undoRedoVersion: 0,
      cacheNodeEdits: mocks.cacheNodeEdits,
    }),
}));

vi.mock("../../issues/components/pickers/assignee-picker", () => ({
  AssigneePicker: ({
    assigneeType,
    assigneeId,
    trigger,
    triggerRender,
  }: {
    assigneeType: string | null;
    assigneeId: string | null;
    trigger?: ReactNode;
    triggerRender?: ReactElement;
  }) =>
    triggerRender
      ? cloneElement(triggerRender, {}, trigger)
      : (
        <button type="button">
          Assignee picker {assigneeType ?? "none"} {assigneeId ?? "unassigned"}
        </button>
      ),
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
    },
    overview: {
      stage_canvas: { unassigned: "Unassigned" },
      stage_dialog: { cancel: "Cancel" },
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
      format_schema_label: "JSON Schema",
      format_schema_hint: "Leave empty to skip format validation.",
      section_worker: "Worker",
      worker_type_human: "Human",
      worker_type_agent: "Agent",
      worker_type_squad: "Squad",
      section_critic: "Critic",
      critic_type_human: "Human",
      critic_type_agent: "Agent",
      critic_type_squad: "Squad",
      critic_type_api: "API",
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
    />,
  );
}

describe("NodeConfigPanel", () => {
  beforeEach(() => {
    mocks.cacheNodeEdits.mockReset();
  });

  it("renders Worker and Critic type segmented controls", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Worker type Human" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worker type Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worker type Squad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Worker type Role" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Critic type Human" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Critic type Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Critic type Squad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Critic type Role" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Critic type API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "agent: agent-1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "agent: agent-2" })).toBeInTheDocument();
  });

  it("switches Worker to Role and clears the previous worker assignment", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Worker type Role" }));

    expect(mocks.cacheNodeEdits).toHaveBeenCalledWith("node-1", {
      worker_type: "role",
      worker_id: null,
    });
    expect(screen.getByLabelText("Worker role")).toBeInTheDocument();
  });

  it("switches Critic to API and shows the API URL field", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Critic type API" }));

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
      started_at: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    });

    expect(screen.getByText("Latest run: critic_rework")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Worker type Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Critic type Agent" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("deliverables-editor")).not.toBeInTheDocument();
  });
});

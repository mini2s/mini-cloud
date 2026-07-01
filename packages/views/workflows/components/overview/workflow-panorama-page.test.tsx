// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WorkflowPanoramaPage } from "./workflow-panorama-page";
import { STAGE_MARKER_COLORS } from "./constants";
import type { Edge, Node } from "@xyflow/react";

// Hoisted mock data — allows per-test overrides via beforeEach
const mocks = vi.hoisted(() => ({
  stagesData: [
    { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
  ],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  workflowData: { id: "wf-1", title: "Test Workflow", status: "draft" },
  selectedNodeId: null as string | null,
  nodeEdits: {} as Record<string, unknown>,
  deletedNodeIds: [] as string[],
  createNodeMutate: vi.fn(),
  updateNodeMutate: vi.fn(),
  updateNodeMutateAsync: vi.fn(),
  assignStageMutate: vi.fn(),
  deleteNodeMutateAsync: vi.fn(),
  updateStageMutateAsync: vi.fn(),
  updateWorkflowMutate: vi.fn(),
  navigationPush: vi.fn(),
  selectNode: vi.fn(),
  clearNodeEdits: vi.fn(),
  cacheNodeDelete: vi.fn(),
  pushServerAction: vi.fn(),
  miniMapProps: null as null | {
    nodeColor?: (node: Node) => string;
  },
  reactFlowProps: null as null | {
    nodes: Node[];
    edges: Edge[];
    onNodeClick?: (event: React.MouseEvent, node: Node) => void;
    onPaneClick?: () => void;
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
    defaultViewport?: { x: number; y: number; zoom: number };
    colorMode?: string;
    children: React.ReactNode;
  },
}));

// ── Mocks ──

vi.mock("@multica/core/workflows/queries", () => ({
  workflowOverviewOptions: () => ({ queryKey: ["workflows", "detail"] }),
  workflowStagesOptions: () => ({ queryKey: ["stages"] }),
  workflowNodesOptions: () => ({ queryKey: ["nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["edges"] }),
  useCreateNode: () => ({ mutate: mocks.createNodeMutate, mutateAsync: vi.fn() }),
  useUpdateNode: () => ({ mutate: mocks.updateNodeMutate, mutateAsync: mocks.updateNodeMutateAsync }),
  useUpdateWorkflow: () => ({ mutate: mocks.updateWorkflowMutate, mutateAsync: vi.fn() }),
  useDeleteNode: () => ({ mutateAsync: mocks.deleteNodeMutateAsync }),
  useCreateEdge: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteEdge: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useAssignNodeToStage: () => ({ mutate: mocks.assignStageMutate, mutateAsync: vi.fn() }),
  useCreateStage: () => ({ mutateAsync: vi.fn() }),
  useUpdateStage: () => ({ mutateAsync: mocks.updateStageMutateAsync }),
  useDeleteStage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useReorderStages: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  builtinPluginListOptions: () => ({ queryKey: ["plugins"] }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => "Test Agent" }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@multica/core/workflows/store", () => {
  const mockUseStore: any = vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      selectedNodeId: mocks.selectedNodeId,
      selectedNodeIds: [],
      nodeEdits: mocks.nodeEdits,
      deletedNodeIds: mocks.deletedNodeIds,
      undoStack: [],
      redoStack: [],
      showAnnotations: true,
      canvasColorMode: "system" as "system" | "light" | "dark",
      selectNode: (nodeId: string | null) => {
        mocks.selectedNodeId = nodeId;
        mocks.selectNode(nodeId);
      },
      cacheNodeEdits: vi.fn(),
      cacheNodeDelete: mocks.cacheNodeDelete,
      clearNodeEdits: mocks.clearNodeEdits,
      clearNodeDelete: vi.fn(),
      pushServerAction: mocks.pushServerAction,
      cycleCanvasColorMode: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      toggleAnnotations: vi.fn(),
    };
    return selector(state);
  });
  mockUseStore.getState = () => ({
    nodeEdits: mocks.nodeEdits,
    deletedNodeIds: mocks.deletedNodeIds,
    undoStack: [],
    redoStack: [],
  });
  return { useWorkflowEditorStore: mockUseStore };
});

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ workflows: () => "/workflows" }),
}));

vi.mock("../../../i18n", () => {
  const translations = {
    status: {
      draft: "Draft",
      active: "Active",
      paused: "Paused",
      archived: "Archived",
    },
    detail: {
      activate: "Activate",
      deactivate: "Deactivate",
      back_to_workflows: "Back to workflows",
      save: "Save",
      saving: "Saving...",
      create_dialog: { create: "Create" },
      toast_activated: "Workflow activated",
      toast_deactivated: "Workflow deactivated",
      toast_activate_failed: "Failed to update workflow status",
      toast_deleted: "Workflow deleted",
      toast_delete_failed: "Failed to delete workflow",
      toast_saved: "Workflow saved",
      toast_save_failed: "Failed to save workflow",
      click_to_rename: "Click to rename",
      delete: "Delete",
      delete_dialog: {
        title: "Delete Workflow",
        description: "Delete workflow {{title}}?",
        cancel: "Cancel",
        confirm: "Delete",
        deleting: "Deleting...",
      },
      canvas_theme_system: "System theme",
      canvas_theme_light: "Light theme",
      canvas_theme_dark: "Dark theme",
    },
    overview: {
      stage_dialog: {
        create_title: "Create Stage",
        edit_title: "Edit Stage",
        name_label: "Stage name",
        name_placeholder: "e.g. Requirements, Design, Build",
        description_label: "Description (optional)",
        description_placeholder: "What happens in this stage?",
        cancel: "Cancel",
      },
    },
    panorama: {
      empty_all: "Create your first stage to get started",
      toolbar: {
        undo: "Undo",
        redo: "Redo",
        auto_layout: "Auto layout",
        annotations: "Toggle annotations",
        save: "Save changes",
        unsaved: "Unsaved changes",
      },
    },
  };

  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string, options?: Record<string, string>) => {
        let value = selector(translations);
        for (const [key, replacement] of Object.entries(options ?? {})) {
          value = value.replace(`{{${key}}}`, replacement);
        }
        return value;
      },
    }),
  };
});

// Mock ReactFlow to avoid complex DOM
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    children: React.ReactNode;
    nodes: Node[];
    edges: Edge[];
    onNodeClick?: (event: React.MouseEvent, node: Node) => void;
    onPaneClick?: () => void;
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
    defaultViewport?: { x: number; y: number; zoom: number };
    colorMode?: string;
  }) => {
    mocks.reactFlowProps = props;
    return <div data-testid="reactflow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: (props: { nodeColor?: (node: Node) => string }) => {
    mocks.miniMapProps = props;
    return <div data-testid="rf-minimap" />;
  },
  Handle: () => <div data-testid="rf-handle" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 200, y: y - 100 }),
  }),
}));

vi.mock("../node-config-panel", () => ({
  NodeConfigPanel: (props: {
    node: { id: string };
    onStageChange?: (nodeId: string, stageId: string | null) => void;
    onDeleteNode?: (nodeId: string) => void;
  }) => (
    <div data-testid="node-config-panel">
      <button type="button" onClick={() => props.onStageChange?.(props.node.id, "stage-2")}>
        Move to Stage 2
      </button>
      <button type="button" onClick={() => props.onDeleteNode?.(props.node.id)}>
        Delete Node
      </button>
    </div>
  ),
}));

// Mock TanStack Query — reads from hoisted mocks
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey.join(",");
    if (key.includes("stages")) return { data: mocks.stagesData, isLoading: false, isError: false };
    if (key.includes("nodes")) return { data: mocks.nodesData, isLoading: false, isError: false };
    if (key.includes("edges")) return { data: mocks.edgesData, isLoading: false, isError: false };
    if (key.includes("detail")) return { data: mocks.workflowData, isLoading: false, isError: false };
    if (key.includes("agents")) return { data: [], isLoading: false };
    if (key.includes("plugins")) return { data: { items: [] }, isLoading: false };
    return { data: null, isLoading: true, isError: false };
  },
}));

// ── Tests ──

describe("WorkflowPanoramaPage (new)", () => {
  beforeEach(() => {
    // Default: populated stages so the canvas view renders (non-empty state)
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.workflowData = { id: "wf-1", title: "Test Workflow", status: "draft" };
    mocks.nodesData = [];
    mocks.edgesData = [];
    mocks.selectedNodeId = null;
    mocks.nodeEdits = {};
    mocks.deletedNodeIds = [];
    mocks.createNodeMutate.mockReset();
    mocks.updateNodeMutate.mockReset();
    mocks.updateNodeMutateAsync.mockReset();
    mocks.assignStageMutate.mockReset();
    mocks.deleteNodeMutateAsync.mockReset();
    mocks.updateStageMutateAsync.mockReset();
    mocks.updateWorkflowMutate.mockReset();
    mocks.navigationPush.mockReset();
    mocks.selectNode.mockReset();
    mocks.clearNodeEdits.mockReset();
    mocks.reactFlowProps = null;
    mocks.miniMapProps = null;
  });

  it("renders the ReactFlow canvas", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("renders the toolbar buttons in the header", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto layout" })).toBeInTheDocument();
  });

  it("saves cached node edits and clears them when save button is clicked", async () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Server title", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };
    mocks.updateNodeMutateAsync.mockResolvedValueOnce({});

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const saveBtn = screen.getByRole("button", { name: "Save changes" });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await vi.waitFor(() => {
      expect(mocks.updateNodeMutateAsync).toHaveBeenCalledWith({
        nodeId: "node-1",
        title: "Edited title",
      });
      expect(mocks.clearNodeEdits).toHaveBeenCalledWith("node-1");
    });
  });

  it("renders the stage labels", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("canvas-stage-labels")).toBeInTheDocument();
  });

  it("starts the canvas content immediately after the stage label rail", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(mocks.reactFlowProps?.defaultViewport).toMatchObject({ x: 0 });
  });

  it("renders the add node button in the toolbar", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    const buttons = screen.getAllByRole("button", { name: "Add node" });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does not render an unassigned stage lane label", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("shows empty state when no stages", () => {
    mocks.stagesData = [];
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByText("Create Stage")).toBeInTheDocument();
  });

  it("renders critic badges as independent nodes below workers", () => {
    mocks.nodesData = [{
      id: "node-1",
      workflow_id: "wf-1",
      title: "Worker",
      description: "",
      worker_type: "agent",
      worker_id: "agent-1",
      critic_type: "agent",
      critic_id: "agent-2",
      critic_api_url: null,
      stage_id: "stage-1",
      format_schema: null,
      position_x: 320,
      position_y: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    }];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const critic = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1:critic");
    expect(critic).toMatchObject({
      type: "criticBadge",
      position: { x: 360, y: 96 },
      width: 144,
      height: 48,
    });
    expect(critic).not.toHaveProperty("parentId");
    expect(critic).not.toHaveProperty("extent");
  });

  it("filters deleted nodes and projects local edits before rendering", () => {
    mocks.nodesData = [
      {
        id: "node-1",
        workflow_id: "wf-1",
        title: "Server title",
        description: "",
        worker_type: "agent",
        worker_id: null,
        critic_type: "human",
        critic_id: null,
        critic_api_url: null,
        stage_id: "stage-1",
        format_schema: null,
        position_x: 120,
        position_y: 0,
        sort_order: 0,
        created_at: "",
        updated_at: "",
      },
      {
        id: "node-2",
        workflow_id: "wf-1",
        title: "Deleted",
        description: "",
        worker_type: "agent",
        worker_id: null,
        critic_type: "human",
        critic_id: null,
        critic_api_url: null,
        stage_id: "stage-1",
        format_schema: null,
        position_x: 420,
        position_y: 0,
        sort_order: 1,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title", critic_api_url: "https://critic.example.test" },
    };
    mocks.deletedNodeIds = ["node-2"];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const nodeIds = mocks.reactFlowProps?.nodes.map((n) => n.id) ?? [];
    expect(nodeIds).toContain("node-1");
    expect(nodeIds).toContain("node-1:critic");
    expect(nodeIds).not.toContain("node-2");
    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect((worker?.data.node as { title: string }).title).toBe("Edited title");
  });

  it("adds arrow markers and interaction width to panorama edges", () => {
    mocks.nodesData = [
      { id: "a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 460, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];
    mocks.edgesData = [{ id: "e-1", workflow_id: "wf-1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" }];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.reactFlowProps?.edges[0]).toMatchObject({
      markerEnd: { type: "arrowclosed", color: STAGE_MARKER_COLORS[0] },
      interactionWidth: 24,
      sourceHandle: "right",
      targetHandle: "left",
    });
    expect((mocks.reactFlowProps?.edges[0]?.markerEnd as { color?: string } | undefined)?.color).not.toContain("/");
  });

  it("routes steep worker edges through existing worker handles", () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
      { id: "stage-2", workflow_id: "wf-1", name: "Stage 2", description: "", sort_order: 1, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [
      { id: "a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-2", format_schema: null, position_x: 110, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];
    mocks.edgesData = [{ id: "e-1", workflow_id: "wf-1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" }];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.reactFlowProps?.edges[0]).toMatchObject({
      sourceHandle: "bottom",
      targetHandle: "left",
    });
  });

  it("creates a node when a shape is dropped on the canvas", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const preventDefault = vi.fn();
    const dropEvent = {
      preventDefault,
      clientX: 500,
      clientY: 120,
      dataTransfer: { getData: vi.fn(() => "diamond") },
    } as unknown as React.DragEvent;

    mocks.reactFlowProps?.onDrop?.(dropEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(mocks.createNodeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Diamond",
        stage_id: "stage-1",
        position_x: 300,
        format_schema: { shape: "diamond" },
      }),
      expect.any(Object),
    );
  });

  it("opens stage editing with the selected stage data and updates that stage", async () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Intake", description: "Collect context", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.updateStageMutateAsync.mockResolvedValueOnce({});

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByLabelText("Edit stage"));
    const input = screen.getByTestId("stage-name-input") as HTMLInputElement;
    expect(input.value).toBe("Intake");

    fireEvent.change(input, { target: { value: "Discovery" } });
    fireEvent.submit(input.closest("form")!);

    expect(mocks.updateStageMutateAsync).toHaveBeenCalledWith({
      stageId: "stage-1",
      name: "Discovery",
      description: "Collect context",
    });
  });

  it("closes the node config panel when the empty canvas is clicked", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();

    act(() => {
      mocks.reactFlowProps?.onPaneClick?.();
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.queryByTestId("node-config-panel")).not.toBeInTheDocument();
    expect(mocks.selectNode).toHaveBeenLastCalledWith(null);
  });

  it("moves a node to an open x slot when its stage changes from the config panel", () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
      { id: "stage-2", workflow_id: "wf-1", name: "Stage 2", description: "", sort_order: 1, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [
      { id: "existing-a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-2", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "existing-b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-2", format_schema: null, position_x: 440, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
      { id: "moving", workflow_id: "wf-1", title: "Moving", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 2, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const movingNode = mocks.reactFlowProps?.nodes.find((n) => n.id === "moving");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, movingNode!);
    });
    fireEvent.click(screen.getByText("Move to Stage 2"));

    expect(mocks.updateNodeMutate).toHaveBeenCalledWith({
      nodeId: "moving",
      position_x: 760,
    });
    expect(mocks.assignStageMutate).toHaveBeenCalledWith({
      nodeId: "moving",
      stage_id: "stage-2",
    });
  });

  it("deletes nodes immediately from the config panel without waiting for manual save", async () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.deleteNodeMutateAsync.mockResolvedValueOnce(undefined);

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });

    fireEvent.click(screen.getByText("Delete Node"));

    expect(mocks.deleteNodeMutateAsync).toHaveBeenCalledWith("node-1");
  });

  it("closes the config panel when a lane background node is clicked", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    // Open panel first by clicking a worker node
    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();

    // Click a lane background node — should close the panel
    const laneBg = mocks.reactFlowProps?.nodes.find((n) => n.id === "lane-bg-stage-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, laneBg!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.queryByTestId("node-config-panel")).not.toBeInTheDocument();
    expect(mocks.selectNode).toHaveBeenLastCalledWith(null);
  });

  it("hides background lane nodes from the minimap and sets node dimensions", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.miniMapProps?.nodeColor?.({ type: "laneBg" } as Node)).toBe("transparent");
    expect(mocks.miniMapProps?.nodeColor?.({ type: "compactWorker" } as Node)).toBe("#64748b");

    // Nodes must carry explicit width/height so MiniMap can render them
    // before the ResizeObserver fires (nodeHasDimensions check in @xyflow/system)
    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect(worker).toMatchObject({ width: 224, height: 64 });
    const laneBg = mocks.reactFlowProps?.nodes.find((n) => n.id === "lane-bg-stage-1");
    expect(laneBg).toMatchObject({ width: 2400, height: 160 });
  });

  it("renders workflow title, back button, and status toggle in the header", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(screen.getByRole("heading", { name: "Test Workflow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to workflows" }));
    expect(mocks.navigationPush).toHaveBeenCalledWith("/workflows");
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("activates draft workflows and deactivates active workflows from the header", () => {
    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(mocks.updateWorkflowMutate).toHaveBeenCalledWith(
      { id: "wf-1", status: "active" },
      expect.any(Object),
    );

    mocks.updateWorkflowMutate.mockReset();
    mocks.workflowData = { id: "wf-1", title: "Test Workflow", status: "active" };
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(mocks.updateWorkflowMutate).toHaveBeenCalledWith(
      { id: "wf-1", status: "paused" },
      expect.any(Object),
    );
  });

  it("allows clicking the title to edit and saving on blur", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const heading = screen.getByRole("heading", { name: "Test Workflow" });
    fireEvent.click(heading);

    const input = screen.getByDisplayValue("Test Workflow") as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Renamed Workflow" } });
    fireEvent.blur(input);

    expect(mocks.updateWorkflowMutate).toHaveBeenCalledWith({ id: "wf-1", title: "Renamed Workflow" });
  });

  it("cancels title editing on Escape without saving", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("heading", { name: "Test Workflow" }));
    const input = screen.getByDisplayValue("Test Workflow");
    fireEvent.change(input, { target: { value: "Unsaved" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mocks.updateWorkflowMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Test Workflow" })).toBeInTheDocument();
  });

  it("renders a delete button in the header", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("opens the delete confirmation dialog", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Workflow")).toBeInTheDocument();
  });

  it("renders the theme toggle button", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByRole("button", { name: "System theme" })).toBeInTheDocument();
  });

  it("passes colorMode to ReactFlow", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(mocks.reactFlowProps?.colorMode).toBe("system");
  });
});

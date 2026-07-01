// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowPanoramaPage } from "./workflow-panorama-page";
import type { Edge, Node } from "@xyflow/react";

// Hoisted mock data — allows per-test overrides via beforeEach
const mocks = vi.hoisted(() => ({
  stagesData: [
    { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
  ],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  selectedNodeId: null as string | null,
  nodeEdits: {} as Record<string, unknown>,
  deletedNodeIds: [] as string[],
  createNodeMutate: vi.fn(),
  reactFlowProps: null as null | {
    nodes: Node[];
    edges: Edge[];
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
    defaultViewport?: { x: number; y: number; zoom: number };
  },
}));

// ── Mocks ──

vi.mock("@multica/core/workflows/queries", () => ({
  workflowOverviewOptions: () => ({ queryKey: ["workflows", "detail"] }),
  workflowStagesOptions: () => ({ queryKey: ["stages"] }),
  workflowNodesOptions: () => ({ queryKey: ["nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["edges"] }),
  useCreateNode: () => ({ mutate: mocks.createNodeMutate, mutateAsync: vi.fn() }),
  useUpdateNode: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteNode: () => ({ mutateAsync: vi.fn() }),
  useCreateEdge: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteEdge: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useAssignNodeToStage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useCreateStage: () => ({ mutateAsync: vi.fn() }),
  useDeleteStage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
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

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      selectedNodeId: mocks.selectedNodeId,
      selectedNodeIds: [],
      nodeEdits: mocks.nodeEdits,
      deletedNodeIds: mocks.deletedNodeIds,
      undoStack: [],
      redoStack: [],
      showAnnotations: true,
      canvasColorMode: "system",
      selectNode: vi.fn(),
      cacheNodeEdits: vi.fn(),
      cacheNodeDelete: vi.fn(),
      clearNodeEdits: vi.fn(),
      clearNodeDelete: vi.fn(),
      pushServerAction: vi.fn(),
    };
    return selector(state);
  }),
}));

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ workflows: () => "/workflows" }),
}));

vi.mock("../../../i18n", () => ({
  useT: () => ({ t: () => "Test label" }),
}));

// Mock ReactFlow to avoid complex DOM
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    children: React.ReactNode;
    nodes: Node[];
    edges: Edge[];
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
    defaultViewport?: { x: number; y: number; zoom: number };
  }) => {
    mocks.reactFlowProps = props;
    return <div data-testid="reactflow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  Handle: () => <div data-testid="rf-handle" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo: vi.fn(),
    setCenter: vi.fn(),
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 200, y: y - 100 }),
  }),
}));

// Mock TanStack Query — reads from hoisted mocks
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey.join(",");
    if (key.includes("stages")) return { data: mocks.stagesData, isLoading: false, isError: false };
    if (key.includes("nodes")) return { data: mocks.nodesData, isLoading: false, isError: false };
    if (key.includes("edges")) return { data: mocks.edgesData, isLoading: false, isError: false };
    if (key.includes("detail")) return {
      data: { id: "wf-1", title: "Test Workflow", status: "draft" },
      isLoading: false,
      isError: false,
    };
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
    mocks.nodesData = [];
    mocks.edgesData = [];
    mocks.selectedNodeId = null;
    mocks.nodeEdits = {};
    mocks.deletedNodeIds = [];
    mocks.createNodeMutate.mockReset();
    mocks.reactFlowProps = null;
  });

  it("renders the ReactFlow canvas", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
  });

  it("renders the toolbar", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("panorama-toolbar")).toBeInTheDocument();
  });

  it("renders the stage labels", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByTestId("canvas-stage-labels")).toBeInTheDocument();
  });

  it("renders the node palette", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByLabelText("Rectangle")).toBeInTheDocument();
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
      position: { x: 320, y: 96 },
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
      markerEnd: { type: "arrowclosed" },
      interactionWidth: 24,
      sourceHandle: "right",
      targetHandle: "left",
    });
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
    expect(mocks.createNodeMutate).toHaveBeenCalledWith(expect.objectContaining({
      title: "Diamond",
      stage_id: "stage-1",
      position_x: 300,
      format_schema: { shape: "diamond" },
    }));
  });
});

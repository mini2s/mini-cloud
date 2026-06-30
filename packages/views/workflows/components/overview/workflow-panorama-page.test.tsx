// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowPanoramaPage } from "./workflow-panorama-page";

// Hoisted mock data — allows per-test overrides via beforeEach
const mocks = vi.hoisted(() => ({
  stagesData: [
    { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
  ],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  selectedNodeId: null as string | null,
}));

// ── Mocks ──

vi.mock("@multica/core/workflows/queries", () => ({
  workflowOverviewOptions: () => ({ queryKey: ["workflows", "detail"] }),
  workflowStagesOptions: () => ({ queryKey: ["stages"] }),
  workflowNodesOptions: () => ({ queryKey: ["nodes"] }),
  workflowEdgesOptions: () => ({ queryKey: ["edges"] }),
  useCreateNode: () => ({ mutateAsync: vi.fn() }),
  useUpdateNode: () => ({ mutateAsync: vi.fn() }),
  useDeleteNode: () => ({ mutateAsync: vi.fn() }),
  useCreateEdge: () => ({ mutateAsync: vi.fn() }),
  useDeleteEdge: () => ({ mutateAsync: vi.fn() }),
  useAssignNodeToStage: () => ({ mutateAsync: vi.fn() }),
  useCreateStage: () => ({ mutateAsync: vi.fn() }),
  useDeleteStage: () => ({ mutateAsync: vi.fn() }),
  useReorderStages: () => ({ mutateAsync: vi.fn() }),
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
      nodeEdits: {},
      deletedNodeIds: [],
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
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow">{children}</div>,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  Handle: () => <div data-testid="rf-handle" />,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
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
});

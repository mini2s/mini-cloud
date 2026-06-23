// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../../test/i18n";

// ── Mock data ──────────────────────────────────────────────────

const MOCK_WORKFLOW = { id: "wf-1", title: "Test Workflow" };

const MOCK_STAGES = [
  { id: "s1", workflow_id: "wf-1", name: "Design", description: "", sort_order: 0, node_count: 2, created_at: "", updated_at: "" },
  { id: "s2", workflow_id: "wf-1", name: "Build", description: "", sort_order: 1, node_count: 1, created_at: "", updated_at: "" },
];

const MOCK_NODES = [
  { id: "n1", workflow_id: "wf-1", stage_id: "s1", title: "Architecture", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent" as const, worker_id: null, critic_type: "human" as const, critic_id: null, critic_api_url: null, sort_order: 0, created_at: "", updated_at: "", shape: "rectangle" as const },
  { id: "n2", workflow_id: "wf-1", stage_id: "s2", title: "Implement", description: "", position_x: 0, position_y: 0, format_schema: null, worker_type: "agent" as const, worker_id: null, critic_type: "human" as const, critic_id: null, critic_api_url: null, sort_order: 0, created_at: "", updated_at: "", shape: "rectangle" as const },
];

const MOCK_EDGES = [
  { id: "e1", workflow_id: "wf-1", source_node_id: "n1", target_node_id: "n2" },
];

// ── Hoisted mocks ──────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  workflowData: undefined as unknown,
  stagesData: [] as unknown[],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  isLoading: false,
  isError: false,
  navigationPush: vi.fn(),
}));

// ── Mock @tanstack/react-query ─────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = opts.queryKey ?? [];
    if (Array.isArray(key) && key.includes("stages")) {
      return { data: mocks.stagesData, isLoading: mocks.isLoading, isError: mocks.isError };
    }
    if (Array.isArray(key) && key.includes("nodes")) {
      return { data: mocks.nodesData, isLoading: false, isError: false };
    }
    if (Array.isArray(key) && key.includes("edges")) {
      return { data: mocks.edgesData, isLoading: false, isError: false };
    }
    return { data: mocks.workflowData, isLoading: mocks.isLoading, isError: mocks.isError, refetch: vi.fn() };
  },
  useMutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── Mock external packages ─────────────────────────────────────

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowDetailOptions: (_wsId: string, id: string) => ({ queryKey: ["workflows", "ws-1", "detail", id] }),
  workflowStagesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "stages"] }),
  workflowNodesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "nodes"] }),
  workflowEdgesOptions: (_wsId: string, workflowId: string) => ({ queryKey: ["workflows", "ws-1", workflowId, "edges"] }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    workflowDetail: (id: string) => `/ws-1/workflows/${id}`,
    workflows: () => "/ws-1/workflows",
  }),
}));

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush, replace: mocks.navigationPush }),
}));

// ── Mock ReactFlow ─────────────────────────────────────────────

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => (
    <div data-testid="swimlane-reactflow">
      <div data-testid="rf-nodecount">{(props.nodes as unknown[]).length}</div>
      <div data-testid="rf-edgecount">{(props.edges as unknown[]).length}</div>
      <button
        data-testid="rf-nodeclick"
        onClick={() => {
          const onNodeClick = props.onNodeClick as ((e: unknown, n: { id: string }) => void) | undefined;
          onNodeClick?.(null as unknown as React.MouseEvent, { id: "n1" });
        }}
      />
      <button
        data-testid="rf-nodeclick-n2"
        onClick={() => {
          const onNodeClick = props.onNodeClick as ((e: unknown, n: { id: string }) => void) | undefined;
          onNodeClick?.(null as unknown as React.MouseEvent, { id: "n2" });
        }}
      />
      {props.children as React.ReactNode}
    </div>
  ),
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

// ── Mock NodeDetailPanel ───────────────────────────────────────

vi.mock("../overview/node-detail-panel", () => ({
  NodeDetailPanel: (props: { nodeId: string; nodes: unknown[]; edges: unknown[]; onClose: () => void }) => (
    <div data-testid="node-detail-panel">
      <span data-testid="detail-node-id">{props.nodeId}</span>
      <button data-testid="node-detail-close" onClick={props.onClose}>Close</button>
    </div>
  ),
}));

// ── Tests ──────────────────────────────────────────────────────

import { WorkflowSwimlanePage } from "./workflow-swimlane-page";

describe("WorkflowSwimlanePage", () => {
  beforeEach(() => {
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.workflowData = MOCK_WORKFLOW;
    mocks.stagesData = MOCK_STAGES;
    mocks.nodesData = MOCK_NODES;
    mocks.edgesData = MOCK_EDGES;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading skeleton", () => {
    mocks.isLoading = true;
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-skeleton")).toBeTruthy();
  });

  it("renders error state", () => {
    mocks.isError = true;
    mocks.workflowData = undefined;
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders ReactFlow canvas with nodes", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-reactflow")).toBeTruthy();
    // 2 nodes should be rendered
    expect(screen.getByTestId("rf-nodecount").textContent).toBe("2");
  });

  it("renders edges in ReactFlow", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("rf-edgecount").textContent).toBe("1");
  });

  it("renders lane overlay", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("swimlane-overlay")).toBeTruthy();
  });

  it("opens node detail panel on node click", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("node-detail-panel")).toBeTruthy();
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n1");
  });

  it("closes node detail panel", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("node-detail-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("node-detail-close"));
    expect(screen.queryByTestId("node-detail-panel")).toBeNull();
  });

  it("switches detail panel to different node", () => {
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    fireEvent.click(screen.getByTestId("rf-nodeclick"));
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n1");
    fireEvent.click(screen.getByTestId("rf-nodeclick-n2"));
    expect(screen.getByTestId("detail-node-id").textContent).toBe("n2");
  });

  it("shows empty state when no nodes", () => {
    mocks.nodesData = [];
    mocks.edgesData = [];
    renderWithI18n(<WorkflowSwimlanePage workflowId="wf-1" />);
    expect(screen.getByTestId("rf-nodecount").textContent).toBe("0");
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ExecutionPanoramaPage, decorateRuntimeEdges } from "./execution-panorama-page";
import { RUNTIME_NODE_HEIGHT, RUNTIME_SPLIT_NODE_HEIGHT } from "./runtime-node-card";
import { WORKER_WIDTH } from "../../../workflows/components/overview/constants";
import type { Edge, Viewport } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Hoisted mock state — lets each test control query behaviour
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  workflowData: undefined as unknown,
  stagesData: undefined as unknown as unknown[],
  nodesData: undefined as unknown as unknown[],
  edgesData: undefined as unknown as unknown[],
  nodeRunsData: undefined as unknown as unknown[],
  canvasSummaryData: undefined as unknown,
  agentsData: undefined as unknown as unknown[],
  membersData: undefined as unknown as unknown[],
  squadsData: undefined as unknown as unknown[],
  workflowOptionsData: undefined as unknown,
  childIssuesData: [] as unknown[],
  splitTasksByNodeRunId: {} as Record<string, unknown>,
  deliverableDefinitionsByNodeId: {} as Record<string, unknown>,
  deliverableSubmissionsByNodeRunId: {} as Record<string, unknown>,
  pluginsData: undefined as unknown,
  workflowRolesData: [] as unknown[],
  roleResolutionsData: [] as unknown[],
  chatSessionsData: [] as unknown[],
  embedded: false,
  postCostrictNavigateToSession: vi.fn(),
  setChatSession: vi.fn(),
  setChatOpen: vi.fn(),
  hasOpenInNewTab: true,
  isLoading: true,
  navigationPush: vi.fn(),
  openInNewTab: vi.fn(),
  onNodeClick: vi.fn(),
  fitView: vi.fn(),
  setCenter: vi.fn(),
  setReactFlowViewport: vi.fn(),
  getViewport: vi.fn(() => ({ x: 0, y: 24, zoom: 0.95 })),
  nodesInitialized: true,
  viewportInitialized: true,
  retryNodeRun: vi.fn(),
  useWorkspacePresenceMap: vi.fn(() => ({
    byAgent: new Map<string, { availability: "online" | "offline" | "unstable" }>(),
    loading: false,
  })),
  reactFlowProps: null as null | {
    nodes: Array<{
      id: string;
      type?: string;
      width?: number;
      height?: number;
      position: { x: number; y: number };
      data?: Record<string, unknown>;
      markerEnd?: { color?: string };
    }>;
    edges: Array<{
      id: string;
      data?: Record<string, unknown>;
      markerEnd?: { color?: string };
    }>;
    onNodeClick?: (event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeDoubleClick?: (event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onMove?: (event: unknown, viewport: Viewport) => void;
  },
  queryOptions: [] as Array<{ queryKey?: unknown[]; enabled?: boolean }>,
}));

// ---------------------------------------------------------------------------
// Mock @tanstack/react-query — check query keys to route data
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...(actual as object),
    useQuery: (opts: { queryKey?: unknown[]; enabled?: boolean }) => {
      mocks.queryOptions.push(opts);
      const key = opts.queryKey ?? [];
      const enabled = opts.enabled !== false;
      if (!enabled) return { data: undefined, isLoading: false };

      if (Array.isArray(key)) {
        if (key.includes("stages"))
          return { data: mocks.stagesData, isLoading: mocks.isLoading };
        if (key.includes("nodes"))
          return { data: mocks.nodesData, isLoading: mocks.isLoading };
        if (key.includes("edges"))
          return { data: mocks.edgesData, isLoading: mocks.isLoading };
        if (key.includes("canvas-summary")) {
          const source = mocks.canvasSummaryData && typeof mocks.canvasSummaryData === "object"
            ? mocks.canvasSummaryData as Record<string, unknown>
            : {
                node_runs: mocks.nodeRunsData,
                node_runtime_summaries: [],
              };
          const data = {
                run: {
                  id: "run-1",
                  workflow_id: "wf-1",
                  definition_schema_version: 0,
                  definition_snapshot: null,
                },
                ...source,
              };
          return { data, isLoading: false };
        }
        if (key.includes("node-runs"))
          return { data: mocks.nodeRunsData, isLoading: false };
        if (key.includes("agents"))
          return { data: mocks.agentsData, isLoading: false };
        if (key.includes("members"))
          return { data: mocks.membersData, isLoading: false };
        if (key.includes("squads"))
          return { data: mocks.squadsData, isLoading: false };
        if (key.includes("plugins"))
          return { data: mocks.pluginsData, isLoading: false };
        if (key.includes("role-resolutions"))
          return { data: mocks.roleResolutionsData, isLoading: false };
        if (key.includes("roles"))
          return { data: mocks.workflowRolesData, isLoading: false };
        if (key[0] === "chat" && key.includes("sessions"))
          return { data: mocks.chatSessionsData, isLoading: false };
        if (key.includes("split-issue-workflow-options"))
          return { data: mocks.workflowOptionsData, isLoading: false };
        if (key.includes("children"))
          return { data: mocks.childIssuesData, isLoading: false };
        return { data: mocks.workflowData, isLoading: mocks.isLoading };
      }
      return { data: undefined, isLoading: true };
    },
    useQueries: ({ queries }: { queries: Array<{ queryKey?: unknown[]; enabled?: boolean }> }) =>
      queries.map((opts) => {
        mocks.queryOptions.push(opts);
        const key = opts.queryKey ?? [];
        const enabled = opts.enabled !== false;
        if (key.includes("node-deliverable-definitions")) {
          const markerIndex = key.indexOf("node-deliverable-definitions");
          const nodeId = String(key[markerIndex + 1] ?? "");
          return {
            data: enabled ? mocks.deliverableDefinitionsByNodeId[nodeId] : undefined,
            isLoading: false,
          };
        }
        if (key.includes("node-deliverable-submissions")) {
          const markerIndex = key.indexOf("node-deliverable-submissions");
          const nodeRunId = String(key[markerIndex + 1] ?? "");
          return {
            data: enabled ? mocks.deliverableSubmissionsByNodeRunId[nodeRunId] : undefined,
            isLoading: false,
          };
        }
        const nodeRunsIndex = Array.isArray(key) ? key.indexOf("node-runs") : -1;
        const nodeRunId = nodeRunsIndex >= 0 ? String(key[nodeRunsIndex + 1] ?? "") : "";
        return {
          data: enabled ? mocks.splitTasksByNodeRunId[nodeRunId] : undefined,
          isLoading: false,
        };
      }),
    useMutation: () => ({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isPending: false,
    }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

// ---------------------------------------------------------------------------
// Mock query-option modules (return keys so useQuery mock can route)
// ---------------------------------------------------------------------------
vi.mock("@multica/core/workflows/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/workflows/queries")>()),
  workflowDetailOptions: (wsId: string, id: string) => ({
    queryKey: ["workflows", wsId, "detail", id],
  }),
  workflowStagesOptions: (wsId: string, workflowId: string) => ({
    queryKey: ["workflows", wsId, workflowId, "stages"],
  }),
  workflowNodesOptions: (wsId: string, workflowId: string) => ({
    queryKey: ["workflows", wsId, workflowId, "nodes"],
  }),
  workflowEdgesOptions: (wsId: string, workflowId: string) => ({
    queryKey: ["workflows", wsId, workflowId, "edges"],
  }),
  workflowNodeRunsOptions: (wsId: string, workflowId: string, runId: string) => ({
    queryKey: ["workflows", wsId, workflowId, runId, "node-runs"],
  }),
  workflowRunCanvasSummaryOptions: (wsId: string, workflowId: string, runId: string) => ({
    queryKey: ["workflows", wsId, workflowId, runId, "canvas-summary"],
  }),
  workflowRolesOptions: (wsId: string) => ({
    queryKey: ["workflows", wsId, "roles"],
  }),
  workflowRoleResolutionsOptions: (
    wsId: string,
    workflowId: string,
    runId: string,
  ) => ({
    queryKey: ["workflows", wsId, workflowId, runId, "role-resolutions"],
  }),
  workflowNodeDeliverablesOptions: (_wsId: string, _workflowId: string, nodeId: string) => ({
    queryKey: ["workflows", "node-deliverable-definitions", nodeId],
  }),
  nodeRunDeliverableSubmissionsOptions: (_wsId: string, nodeRunId: string) => ({
    queryKey: ["workflows", "node-deliverable-submissions", nodeRunId],
  }),
  splitTasksOptions: (wsId: string, nodeRunId: string | null | undefined) => ({
    queryKey: ["workflows", wsId, "node-runs", nodeRunId ?? "", "split-tasks"],
    enabled: !!nodeRunId,
  }),
  splitIssueWorkflowOptions: (wsId: string, workflowId: string | null | undefined) => ({
    queryKey: ["workflows", wsId, workflowId ?? "", "split-issue-workflow-options"],
    enabled: !!workflowId,
  }),
  workflowKeys: {
    nodeRuns: (wsId: string, wfId: string, runId: string) => [
      "workflows",
      wsId,
      wfId,
      runId,
      "node-runs",
    ],
    runCanvasSummary: (wsId: string, wfId: string, runId: string) => [
      "workflows",
      wsId,
      wfId,
      runId,
      "canvas-summary",
    ],
  },
  useSubmitNodeRun: () => ({ mutate: vi.fn() }),
  useReviewNodeRun: () => ({ mutate: vi.fn() }),
  useSkipNodeRun: () => ({ mutate: vi.fn() }),
  useTakeoverNodeRun: () => ({ mutate: vi.fn() }),
  useHandbackNodeRun: () => ({ mutate: vi.fn() }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: (wsId: string) => ({
    queryKey: ["workspaces", wsId, "agents"],
  }),
  memberListOptions: (wsId: string) => ({
    queryKey: ["workspaces", wsId, "members"],
  }),
  squadListOptions: (wsId: string) => ({
    queryKey: ["workspaces", wsId, "squads"],
  }),
  builtinPluginListOptions: () => ({
    queryKey: ["plugins", "builtin"],
  }),
}));

vi.mock("@multica/core/issues/queries", () => ({
  childIssuesOptions: (wsId: string, issueId: string) => ({
    queryKey: ["issues", wsId, issueId, "children"],
    enabled: !!issueId,
  }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    retryNodeRun: mocks.retryNodeRun,
  },
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatSessionsOptions: (wsId: string) => ({
    queryKey: ["chat", wsId, "sessions"],
  }),
}));

vi.mock("@multica/core/chat", () => ({
  useChatStore: (selector: (state: {
    setActiveSession: typeof mocks.setChatSession;
    setOpen: typeof mocks.setChatOpen;
  }) => unknown) => selector({
    setActiveSession: mocks.setChatSession,
    setOpen: mocks.setChatOpen,
  }),
}));

vi.mock("@multica/core/platform", () => ({
  isEmbeddedInCostrict: () => mocks.embedded,
  postCostrictNavigateToSession: (args: unknown) =>
    mocks.postCostrictNavigateToSession(args),
}));

vi.mock("@multica/core/agents", () => ({
  useWorkspacePresenceMap: mocks.useWorkspacePresenceMap,
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (issueId: string) => `/demo111/issues/${issueId}`,
  }),
}));

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({
    push: mocks.navigationPush,
    ...(mocks.hasOpenInNewTab ? { openInNewTab: mocks.openInNewTab } : {}),
    getShareableUrl: (path: string) => `https://app.multica.test${path}`,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../i18n", () => ({
  useT: (_namespace: string) => ({
    t: (selector: (value: unknown) => string) =>
      selector({
        builtin_roles: {
          developer: { name: "Developer", description: "Builds changes" },
          qa: { name: "QA", description: "Validates changes" },
          tech_lead: { name: "Tech Lead", description: "Tech direction" },
        },
        run: {
          roles: {
            unknown_node: "Unknown node",
          },
        },
        panorama: {
          card: {
            actor_type_agent: "Digital human",
            actor_type_member: "Member",
            actor_type_squad: "Squad",
            actor_type_role: "Development role",
            actor_type_api: "API reviewer",
            actor_online: "Online",
            actor_offline: "Offline",
          },
        },
        execution: {
          card: {
            child_issue_fallback: "Child issue",
            child_workflow_running: "Workflow in progress",
            child_waiting_dependencies: "Waiting for dependencies",
            child_waiting_workflow: "Waiting for workflow to start",
            child_workflow_completed: "Workflow completed",
            child_workflow_failed: "Workflow failed",
            child_workflow_cancelled: "Cancelled",
            child_workflow_skipped: "Skipped because a dependency failed",
          },
          display_status: {
            pending: "Pending",
            todo: "To do",
            in_progress: "In progress",
            reviewing: "Reviewing",
            completed: "Completed",
            blocked: "Blocked",
            cancelled: "Cancelled",
          },
        },
      }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock child components
// ---------------------------------------------------------------------------
vi.mock("./execution-detail-panel", () => ({
  ExecutionDetailPanel: ({
    node,
    nodeRun,
    onClose,
    onOpenIssue,
    onRetry,
    isChildIssue,
    parentSplitTitle,
  }: {
    node: { title: string };
    nodeRun: { status: string } | null;
    onClose: () => void;
    onOpenIssue?: () => void;
    onRetry?: () => void;
    isChildIssue?: boolean;
    parentSplitTitle?: string | null;
  }) => (
    <div data-testid="execution-detail-panel">
      <span data-testid="detail-panel-title">{node.title}</span>
      <span data-testid="detail-panel-status">{nodeRun?.status ?? "no-run"}</span>
      <span data-testid="detail-panel-is-child">{String(isChildIssue === true)}</span>
      <span data-testid="detail-panel-parent-split">{parentSplitTitle ?? "no-parent"}</span>
      {onOpenIssue ? (
        <button type="button" onClick={onOpenIssue}>
          Open issue
        </button>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry from panel
        </button>
      ) : null}
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock("../../../workflows/components/split/split-review-panel", () => ({
  SplitReviewPanel: ({
    nodeRun,
    parentIssueId,
    onClose,
  }: {
    nodeRun: { status: string } | null;
    parentIssueId?: string;
    onClose: () => void;
  }) => (
    <div data-testid="execution-split-review-panel">
      <span data-testid="split-panel-status">{nodeRun?.status ?? "no-run"}</span>
      <span data-testid="split-panel-parent-issue-id">{parentIssueId ?? "no-parent-issue"}</span>
      <button onClick={onClose}>Close split panel</button>
    </div>
  ),
}));


vi.mock("./global-notification-bar", () => ({
  GlobalNotificationBar: ({
    nodeRunMap,
    onScrollToNode,
  }: {
    nodeRunMap: Map<string, unknown>;
    onScrollToNode: (nodeId: string) => void;
  }) => {
    const firstNodeId = [...nodeRunMap.keys()][0];
    if (!firstNodeId) return null;
    return (
      <button
        type="button"
        data-testid="notification-item-test"
        onClick={() => onScrollToNode(firstNodeId)}
      >
        Jump
      </button>
    );
  },
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    nodes?: Array<{
      id: string;
      type?: string;
      width?: number;
      height?: number;
      position: { x: number; y: number };
      data?: Record<string, unknown>;
    }>;
    edges?: Array<{
      id: string;
      data?: Record<string, unknown>;
      markerEnd?: { color?: string };
    }>;
    defaultViewport?: { x: number; y: number; zoom: number };
    fitView?: boolean;
    fitViewOptions?: { maxZoom?: number; padding?: number };
    onNodeClick?: (event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onNodeDoubleClick?: (event: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    onMove?: (event: unknown, viewport: Viewport) => void;
    children?: ReactNode;
  }) => {
    mocks.reactFlowProps = {
      nodes: props.nodes ?? [],
      edges: props.edges ?? [],
      onNodeClick: props.onNodeClick,
      onNodeDoubleClick: props.onNodeDoubleClick,
      onMove: props.onMove,
    };
    return (
      <div
        data-testid="reactflow-canvas"
        data-node-count={props.nodes?.length ?? 0}
        data-edge-count={props.edges?.length ?? 0}
        data-default-zoom={props.defaultViewport?.zoom}
        data-fit-view={props.fitView ? "true" : "false"}
        data-fit-view-max-zoom={props.fitViewOptions?.maxZoom}
      >
        {props.children}
      </div>
    );
  },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="reactflow-background" />,
  Controls: () => <div data-testid="reactflow-controls" />,
  MiniMap: () => <div data-testid="reactflow-minimap" />,
  useReactFlow: () => ({
    fitView: mocks.fitView,
    setCenter: mocks.setCenter,
    setViewport: mocks.setReactFlowViewport,
    getViewport: mocks.getViewport,
    viewportInitialized: mocks.viewportInitialized,
  }),
  useNodesInitialized: () => mocks.nodesInitialized,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  Position: { Left: "left", Right: "right", Bottom: "bottom", Top: "top" },
  Handle: () => <div />,
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

// ---------------------------------------------------------------------------
// Test wrapper
// ---------------------------------------------------------------------------
function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STAGE = {
  id: "stage-1",
  workflow_id: "wf-1",
  name: "Intake",
  description: "",
  sort_order: 0,
  node_count: 0,
  created_at: "",
  updated_at: "",
};

const NODE = {
  id: "n1",
  workflow_id: "wf-1",
  title: "brainstorming",
  description: "",
  position_x: 0,
  position_y: 0,
  format_schema: null,
  worker_type: "agent" as const,
  worker_id: "agent-1",
  critic_type: "human" as const,
  critic_id: null,
  critic_api_url: null,
  sort_order: 0,
  stage_id: "stage-1",
  created_at: "",
  updated_at: "",
};

const SPLIT_NODE = {
  ...NODE,
  id: "split-1",
  title: "Split implementation",
  format_schema: {
    type: "split",
    split_config: {
      default_issue_workflow_id: "child-wf-1",
      mode: "barrier",
      max_concurrency: 3,
      max_failures: 0,
    },
  },
};

const SPLIT_NODE_RUN = {
  id: "split-run-1",
  workflow_run_id: "run-1",
  workflow_node_id: "split-1",
  node_title: "Split implementation",
  status: "split_active",
  retry_count: 0,
  worker_type: "agent",
  worker_id: "agent-1",
  worker_output: null,
  worker_agent_task_id: null,
  critic_type: "human",
  critic_id: null,
  critic_output: null,
  critic_comment: "",
  critic_agent_task_id: null,
  agent_task_id: null,
  session_id: null,
  runtime_id: null,
  device_id: null,
  started_at: null,
  completed_at: null,
  created_at: "",
  updated_at: "",
};

const SPLIT_TASKS_RESPONSE = {
  tasks: [
    {
      id: "task-1",
      node_run_id: "split-run-1",
      title: "Implement API contract",
      description: "Update handlers and service flow.",
      workflow_id: "wf-impl",
      depends_on: [],
      sort_order: 0,
      status: "running",
      issue_id: "child-issue-1",
      run_id: "child-run-1",
      version: 1,
      last_error: null,
      created_at: "",
      updated_at: "",
    },
    {
      id: "task-2",
      node_run_id: "split-run-1",
      title: "Backfill tests",
      description: "Cover the selected workflow.",
      workflow_id: "wf-test",
      depends_on: ["task-1"],
      sort_order: 1,
      status: "created",
      issue_id: "child-issue-2",
      run_id: "child-run-2",
      version: 1,
      last_error: null,
      created_at: "",
      updated_at: "",
    },
  ],
  progress: {
    total: 2,
    created: 1,
    running: 1,
    done: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  },
};

const AGENT = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "rt-1",
  name: "Brainstorming Agent",
  description: "Brainstorms",
  instructions: "",
  avatar_url: null,
  runtime_mode: "cloud" as const,
  runtime_config: {},
  custom_env: {},
  custom_args: [],
  custom_env_redacted: false,
  visibility: "workspace" as const,
  status: "idle" as const,
  max_concurrent_tasks: 1,
  model: "claude-sonnet-4-6",
  thinking_level: "medium",
  plugin_id: null,
  is_builtin: false,
  owner_id: null,
  skills: [],
  created_at: "",
  updated_at: "",
  archived_at: null,
  archived_by: null,
};

describe("decorateRuntimeEdges", () => {
  it("adds runtime edge tones and business labels", () => {
    const edges = [
      { id: "edge-a-b", source: "a", target: "b", data: { edgeKind: "data" } },
      { id: "edge-b-c", source: "b", target: "c", data: { edgeKind: "data" } },
    ] as Edge[];
    const nodeRunMap = new Map<string, any>([
      ["a", { id: "run-a", status: "completed", worker_output: { artifact_count: 2 } }],
      ["b", { id: "run-b", status: "working", worker_output: null }],
      ["c", { id: "run-c", status: "failed", worker_output: null }],
    ]);
    const splitTasksByNodeId = new Map<string, any[]>([
      ["b", [{ id: "task-1", issue_id: "issue-1" }, { id: "task-2", issue_id: "issue-2" }]],
    ]);

    expect(decorateRuntimeEdges({ edges, nodeRunMap, splitTasksByNodeId })).toEqual([
      expect.objectContaining({
        id: "edge-a-b",
        data: expect.objectContaining({ edgeTone: "running", edgeLabel: "2 artifacts" }),
        markerEnd: expect.objectContaining({ color: "rgb(59 130 246)" }),
      }),
      expect.objectContaining({
        id: "edge-b-c",
        data: expect.objectContaining({ edgeTone: "blocked", edgeLabel: "2 child issues" }),
        markerEnd: expect.objectContaining({ color: "rgb(239 68 68)" }),
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ExecutionPanoramaPage", () => {
  beforeEach(() => {
    mocks.isLoading = true;
    mocks.workflowData = undefined;
    mocks.stagesData = [];
    mocks.nodesData = [];
    mocks.edgesData = [];
    mocks.nodeRunsData = [];
    mocks.canvasSummaryData = undefined;
    mocks.agentsData = [];
    mocks.membersData = [];
    mocks.squadsData = [];
    mocks.workflowOptionsData = [];
    mocks.childIssuesData = [];
    mocks.chatSessionsData = [];
    mocks.workflowRolesData = [];
    mocks.roleResolutionsData = [];
    mocks.embedded = false;
    mocks.hasOpenInNewTab = true;
    mocks.splitTasksByNodeRunId = {};
    mocks.deliverableDefinitionsByNodeId = {};
    mocks.deliverableSubmissionsByNodeRunId = {};
    mocks.fitView.mockClear();
    mocks.setCenter.mockClear();
    mocks.getViewport.mockClear();
    mocks.getViewport.mockReturnValue({ x: 0, y: 24, zoom: 0.95 });
    mocks.nodesInitialized = true;
    mocks.viewportInitialized = true;
    mocks.retryNodeRun.mockReset();
    mocks.retryNodeRun.mockResolvedValue({ id: "nr-2" });
    mocks.useWorkspacePresenceMap.mockClear();
    mocks.useWorkspacePresenceMap.mockReturnValue({ byAgent: new Map(), loading: false });
    mocks.navigationPush.mockReset();
    mocks.openInNewTab.mockReset();
    mocks.postCostrictNavigateToSession.mockReset();
    mocks.setChatSession.mockReset();
    mocks.setChatOpen.mockReset();
    mocks.reactFlowProps = null;
    mocks.queryOptions = [];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };
  });

  it("renders loading state when data is loading", () => {
    mocks.isLoading = true;

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders unassigned lane when no stages defined", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("execution-panorama")).toBeInTheDocument();
    expect(screen.getByTestId("panorama-canvas")).toBeInTheDocument();
  });

  it("gives the shared canvas an explicit height in the regular issue detail flow", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("execution-panorama")).toHaveClass("min-h-[640px]");
    expect(screen.getByTestId("execution-canvas-shell")).toHaveClass("min-h-[560px]", "flex-1");
    expect(screen.getByTestId("execution-canvas-shell").className).not.toContain("min-h-[480px]");
  });

  it("fills the parent height when embedded in fullscreen issue detail", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage
          workflowId="wf-1"
          runId={null}
          wsId="ws-1"
          fillAvailableHeight
        />
      </Wrapper>,
    );

    expect(screen.getByTestId("execution-panorama")).toHaveClass("min-h-0");
    expect(screen.getByTestId("execution-panorama").className).not.toContain("min-h-[640px]");
    expect(screen.getByTestId("execution-canvas-shell")).toHaveClass("min-h-0", "flex-1");
    expect(screen.getByTestId("execution-canvas-shell").className).not.toContain("min-h-[560px]");
    expect(screen.getByTestId("panorama-canvas")).toHaveClass("left-40", "right-0");
    expect(screen.getByTestId("panorama-canvas").className).not.toContain("left-0");
  });

  it("renders the shared ReactFlow canvas core when stages exist", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("workflow-canvas-core")).toBeInTheDocument();
    expect(screen.getByTestId("reactflow-canvas")).toHaveAttribute("data-node-count", "1");
    expect(screen.queryByTestId("stage-lane-stage-1")).not.toBeInTheDocument();
  });

  it("builds runtime worker nodes through the shared canvas model while preserving runtime data", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.embedded = true;
    mocks.postCostrictNavigateToSession.mockReturnValue(true);
    mocks.nodeRunsData = [
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "completed",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: "runtime-session-1",
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [
        {
          workflow_node_id: "n1",
          node_run_id: "nr-1",
          display_status: "completed",
          active_actor_type: null,
          active_actor_id: null,
          duration_seconds: 12,
          session_id: null,
          runtime_id: null,
          device_id: null,
          has_error: false,
          error_message: "",
        },
      ],
    };
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((node) => node.id === "n1");
    expect(worker).toMatchObject({
      type: "runtimeNode",
      width: WORKER_WIDTH,
      height: RUNTIME_NODE_HEIGHT,
      data: expect.objectContaining({
        nodeRun: expect.objectContaining({ status: "completed" }),
        onOpenSession: expect.any(Function),
      }),
    });

    const onOpenSession = worker?.data?.onOpenSession as ((nodeId: string) => Promise<boolean>) | undefined;
    let opened = false;
    await act(async () => {
      opened = await onOpenSession?.("n1") ?? false;
    });
    expect(opened).toBe(true);
    expect(mocks.postCostrictNavigateToSession).toHaveBeenCalledWith({
      sessionId: "runtime-session-1",
      newTab: true,
    });

    mocks.embedded = false;
    mocks.postCostrictNavigateToSession.mockReturnValue(false);
    await act(async () => {
      opened = await onOpenSession?.("n1") ?? false;
    });
    expect(opened).toBe(true);
    expect(screen.getByTestId("execution-detail-panel")).toBeInTheDocument();
  });

  it("replays snapshot runs without enabling current workflow definition queries", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Current workflow" };
    mocks.stagesData = [{ ...STAGE, id: "current-stage", name: "Current stage" }];
    mocks.nodesData = [{ ...NODE, id: "current-node", title: "Current node" }];
    mocks.edgesData = [];
    mocks.nodeRunsData = [{
      ...SPLIT_NODE_RUN,
      id: "snapshot-node-run",
      workflow_node_id: "legacy-node-alias",
      source_workflow_node_id: "snapshot-node",
      node_title: "Snapshot node",
      status: "completed",
      format_schema: {},
    }];
    mocks.canvasSummaryData = {
      run: {
        workflow_id: "wf-1",
        definition_schema_version: 1,
        definition_snapshot: {
          schema_version: 1,
          snapshot_origin: "native",
          workflow: {
            id: "wf-1",
            workspace_id: "ws-1",
            title: "Snapshot workflow",
            description: "",
            is_default: false,
            max_retries: 3,
            runtime_selection_policy: "idle_first",
            config_revision: 4,
          },
          nodes: [{
            id: "snapshot-node",
            title: "Snapshot node",
            description: "Frozen",
            position_x: 48,
            position_y: 64,
            sort_order: 0,
            stage_id: "snapshot-stage",
            kind: "task",
            worker_type: "agent",
            worker_id: "agent-1",
            critic_type: "human",
          }],
          edges: [{
            id: "snapshot-edge",
            source_node_id: "snapshot-node",
            target_node_id: "snapshot-node",
          }],
          stages: [{
            id: "snapshot-stage",
            name: "Snapshot stage",
            description: "",
            sort_order: 0,
          }],
          roles: [],
          deliverables: [],
        },
      },
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).toContain("snapshot-node");
    expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).not.toContain("current-node");
    expect(mocks.reactFlowProps?.edges.map((edge) => edge.id)).toContain("snapshot-edge");
    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "snapshot-node")?.data?.nodeRun).toEqual(
      expect.objectContaining({ id: "snapshot-node-run", status: "completed" }),
    );

    for (const marker of ["detail", "nodes", "edges", "stages"]) {
      const query = mocks.queryOptions.find((option) => option.queryKey?.includes(marker));
      expect(query?.enabled, `${marker} query should be disabled`).toBe(false);
    }
  });

  it("falls back to node-run records without reading current definitions when a strict snapshot is unavailable", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Current workflow" };
    mocks.nodesData = [{ ...NODE, id: "current-node", title: "Current node" }];
    mocks.nodeRunsData = [{
      ...SPLIT_NODE_RUN,
      id: "captured-node-run",
      workflow_node_id: "legacy-node-alias",
      source_workflow_node_id: "captured-node",
      node_title: "Captured node",
      node_description: "Captured description",
      status: "failed",
      format_schema: {},
    }];
    mocks.canvasSummaryData = {
      run: {
        id: "run-1",
        workflow_id: "wf-1",
        definition_schema_version: 1,
        definition_snapshot: null,
      },
      node_runs: [],
      node_runtime_summaries: [],
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).toContain("captured-node");
    expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).not.toContain("current-node");
    for (const marker of ["detail", "nodes", "edges", "stages"]) {
      const query = mocks.queryOptions.find((option) => option.queryKey?.includes(marker));
      expect(query?.enabled, `${marker} query should be disabled`).toBe(false);
    }
  });

  it("passes the shared duration clock to nodes with an unfinished run", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.nodeRunsData = [{
      ...SPLIT_NODE_RUN,
      workflow_node_id: "n1",
      status: "working",
      started_at: "2026-07-25T10:00:00Z",
      completed_at: null,
    }];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "n1")?.data).toEqual(
      expect.objectContaining({ nowMs: expect.any(Number) }),
    );
  });

  it("joins deliverable definitions and submissions into runtime card summaries", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.nodeRunsData = [{
      id: "nr-1",
      workflow_run_id: "run-1",
      workflow_node_id: "n1",
      node_title: "brainstorming",
      status: "completed",
      retry_count: 0,
      worker_type: "agent",
      worker_id: "agent-1",
      worker_output: null,
      worker_agent_task_id: null,
      critic_type: "human",
      critic_id: null,
      critic_output: null,
      critic_comment: "",
      critic_agent_task_id: null,
      agent_task_id: null,
      session_id: null,
      runtime_id: null,
      device_id: null,
      started_at: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    }];
    mocks.canvasSummaryData = { node_runs: mocks.nodeRunsData, node_runtime_summaries: [] };
    mocks.agentsData = [AGENT];
    mocks.deliverableDefinitionsByNodeId = {
      n1: [
        { id: "d-current", title: "Current definition", sort_order: 1 },
      ],
    };
    mocks.deliverableSubmissionsByNodeRunId = {
      "nr-1": {
        deliverables: [
          { id: "d-2", title: "Acceptance checklist", sort_order: 2 },
          { id: "d-1", title: "Requirements specification", sort_order: 1 },
        ],
        submissions: [
        {
          id: "s-1",
          deliverable_id: "d-1",
          status: "approved",
          pull_request_url: "https://gitea.test/workflow/pulls/7",
        },
        ],
      },
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((node) => node.id === "n1");
    expect(worker?.data?.deliverables).toEqual([
      {
        id: "d-1",
        title: "Requirements specification",
        status: "approved",
        pullRequestUrl: "https://gitea.test/workflow/pulls/7",
      },
      {
        id: "d-2",
        title: "Acceptance checklist",
        status: "missing",
        pullRequestUrl: null,
      },
    ]);
    expect(mocks.queryOptions.some((option) => option.queryKey?.includes("node-deliverable-definitions"))).toBe(false);
  });

  it("marks only the highest-priority runtime node as the runtime focus", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      { ...NODE, id: "running-node", title: "Running", position_x: 0 },
      { ...NODE, id: "blocked-node", title: "Blocked", position_x: 320 },
    ];
    mocks.nodeRunsData = [
      {
        id: "nr-running",
        workflow_run_id: "run-1",
        workflow_node_id: "running-node",
        node_title: "Running",
        status: "working",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "nr-blocked",
        workflow_run_id: "run-1",
        workflow_node_id: "blocked-node",
        node_title: "Blocked",
        status: "blocked",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "blocked-node")?.data).toMatchObject({
      isRuntimeFocus: true,
    });
    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "running-node")?.data).toMatchObject({
      isRuntimeFocus: false,
    });
  });

  it("centers and prominently zooms the initial viewport on the highest-priority runtime node", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      { ...NODE, id: "running-node", title: "Running", position_x: 0 },
      { ...NODE, id: "blocked-node", title: "Blocked", position_x: 320 },
    ];
    mocks.nodeRunsData = [
      {
        id: "nr-running",
        workflow_run_id: "run-1",
        workflow_node_id: "running-node",
        node_title: "Running",
        status: "working",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "nr-blocked",
        workflow_run_id: "run-1",
        workflow_node_id: "blocked-node",
        node_title: "Blocked",
        status: "blocked",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const blockedNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "blocked-node");
    expect(blockedNode).toBeTruthy();

    await waitFor(() => {
      expect(mocks.setCenter).toHaveBeenCalledWith(
        blockedNode!.position.x + (blockedNode!.width ?? WORKER_WIDTH) / 2,
        blockedNode!.position.y + (blockedNode!.height ?? RUNTIME_NODE_HEIGHT) / 2,
        expect.objectContaining({ duration: 450, zoom: 1.45 }),
      );
    });
  });

  it("does not render independent critic badge nodes in runtime mode", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [{ ...NODE, critic_id: "agent-2" }];
    mocks.agentsData = [AGENT, { ...AGENT, id: "agent-2", name: "Review Agent" }];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "n1:critic")).toBeUndefined();
    expect(mocks.reactFlowProps?.edges.find((edge) => edge.id === "n1:critic-edge")).toBeUndefined();
    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "n1")).toMatchObject({
      type: "runtimeNode",
      width: WORKER_WIDTH,
      height: RUNTIME_NODE_HEIGHT,
    });
  });

  it("lets the shared canvas stretch to the issue detail shell height", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    const canvasCore = screen.getByTestId("workflow-canvas-core");
    expect(canvasCore).toHaveClass("self-stretch");
    expect(canvasCore.className).not.toContain("h-full");
  });

  it("fits the runtime canvas to all workflow nodes on first render", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: [{ id: "n1" }],
          padding: 0.16,
          maxZoom: 1,
        }),
      );
    });

    expect(screen.getByTestId("reactflow-canvas")).toHaveAttribute("data-fit-view", "false");
    expect(screen.getByTestId("reactflow-canvas")).toHaveAttribute("data-fit-view-max-zoom", "1");
  });

  it("waits for ReactFlow to initialize before fitting workflow nodes", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];
    mocks.nodesInitialized = false;
    mocks.viewportInitialized = false;

    const { rerender } = render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(mocks.fitView).not.toHaveBeenCalled();

    mocks.nodesInitialized = true;
    mocks.viewportInitialized = true;

    rerender(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: [{ id: "n1" }],
        }),
      );
    });
  });

  it("centers the matching ReactFlow node when a notification is clicked", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.nodeRunsData = [
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "awaiting_critic",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("notification-item-test"));

    const runtimeNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "n1");
    expect(runtimeNode).toBeTruthy();
    expect(mocks.setCenter).toHaveBeenCalledWith(
      runtimeNode!.position.x + (runtimeNode!.width ?? WORKER_WIDTH) / 2,
      runtimeNode!.position.y + (runtimeNode!.height ?? RUNTIME_NODE_HEIGHT) / 2,
      expect.objectContaining({ duration: 450, zoom: 0.95 }),
    );
  });

  it("does not render detail panel initially", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    // Simulate state change by clicking — we pass the onNodeClick
    // via StageLane mock already, but since the component uses
    // internal state, we can't easily trigger it from the test.
    // This test verifies the component renders without detail panel initially.
    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.queryByTestId("execution-detail-panel")).not.toBeInTheDocument();
  });

  it("opens the split review panel instead of the generic execution panel for split nodes", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        format_schema: {
          type: "split",
          split_config: {
            default_issue_workflow_id: "child-wf-1",
            mode: "barrier",
            max_concurrency: 3,
            max_failures: 0,
          },
        },
      },
    ];
    mocks.nodeRunsData = [
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "awaiting_split_review",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("notification-item-test"));

    expect(screen.getByTestId("execution-split-review-panel")).toBeInTheDocument();
    expect(screen.getByTestId("split-panel-status")).toHaveTextContent("awaiting_split_review");
    expect(screen.getByTestId("split-panel-parent-issue-id")).toHaveTextContent("issue-1");
    expect(screen.queryByTestId("execution-detail-panel")).not.toBeInTheDocument();
  });

  it("expands split child issues into a subflow container from the runtime split expansion button", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [
        {
          workflow_node_id: "split-1",
          node_run_id: "split-run-1",
          display_status: "in_progress",
          active_actor_type: null,
          active_actor_id: null,
          duration_seconds: null,
          session_id: null,
          runtime_id: null,
          device_id: null,
          has_error: false,
          error_message: "",
          split_progress: SPLIT_TASKS_RESPONSE.progress,
        },
      ],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };
    mocks.childIssuesData = [
      { id: "child-issue-1", identifier: "MUL-580" },
      { id: "child-issue-2", identifier: "MUL-581" },
    ];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    expect(splitNode?.height).toBe(RUNTIME_SPLIT_NODE_HEIGHT);
    expect(splitNode!.position.y + RUNTIME_SPLIT_NODE_HEIGHT / 2).toBe(
      12 + RUNTIME_NODE_HEIGHT / 2,
    );
    expect(splitNode?.data).toMatchObject({
      splitChildCount: 2,
      isSplitExpanded: false,
    });

    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining([
          "split-1",
          "split-1:split-subflow",
        ]),
      );
    });

    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-task:task-1")).toBeUndefined();
    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-task:task-2")).toBeUndefined();
    expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toMatchObject({
      type: "runtimeSplitSubflow",
      data: {
        splitNodeId: "split-1",
        parentTitle: "Split implementation",
        childIssues: [
          expect.objectContaining({
            nodeId: "split-1:split-task:task-1",
            issueId: "child-issue-1",
            title: "Implement API contract",
            displayStatus: "in_progress",
            workerName: "wf-impl",
            issueIdentifier: "MUL-580",
            progressLabel: "Workflow in progress",
            level: 0,
          }),
          expect.objectContaining({
            nodeId: "split-1:split-task:task-2",
            issueId: "child-issue-2",
            title: "Backfill tests",
            displayStatus: "todo",
            workerName: "wf-test",
            issueIdentifier: "MUL-581",
            progressLabel: "Waiting for dependencies",
            level: 1,
          }),
        ],
        dependencyEdges: [
          expect.objectContaining({
            sourceNodeId: "split-1:split-task:task-1",
            targetNodeId: "split-1:split-task:task-2",
          }),
        ],
      },
    });
    expect(mocks.reactFlowProps?.edges.map((edge) => edge.id)).toEqual(
      expect.arrayContaining([
        "split-1:split-subflow-edge",
      ]),
    );
    expect(mocks.reactFlowProps?.edges.find((edge) => edge.id === "split-1:split-subflow-edge")?.data).toMatchObject({
      edgeTone: "running",
      edgeLabel: "2 child issues",
      sameStage: false,
    });
    expect(mocks.reactFlowProps?.edges.find((edge) => edge.id === "split-1:split-subflow-edge")?.markerEnd?.color).toBe(
      "rgb(59 130 246)",
    );
    expect(
      mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1")?.data,
    ).toMatchObject({
      isSplitExpanded: true,
    });
  });

  it("keeps the expanded split subflow near the parent split and shifts overlapping workflow nodes", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      SPLIT_NODE,
      {
        ...NODE,
        id: "downstream-1",
        title: "Downstream workflow node",
        position_x: 320,
      },
    ];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    const downstreamNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "downstream-1");
    const parentNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    const subflowNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow");

    expect(subflowNode!.position.x).toBe(parentNode!.position.x + WORKER_WIDTH + 144);
    expect(downstreamNode!.position.x).toBeGreaterThanOrEqual(
      subflowNode!.position.x + (subflowNode!.width ?? 560) + 96,
    );
  });

  it("widens the split subflow to contain multi-level child issue chains", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": {
        ...SPLIT_TASKS_RESPONSE,
        tasks: [
          { ...SPLIT_TASKS_RESPONSE.tasks[0], id: "task-1", depends_on: [], sort_order: 0 },
          { ...SPLIT_TASKS_RESPONSE.tasks[1], id: "task-2", depends_on: ["task-1"], sort_order: 1 },
          {
            ...SPLIT_TASKS_RESPONSE.tasks[1],
            id: "task-3",
            title: "Render controls",
            issue_id: "child-issue-3",
            depends_on: ["task-2"],
            sort_order: 2,
          },
          {
            ...SPLIT_TASKS_RESPONSE.tasks[1],
            id: "task-4",
            title: "AI opponent",
            issue_id: "child-issue-4",
            depends_on: ["task-3"],
            sort_order: 3,
          },
        ],
      },
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    const subflowNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow");
    expect(subflowNode?.width).toBeGreaterThan(700);
    expect(subflowNode?.data?.childIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "split-1:split-task:task-4", level: 3 }),
      ]),
    );
  });

  it("fits the viewport once to the expanded split child issue panel without locking later moves", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalledTimes(1);
    });
    mocks.fitView.mockClear();
    mocks.setCenter.mockClear();
    mocks.setReactFlowViewport.mockClear();

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: [{ id: "split-1:split-subflow" }],
          padding: 0.06,
          maxZoom: 1.4,
          duration: 450,
        }),
      );
    });
    const splitFitCount = mocks.fitView.mock.calls.filter((call) =>
      JSON.stringify(call[0]).includes("split-1:split-subflow"),
    ).length;

    act(() => {
      mocks.reactFlowProps?.onMove?.(null, { x: -640, y: -180, zoom: 0.72 });
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(
      mocks.fitView.mock.calls.filter((call) =>
        JSON.stringify(call[0]).includes("split-1:split-subflow"),
      ).length,
    ).toBe(splitFitCount);
    expect(mocks.setCenter).not.toHaveBeenCalled();
  });

  it("focuses the split subflow even when ReactFlow never reports initialized nodes", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };
    mocks.nodesInitialized = false;

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    mocks.fitView.mockClear();

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.fitView).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: [{ id: "split-1:split-subflow" }],
          padding: 0.06,
          maxZoom: 1.4,
          duration: 450,
        }),
      );
    });
  });

  it("restores the previous viewport when collapsing an expanded split subflow", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };
    const beforeExpandViewport = { x: -360, y: 112, zoom: 1.18 };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    act(() => {
      mocks.reactFlowProps?.onMove?.(null, beforeExpandViewport);
    });
    mocks.fitView.mockClear();
    mocks.setReactFlowViewport.mockClear();

    let splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.setReactFlowViewport).toHaveBeenCalledWith(
        beforeExpandViewport,
        expect.objectContaining({ duration: 450 }),
      );
    });
  });

  it("opens a detail panel for a split child issue node before navigating to the issue", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    const subflowNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow");
    act(() => {
      (subflowNode?.data?.onOpenChild as (nodeId: string) => void)("split-1:split-task:task-1");
    });

    expect(mocks.navigationPush).not.toHaveBeenCalled();
    expect(screen.getByTestId("execution-detail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel-title")).toHaveTextContent("Implement API contract");
    expect(screen.getByTestId("detail-panel-is-child")).toHaveTextContent("true");
    expect(screen.getByTestId("detail-panel-parent-split")).toHaveTextContent("Split implementation");
    expect(screen.queryByTestId("execution-split-review-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open issue" }));

    expect(mocks.openInNewTab).toHaveBeenCalledWith(
      "/demo111/issues/child-issue-1",
      "Implement API contract",
      { activate: true },
    );
    expect(mocks.navigationPush).not.toHaveBeenCalled();
  });

  it("opens a child issue in a browser tab when the navigation adapter has no app-tab API", async () => {
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    mocks.hasOpenInNewTab = false;
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    const subflowNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow");
    act(() => {
      (subflowNode?.data?.onOpenChild as (nodeId: string) => void)("split-1:split-task:task-1");
    });

    await waitFor(() => {
      expect(screen.getByTestId("execution-detail-panel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open issue" }));

    expect(windowOpen).toHaveBeenCalledWith(
      "https://app.multica.test/demo111/issues/child-issue-1",
      "_blank",
      "noopener,noreferrer",
    );
    expect(mocks.navigationPush).not.toHaveBeenCalled();
    expect(mocks.openInNewTab).not.toHaveBeenCalled();

    windowOpen.mockRestore();
  });

  it("resolves split child issue workflow names", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.membersData = [{ user_id: "user-1", name: "Alice Reviewer" }];
    mocks.squadsData = [{ id: "squad-1", name: "Frontend Squad" }];
    mocks.workflowOptionsData = [
      {
        id: "wf-impl",
        workspace_id: "ws-1",
        title: "Implementation workflow",
        description: "",
        status: "active",
        max_retries: 1,
        created_by_type: "human",
        created_by_id: "user-1",
        node_count: 1,
        is_template: false,
        source_template_id: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "wf-test",
        workspace_id: "ws-1",
        title: "Test workflow",
        description: "",
        status: "active",
        max_retries: 1,
        created_by_type: "human",
        created_by_id: "user-1",
        node_count: 1,
        is_template: false,
        source_template_id: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": {
        ...SPLIT_TASKS_RESPONSE,
        tasks: [
          {
            ...SPLIT_TASKS_RESPONSE.tasks[0],
            workflow_id: "wf-impl",
          },
          {
            ...SPLIT_TASKS_RESPONSE.tasks[1],
            workflow_id: "wf-test",
          },
        ],
      },
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    const splitNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1");
    act(() => {
      (splitNode?.data?.onSplitNodeToggle as (nodeId: string) => void)("split-1");
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    const subflowNode = mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow");
    expect(subflowNode?.data?.childIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "split-1:split-task:task-1",
          workerName: "Implementation workflow",
        }),
        expect.objectContaining({
          nodeId: "split-1:split-task:task-2",
          workerName: "Test workflow",
        }),
      ]),
    );
  });

  it("toggles split child issue nodes when a runtime split node is double clicked", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [SPLIT_NODE];
    mocks.nodeRunsData = [SPLIT_NODE_RUN];
    mocks.canvasSummaryData = {
      node_runs: mocks.nodeRunsData,
      node_runtime_summaries: [],
    };
    mocks.agentsData = [AGENT];
    mocks.splitTasksByNodeRunId = {
      "split-run-1": SPLIT_TASKS_RESPONSE,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    act(() => {
      mocks.reactFlowProps?.onNodeDoubleClick?.({}, { id: "split-1" });
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeTruthy();
    });

    act(() => {
      mocks.reactFlowProps?.onNodeDoubleClick?.({}, { id: "split-1" });
    });

    await waitFor(() => {
      expect(mocks.reactFlowProps?.nodes.find((node) => node.id === "split-1:split-subflow")).toBeUndefined();
    });
  });

  it("passes a retry action to the detail panel for format_failed node runs", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.nodeRunsData = [
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "format_failed",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: "task-1",
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("notification-item-test"));
    expect(screen.getByTestId("detail-panel-status")).toHaveTextContent("format_failed");

    fireEvent.click(screen.getByText("Retry from panel"));

    await waitFor(() => {
      expect(mocks.retryNodeRun).toHaveBeenCalledWith("nr-1");
    });
  });

  it("passes a retry action to the detail panel for retryable node runs without an agent task id", async () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.nodeRunsData = [
      {
        id: "nr-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "format_failed",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" issueId="issue-1" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByTestId("notification-item-test"));
    expect(screen.getByTestId("detail-panel-status")).toHaveTextContent("format_failed");

    fireEvent.click(screen.getByText("Retry from panel"));

    await waitFor(() => {
      expect(mocks.retryNodeRun).toHaveBeenCalledWith("nr-1");
    });
  });

  it("renders workflow edges through the shared ReactFlow canvas when runId is provided", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.edgesData = [
      {
        id: "e1",
        workflow_id: "wf-1",
        source_node_id: "n1",
        target_node_id: "n1",
        condition: null,
        created_at: "",
      },
    ];
    mocks.nodeRunsData = [
      {
        id: "run-1",
        workflow_run_id: "run-1",
        workflow_node_id: "n1",
        node_title: "brainstorming",
        status: "completed",
        retry_count: 0,
        worker_type: "agent",
        worker_id: "agent-1",
        worker_output: null,
        worker_agent_task_id: null,
        critic_type: "human",
        critic_id: null,
        critic_output: null,
        critic_comment: "",
        critic_agent_task_id: null,
        agent_task_id: null,
        session_id: null,
        runtime_id: null,
        device_id: null,
        started_at: null,
        completed_at: null,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("reactflow-canvas")).toHaveAttribute("data-edge-count", "1");
  });

  it("uses stage-aware shared edge styling in runtime mode", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [
      STAGE,
      { ...STAGE, id: "stage-2", name: "Build", sort_order: 1 },
    ];
    mocks.nodesData = [
      NODE,
      { ...NODE, id: "n2", title: "Build", stage_id: "stage-2", position_x: 400 },
    ];
    mocks.edgesData = [
      {
        id: "e1",
        workflow_id: "wf-1",
        source_node_id: "n2",
        target_node_id: "n1",
        condition: { kind: "condition" },
        created_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    const edge = mocks.reactFlowProps?.edges.find((item) => item.id === "e1");
    expect(edge?.data).toMatchObject({
      stageColorIndex: 1,
      edgeKind: "condition",
      edgeTone: "waiting",
    });
    expect(edge?.markerEnd?.color).toBe("rgb(100 116 139)");
  });

  it("renders workflow edges through the shared ReactFlow canvas when runId is null", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [NODE];
    mocks.edgesData = [
      {
        id: "e1",
        workflow_id: "wf-1",
        source_node_id: "n1",
        target_node_id: "n1",
        condition: null,
        created_at: "",
      },
    ];
    mocks.agentsData = [AGENT];
    mocks.pluginsData = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    };

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId={null} wsId="ws-1" />
      </Wrapper>,
    );

    expect(screen.getByTestId("reactflow-canvas")).toHaveAttribute("data-edge-count", "1");
  });

  // ---------------------------------------------------------------------------
  // Role-based worker/critic display — regression coverage for the fix that
  // made role-assigned nodes show a name on the runtime canvas. Precedence:
  // explicit agent/member → resolved user from WorkflowRoleResolution →
  // localized built-in role name → raw custom role name.
  // ---------------------------------------------------------------------------
  const CUSTOM_ROLE = {
    id: "role-backend",
    workspace_id: "ws-1",
    name: "Backend Engineer",
    description: "Builds backend changes",
    is_builtin: false,
    needs_description: false,
    is_referenced: false,
    created_by: "user-1",
    created_at: "",
    updated_at: "",
  };

  const BUILTIN_DEV_ROLE = {
    ...CUSTOM_ROLE,
    id: "role-dev",
    name: "developer",
    is_builtin: true,
    description: "Builds changes",
  };

  const MEMBER = {
    user_id: "user-alice",
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "member",
    status: "active",
  };

  const baseNodeRun = {
    id: "nr-role",
    workflow_run_id: "run-1",
    workflow_node_id: "n-role",
    node_title: "implement",
    status: "running",
    retry_count: 0,
    worker_type: "agent",
    worker_id: null,
    worker_output: null,
    worker_agent_task_id: null,
    critic_type: "human",
    critic_id: null,
    critic_output: null,
    critic_comment: "",
    critic_agent_task_id: null,
    agent_task_id: null,
    session_id: null,
    runtime_id: null,
    device_id: null,
    started_at: null,
    completed_at: null,
    created_at: "",
    updated_at: "",
  };

  it("uses captured actor names instead of renamed current entities", () => {
    mocks.isLoading = false;
    mocks.nodesData = [{ ...NODE, critic_id: "user-alice" }];
    mocks.nodeRunsData = [{
      ...baseNodeRun,
      workflow_node_id: "n1",
      worker_type: "agent",
      worker_id: "agent-1",
      worker_name_snapshot: "Original Agent",
      critic_type: "human",
      critic_id: "user-alice",
      critic_name_snapshot: "Original Reviewer",
    }];
    mocks.agentsData = [{ ...AGENT, name: "Renamed Agent" }];
    mocks.membersData = [{ ...MEMBER, name: "Renamed Reviewer" }];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const node = mocks.reactFlowProps?.nodes.find((item) => item.id === "n1");
    expect(node?.data).toMatchObject({
      workerName: "Original Agent",
      criticName: "Original Reviewer",
      workerIdentity: { name: "Original Agent" },
      criticIdentity: { name: "Original Reviewer" },
    });
  });

  it("uses the captured role name after the current role is deleted", () => {
    mocks.isLoading = false;
    mocks.nodesData = [{
      ...NODE,
      id: "n-role",
      worker_type: "role",
      worker_id: null,
      worker_role_id: "role-deleted",
    }];
    mocks.nodeRunsData = [{
      ...baseNodeRun,
      workflow_node_id: "n-role",
      worker_type: "role",
      worker_id: null,
      worker_role_snapshot: {
        id: "role-deleted",
        name: "Historical Architect",
        description: "Captured role",
      },
    }];
    mocks.workflowRolesData = [];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const node = mocks.reactFlowProps?.nodes.find((item) => item.id === "n-role");
    expect(node?.data).toMatchObject({
      workerName: "Historical Architect",
      workerIdentity: {
        type: "role",
        name: "Historical Architect",
      },
    });
  });

  it("shows the raw custom role name when a worker is role-assigned but unresolved", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        id: "n-role",
        worker_type: "role",
        worker_id: null,
        worker_role_id: "role-backend",
        worker_role: null,
      },
    ];
    mocks.workflowRolesData = [CUSTOM_ROLE];
    mocks.nodeRunsData = [{ ...baseNodeRun, status: "pending" }];
    mocks.agentsData = [];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "n-role");
    expect(worker?.data).toMatchObject({ workerName: "Backend Engineer" });
  });

  it("localizes the built-in developer role name on the runtime canvas", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        id: "n-role",
        worker_type: "role",
        worker_id: null,
        worker_role_id: "role-dev",
        worker_role: null,
      },
    ];
    mocks.workflowRolesData = [BUILTIN_DEV_ROLE];
    mocks.nodeRunsData = [{ ...baseNodeRun, status: "pending" }];
    mocks.agentsData = [];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "n-role");
    // i18n mock returns "Developer" for the developer built-in — without the
    // fix this assertion would fail because workerName was null and the node
    // appeared blank on the canvas.
    expect(worker?.data).toMatchObject({ workerName: "Developer" });
  });

  it("surfaces the resolved member name once role resolution completes", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        id: "n-role",
        worker_type: "role",
        worker_id: null,
        worker_role_id: "role-backend",
        worker_role: null,
      },
    ];
    mocks.workflowRolesData = [CUSTOM_ROLE];
    mocks.membersData = [MEMBER];
    mocks.nodeRunsData = [{ ...baseNodeRun, status: "running" }];
    mocks.roleResolutionsData = [
      {
        id: "res-1",
        workflow_node_run_id: "nr-role",
        slot_type: "worker",
        status: "resolved",
        resolved_user_id: "user-alice",
        resolved_at: "",
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "n-role");
    expect(worker?.data).toMatchObject({ workerName: "Alice Johnson" });
  });

  it("prefers an explicit worker agent over a resolved role resolution", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        id: "n-role",
        worker_type: "agent",
        worker_id: "agent-1",
        worker_role_id: "role-backend",
        worker_role: null,
      },
    ];
    mocks.workflowRolesData = [CUSTOM_ROLE];
    mocks.membersData = [MEMBER];
    mocks.nodeRunsData = [{ ...baseNodeRun, status: "running" }];
    mocks.roleResolutionsData = [
      {
        id: "res-1",
        workflow_node_run_id: "nr-role",
        slot_type: "worker",
        status: "resolved",
        resolved_user_id: "user-alice",
        resolved_at: "",
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [AGENT];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "n-role");
    // Explicit agent assignment wins — the resolved member must not override.
    expect(worker?.data).toMatchObject({ workerName: "Brainstorming Agent" });
  });

  it("ignores pending role resolutions and falls back to the role name", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.nodesData = [
      {
        ...NODE,
        id: "n-role",
        worker_type: "role",
        worker_id: null,
        worker_role_id: "role-backend",
        worker_role: null,
      },
    ];
    mocks.workflowRolesData = [CUSTOM_ROLE];
    mocks.membersData = [MEMBER];
    mocks.nodeRunsData = [{ ...baseNodeRun, status: "running" }];
    mocks.roleResolutionsData = [
      {
        id: "res-1",
        workflow_node_run_id: "nr-role",
        slot_type: "worker",
        status: "pending",
        resolved_user_id: null,
        resolved_at: "",
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.agentsData = [];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "n-role");
    expect(worker?.data).toMatchObject({ workerName: "Backend Engineer" });
  });

  it("resolves concrete runtime actors before node roles and attaches agent presence", () => {
    mocks.isLoading = false;
    mocks.workflowData = { id: "wf-1", title: "Test Workflow" };
    mocks.stagesData = [STAGE];
    mocks.workflowRolesData = [BUILTIN_DEV_ROLE];
    mocks.membersData = [{ ...MEMBER, avatar_url: "/reviewer.png" }];
    mocks.agentsData = [{ ...AGENT, avatar_url: "/agent.png" }];
    mocks.squadsData = [{ id: "squad-1", name: "Platform Squad", avatar_url: null }];
    mocks.useWorkspacePresenceMap.mockReturnValue({
      byAgent: new Map([["agent-1", { availability: "online" as const }]]),
      loading: false,
    });
    mocks.nodesData = [
      { ...NODE, id: "resolved-role-node", worker_type: "role", worker_id: null, worker_role_id: "role-dev" },
      { ...NODE, id: "pending-role-node", worker_type: "role", worker_id: null, worker_role_id: "role-dev" },
      { ...NODE, id: "agent-node", worker_type: "agent", worker_id: "agent-1" },
      { ...NODE, id: "squad-api-node", worker_type: "squad", worker_id: "squad-1", critic_type: "api", critic_id: null, critic_api_url: "https://review.example.test" },
    ];
    mocks.nodeRunsData = [
      { ...baseNodeRun, id: "nr-resolved", workflow_node_id: "resolved-role-node", worker_type: "human", worker_id: "user-alice" },
      { ...baseNodeRun, id: "nr-pending", workflow_node_id: "pending-role-node", worker_type: "role", worker_id: null },
      { ...baseNodeRun, id: "nr-agent", workflow_node_id: "agent-node", worker_type: "agent", worker_id: "agent-1" },
      { ...baseNodeRun, id: "nr-squad", workflow_node_id: "squad-api-node", worker_type: "squad", worker_id: "squad-1", critic_type: "api", critic_id: null },
    ];

    render(
      <Wrapper>
        <ExecutionPanoramaPage workflowId="wf-1" runId="run-1" wsId="ws-1" />
      </Wrapper>,
    );

    const renderedNodes = mocks.reactFlowProps?.nodes ?? [];
    expect(renderedNodes.find((node) => node.id === "resolved-role-node")?.data?.workerIdentity).toMatchObject({
      type: "member",
      id: "user-alice",
      name: "Alice Johnson",
      avatarUrl: "/reviewer.png",
      typeLabel: "Member",
    });
    expect(renderedNodes.find((node) => node.id === "pending-role-node")?.data?.workerIdentity).toEqual({
      type: "role",
      id: null,
      name: "Developer",
      typeLabel: "Development role",
    });
    expect(renderedNodes.find((node) => node.id === "agent-node")?.data?.workerIdentity).toMatchObject({
      type: "agent",
      id: "agent-1",
      name: "Brainstorming Agent",
      avatarUrl: "/agent.png",
      availability: "online",
      availabilityLabel: "Online",
    });
    expect(renderedNodes.find((node) => node.id === "squad-api-node")?.data).toMatchObject({
      workerIdentity: {
        type: "squad",
        id: "squad-1",
        name: "Platform Squad",
        typeLabel: "Squad",
      },
      criticIdentity: {
        type: "api",
        id: null,
        name: "API review",
        typeLabel: "API reviewer",
      },
    });
    expect(renderedNodes.find((node) => node.id === "squad-api-node")?.data?.workerIdentity).not.toHaveProperty("availability");
    expect(renderedNodes.find((node) => node.id === "squad-api-node")?.data?.criticIdentity).not.toHaveProperty("availability");
    expect(mocks.useWorkspacePresenceMap).toHaveBeenCalledTimes(1);
    expect(mocks.useWorkspacePresenceMap).toHaveBeenCalledWith("ws-1");
  });
});

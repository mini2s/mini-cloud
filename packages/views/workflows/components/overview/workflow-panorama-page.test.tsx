// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { isValidWorkflowConnection, WorkflowPanoramaPage } from "./workflow-panorama-page";
import { STAGE_MARKER_COLORS } from "./constants";
import type { Edge, Node } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";

it("validates boundary connections before mutation", () => {
  const node = (id: string, type?: string): WorkflowNode => ({
    id,
    workflow_id: "wf-1",
    title: id,
    description: "",
    position_x: 0,
    position_y: 0,
    format_schema: type ? { type } : null,
    worker_type: "human",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    sort_order: 0,
    stage_id: "stage-1",
    created_at: "",
    updated_at: "",
  });
  const nodes = new Map(["start", "task", "end", "note"].map((id) => [
    id,
    node(id, id === "task" ? undefined : id === "note" ? "annotation" : id),
  ]));

  expect(isValidWorkflowConnection({ source: "start", target: "task", sourceHandle: null, targetHandle: null }, nodes)).toBe(true);
  expect(isValidWorkflowConnection({ source: "task", target: "end", sourceHandle: null, targetHandle: null }, nodes)).toBe(true);
  expect(isValidWorkflowConnection({ source: "task", target: "start", sourceHandle: null, targetHandle: null }, nodes)).toBe(false);
  expect(isValidWorkflowConnection({ source: "start", target: "end", sourceHandle: null, targetHandle: null }, nodes)).toBe(false);
  expect(isValidWorkflowConnection({ source: "start", target: "note", sourceHandle: null, targetHandle: null }, nodes)).toBe(false);
});

// Hoisted mock data — allows per-test overrides via beforeEach
const mocks = vi.hoisted(() => ({
  stagesData: [
    { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
  ],
  nodesData: [] as unknown[],
  edgesData: [] as unknown[],
  workflowRolesData: [] as unknown[],
  runsData: [] as Array<{ id: string }>,
  nodeRunsData: [] as unknown[],
  runtimesData: [] as unknown[],
  preflightResult: {
    issues: [] as Array<{ checkId: string; severity: string; blocking: boolean; nodeId: string; nodeTitle: string; message: string }>,
    blockingCount: 0,
    warningCount: 0,
    passed: true,
  },
  workflowData: {
    id: "wf-1",
    title: "Test Workflow",
    status: "draft",
    default_runtime_selection_policy: "idle_first",
    default_runtime_id: null,
  },
  selectedNodeId: null as string | null,
  selectedEdgeId: null as string | null,
  nodeEdits: {} as Record<string, unknown>,
  deletedNodeIds: [] as string[],
  createNodeMutate: vi.fn(),
  createEdgeMutate: vi.fn(),
  updateNodeMutate: vi.fn(),
  updateNodeMutateAsync: vi.fn(),
  assignStageMutate: vi.fn(),
  deleteNodeMutateAsync: vi.fn(),
  deleteEdgeMutate: vi.fn(),
  updateStageMutateAsync: vi.fn(),
  deleteStageMutate: vi.fn(),
  updateWorkflowMutate: vi.fn(),
  updateWorkflowMutateAsync: vi.fn(),
  startWorkflowRunMutateAsync: vi.fn(),
  navigationPush: vi.fn(),
  getActorName: vi.fn<(type: string, id: string) => string>(() => "Test Agent"),
  getActorInitials: vi.fn<(type: string, id: string) => string>(() => "TA"),
  getActorAvatarUrl: vi.fn<(type: string, id: string) => string | null>(() => null),
  useWorkspacePresenceMap: vi.fn(() => ({
    byAgent: new Map<string, { availability: "online" | "offline" | "unstable" }>(),
    loading: false,
  })),
  selectNode: vi.fn(),
  clearNodeEdits: vi.fn(),
  cacheNodeDelete: vi.fn(),
  pushServerAction: vi.fn(),
  clearReverseAction: vi.fn(),
  updateLatestUndoAction: vi.fn(),
  configPanelSave: vi.fn(),
  reverseAction: null as null | {
    direction: "undo" | "redo";
    action: {
      type: "create-node";
      nodeId?: string;
      nodeRequest?: {
        title: string;
        worker_type: "agent";
        critic_type: "human";
      };
    };
  },
  controlsProps: null as null | {
    position?: string;
    orientation?: string;
    className?: string;
  },
  miniMapProps: null as null | {
    position?: string;
    className?: string;
    style?: React.CSSProperties;
    bgColor?: string;
    maskColor?: string;
    maskStrokeColor?: string;
    maskStrokeWidth?: number;
    nodeBorderRadius?: number;
    nodeColor?: (node: Node) => string;
  },
  reactFlowProps: null as null | {
    nodes: Node[];
    edges: Edge[];
    onNodeClick?: (event: React.MouseEvent, node: Node) => void;
    onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
    onPaneClick?: () => void;
    onNodeDragStop?: (event: MouseEvent | TouchEvent, node: Node) => void;
    onConnect?: (connection: { source?: string | null; target?: string | null }) => void;
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
  workflowRunsOptions: () => ({ queryKey: ["runs"] }),
  workflowNodeRunsOptions: (_wsId: string, _workflowId: string, runId: string) => ({ queryKey: ["node-runs", runId] }),
  workflowRolesOptions: () => ({ queryKey: ["roles"] }),
  splitIssueWorkflowOptions: () => ({ queryKey: ["split-issue-workflow-options"] }),
  useCreateNode: () => ({ mutate: mocks.createNodeMutate, mutateAsync: vi.fn() }),
  useUpdateNode: () => ({ mutate: mocks.updateNodeMutate, mutateAsync: mocks.updateNodeMutateAsync }),
  useUpdateWorkflow: () => ({
    mutate: mocks.updateWorkflowMutate,
    mutateAsync: mocks.updateWorkflowMutateAsync,
    isPending: false,
  }),
  useMutateWorkflowRole: () => ({ mutateAsync: vi.fn() }),
  useDeleteNode: () => ({ mutateAsync: mocks.deleteNodeMutateAsync }),
  useCreateEdge: () => ({ mutate: mocks.createEdgeMutate, mutateAsync: vi.fn() }),
  useDeleteEdge: () => ({ mutate: mocks.deleteEdgeMutate, mutateAsync: vi.fn() }),
  useAssignNodeToStage: () => ({ mutate: mocks.assignStageMutate, mutateAsync: vi.fn() }),
  useCreateStage: () => ({ mutateAsync: vi.fn() }),
  useUpdateStage: () => ({ mutateAsync: mocks.updateStageMutateAsync }),
  useDeleteStage: () => ({ mutate: mocks.deleteStageMutate, mutateAsync: vi.fn() }),
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined) }),
  useStartWorkflowRun: () => ({ mutateAsync: mocks.startWorkflowRunMutateAsync }),
  useReorderStages: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  builtinPluginListOptions: () => ({ queryKey: ["plugins"] }),
}));

vi.mock("@multica/core/runtimes/queries", () => ({
  runtimeListOptions: () => ({ queryKey: ["runtimes"] }),
}));

vi.mock("../use-usable-workflow-runtimes", () => ({
  useUsableWorkflowRuntimes: (runtimes: unknown[]) => ({ runtimes, isLoading: false }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: mocks.getActorName,
    getActorInitials: mocks.getActorInitials,
    getActorAvatarUrl: mocks.getActorAvatarUrl,
  }),
}));

vi.mock("@multica/core/agents", () => ({
  useWorkspacePresenceMap: mocks.useWorkspacePresenceMap,
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@multica/core/workflows/store", () => {
  const mockUseStore: any = vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      selectedNodeId: mocks.selectedNodeId,
      selectedEdgeId: mocks.selectedEdgeId,
      selectedNodeIds: [],
      nodeEdits: mocks.nodeEdits,
      deletedNodeIds: mocks.deletedNodeIds,
      undoStack: [],
      redoStack: [],
      _reverseAction: mocks.reverseAction,
      showAnnotations: true,
      selectNode: (nodeId: string | null) => {
        mocks.selectedNodeId = nodeId;
        mocks.selectedEdgeId = null;
        mocks.selectNode(nodeId);
      },
      selectEdge: (edgeId: string | null) => {
        mocks.selectedEdgeId = edgeId;
        if (edgeId) mocks.selectedNodeId = null;
      },
      cacheNodeEdits: vi.fn(),
      cacheNodeDelete: mocks.cacheNodeDelete,
      clearNodeEdits: mocks.clearNodeEdits,
      clearNodeDelete: vi.fn(),
      pushServerAction: mocks.pushServerAction,
      clearReverseAction: mocks.clearReverseAction,
      updateLatestUndoAction: mocks.updateLatestUndoAction,
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
    _reverseAction: mocks.reverseAction,
    clearReverseAction: mocks.clearReverseAction,
    updateLatestUndoAction: mocks.updateLatestUndoAction,
  });
  return { useWorkflowEditorStore: mockUseStore };
});

vi.mock("../../../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    workflows: () => "/workflows",
    workflowRuns: (id: string) => `/workflows/${id}/runs`,
    workflowRunDetail: (workflowId: string, runId: string) => `/workflows/${workflowId}/runs/${runId}`,
  }),
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
      add_node: "Add node",
      toast_activated: "Workflow activated",
      toast_deactivated: "Workflow deactivated",
      toast_activate_failed: "Failed to update workflow status",
      toast_deleted: "Workflow deleted",
      toast_delete_failed: "Failed to delete workflow",
      toast_saved: "Workflow saved",
      toast_save_failed: "Failed to save workflow",
      toast_run_started: "Workflow run started",
      toast_run_failed: "Failed to start workflow run",
      click_to_rename: "Click to rename",
      delete: "Delete",
      delete_dialog: {
        title: "Delete Workflow",
        description: "Delete workflow {{title}}?",
        cancel: "Cancel",
        confirm: "Delete",
        deleting: "Deleting...",
      },
    },
    node: {
      role_developer: "Developer",
      role_qa: "QA",
      role_tech_lead: "Tech lead",
    },
    builtin_roles: {
      developer: { name: "Developer" },
      qa: { name: "QA" },
      tech_lead: { name: "Tech lead" },
    },
    runtime_select: {
      title: "Select runtime",
      description: "Select a runtime for {{name}}.",
      empty_title: "No runtime available",
      empty_description: "Connect a runtime device first.",
      auto_title: "Auto-select (recommended)",
      auto_description: "Select a runtime for each node when it runs.",
      cancel: "Cancel",
      confirm: "Run",
    },
    detail_panel: {
      close_confirm_title: "Save panel changes?",
      close_confirm_description: "This node inspector has unsaved changes. Save before closing?",
      discard_changes: "Discard changes",
      save_changes: "Save changes",
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
      add_first_step: "Add your first task",
      add_connected_node: "Drag to connect, click to add node",
      node_picker: {
        search_placeholder: "Search nodes or actions...",
        empty: "No matching nodes",
        trigger: "Triggers",
        trigger_description: "Start a workflow",
        action: "Actions",
        action_description: "Do work in a step",
        logic: "Logic",
        logic_description: "Branch or route work",
        ai: "AI",
        ai_description: "Agent-powered steps",
        human: "Human",
        human_description: "Review or approval",
        annotation: "Notes",
        annotation_description: "Explain the canvas",
      },
      toolbar: {
        undo: "Undo",
        redo: "Redo",
        auto_layout: "Auto layout",
        annotations: "Toggle annotations",
        save: "Save changes",
        saved: "Saved",
        unsaved: "Unsaved",
        editor: "Editor",
        run_history: "Run history",
        run_settings: "Run settings",
        test_run: "Test run",
        save_and_test: "Save & test",
        more: "More",
        blocked_tooltip: "Resolve blocking issues first.",
        activate_disabled_unsaved: "Save changes before activating.",
        activate: "Activate",
        reactivate: "Reactivate",
        deactivate: "Deactivate",
        save_first: "Save first",
        review_issues: "Review issues",
        save_before_activating_status: "Save before activating",
        available_in_issues: "Available in issues",
        hidden_from_issue_picker: "Hidden from issue picker",
        blocking_issues_left: "{{count}} issue(s) left",
      },
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
    runtime_strategy: {
      default_title: "Default run strategy",
      default_description: "Default for {{name}}",
      run_title: "Start workflow",
      run_description: "Run {{name}}",
      runtime_label: "Preferred runtime",
      runtime_placeholder: "Select a runtime",
      online: "Online",
      offline: "Offline",
      deleted_runtime: "Runtime unavailable",
      no_runtime: "No runtime",
      direct_run_hint: "No issue creator",
      cancel: "Cancel",
      saving: "Saving...",
      save_default: "Save default",
      start_run: "Start run",
      toast_default_saved: "Saved",
      toast_default_failed: "Failed",
      policy: {
        specified_runtime_first: { title: "Specified runtime first", description: "Specified → idle → creator" },
        idle_first: { title: "Idle runtime first", description: "Idle → creator" },
        issue_creator_first: { title: "Issue creator first", description: "Creator → idle" },
      },
    },
    preflight: {
      bar_collapsed_all_clear: "Ready to activate",
      bar_collapsed_blocking: "{{count}} blocking",
      bar_collapsed_warnings: "{{count}} warning(s)",
      bar_collapsed_issues: "{{count}} issue(s) before activation",
      bar_expand: "Review issues",
      bar_dismiss: "Dismiss",
      bar_activate: "Activate",
      bar_active_button: "Active",
      bar_activate_disabled_unsaved: "Save first",
      bar_activating: "Activating...",
      check_stage_missing: "No stage assigned",
      first_stage_guide_title: "Create your first node",
      first_stage_guide_description: "Nodes are the steps that make this workflow run.",
      first_stage_guide_cta: "Create stage",
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
    onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
    onPaneClick?: () => void;
    onNodeDragStop?: (event: MouseEvent | TouchEvent, node: Node) => void;
    onConnect?: (connection: { source?: string | null; target?: string | null }) => void;
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
  Controls: (props: {
    position?: string;
    orientation?: string;
    className?: string;
  }) => {
    mocks.controlsProps = props;
    return <div data-testid="rf-controls" />;
  },
  MiniMap: (props: {
    position?: string;
    className?: string;
    style?: React.CSSProperties;
    bgColor?: string;
    maskColor?: string;
    maskStrokeColor?: string;
    maskStrokeWidth?: number;
    nodeBorderRadius?: number;
    nodeColor?: (node: Node) => string;
  }) => {
    mocks.miniMapProps = props;
    return <div data-testid="rf-minimap" />;
  },
  Handle: () => <div data-testid="rf-handle" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x - 200, y: y - 100 }),
    flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x: x + 200, y: y + 100 }),
  }),
}));

vi.mock("../node-config-panel", () => ({
  NodeConfigPanel: (props: {
    node: { id: string };
    recentNodeRun?: { workflow_node_id: string } | null;
    onStageChange?: (nodeId: string, stageId: string | null) => void;
    onDeleteNode?: (nodeId: string) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
  }) => (
    <div data-testid="node-config-panel">
      <button
        type="button"
        onClick={() => {
          props.onDirtyChange?.(true);
          props.onRegisterSave?.(mocks.configPanelSave);
        }}
      >
        Mark panel dirty
      </button>
      <button type="button" onClick={() => props.onStageChange?.(props.node.id, "stage-2")}>
        Move to Stage 2
      </button>
      <button type="button" onClick={() => props.onDeleteNode?.(props.node.id)}>
        Delete Node
      </button>
    </div>
  ),
}));

vi.mock("@multica/core/workflows/preflight-checks", () => ({
  runAllPreflightChecks: () => mocks.preflightResult,
}));

vi.mock("./preflight-bar", () => ({
  PreflightBar: ({ onDismiss }: { onDismiss: () => void }) => (
    <div data-testid="preflight-bar">
      <button type="button" onClick={onDismiss}>Dismiss preflight</button>
    </div>
  ),
}));

// Mock TanStack Query — reads from hoisted mocks
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  }),
  useQuery: (opts: { queryKey: string[] }) => {
    const key = opts.queryKey.join(",");
    if (key.includes("node-runs")) return { data: mocks.nodeRunsData, isLoading: false, isError: false };
    if (key.includes("runs")) return { data: mocks.runsData, isLoading: false, isError: false };
    if (key.includes("stages")) return { data: mocks.stagesData, isLoading: false, isError: false };
    if (key.includes("nodes")) return { data: mocks.nodesData, isLoading: false, isError: false };
    if (key.includes("edges")) return { data: mocks.edgesData, isLoading: false, isError: false };
    if (key.includes("detail")) return { data: mocks.workflowData, isLoading: false, isError: false };
    if (key.includes("agents")) return { data: [], isLoading: false };
    if (key.includes("plugins")) return { data: { items: [] }, isLoading: false };
    if (key.includes("roles")) return { data: mocks.workflowRolesData, isLoading: false };
		if (key.includes("runtimes")) return { data: mocks.runtimesData, isLoading: false };
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
    mocks.workflowData = {
      id: "wf-1",
      title: "Test Workflow",
      status: "draft",
      default_runtime_selection_policy: "idle_first",
      default_runtime_id: null,
    };
    mocks.nodesData = [];
    mocks.edgesData = [];
    mocks.workflowRolesData = [];
    mocks.runsData = [];
    mocks.nodeRunsData = [];
    mocks.runtimesData = [];
    mocks.preflightResult = {
      issues: [],
      blockingCount: 0,
      warningCount: 0,
      passed: true,
    };
    mocks.selectedNodeId = null;
    mocks.selectedEdgeId = null;
    mocks.nodeEdits = {};
    mocks.deletedNodeIds = [];
    mocks.createNodeMutate.mockReset();
    mocks.createEdgeMutate.mockReset();
    mocks.updateNodeMutate.mockReset();
    mocks.updateNodeMutateAsync.mockReset();
    mocks.assignStageMutate.mockReset();
    mocks.deleteNodeMutateAsync.mockReset();
    mocks.deleteEdgeMutate.mockReset();
    mocks.updateStageMutateAsync.mockReset();
    mocks.deleteStageMutate.mockReset();
    mocks.updateWorkflowMutate.mockReset();
    mocks.updateWorkflowMutateAsync.mockReset();
    mocks.startWorkflowRunMutateAsync.mockReset();
    mocks.navigationPush.mockReset();
    mocks.getActorName.mockReset();
    mocks.getActorName.mockReturnValue("Test Agent");
    mocks.getActorInitials.mockReset();
    mocks.getActorInitials.mockReturnValue("TA");
    mocks.getActorAvatarUrl.mockReset();
    mocks.getActorAvatarUrl.mockReturnValue(null);
    mocks.useWorkspacePresenceMap.mockClear();
    mocks.useWorkspacePresenceMap.mockReturnValue({ byAgent: new Map(), loading: false });
    mocks.selectNode.mockReset();
    mocks.clearNodeEdits.mockReset();
    mocks.clearReverseAction.mockReset();
    mocks.updateLatestUndoAction.mockReset();
    mocks.configPanelSave.mockReset();
    mocks.configPanelSave.mockResolvedValue(true);
    mocks.reverseAction = null;
    mocks.reactFlowProps = null;
    mocks.controlsProps = null;
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
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test run" })).toBeInTheDocument();
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

  it("only sends title and description when saving cached boundary node edits", async () => {
    mocks.nodesData = [
      {
        id: "start-1",
        workflow_id: "wf-1",
        title: "Start",
        description: "",
        worker_type: "human",
        worker_id: null,
        worker_role_id: null,
        critic_type: "human",
        critic_id: null,
        critic_role_id: null,
        critic_api_url: null,
        stage_id: "stage-1",
        format_schema: { type: "start" },
        position_x: 120,
        position_y: 0,
        sort_order: 0,
        created_at: "",
        updated_at: "",
      },
    ];
    mocks.nodeEdits = {
      "start-1": {
        title: "Begin",
        description: "Entry point",
        worker_type: "agent",
        worker_id: "agent-1",
        worker_role_id: "role-1",
        critic_type: "api",
        critic_id: "critic-1",
        critic_role_id: "role-2",
        critic_api_url: "https://critic.example.test",
        format_schema: { type: "split" },
      },
    };
    mocks.updateNodeMutateAsync.mockResolvedValueOnce({});

    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => {
      expect(mocks.updateNodeMutateAsync).toHaveBeenCalledWith({
        nodeId: "start-1",
        title: "Begin",
        description: "Entry point",
      });
    });
  });

  it("clears cached node edits when deleting a node from the config panel", async () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Server title", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };
    mocks.deleteNodeMutateAsync.mockResolvedValueOnce(undefined);
    mocks.clearNodeEdits.mockImplementation((nodeId: string) => {
      delete mocks.nodeEdits[nodeId];
    });

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByText("Delete Node"));

    await vi.waitFor(() => {
      expect(mocks.deleteNodeMutateAsync).toHaveBeenCalledWith("node-1");
      expect(mocks.clearNodeEdits).toHaveBeenCalledWith("node-1");
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(mocks.updateNodeMutateAsync).not.toHaveBeenCalled();
  });

  it("skips cached edits for nodes already marked deleted when saving", async () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Server title", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };
    mocks.deletedNodeIds = ["node-1"];
    mocks.clearNodeEdits.mockImplementation((nodeId: string) => {
      delete mocks.nodeEdits[nodeId];
    });

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => {
      expect(mocks.clearNodeEdits).toHaveBeenCalledWith("node-1");
    });
    expect(mocks.updateNodeMutateAsync).not.toHaveBeenCalled();
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

  it("从 Add node picker 创建模板节点", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add node" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Task:/ }));

    expect(mocks.createNodeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Task",
        worker_type: "agent",
        format_schema: expect.objectContaining({
          template_id: "agent-task",
          template_category: "action",
        }),
      }),
      expect.any(Object),
    );
  });

  it("disables boundary templates that already exist in the workflow", () => {
    mocks.nodesData = [{
      id: "start",
      workflow_id: "wf-1",
      title: "Start",
      description: "",
      worker_type: "human",
      worker_id: null,
      critic_type: "human",
      critic_id: null,
      critic_api_url: null,
      stage_id: "stage-1",
      format_schema: { type: "start" },
      position_x: 120,
      position_y: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    }];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add node" })[0]!);

    expect(screen.getByRole("button", { name: /^Start:/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^End:/ })).toBeEnabled();
  });

  it("first-step guide 打开 picker，而不是直接创建默认矩形", () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Build", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add node" })[1]!);

    expect(screen.getByTestId("node-template-picker")).toBeInTheDocument();
    expect(mocks.createNodeMutate).not.toHaveBeenCalled();
  });

  it("does not render an unassigned stage lane label", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("restores a dismissed blocking preflight from the toolbar", () => {
    mocks.stagesData = [];
    mocks.nodesData = [{
      id: "node-1",
      workflow_id: "wf-1",
      title: "Task",
      description: "",
      worker_type: "human",
      worker_id: null,
      critic_type: "human",
      critic_id: null,
      critic_api_url: null,
      stage_id: null,
      format_schema: null,
      position_x: 120,
      position_y: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    }];
    mocks.preflightResult = {
      issues: [{
        checkId: "worker-missing",
        severity: "error",
        blocking: true,
        nodeId: "node-1",
        nodeTitle: "Task",
        message: "Worker missing",
      }],
      blockingCount: 1,
      warningCount: 0,
      passed: false,
    };

    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss preflight" }));
    expect(screen.queryByTestId("preflight-bar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review issues" }));
    expect(screen.getByTestId("preflight-bar")).toBeInTheDocument();
  });

  it("renders an unassigned stage lane for workflows whose nodes have no stage", () => {
    mocks.stagesData = [];
    mocks.nodesData = [{
      id: "node-1",
      workflow_id: "wf-1",
      title: "Task",
      description: "",
      worker_type: "human",
      worker_id: null,
      critic_type: "human",
      critic_id: null,
      critic_api_url: null,
      stage_id: null,
      format_schema: null,
      position_x: 120,
      position_y: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    }];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows add node as the primary empty-workflow action", () => {
    mocks.stagesData = [];
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(screen.getByRole("button", { name: "Add node" })).toBeInTheDocument();
    expect(screen.getByText("Create stage")).toBeInTheDocument();
    expect(screen.getByText("Create your first node")).toBeInTheDocument();
    expect(screen.queryByText("Create your first stage")).not.toBeInTheDocument();
  });

  it("creates an unassigned node from the empty-workflow add node picker", () => {
    mocks.stagesData = [];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    fireEvent.click(screen.getByRole("button", { name: /Task:/ }));

    expect(mocks.createNodeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Task",
        stage_id: null,
        format_schema: expect.objectContaining({
          template_id: "agent-task",
          template_category: "action",
        }),
      }),
      expect.any(Object),
    );
  });

  it("renders configured critic inside the worker node instead of a separate critic badge node", () => {
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

    const renderedNodes = mocks.reactFlowProps?.nodes ?? [];
    const worker = renderedNodes.find((n) => n.id === "node-1");
    expect(renderedNodes.map((node) => node.id)).toEqual(expect.arrayContaining(["node-1"]));
    expect(renderedNodes.some((node) => node.id === "node-1:critic")).toBe(false);
    expect(worker?.data).toMatchObject({
      criticName: "Test Agent",
      criticConfigured: true,
    });
  });

  it("renders worker nodes at their persisted x coordinate without label rail offsets", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect(worker).toMatchObject({ position: { x: 120, y: 12 } });
  });

  it("saves cached node edits, confirms the default strategy, and starts a test run", async () => {
    mocks.workflowData = {
      id: "wf-1",
      title: "Test Workflow",
      status: "active",
      default_runtime_selection_policy: "idle_first",
      default_runtime_id: null,
    };
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Server title", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };
    mocks.updateNodeMutateAsync.mockResolvedValueOnce({});
    mocks.startWorkflowRunMutateAsync.mockResolvedValueOnce({ id: "run-1" });

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    await vi.waitFor(() => {
      expect(mocks.updateNodeMutateAsync).toHaveBeenCalledWith({
        nodeId: "node-1",
        title: "Edited title",
      });
      expect(screen.getByText("Idle runtime first")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    await vi.waitFor(() => {
      expect(mocks.startWorkflowRunMutateAsync).toHaveBeenCalledWith({
        workflowId: "wf-1",
        runtimeSelectionPolicy: "idle_first",
      });
      expect(mocks.navigationPush).toHaveBeenCalledWith("/workflows/wf-1/runs/run-1");
    });
    expect(mocks.updateNodeMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startWorkflowRunMutateAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("saves the workflow-level default runtime strategy", async () => {
    mocks.updateWorkflowMutateAsync.mockResolvedValueOnce({});
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Run settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save default" }));

    await vi.waitFor(() => {
      expect(mocks.updateWorkflowMutateAsync).toHaveBeenCalledWith({
        id: "wf-1",
        default_runtime_selection_policy: "idle_first",
        default_runtime_id: null,
      });
    });
  });

  it("renders worker nodes in the first visible lane when stage sort orders are sparse", () => {
    mocks.stagesData = [
      { id: "stage-2", workflow_id: "wf-1", name: "Stage 2", description: "", sort_order: 1, node_count: 0, created_at: "", updated_at: "" },
      { id: "stage-3", workflow_id: "wf-1", name: "Stage 3", description: "", sort_order: 2, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-2", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect(worker).toMatchObject({ position: { x: 120, y: 12 } });
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
    expect(nodeIds).not.toContain("node-1:critic");
    expect(nodeIds).not.toContain("node-2");
    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect((worker?.data.node as { title: string }).title).toBe("Edited title");
    expect(worker?.data).toMatchObject({ criticName: "API review", criticConfigured: true });
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

  it("injects static worker and critic semantics into worker nodes", () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Intake", description: "Collect context", sort_order: 0, node_count: 1, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Qualify lead", description: "", worker_type: "agent", worker_id: "agent-1", critic_type: "human", critic_id: "member-1", critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.runsData = [{ id: "run-1" }];
    mocks.nodeRunsData = [
      { id: "nr-1", workflow_run_id: "run-1", workflow_node_id: "node-1", status: "completed" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect(worker?.data).toMatchObject({
      workerConfigured: true,
      criticConfigured: true,
      criticName: "Test Agent",
    });
    expect(worker?.data).not.toHaveProperty("stageName");
    expect(worker?.data).not.toHaveProperty("stageDescription");
    expect(worker?.data).not.toHaveProperty("runStatus");
    expect(mocks.getActorName).toHaveBeenCalledWith("member", "member-1");
  });

  it("resolves editor actor identities and agent presence once at page level", () => {
    mocks.getActorName.mockImplementation((type: string, id: string) => ({
      "agent:agent-1": "Builder Agent",
      "member:member-1": "Reviewer",
      "squad:squad-1": "Platform Squad",
    } as Record<string, string>)[`${type}:${id}`] ?? "Unknown");
    mocks.getActorInitials.mockImplementation((type: string, id: string) => ({
      "agent:agent-1": "BA",
      "member:member-1": "R",
      "squad:squad-1": "PS",
    } as Record<string, string>)[`${type}:${id}`] ?? "U");
    mocks.getActorAvatarUrl.mockImplementation((type: string, id: string) =>
      type === "agent" && id === "agent-1" ? "/agent.png" : null,
    );
    mocks.useWorkspacePresenceMap.mockReturnValue({
      byAgent: new Map([["agent-1", { availability: "online" as const }]]),
      loading: false,
    });
    mocks.workflowRolesData = [{
      id: "role-1",
      workflow_id: "wf-1",
      name: "developer",
      description: "",
      is_builtin: true,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    }];
    const baseNode = {
      workflow_id: "wf-1",
      title: "Task",
      description: "",
      critic_type: "human",
      critic_id: null,
      critic_api_url: null,
      stage_id: "stage-1",
      format_schema: null,
      position_y: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    };
    mocks.nodesData = [
      { ...baseNode, id: "agent-node", worker_type: "agent", worker_id: "agent-1", critic_id: "member-1", position_x: 120 },
      { ...baseNode, id: "squad-node", worker_type: "squad", worker_id: "squad-1", position_x: 420 },
      { ...baseNode, id: "role-node", worker_type: "role", worker_id: null, worker_role_id: "role-1", position_x: 720 },
      { ...baseNode, id: "api-node", worker_type: "human", worker_id: "member-1", critic_type: "api", critic_api_url: "https://review.example.test", position_x: 1020 },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const renderedNodes = mocks.reactFlowProps?.nodes ?? [];
    expect(renderedNodes.find((node) => node.id === "agent-node")?.data).toMatchObject({
      workerIdentity: {
        type: "agent",
        id: "agent-1",
        name: "Builder Agent",
        typeLabel: "Digital human",
        initials: "BA",
        avatarUrl: "/agent.png",
        availability: "online",
        availabilityLabel: "Online",
      },
      criticIdentity: {
        type: "member",
        id: "member-1",
        name: "Reviewer",
        typeLabel: "Member",
      },
    });
    expect(renderedNodes.find((node) => node.id === "squad-node")?.data.workerIdentity).toMatchObject({
      type: "squad",
      id: "squad-1",
      name: "Platform Squad",
      typeLabel: "Squad",
    });
    expect(renderedNodes.find((node) => node.id === "role-node")?.data.workerIdentity).toEqual({
      type: "role",
      id: null,
      name: "Developer",
      typeLabel: "Development role",
    });
    expect(renderedNodes.find((node) => node.id === "api-node")?.data.criticIdentity).toEqual({
      type: "api",
      id: null,
      name: "API review",
      typeLabel: "API reviewer",
    });
    expect(mocks.useWorkspacePresenceMap).toHaveBeenCalledTimes(1);
    expect(mocks.useWorkspacePresenceMap).toHaveBeenCalledWith("ws-test");
  });

  it("marks annotation nodes so they do not require worker configuration", () => {
    mocks.nodesData = [
      { id: "note-1", workflow_id: "wf-1", title: "Note", description: "", worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: { type: "annotation" }, position_x: 120, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const note = mocks.reactFlowProps?.nodes.find((n) => n.id === "note-1");
    expect(note?.data).toMatchObject({
      isAnnotation: true,
      workerConfigured: true,
      criticConfigured: false,
    });
  });

  it("injects semantic edge tones from condition objects without text labels", () => {
    mocks.nodesData = [
      { id: "a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: "agent-1", critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 460, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];
    mocks.edgesData = [
      { id: "e-condition", workflow_id: "wf-1", source_node_id: "a", target_node_id: "b", condition: { kind: "condition", label: "approved" }, created_at: "" },
      { id: "e-data", workflow_id: "wf-1", source_node_id: "b", target_node_id: "a", condition: "legacy", created_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const conditionEdge = mocks.reactFlowProps?.edges.find((e) => e.id === "e-condition");
    const dataEdge = mocks.reactFlowProps?.edges.find((e) => e.id === "e-data");
    expect(conditionEdge?.data).toMatchObject({
      edgeKind: "condition",
      edgeTone: "condition",
    });
    expect(dataEdge?.data).toMatchObject({
      edgeKind: "data",
      edgeTone: "data",
    });
    expect(conditionEdge?.data).not.toHaveProperty("edgeLabel");
    expect(dataEdge?.data).not.toHaveProperty("edgeLabel");
  });

  it("injects delete callbacks into editable workflow edges without default critic edges", () => {
    mocks.nodesData = [
      { id: "a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: "agent-1", critic_type: "agent", critic_id: "agent-2", critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 460, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];
    mocks.edgesData = [
      { id: "edge-a-b", workflow_id: "wf-1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const workflowEdge = mocks.reactFlowProps?.edges.find((edge) => edge.id === "edge-a-b");
    const criticEdge = mocks.reactFlowProps?.edges.find((edge) => edge.id === "a:critic-edge");
    expect(workflowEdge?.data).toHaveProperty("onDeleteEdge");
    expect(criticEdge).toBeUndefined();

    (workflowEdge?.data?.onDeleteEdge as (edgeId: string) => void)("edge-a-b");
    expect(mocks.deleteEdgeMutate).toHaveBeenCalledWith("edge-a-b");
    expect(mocks.pushServerAction).toHaveBeenCalledWith({ type: "delete-edge", edgeId: "edge-a-b" });
  });

  it("undoes a created node by deleting the persisted node", async () => {
    mocks.reverseAction = {
      direction: "undo",
      action: { type: "create-node", nodeId: "created-node" },
    };
    mocks.deleteNodeMutateAsync.mockResolvedValueOnce(undefined);

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    await vi.waitFor(() => {
      expect(mocks.deleteNodeMutateAsync).toHaveBeenCalledWith("created-node");
      expect(mocks.clearReverseAction).toHaveBeenCalled();
    });
  });

  it("redoes a created node by recreating it from the stored request", async () => {
    const nodeRequest = {
      title: "Agent task",
      worker_type: "agent" as const,
      critic_type: "human" as const,
    };
    mocks.reverseAction = {
      direction: "redo",
      action: { type: "create-node", nodeRequest },
    };

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    await vi.waitFor(() => {
      expect(mocks.createNodeMutate).toHaveBeenCalledWith(nodeRequest, expect.any(Object));
      expect(mocks.clearReverseAction).toHaveBeenCalled();
    });

    const [, options] = mocks.createNodeMutate.mock.calls[0]!;
    options.onSuccess({ id: "recreated-node" });
    expect(mocks.updateLatestUndoAction).toHaveBeenCalledWith({
      type: "create-node",
      nodeRequest,
      nodeId: "recreated-node",
    });
  });

  it("marks a workflow edge selected after edge click so the inline delete button can render", () => {
    mocks.nodesData = [
      { id: "a", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "b", workflow_id: "wf-1", title: "B", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 460, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];
    mocks.edgesData = [
      { id: "edge-a-b", workflow_id: "wf-1", source_node_id: "a", target_node_id: "b", condition: null, created_at: "" },
    ];

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.reactFlowProps?.edges.find((edge) => edge.id === "edge-a-b")?.selected).toBe(false);

    act(() => {
      mocks.reactFlowProps?.onEdgeClick?.({ clientX: 340, clientY: 220 } as React.MouseEvent, mocks.reactFlowProps.edges[0]!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    const selectedEdge = mocks.reactFlowProps?.edges.find((edge) => edge.id === "edge-a-b");
    expect(selectedEdge?.selected).toBe(true);
    expect(selectedEdge?.data).toHaveProperty("onDeleteEdge");
    expect(selectedEdge?.data).toMatchObject({
      deleteButtonPosition: { x: 140, y: 120 },
    });

    act(() => {
      mocks.reactFlowProps?.onPaneClick?.();
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.reactFlowProps?.edges.find((edge) => edge.id === "edge-a-b")?.selected).toBe(false);
  });

  it("does not generate critic edges by default in the editor panorama", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "Worker", description: "", worker_type: "agent", worker_id: "agent-1", critic_type: "agent", critic_id: "agent-2", critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 320, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const criticEdge = mocks.reactFlowProps?.edges.find((e) => e.id === "node-1:critic-edge");
    expect(criticEdge).toBeUndefined();
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

  it("persists dragged node x coordinates without label rail offsets", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    mocks.reactFlowProps?.onNodeDragStop?.({} as MouseEvent, {
      ...worker!,
      position: { x: 280, y: 12 },
    });

    expect(mocks.updateNodeMutate).toHaveBeenCalledWith({
      nodeId: "node-1",
      position_x: 280,
    });
  });

  it("persists dragged node x coordinates in the left-side blank canvas", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    mocks.reactFlowProps?.onNodeDragStop?.({} as MouseEvent, {
      ...worker!,
      position: { x: -180, y: 12 },
    });

    expect(mocks.updateNodeMutate).toHaveBeenCalledWith({
      nodeId: "node-1",
      position_x: -180,
    });
  });

  it("opens the add-node picker from the node plus action without creating immediately", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      (worker?.data.onAddConnectedNode as undefined | ((nodeId: string) => void))?.("node-1");
    });

    expect(screen.getByTestId("node-template-picker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Start:/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^End:/ })).toBeEnabled();
    expect(mocks.createNodeMutate).not.toHaveBeenCalled();
  });

  it("creates the selected downstream node in the same stage and auto-connects it", () => {
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Stage 1", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
      { id: "stage-2", workflow_id: "wf-1", name: "Stage 2", description: "", sort_order: 1, node_count: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-2", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      (worker?.data.onAddConnectedNode as undefined | ((nodeId: string) => void))?.("node-1");
    });
    fireEvent.click(screen.getByRole("button", { name: /Task:/ }));

    expect(mocks.createNodeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Task",
        position_x: 492,
        stage_id: "stage-2",
      }),
      expect.any(Object),
    );

    const [, options] = mocks.createNodeMutate.mock.calls[0]!;
    options.onSuccess({ id: "created-node" });

    expect(mocks.createEdgeMutate).toHaveBeenCalledWith(
      {
        source_node_id: "node-1",
        target_node_id: "created-node",
      },
      expect.any(Object),
    );
  });

  it("creates a selected start node before the source and connects it in boundary direction", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 500, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((node) => node.id === "node-1");
    act(() => {
      (worker?.data.onAddConnectedNode as undefined | ((nodeId: string) => void))?.("node-1");
    });
    fireEvent.click(screen.getByRole("button", { name: /^Start:/ }));

    expect(mocks.createNodeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Start",
        position_x: 228,
        stage_id: "stage-1",
      }),
      expect.any(Object),
    );

    const [, options] = mocks.createNodeMutate.mock.calls[0]!;
    options.onSuccess({ id: "created-start" });

    expect(mocks.createEdgeMutate).toHaveBeenCalledWith(
      {
        source_node_id: "created-start",
        target_node_id: "node-1",
      },
      expect.any(Object),
    );
  });

  it("keeps drag-to-connect support between existing nodes", () => {
    mocks.nodesData = [
      { id: "source", workflow_id: "wf-1", title: "Source", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
      { id: "target", workflow_id: "wf-1", title: "Target", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 420, position_y: 0, sort_order: 1, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    mocks.reactFlowProps?.onConnect?.({ source: "source", target: "target" });

    expect(mocks.createEdgeMutate).toHaveBeenCalledWith(
      {
        source_node_id: "source",
        target_node_id: "target",
      },
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

  it("prompts with an app dialog before closing a dirty node config panel", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark panel dirty" }));

    act(() => {
      mocks.reactFlowProps?.onPaneClick?.();
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Save panel changes?")).toBeInTheDocument();
    expect(screen.getByText("This node inspector has unsaved changes. Save before closing?")).toBeInTheDocument();
    expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();
    expect(mocks.selectNode).not.toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mocks.configPanelSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();
    expect(mocks.selectNode).not.toHaveBeenCalledWith(null);

    act(() => {
      mocks.reactFlowProps?.onPaneClick?.();
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => {
      expect(mocks.configPanelSave).toHaveBeenCalledTimes(1);
      expect(mocks.selectNode).toHaveBeenLastCalledWith(null);
    });

    confirmSpy.mockRestore();
  });

  it("can discard dirty node config panel changes without saving", async () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];
    mocks.nodeEdits = {
      "node-1": { title: "Edited title" },
    };

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark panel dirty" }));

    act(() => {
      mocks.reactFlowProps?.onPaneClick?.();
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(mocks.selectNode).toHaveBeenLastCalledWith(null);
    });
    expect(mocks.configPanelSave).not.toHaveBeenCalled();
    expect(mocks.clearNodeEdits).toHaveBeenCalledWith("node-1");
  });

  it("confirms stage deletion with an app dialog instead of the browser confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    mocks.stagesData = [
      { id: "stage-1", workflow_id: "wf-1", name: "Intake", description: "", sort_order: 0, node_count: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByLabelText("Delete stage"));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText('Delete stage "Intake"?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete stage" }));
    expect(mocks.deleteStageMutate).toHaveBeenCalledWith("stage-1");

    confirmSpy.mockRestore();
  });

  it("lets the shared node detail panel shell own the inspector width", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    const { rerender } = render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    act(() => {
      mocks.reactFlowProps?.onNodeClick?.({} as React.MouseEvent, worker!);
    });
    rerender(<WorkflowPanoramaPage workflowId="wf-1" />);

    const rail = screen.getByTestId("node-config-panel").closest("aside");
    expect(rail?.className).not.toContain("w-[560px]");
    expect(rail?.className).not.toContain("max-w-[48vw]");
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
      position_x: 904,
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

  it("does not model stage lane backgrounds as clickable ReactFlow nodes", () => {
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
    expect(laneBg).toBeUndefined();
    expect(screen.getByTestId("node-config-panel")).toBeInTheDocument();
  });

  it("keeps stage lane backgrounds out of ReactFlow nodes and the minimap", () => {
    mocks.nodesData = [
      { id: "node-1", workflow_id: "wf-1", title: "A", description: "", worker_type: "agent", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, stage_id: "stage-1", format_schema: null, position_x: 100, position_y: 0, sort_order: 0, created_at: "", updated_at: "" },
    ];

    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.miniMapProps?.nodeColor?.({ type: "compactWorker" } as Node)).toBe("#64748b");

    // Nodes must carry explicit width/height so MiniMap can render them
    // before the ResizeObserver fires (nodeHasDimensions check in @xyflow/system)
    const worker = mocks.reactFlowProps?.nodes.find((n) => n.id === "node-1");
    expect(worker).toMatchObject({ width: 296, height: 152 });
    expect(mocks.reactFlowProps?.nodes.some((n) => n.type === "laneBg" || n.type === "gradientBg")).toBe(false);
  });

  it("docks workflow canvas navigation controls with the minimap separated", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    expect(mocks.controlsProps).toMatchObject({
      position: "bottom-left",
      orientation: "horizontal",
    });
    expect(mocks.controlsProps?.className).toContain("!m-5");
    expect(mocks.controlsProps?.className).toContain("[&_.react-flow__controls-button]:h-8");

    expect(mocks.miniMapProps).toMatchObject({
      position: "bottom-right",
      bgColor: "hsl(var(--card))",
      maskColor: "hsl(var(--muted) / 0.14)",
      maskStrokeColor: "transparent",
      maskStrokeWidth: 0,
      nodeBorderRadius: 4,
      style: { width: 156, height: 104, border: "none" },
    });
    expect(mocks.miniMapProps?.className).toContain("!m-5");
    expect(mocks.miniMapProps?.className).not.toContain("border");
  });

  it("reserves the fixed stage label rail outside the ReactFlow interaction layer", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    const canvas = screen.getByTestId("panorama-canvas");
    expect(canvas.className).toContain("absolute");
    expect(canvas.className).toContain("left-40");
    expect(canvas.className).toContain("right-0");
    expect(canvas.className).toContain("inset-y-0");
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
    mocks.workflowData = {
      id: "wf-1",
      title: "Test Workflow",
      status: "active",
      default_runtime_selection_policy: "idle_first",
      default_runtime_id: null,
    };
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
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
  });

  it("opens the delete confirmation dialog", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Workflow")).toBeInTheDocument();
  });

  it("renders the theme action in the More menu", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
  });

  it("passes colorMode to ReactFlow", () => {
    render(<WorkflowPanoramaPage workflowId="wf-1" />);
    expect(mocks.reactFlowProps?.colorMode).toBeUndefined();
  });
});

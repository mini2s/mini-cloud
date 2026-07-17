"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MarkerType,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type Viewport,
} from "@xyflow/react";
import {
  workflowDetailOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowNodeRunsOptions,
  workflowRunCanvasSummaryOptions,
  splitTasksOptions,
  splitIssueWorkflowOptions,
  workflowKeys,
} from "@multica/core/workflows/queries";
import { useWorkspacePaths } from "@multica/core/paths";
import { api } from "@multica/core/api";
import { agentListOptions, memberListOptions, squadListOptions } from "@multica/core/workspace/queries";
import { workerTypeToActorType } from "@multica/core/types";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowStage,
  Agent,
  MemberWithUser,
  Squad,
  SplitTask,
  Workflow,
  WorkflowRuntimeDisplayStatus,
  WorkerType,
} from "@multica/core/types";
import { parseNodeFormat } from "@multica/core/types";
import { WorkflowCanvasCore } from "../../../workflows/components/canvas/workflow-canvas-core";
import {
  workflowEdgesToReactFlowEdges,
  workflowNodesToReactFlowNodes,
} from "../../../workflows/components/canvas/workflow-canvas-model";
import { panoramaEdgeTypes } from "../../../workflows/components/overview/reactflow-edges";
import {
  WORKER_WIDTH,
  sortStagesForDisplay,
} from "../../../workflows/components/overview/constants";
import { ExecutionDetailPanel } from "./execution-detail-panel";
import { GlobalNotificationBar } from "./global-notification-bar";
import {
  RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH,
  RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP,
  RUNTIME_SPLIT_SUBFLOW_HEADER_HEIGHT,
  RUNTIME_SPLIT_SUBFLOW_MIN_HEIGHT,
  RUNTIME_SPLIT_SUBFLOW_MIN_WIDTH,
  RUNTIME_SPLIT_SUBFLOW_ROW_GAP,
  RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT,
  RUNTIME_SPLIT_SUBFLOW_X_PADDING,
  runtimeCanvasNodeTypes,
  type RuntimeSplitSubflowChildIssue,
} from "./runtime-canvas-node";
import { RUNTIME_NODE_HEIGHT } from "./runtime-node-card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@multica/ui/lib/utils";
import { SplitReviewPanel } from "../../../workflows/components/split/split-review-panel";
import { useNavigation } from "../../../navigation";
import { useT } from "@multica/views/i18n";

export interface ExecutionPanoramaPageProps {
  workflowId: string;
  runId: string | null;
  wsId: string;
  issueId?: string;
  fillAvailableHeight?: boolean;
}

const RUNTIME_CANVAS_FIT_VIEW = {
  padding: 0.16,
  maxZoom: 1,
} as const;

const RUNTIME_INITIAL_FOCUS_VIEW = {
  duration: 450,
  zoom: 1.45,
} as const;

const SPLIT_CHILD_X_GAP = 144;
const SPLIT_CHILD_SAFE_X_GAP = 96;
const SPLIT_CHILD_NODE_ID_PART = ":split-task:";
const SPLIT_SUBFLOW_NODE_ID_PART = ":split-subflow";

interface SplitChildClusterLayout {
  splitNode: WorkflowNode;
  levelGroups: Map<number, SplitTask[]>;
}

interface SplitChildClusterBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface SplitChildIssueDetail {
  issueId: string;
  node: WorkflowNode;
  runtimeSummary: WorkflowNodeRuntimeSummary;
  workerName: string | null;
}

interface SplitViewportRestoreRequest {
  requestId: number;
  viewport: Viewport;
}

function splitTaskDisplayStatus(status: SplitTask["status"]): WorkflowRuntimeDisplayStatus {
  switch (status) {
    case "running":
      return "in_progress";
    case "done":
      return "completed";
    case "failed":
      return "blocked";
    case "cancelled":
    case "skipped":
    case "discarded":
      return "cancelled";
    case "created":
    case "approved":
      return "todo";
    case "draft":
    default:
      return "pending";
  }
}

type IssueTranslator = ReturnType<typeof useT<"issues">>["t"];

function runtimeDisplayStatusText(t: IssueTranslator, status: WorkflowRuntimeDisplayStatus): string {
  switch (status) {
    case "pending":
      return t(($) => $.execution.display_status.pending);
    case "todo":
      return t(($) => $.execution.display_status.todo);
    case "in_progress":
      return t(($) => $.execution.display_status.in_progress);
    case "reviewing":
      return t(($) => $.execution.display_status.reviewing);
    case "completed":
      return t(($) => $.execution.display_status.completed);
    case "blocked":
      return t(($) => $.execution.display_status.blocked);
    case "cancelled":
      return t(($) => $.execution.display_status.cancelled);
  }
}

function splitTaskWorkerType(task: SplitTask): WorkerType {
  return task.workflow_id ? "agent" : "human";
}

function createSplitChildNodeId(parentNodeId: string, taskId: string): string {
  return `${parentNodeId}:split-task:${taskId}`;
}

function createSplitSubflowNodeId(parentNodeId: string): string {
  return `${parentNodeId}${SPLIT_SUBFLOW_NODE_ID_PART}`;
}

function isSplitExpansionNodeId(nodeId: string): boolean {
  return nodeId.includes(SPLIT_CHILD_NODE_ID_PART) || nodeId.endsWith(SPLIT_SUBFLOW_NODE_ID_PART);
}

function splitSubflowHeight(levelGroups: Map<number, SplitTask[]>): number {
  const maxRows = Math.max(1, ...Array.from(levelGroups.values()).map((group) => group.length));
  return Math.max(
    RUNTIME_SPLIT_SUBFLOW_MIN_HEIGHT,
    RUNTIME_SPLIT_SUBFLOW_HEADER_HEIGHT +
      maxRows * RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT +
      (maxRows - 1) * RUNTIME_SPLIT_SUBFLOW_ROW_GAP +
      RUNTIME_SPLIT_SUBFLOW_X_PADDING * 2,
  );
}

function splitSubflowWidth(levelGroups: Map<number, SplitTask[]>): number {
  const levelCount = Math.max(1, levelGroups.size);
  return Math.max(
    RUNTIME_SPLIT_SUBFLOW_MIN_WIDTH,
    RUNTIME_SPLIT_SUBFLOW_X_PADDING * 2 +
      levelCount * RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH +
      (levelCount - 1) * RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP,
  );
}

function runtimeToneForEdge(
  sourceRun: WorkflowNodeRun | undefined,
  targetRun: WorkflowNodeRun | undefined,
): "success" | "running" | "blocked" | "waiting" {
  if (targetRun?.status === "blocked" || targetRun?.status === "failed" || targetRun?.status === "format_failed") {
    return "blocked";
  }
  if (
    targetRun?.status === "working" ||
    targetRun?.status === "worker_assigned" ||
    targetRun?.status === "critic_reviewing" ||
    targetRun?.status === "awaiting_critic" ||
    targetRun?.status === "awaiting_input" ||
    targetRun?.status === "splitting" ||
    targetRun?.status === "split_active"
  ) {
    return "running";
  }
  if (sourceRun?.status === "completed" || sourceRun?.status === "critic_approved") {
    return "success";
  }
  return "waiting";
}

function runtimeFocusPriority(status: WorkflowNodeRun["status"]): number {
  switch (status) {
    case "blocked":
    case "failed":
    case "format_failed":
    case "critic_rework":
      return 50;
    case "awaiting_critic":
    case "awaiting_split_review":
      return 40;
    case "awaiting_input":
      return 35;
    case "working":
    case "worker_assigned":
    case "critic_reviewing":
    case "format_checking":
    case "splitting":
    case "split_active":
      return 30;
    default:
      return 0;
  }
}

function pickRuntimeFocusNodeId(
  nodes: WorkflowNode[],
  nodeRunMap: Map<string, WorkflowNodeRun>,
): string | null {
  let selectedNodeId: string | null = null;
  let selectedPriority = 0;

  for (const node of nodes) {
    const run = nodeRunMap.get(node.id);
    if (!run) continue;
    const priority = runtimeFocusPriority(run.status);
    if (priority > selectedPriority) {
      selectedNodeId = node.id;
      selectedPriority = priority;
    }
  }

  return selectedNodeId;
}

function runtimeEdgeMarkerColor(tone: "success" | "running" | "blocked" | "waiting"): string {
  if (tone === "success") return "rgb(16 185 129)";
  if (tone === "running") return "rgb(59 130 246)";
  if (tone === "blocked") return "rgb(239 68 68)";
  return "rgb(100 116 139)";
}

function edgeLabelForSource(
  sourceNodeId: string,
  sourceRun: WorkflowNodeRun | undefined,
  splitTasksByNodeId: Map<string, SplitTask[]>,
): string | undefined {
  const childIssueCount = (splitTasksByNodeId.get(sourceNodeId) ?? []).filter((task) => task.issue_id).length;
  if (childIssueCount > 0) return `${childIssueCount} child issues`;
  const output = sourceRun?.worker_output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const artifactCount = Number((output as Record<string, unknown>).artifact_count ?? 0);
    if (artifactCount > 0) return `${artifactCount} artifacts`;
  }
  if (sourceRun?.status === "blocked" || sourceRun?.status === "failed") return "blocked";
  return undefined;
}

export function decorateRuntimeEdges({
  edges,
  nodeRunMap,
  splitTasksByNodeId,
}: {
  edges: Edge[];
  nodeRunMap: Map<string, WorkflowNodeRun>;
  splitTasksByNodeId: Map<string, SplitTask[]>;
}): Edge[] {
  return edges.map((edge) => {
    const sourceRun = nodeRunMap.get(edge.source);
    const targetRun = nodeRunMap.get(edge.target);
    const edgeTone = runtimeToneForEdge(sourceRun, targetRun);
    return {
      ...edge,
      markerEnd: {
        ...(edge.markerEnd && typeof edge.markerEnd === "object" ? edge.markerEnd : {}),
        type: MarkerType.ArrowClosed,
        color: runtimeEdgeMarkerColor(edgeTone),
      },
      data: {
        ...(edge.data ?? {}),
        edgeTone,
        edgeLabel: edgeLabelForSource(edge.source, sourceRun, splitTasksByNodeId),
      },
    };
  });
}

function splitSubflowEdgeTone(tasks: SplitTask[]): "success" | "running" | "blocked" | "waiting" {
  if (tasks.some((task) => splitTaskDisplayStatus(task.status) === "blocked")) return "blocked";
  if (tasks.some((task) => splitTaskDisplayStatus(task.status) === "in_progress")) return "running";
  if (tasks.length > 0 && tasks.every((task) => splitTaskDisplayStatus(task.status) === "completed")) return "success";
  return "waiting";
}

function splitTaskLevel(
  task: SplitTask,
  taskMap: Map<string, SplitTask>,
  memo: Map<string, number>,
  visiting = new Set<string>(),
): number {
  const cached = memo.get(task.id);
  if (cached != null) return cached;
  if (visiting.has(task.id)) return 0;

  visiting.add(task.id);
  const upstreamLevels = task.depends_on
    .map((depId) => taskMap.get(depId))
    .filter((item): item is SplitTask => Boolean(item))
    .map((depTask) => splitTaskLevel(depTask, taskMap, memo, visiting));
  visiting.delete(task.id);

  const level = upstreamLevels.length > 0 ? Math.max(...upstreamLevels) + 1 : 0;
  memo.set(task.id, level);
  return level;
}

/**
 * Main issue-execution panorama view.
 *
 * Composes the shared WorkflowCanvasCore in read-only runtime mode with
 * ExecutionDetailPanel.
 * into a scrollable full-page view of all workflow stages, nodes, and their
 * per-run status.
 */
interface ExecutionPanoramaCanvasProps {
  rfNodes: Node[];
  rfEdges: Edge[];
  canvasStages: WorkflowStage[];
  nodeRunMap: Map<string, WorkflowNodeRun>;
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  initialFocusNodeId?: string | null;
  focusSplitNodeId?: string | null;
  onSplitClusterFocused?: () => void;
  restoreViewportRequest?: SplitViewportRestoreRequest | null;
  fillAvailableHeight?: boolean;
}

function ExecutionPanoramaCanvas({
  rfNodes,
  rfEdges,
  canvasStages,
  nodeRunMap,
  viewport,
  setViewport,
  setSelectedNodeId,
  onNodeClick,
  onNodeDoubleClick,
  initialFocusNodeId,
  focusSplitNodeId,
  onSplitClusterFocused,
  restoreViewportRequest,
  fillAvailableHeight = false,
}: ExecutionPanoramaCanvasProps) {
  const { fitView, getViewport, setCenter, setViewport: setReactFlowViewport, viewportInitialized } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedBaseNodeIdsRef = useRef<string | null>(null);
  const initialFocusedBaseNodeIdsRef = useRef<string | null>(null);

  const baseNodeIdsSignature = useMemo(
    () =>
      rfNodes
        .filter((node) => !isSplitExpansionNodeId(node.id))
        .map((node) => node.id)
        .join("|"),
    [rfNodes],
  );

  useEffect(() => {
    const shouldFitBaseNodes = fittedBaseNodeIdsRef.current !== baseNodeIdsSignature;
    const shouldFocusRuntimeNode = Boolean(initialFocusNodeId) &&
      initialFocusedBaseNodeIdsRef.current !== baseNodeIdsSignature;

    if (
      rfNodes.length === 0 ||
      !viewportInitialized ||
      !nodesInitialized ||
      (!shouldFitBaseNodes && !shouldFocusRuntimeNode)
    ) {
      return;
    }

    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        if (shouldFitBaseNodes) {
          fittedBaseNodeIdsRef.current = baseNodeIdsSignature;
          await fitView({
            nodes: rfNodes
              .filter((node) => !isSplitExpansionNodeId(node.id))
              .map((node) => ({ id: node.id })),
            ...RUNTIME_CANVAS_FIT_VIEW,
            duration: 0,
          });
        }

        if (cancelled || !initialFocusNodeId || initialFocusedBaseNodeIdsRef.current === baseNodeIdsSignature) {
          return;
        }

        const focusNode = rfNodes.find((node) => node.id === initialFocusNodeId);
        if (!focusNode) return;

        const width = typeof focusNode.width === "number" ? focusNode.width : WORKER_WIDTH;
        const height = typeof focusNode.height === "number" ? focusNode.height : RUNTIME_NODE_HEIGHT;
        initialFocusedBaseNodeIdsRef.current = baseNodeIdsSignature;
        setCenter(
          focusNode.position.x + width / 2,
          focusNode.position.y + height / 2,
          RUNTIME_INITIAL_FOCUS_VIEW,
        );
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [baseNodeIdsSignature, fitView, initialFocusNodeId, nodesInitialized, rfNodes, setCenter, viewportInitialized]);

  useEffect(() => {
    if (!restoreViewportRequest || !viewportInitialized) return;

    void Promise.resolve(
      setReactFlowViewport(restoreViewportRequest.viewport, { duration: 450 }),
    );
  }, [restoreViewportRequest, setReactFlowViewport, viewportInitialized]);

  useEffect(() => {
    if (!focusSplitNodeId || !viewportInitialized) return;

    const clusterNodes = rfNodes.filter(
      (node) =>
        node.id === focusSplitNodeId ||
        node.id.startsWith(`${focusSplitNodeId}${SPLIT_CHILD_NODE_ID_PART}`) ||
        node.id === createSplitSubflowNodeId(focusSplitNodeId),
    );
    if (clusterNodes.length <= 1) return;
    const focusNodes = rfNodes.filter(
      (node) => node.id === createSplitSubflowNodeId(focusSplitNodeId),
    );
    const nodesToFit = focusNodes.length > 0 ? focusNodes : clusterNodes;

    let cancelled = false;
    let settleFrame: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const fitSplitSubflow = () =>
      Promise.resolve(
        fitView({
          nodes: nodesToFit.map((node) => ({ id: node.id })),
          padding: 0.06,
          maxZoom: 1.4,
          duration: 450,
        }),
      );
    const frame = requestAnimationFrame(() => {
      void fitSplitSubflow();
      settleFrame = requestAnimationFrame(() => {
        settleTimer = setTimeout(() => {
          void fitSplitSubflow().then(() => {
            if (!cancelled) onSplitClusterFocused?.();
          });
        }, 80);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (settleFrame != null) cancelAnimationFrame(settleFrame);
      if (settleTimer != null) clearTimeout(settleTimer);
    };
  }, [
    fitView,
    focusSplitNodeId,
    onSplitClusterFocused,
    rfNodes,
    viewportInitialized,
  ]);

  const scrollToNode = useCallback((nodeId: string) => {
    const node = rfNodes.find((item) => item.id === nodeId);
    if (!node) return;

    const width = typeof node.width === "number" ? node.width : WORKER_WIDTH;
    const height = typeof node.height === "number" ? node.height : RUNTIME_NODE_HEIGHT;
    const currentViewport = getViewport();

    setSelectedNodeId(nodeId);
    setCenter(
      node.position.x + width / 2,
      node.position.y + height / 2,
      {
        duration: 450,
        zoom: currentViewport.zoom,
      },
    );
  }, [getViewport, rfNodes, setCenter, setSelectedNodeId]);

  return (
    <>
      <GlobalNotificationBar
        nodeRunMap={nodeRunMap}
        onScrollToNode={scrollToNode}
      />
      <div
        className={cn(
          "relative flex flex-1",
          fillAvailableHeight ? "min-h-0" : "min-h-[560px]",
        )}
        data-testid="execution-canvas-shell"
      >
        <WorkflowCanvasCore
          nodes={rfNodes}
          edges={rfEdges}
          stages={canvasStages}
          nodeTypes={runtimeCanvasNodeTypes}
          edgeTypes={panoramaEdgeTypes}
          readOnly
          fitView
          fitViewOptions={{
            nodes: rfNodes.map((node) => ({ id: node.id })),
            ...RUNTIME_CANVAS_FIT_VIEW,
          }}
          reserveStageRail={!fillAvailableHeight}
          viewportY={viewport.y}
          viewportZoom={viewport.zoom}
          onMove={setViewport}
          onNodeClick={(_event, node) => onNodeClick(node.id)}
          onNodeDoubleClick={(_event, node) => onNodeDoubleClick(node.id)}
        />
      </div>
    </>
  );
}

export function ExecutionPanoramaPage({
  workflowId,
  runId,
  wsId,
  issueId,
  fillAvailableHeight = false,
}: ExecutionPanoramaPageProps) {
  const queryClient = useQueryClient();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { t } = useT("issues");
  // ---- Data queries ----
  const { isLoading: wfLoading } = useQuery(
    workflowDetailOptions(wsId, workflowId),
  );
  const { data: stages, isLoading: stLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );
  const { data: nodes, isLoading: ndLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );
  const { data: nodeRuns = [] } = useQuery({
    ...workflowNodeRunsOptions(wsId, workflowId, runId ?? ""),
    enabled: !!runId,
  });
  const { data: canvasSummary } = useQuery({
    ...workflowRunCanvasSummaryOptions(wsId, workflowId, runId ?? ""),
    enabled: !!runId,
  });
  const { data: edges } = useQuery(workflowEdgesOptions(wsId, workflowId));
  const { data: agents } = useQuery(agentListOptions(wsId));
  const { data: members } = useQuery(memberListOptions(wsId));
  const { data: squads } = useQuery(squadListOptions(wsId));
  const { data: splitWorkflowOptions = [] } = useQuery(splitIssueWorkflowOptions(wsId, workflowId));

  // ---- Local state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 24, zoom: 0.95 });
  const [retryingNodeRunId, setRetryingNodeRunId] = useState<string | null>(null);
  const [expandedSplitNodeIds, setExpandedSplitNodeIds] = useState<Set<string>>(() => new Set());
  const [focusSplitNodeId, setFocusSplitNodeId] = useState<string | null>(null);
  const splitViewportByNodeIdRef = useRef<Map<string, Viewport>>(new Map());
  const restoreViewportRequestIdRef = useRef(0);
  const [restoreViewportRequest, setRestoreViewportRequest] = useState<SplitViewportRestoreRequest | null>(null);

  const allStages: WorkflowStage[] = stages ?? [];
  const allNodes: WorkflowNode[] = nodes ?? [];

  // ---- Lookup maps ----
  const nodeRunMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeRun>();
    const runs = canvasSummary?.node_runs ?? nodeRuns;
    for (const nr of runs) {
      map.set(nr.workflow_node_id, nr);
    }
    return map;
  }, [canvasSummary?.node_runs, nodeRuns]);

  const runtimeSummaryMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeRuntimeSummary>();
    for (const summary of canvasSummary?.node_runtime_summaries ?? []) {
      map.set(summary.workflow_node_id, summary);
    }
    return map;
  }, [canvasSummary?.node_runtime_summaries]);

  const splitNodeEntries = useMemo(
    () =>
      allNodes
        .filter((node) => parseNodeFormat(node.format_schema).kind === "split")
        .map((node) => ({
          node,
          nodeRun: nodeRunMap.get(node.id) ?? null,
        })),
    [allNodes, nodeRunMap],
  );

  const splitTaskQueries = useQueries({
    queries: splitNodeEntries.map(({ nodeRun }) =>
      splitTasksOptions(wsId, nodeRun?.id),
    ),
  });

  const splitTasksByNodeId = useMemo(() => {
    const map = new Map<string, SplitTask[]>();
    splitNodeEntries.forEach(({ node }, index) => {
      const data = splitTaskQueries[index]?.data as { tasks?: SplitTask[] } | undefined;
      map.set(node.id, data?.tasks ?? []);
    });
    return map;
  }, [splitNodeEntries, splitTaskQueries]);

  const handleToggleSplitNode = useCallback((nodeId: string) => {
    const isExpanded = expandedSplitNodeIds.has(nodeId);
    if (isExpanded) {
      const restoreViewport = splitViewportByNodeIdRef.current.get(nodeId);
      splitViewportByNodeIdRef.current.delete(nodeId);
      if (restoreViewport) {
        setViewport(restoreViewport);
        setRestoreViewportRequest({
          requestId: ++restoreViewportRequestIdRef.current,
          viewport: restoreViewport,
        });
      }
    } else {
      splitViewportByNodeIdRef.current.set(nodeId, viewport);
    }
    setExpandedSplitNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
    setFocusSplitNodeId(isExpanded ? null : nodeId);
  }, [expandedSplitNodeIds, viewport]);

  const handleSplitClusterFocused = useCallback(() => {
    setFocusSplitNodeId(null);
  }, []);

  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    if (agents) {
      for (const a of agents) map.set(a.id, a);
    }
    return map;
  }, [agents]);

  const memberLookup = useMemo(() => {
    const map = new Map<string, MemberWithUser | null>();
    if (members) {
      for (const member of members) map.set(member.user_id, member);
    }
    return map;
  }, [members]);

  const squadLookup = useMemo(() => {
    const map = new Map<string, Squad | null>();
    if (squads) {
      for (const squad of squads) map.set(squad.id, squad);
    }
    return map;
  }, [squads]);

  const splitWorkflowLookup = useMemo(() => {
    const map = new Map<string, Workflow>();
    for (const workflow of splitWorkflowOptions) {
      map.set(workflow.id, workflow);
    }
    return map;
  }, [splitWorkflowOptions]);

  const getActorName = useCallback((type: string, id: string): string | null => {
    if (type === "agent") {
      return agentLookup.get(id)?.name ?? null;
    }
    if (type === "human" || type === "member") {
      return memberLookup.get(id)?.name ?? null;
    }
    if (type === "squad") {
      return squadLookup.get(id)?.name ?? null;
    }
    return null;
  }, [agentLookup, memberLookup, squadLookup]);

  const handleRetryNodeRun = useCallback(async (nodeRun: WorkflowNodeRun) => {
    if (!issueId) return;
    const taskId =
      nodeRun.worker_agent_task_id ??
      nodeRun.agent_task_id ??
      nodeRun.critic_agent_task_id ??
      undefined;

    setRetryingNodeRunId(nodeRun.id);
    try {
      await api.rerunIssue(issueId, taskId);
      if (runId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: workflowKeys.nodeRuns(wsId, workflowId, runId),
          }),
          queryClient.invalidateQueries({
            queryKey: workflowKeys.runCanvasSummary(wsId, workflowId, runId),
          }),
        ]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry node run");
    } finally {
      setRetryingNodeRunId((current) => (current === nodeRun.id ? null : current));
    }
  }, [issueId, queryClient, runId, workflowId, wsId]);

  // ---- Derived ----
  const isLoading = wfLoading || stLoading || ndLoading;

  if (isLoading) {
    return (
      <div
        role="status"
        className="flex items-center justify-center py-20"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const unassignedCount = allNodes.filter((node) => !node.stage_id).length;
  const canvasStages = unassignedCount > 0 || allStages.length === 0
    ? [
        ...allStages,
        {
          id: "unassigned",
          workflow_id: workflowId,
          name: "Unassigned",
          description: "",
          sort_order: allStages.length,
          node_count: unassignedCount,
          created_at: "",
          updated_at: "",
        },
      ]
    : allStages;
  const runtimeFocusNodeId = pickRuntimeFocusNodeId(allNodes, nodeRunMap);
  const baseRfNodesRaw = workflowNodesToReactFlowNodes({
    nodes: allNodes,
    stages: sortStagesForDisplay(allStages),
    nodeType: "runtimeNode",
    nodeHeight: RUNTIME_NODE_HEIGHT,
    includeCriticBadges: false,
    makeNodeData: (node) => ({
      node,
      nodeRun: nodeRunMap.get(node.id) ?? null,
      runtimeSummary: runtimeSummaryMap.get(node.id) ?? null,
      workerName: node.worker_id
        ? getActorName(workerTypeToActorType(node.worker_type), node.worker_id)
        : null,
      criticName: node.critic_id
        ? getActorName(node.critic_type ?? "agent", node.critic_id)
        : null,
      onOpen: setSelectedNodeId,
      isRuntimeFocus: node.id === runtimeFocusNodeId,
      isSplitExpanded: expandedSplitNodeIds.has(node.id),
      splitChildCount: (splitTasksByNodeId.get(node.id) ?? []).filter((task) => task.issue_id).length,
      onSplitNodeToggle: handleToggleSplitNode,
    }),
    makeCriticName: (node) =>
      node.critic_id
        ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined
        : undefined,
  });
  const baseRfEdges = workflowEdgesToReactFlowEdges({
    edges: edges ?? [],
    nodes: allNodes,
    stages: sortStagesForDisplay(allStages),
    includeCriticEdges: false,
  });
  const splitChildDetailByNodeId = new Map<string, SplitChildIssueDetail>();
  const splitSubflowNodes: Node[] = [];
  const splitSubflowEdges: Edge[] = [];
  const baseRfNodeById = new Map(baseRfNodesRaw.map((node) => [node.id, node]));
  const splitChildClusterLayouts: SplitChildClusterLayout[] = [];

  for (const splitNode of allNodes) {
    if (!expandedSplitNodeIds.has(splitNode.id)) continue;
    if (parseNodeFormat(splitNode.format_schema).kind !== "split") continue;

    const parentRfNode = baseRfNodeById.get(splitNode.id);
    if (!parentRfNode) continue;

    const tasks = (splitTasksByNodeId.get(splitNode.id) ?? [])
      .filter((task) => task.issue_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (tasks.length === 0) continue;

    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const levelMemo = new Map<string, number>();
    const levelGroups = new Map<number, SplitTask[]>();
    for (const task of tasks) {
      const level = splitTaskLevel(task, taskMap, levelMemo);
      const group = levelGroups.get(level) ?? [];
      group.push(task);
      levelGroups.set(level, group);
    }

    splitChildClusterLayouts.push({ splitNode, levelGroups });
  }

  splitChildClusterLayouts.sort((a, b) => {
    const aNode = baseRfNodeById.get(a.splitNode.id);
    const bNode = baseRfNodeById.get(b.splitNode.id);
    return (aNode?.position.x ?? 0) - (bNode?.position.x ?? 0);
  });

  const nodeShiftById = new Map<string, number>();
  const clusterBoundsBySplitNodeId = new Map<string, SplitChildClusterBounds>();

  for (const layout of splitChildClusterLayouts) {
    const parentRfNode = baseRfNodeById.get(layout.splitNode.id);
    if (!parentRfNode) continue;

    const parentX = parentRfNode.position.x + (nodeShiftById.get(parentRfNode.id) ?? 0);
    const parentY = parentRfNode.position.y;
    const childClusterStartX = parentX + WORKER_WIDTH + SPLIT_CHILD_X_GAP;
    const subflowHeight = splitSubflowHeight(layout.levelGroups);
    const subflowWidth = splitSubflowWidth(layout.levelGroups);
    const bounds = {
      left: childClusterStartX,
      right: childClusterStartX + subflowWidth,
      top: parentY - (subflowHeight - RUNTIME_NODE_HEIGHT) / 2,
      bottom: parentY - (subflowHeight - RUNTIME_NODE_HEIGHT) / 2 + subflowHeight,
    };

    clusterBoundsBySplitNodeId.set(layout.splitNode.id, bounds);

    for (const node of baseRfNodesRaw) {
      if (node.id === layout.splitNode.id) continue;
      const nodeHeight = typeof node.height === "number" ? node.height : RUNTIME_NODE_HEIGHT;
      const currentShift = nodeShiftById.get(node.id) ?? 0;
      const nodeLeft = node.position.x + currentShift;
      const nodeTop = node.position.y;
      const verticallyOverlaps = nodeTop < bounds.bottom && nodeTop + nodeHeight > bounds.top;
      if (!verticallyOverlaps || nodeLeft <= parentX) continue;

      const requiredLeft = bounds.right + SPLIT_CHILD_SAFE_X_GAP;
      if (nodeLeft < requiredLeft) {
        nodeShiftById.set(node.id, currentShift + requiredLeft - nodeLeft);
      }
    }
  }

  const baseRfNodes = baseRfNodesRaw.map((node) => {
    const shift = nodeShiftById.get(node.id) ?? 0;
    if (shift === 0) return node;
    return {
      ...node,
      position: {
        ...node.position,
        x: node.position.x + shift,
      },
    };
  });
  const shiftedBaseRfNodeById = new Map(baseRfNodes.map((node) => [node.id, node]));

  for (const layout of splitChildClusterLayouts) {
    const splitNode = layout.splitNode;
    const parentRfNode = shiftedBaseRfNodeById.get(splitNode.id);
    const bounds = clusterBoundsBySplitNodeId.get(splitNode.id);
    if (!parentRfNode || !bounds) continue;

    const childClusterStartX = parentRfNode.position.x + WORKER_WIDTH + SPLIT_CHILD_X_GAP;
    const taskMap = new Map(
      Array.from(layout.levelGroups.values())
        .flat()
        .map((task) => [task.id, task]),
    );
    const sortedLevels = Array.from(layout.levelGroups.keys()).sort((a, b) => a - b);
    const childIssues: RuntimeSplitSubflowChildIssue[] = [];
    const dependencyEdges: Array<{ sourceNodeId: string; targetNodeId: string }> = [];

    for (const level of sortedLevels) {
      const group = layout.levelGroups.get(level) ?? [];
      group.sort((a, b) => a.sort_order - b.sort_order);
      group.forEach((task, index) => {
        const childNodeId = createSplitChildNodeId(splitNode.id, task.id);
        const issueId = task.issue_id!;
        const displayStatus = splitTaskDisplayStatus(task.status);
        const childWorkflowNode = {
          id: childNodeId,
          workflow_id: splitNode.workflow_id,
          title: task.title,
          description: task.description,
          position_x: 0,
          position_y: 0,
          format_schema: null,
          worker_type: splitTaskWorkerType(task),
          worker_id: task.workflow_id,
          critic_type: "human",
          critic_id: null,
          critic_api_url: null,
          sort_order: task.sort_order,
          stage_id: splitNode.stage_id,
          created_at: task.created_at,
          updated_at: task.updated_at,
        } satisfies WorkflowNode;
        const childRuntimeSummary = {
          workflow_node_id: childNodeId,
          node_run_id: task.run_id ?? task.id,
          display_status: displayStatus,
          active_actor_type: "workflow",
          active_actor_id: task.workflow_id,
          duration_seconds: null,
          session_id: null,
          runtime_id: null,
          device_id: null,
          has_error: task.status === "failed",
          error_message: "",
          split_progress: null,
        } satisfies WorkflowNodeRuntimeSummary;
        const childWorkerName = task.workflow_id
          ? splitWorkflowLookup.get(task.workflow_id)?.title ?? task.workflow_id
          : null;

        splitChildDetailByNodeId.set(childNodeId, {
          issueId,
          node: childWorkflowNode,
          runtimeSummary: childRuntimeSummary,
          workerName: childWorkerName,
        });

        const validDependencies = task.depends_on.filter((depId) => taskMap.has(depId));
        childIssues.push({
          nodeId: childNodeId,
          issueId,
          title: task.title,
          description: task.description,
          displayStatus,
          displayStatusLabel: runtimeDisplayStatusText(t, displayStatus),
          workerName: childWorkerName,
          level,
          rowIndex: index,
          dependencyNodeIds: validDependencies.map((depId) => createSplitChildNodeId(splitNode.id, depId)),
          workflowNode: childWorkflowNode,
          runtimeSummary: childRuntimeSummary,
        });
        for (const depId of validDependencies) {
          dependencyEdges.push({
            sourceNodeId: createSplitChildNodeId(splitNode.id, depId),
            targetNodeId: childNodeId,
          });
        }
      });
    }

    const allTasks = sortedLevels.flatMap((level) => layout.levelGroups.get(level) ?? []);
    const edgeTone = splitSubflowEdgeTone(allTasks);
    const subflowNodeId = createSplitSubflowNodeId(splitNode.id);
    const subflowHeight = splitSubflowHeight(layout.levelGroups);
    const subflowWidth = splitSubflowWidth(layout.levelGroups);
    splitSubflowNodes.push({
      id: subflowNodeId,
      type: "runtimeSplitSubflow",
      position: {
        x: childClusterStartX,
        y: parentRfNode.position.y - (subflowHeight - RUNTIME_NODE_HEIGHT) / 2,
      },
      width: subflowWidth,
      height: subflowHeight,
      data: {
        splitNodeId: splitNode.id,
        parentTitle: splitNode.title,
        childIssues,
        dependencyEdges,
        onOpenChild: setSelectedNodeId,
        onCollapse: handleToggleSplitNode,
      },
    });
    splitSubflowEdges.push({
      id: `${splitNode.id}:split-subflow-edge`,
      source: splitNode.id,
      target: subflowNodeId,
      sourceHandle: "right",
      targetHandle: "left",
      type: "panorama",
      interactionWidth: 24,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: runtimeEdgeMarkerColor(edgeTone),
        strokeWidth: 1.5,
      },
      data: {
        edgeKind: "data",
        edgeTone,
        edgeLabel: edgeLabelForSource(splitNode.id, nodeRunMap.get(splitNode.id), splitTasksByNodeId),
        stageColorIndex: 0,
        sameStage: false,
      },
    });
  }

  const rfNodes = [...baseRfNodes, ...splitSubflowNodes];
  const rfEdges = [
    ...decorateRuntimeEdges({
      edges: baseRfEdges,
      nodeRunMap,
      splitTasksByNodeId,
    }),
    ...splitSubflowEdges,
  ];
  const selectedChildDetail = selectedNodeId
    ? splitChildDetailByNodeId.get(selectedNodeId) ?? null
    : null;
  const selectedNode = allNodes.find((n) => n.id === selectedNodeId) ?? selectedChildDetail?.node ?? null;
  const selectedRun = selectedNodeId
    ? nodeRunMap.get(selectedNodeId) ?? null
    : null;
  const selectedRuntimeSummary = selectedNodeId
    ? runtimeSummaryMap.get(selectedNodeId) ?? selectedChildDetail?.runtimeSummary ?? null
    : null;
  const selectedWorkerName =
    selectedChildDetail?.workerName ??
    (selectedNode?.worker_id
      ? getActorName(workerTypeToActorType(selectedNode.worker_type), selectedNode.worker_id)
      : null);
  const selectedCriticName =
    selectedChildDetail
      ? null
      : selectedNode?.critic_id
        ? getActorName(selectedNode.critic_type ?? "agent", selectedNode.critic_id)
        : null;
  const selectedChildParentNodeId = selectedChildDetail && selectedNodeId?.includes(SPLIT_CHILD_NODE_ID_PART)
    ? selectedNodeId.split(SPLIT_CHILD_NODE_ID_PART)[0] ?? null
    : null;
  const selectedChildParentTitle = selectedChildParentNodeId
    ? allNodes.find((node) => node.id === selectedChildParentNodeId)?.title ?? null
    : null;
  const selectedNodeFormat = selectedNode ? parseNodeFormat(selectedNode.format_schema) : null;
  const isSplitSelectedNode = selectedNodeFormat?.kind === "split";
  const isRetryableSelectedRun =
    selectedRun?.status === "failed" ||
    selectedRun?.status === "format_failed" ||
    selectedRun?.status === "blocked" ||
    selectedRun?.status === "critic_rework";
  const selectedRetryTaskId = selectedRun
    ? selectedRun.worker_agent_task_id ?? selectedRun.agent_task_id ?? selectedRun.critic_agent_task_id
    : null;
  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };
  const handleNodeDoubleClick = (nodeId: string) => {
    if (splitNodeEntries.some(({ node }) => node.id === nodeId)) {
      handleToggleSplitNode(nodeId);
    }
  };

  return (
    <div
      className={cn(
        "relative flex h-full flex-1 flex-col",
        fillAvailableHeight ? "min-h-0" : "min-h-[640px]",
      )}
      data-testid="execution-panorama"
    >
      <ReactFlowProvider>
        <ExecutionPanoramaCanvas
          rfNodes={rfNodes}
          rfEdges={rfEdges}
          canvasStages={canvasStages}
          nodeRunMap={nodeRunMap}
          viewport={viewport}
          setViewport={setViewport}
          setSelectedNodeId={setSelectedNodeId}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          initialFocusNodeId={runtimeFocusNodeId}
          focusSplitNodeId={focusSplitNodeId}
          onSplitClusterFocused={handleSplitClusterFocused}
          restoreViewportRequest={restoreViewportRequest}
          fillAvailableHeight={fillAvailableHeight}
        />
      </ReactFlowProvider>

      {/* Detail panel */}
      {selectedNodeId && selectedNode && (
        isSplitSelectedNode ? (
          <SplitReviewPanel
            node={selectedNode}
            nodeRun={selectedRun}
            wsId={wsId}
            workflowId={workflowId}
            runId={runId ?? undefined}
            parentIssueId={issueId}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : (
          <ExecutionDetailPanel
            node={selectedNode}
            nodeRun={selectedRun}
            workerName={selectedWorkerName}
            criticName={selectedCriticName}
            onClose={() => setSelectedNodeId(null)}
            wsId={wsId}
            runtimeSummary={selectedRuntimeSummary}
            onOpenIssue={
              selectedChildDetail
                ? () => {
                    const childIssuePath = paths.issueDetail(selectedChildDetail.issueId);
                    if (navigation.openInNewTab) {
                      navigation.openInNewTab(childIssuePath, selectedNode?.title ?? undefined, { activate: true });
                      return;
                    }
                    window.open(navigation.getShareableUrl(childIssuePath), "_blank", "noopener,noreferrer");
                  }
                : undefined
            }
            isChildIssue={Boolean(selectedChildDetail)}
            parentSplitTitle={selectedChildParentTitle}
            childWorkflowName={selectedChildDetail?.workerName ?? null}
            onRetry={
              issueId && selectedRun && selectedRetryTaskId && isRetryableSelectedRun && retryingNodeRunId !== selectedRun.id
                ? () => void handleRetryNodeRun(selectedRun)
                : undefined
            }
          />
        )
      )}
    </div>
  );
}

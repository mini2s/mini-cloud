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
  workflowKeys,
} from "@multica/core/workflows/queries";
import { useWorkspacePaths } from "@multica/core/paths";
import { api } from "@multica/core/api";
import { agentListOptions } from "@multica/core/workspace/queries";
import { workerTypeToActorType } from "@multica/core/types";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowStage,
  Agent,
  SplitTask,
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
import { runtimeCanvasNodeTypes } from "./runtime-canvas-node";
import { RUNTIME_NODE_HEIGHT } from "./runtime-node-card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@multica/ui/lib/utils";
import { SplitReviewPanel } from "../../../workflows/components/split/split-review-panel";
import { useNavigation } from "../../../navigation";

export interface ExecutionPanoramaPageProps {
  workflowId: string;
  runId: string | null;
  wsId: string;
  issueId?: string;
  fillAvailableHeight?: boolean;
}

const RUNTIME_CANVAS_FIT_VIEW = {
  padding: 0.04,
  maxZoom: 1.2,
} as const;

const SPLIT_CHILD_X_GAP = 144;
const SPLIT_CHILD_SAFE_X_GAP = 96;
const SPLIT_CHILD_Y_GAP = 32;

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

function splitTaskWorkerType(task: SplitTask): WorkerType {
  if (task.suggested_assignee_type === "squad") return "squad";
  if (task.suggested_assignee_type === "agent") return "agent";
  return "human";
}

function createSplitChildNodeId(parentNodeId: string, taskId: string): string {
  return `${parentNodeId}:split-task:${taskId}`;
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
  fillAvailableHeight = false,
}: ExecutionPanoramaCanvasProps) {
  const { fitView, getViewport, setCenter, viewportInitialized } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedNodeSignatureRef = useRef<string | null>(null);

  const nodeSignature = useMemo(
    () =>
      rfNodes
        .map((node) => `${node.id}:${node.position.x}:${node.position.y}`)
        .join("|"),
    [rfNodes],
  );

  useEffect(() => {
    if (
      rfNodes.length === 0 ||
      !viewportInitialized ||
      !nodesInitialized ||
      fittedNodeSignatureRef.current === nodeSignature
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      fittedNodeSignatureRef.current = nodeSignature;
      void fitView({
        nodes: rfNodes.map((node) => ({ id: node.id })),
        ...RUNTIME_CANVAS_FIT_VIEW,
        duration: 0,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [fitView, nodeSignature, nodesInitialized, rfNodes, viewportInitialized]);

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

  // ---- Local state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 24, zoom: 0.95 });
  const [retryingNodeRunId, setRetryingNodeRunId] = useState<string | null>(null);
  const [expandedSplitNodeIds, setExpandedSplitNodeIds] = useState<Set<string>>(() => new Set());

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
    setExpandedSplitNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    if (agents) {
      for (const a of agents) map.set(a.id, a);
    }
    return map;
  }, [agents]);

  const getActorName = useCallback((type: string, id: string): string | null => {
    if (type === "agent" || type === "human" || type === "member") {
      return agentLookup.get(id)?.name ?? null;
    }
    return null;
  }, [agentLookup]);

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
  const selectedNode = allNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedRun = selectedNodeId
    ? nodeRunMap.get(selectedNodeId) ?? null
    : null;
  const selectedRuntimeSummary = selectedNodeId
    ? runtimeSummaryMap.get(selectedNodeId) ?? null
    : null;
  const selectedNodeFormat = selectedNode ? parseNodeFormat(selectedNode.format_schema) : null;
  const isSplitSelectedNode = selectedNodeFormat?.kind === "split";
  const isRetryableSelectedRun =
    selectedRun?.status === "failed" ||
    selectedRun?.status === "format_failed" ||
    selectedRun?.status === "blocked" ||
    selectedRun?.status === "critic_rework";

  const baseRfNodes = workflowNodesToReactFlowNodes({
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
      isSplitExpanded: expandedSplitNodeIds.has(node.id),
      splitChildCount: (splitTasksByNodeId.get(node.id) ?? []).filter((task) => task.issue_id).length,
      onSplitNodeToggle: handleToggleSplitNode,
    }),
    makeCriticName: (node) => node.critic_id ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined : undefined,
  });
  const baseRfEdges = workflowEdgesToReactFlowEdges({
    edges: edges ?? [],
    nodes: allNodes,
    stages: sortStagesForDisplay(allStages),
    includeCriticEdges: false,
  });
  const splitChildIssueByNodeId = new Map<string, string>();
  const splitChildNodes: Node[] = [];
  const splitChildEdges: Edge[] = [];
  const baseGraphRight = baseRfNodes.reduce((maxRight, node) => {
    const width = typeof node.width === "number" ? node.width : WORKER_WIDTH;
    return Math.max(maxRight, node.position.x + width);
  }, 0);

  for (const splitNode of allNodes) {
    if (!expandedSplitNodeIds.has(splitNode.id)) continue;
    if (parseNodeFormat(splitNode.format_schema).kind !== "split") continue;

    const parentRfNode = baseRfNodes.find((node) => node.id === splitNode.id);
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

    const childClusterStartX = Math.max(
      parentRfNode.position.x + WORKER_WIDTH + SPLIT_CHILD_X_GAP,
      baseGraphRight + SPLIT_CHILD_SAFE_X_GAP,
    );

    for (const [level, group] of levelGroups) {
      group.sort((a, b) => a.sort_order - b.sort_order);
      group.forEach((task, index) => {
        const childNodeId = createSplitChildNodeId(splitNode.id, task.id);
        const issueId = task.issue_id!;
        const yOffset = (index - (group.length - 1) / 2) * (RUNTIME_NODE_HEIGHT + SPLIT_CHILD_Y_GAP);

        splitChildIssueByNodeId.set(childNodeId, issueId);
        splitChildNodes.push({
          id: childNodeId,
          type: "runtimeNode",
          position: {
            x: childClusterStartX + level * (WORKER_WIDTH + SPLIT_CHILD_X_GAP),
            y: parentRfNode.position.y + yOffset,
          },
          width: WORKER_WIDTH,
          height: RUNTIME_NODE_HEIGHT,
          data: {
            node: {
              id: childNodeId,
              workflow_id: splitNode.workflow_id,
              title: task.title,
              description: task.description,
              position_x: 0,
              position_y: 0,
              format_schema: null,
              worker_type: splitTaskWorkerType(task),
              worker_id: task.suggested_assignee_id,
              critic_type: "human",
              critic_id: null,
              critic_api_url: null,
              sort_order: task.sort_order,
              stage_id: splitNode.stage_id,
              created_at: task.created_at,
              updated_at: task.updated_at,
            } satisfies WorkflowNode,
            nodeRun: null,
            runtimeSummary: {
              workflow_node_id: childNodeId,
              node_run_id: task.run_id ?? task.id,
              display_status: splitTaskDisplayStatus(task.status),
              active_actor_type: task.suggested_assignee_type ?? "member",
              active_actor_id: task.suggested_assignee_id,
              deliverable_signal: "none",
              required_deliverables_total: 0,
              required_deliverables_submitted: 0,
              required_deliverables_approved: 0,
              duration_seconds: null,
              session_id: null,
              runtime_id: null,
              device_id: null,
              has_error: task.status === "failed",
              error_message: "",
              split_progress: null,
            } satisfies WorkflowNodeRuntimeSummary,
            workerName: task.suggested_assignee_id
              ? getActorName(task.suggested_assignee_type ?? "member", task.suggested_assignee_id)
              : null,
            criticName: null,
            onOpen: () => navigation.push(paths.issueDetail(issueId)),
          },
        });

        const validDependencies = task.depends_on.filter((depId) => taskMap.has(depId));
        if (validDependencies.length === 0) {
          splitChildEdges.push({
            id: `${splitNode.id}:split-task-edge:${task.id}`,
            source: splitNode.id,
            target: childNodeId,
            sourceHandle: "right",
            targetHandle: "left",
            type: "panorama",
            interactionWidth: 24,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "rgb(59 130 246)",
              strokeWidth: 1.5,
            },
            data: {
              edgeKind: "data",
              edgeTone: "condition",
              stageColorIndex: 0,
              sameStage: true,
            },
          });
        } else {
          for (const depId of validDependencies) {
            splitChildEdges.push({
              id: `${splitNode.id}:split-task-edge:${depId}:${task.id}`,
              source: createSplitChildNodeId(splitNode.id, depId),
              target: childNodeId,
              sourceHandle: "right",
              targetHandle: "left",
              type: "panorama",
              interactionWidth: 24,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "rgb(59 130 246)",
                strokeWidth: 1.5,
              },
              data: {
                edgeKind: "condition",
                edgeTone: "condition",
                stageColorIndex: 0,
                sameStage: true,
              },
            });
          }
        }
      });
    }
  }

  const rfNodes = [...baseRfNodes, ...splitChildNodes];
  const rfEdges = [...baseRfEdges, ...splitChildEdges];
  const handleNodeClick = (nodeId: string) => {
    const childIssueId = splitChildIssueByNodeId.get(nodeId);
    if (childIssueId) {
      navigation.push(paths.issueDetail(childIssueId));
      return;
    }
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
            workerName={
              selectedNode.worker_id
                ? getActorName(
                    workerTypeToActorType(selectedNode.worker_type),
                    selectedNode.worker_id,
                  )
                : null
            }
            criticName={
              selectedNode.critic_id
                ? getActorName(
                    selectedNode.critic_type ?? "agent",
                    selectedNode.critic_id,
                  )
                : null
            }
            onClose={() => setSelectedNodeId(null)}
            wsId={wsId}
            runtimeSummary={selectedRuntimeSummary}
            onRetry={
              issueId && selectedRun && isRetryableSelectedRun && retryingNodeRunId !== selectedRun.id
                ? () => void handleRetryNodeRun(selectedRun)
                : undefined
            }
          />
        )
      )}
    </div>
  );
}

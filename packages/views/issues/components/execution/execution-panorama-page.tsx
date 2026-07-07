"use client";

import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarkerType, ReactFlowProvider, type Edge, type Node, type Viewport } from "@xyflow/react";
import {
  workflowDetailOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowNodeRunsOptions,
  workflowRunCanvasSummaryOptions,
} from "@multica/core/workflows/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import { workerTypeToActorType } from "@multica/core/types";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowStage,
  Agent,
} from "@multica/core/types";
import type { WorkflowEdge } from "@multica/core/types";
import { WorkflowCanvasCore } from "../../../workflows/components/canvas/workflow-canvas-core";
import { panoramaEdgeTypes } from "../../../workflows/components/overview/reactflow-edges";
import {
  WORKER_HEIGHT,
  WORKER_WIDTH,
  computeLaneY,
  createStageVisualIndexMap,
  sortStagesForDisplay,
  UNASSIGNED_LANE_Y,
} from "../../../workflows/components/overview/constants";
import { ExecutionDetailPanel } from "./execution-detail-panel";
import { GlobalNotificationBar } from "./global-notification-bar";
import { runtimeCanvasNodeTypes } from "./runtime-canvas-node";
import { Loader2 } from "lucide-react";

export interface ExecutionPanoramaPageProps {
  workflowId: string;
  runId: string | null;
  wsId: string;
}

/**
 * Main issue-execution panorama view.
 *
 * Composes the shared WorkflowCanvasCore in read-only runtime mode with
 * ExecutionDetailPanel.
 * into a scrollable full-page view of all workflow stages, nodes, and their
 * per-run status.
 */
function runtimeNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  nodeRunMap: Map<string, WorkflowNodeRun>,
  runtimeSummaryMap: Map<string, WorkflowNodeRuntimeSummary>,
  getActorName: (type: string, id: string) => string | null,
  onOpen: (nodeId: string) => void,
): Node[] {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const stageVisualIndexMap = createStageVisualIndexMap(stages);

  return nodes.map((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const visualIndex = stage ? stageVisualIndexMap.get(stage.id) ?? stages.length : stages.length;
    return {
      id: node.id,
      type: "runtimeNode",
      position: {
        x: node.position_x ?? 100,
        y: stage ? computeLaneY(visualIndex) : UNASSIGNED_LANE_Y(stages.length),
      },
      width: WORKER_WIDTH,
      height: Math.max(WORKER_HEIGHT, 120),
      data: {
        node,
        nodeRun: nodeRunMap.get(node.id) ?? null,
        runtimeSummary: runtimeSummaryMap.get(node.id) ?? null,
        workerName: node.worker_id
          ? getActorName(workerTypeToActorType(node.worker_type), node.worker_id)
          : null,
        criticName: node.critic_id
          ? getActorName(node.critic_type ?? "agent", node.critic_id)
          : null,
        onOpen,
      },
    };
  });
}

function runtimeEdgesToReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: "panorama",
    sourceHandle: "right",
    targetHandle: "left",
    interactionWidth: 16,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "rgb(100 116 139)",
      strokeWidth: 1.5,
    },
    data: {
      stageColorIndex: 0,
      edgeKind: "data",
      edgeTone: "data",
    },
  }));
}

export function ExecutionPanoramaPage({
  workflowId,
  runId,
  wsId,
}: ExecutionPanoramaPageProps) {
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

  // ---- Derived ----
  const isLoading = wfLoading || stLoading || ndLoading;

  const scrollToNode = useCallback((nodeId: string) => {
    const el = document.querySelector(
      `[data-testid="runtime-node-card-${nodeId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

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

  const allStages: WorkflowStage[] = stages ?? [];
  const allNodes: WorkflowNode[] = nodes ?? [];
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
  const rfNodes = runtimeNodesToReactFlowNodes(
    allNodes,
    sortStagesForDisplay(allStages),
    nodeRunMap,
    runtimeSummaryMap,
    getActorName,
    setSelectedNodeId,
  );
  const rfEdges = runtimeEdgesToReactFlowEdges(edges ?? []);

  return (
    <div
      className="relative flex h-full min-h-[640px] flex-1 flex-col"
      data-testid="execution-panorama"
    >
      {/* Global notification bar */}
      <GlobalNotificationBar
        nodeRunMap={nodeRunMap}
        onScrollToNode={scrollToNode}
      />
      <div className="relative flex min-h-[560px] flex-1" data-testid="execution-canvas-shell">
        <ReactFlowProvider>
          <WorkflowCanvasCore
            nodes={rfNodes}
            edges={rfEdges}
            stages={canvasStages}
            nodeTypes={runtimeCanvasNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            readOnly
            viewportY={viewport.y}
            viewportZoom={viewport.zoom}
            onMove={setViewport}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          />
        </ReactFlowProvider>
      </div>

      {/* Detail panel */}
      {selectedNodeId && selectedNode && (
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
        />
      )}
    </div>
  );
}

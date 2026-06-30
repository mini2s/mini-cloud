"use client";

import { useState, useMemo, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowOverviewOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  useUpdateNode,
  useCreateEdge,
  useDeleteEdge,
  useDeleteNode,
  useAssignNodeToStage,
} from "@multica/core/workflows/queries";
import { agentListOptions, builtinPluginListOptions } from "@multica/core/workspace/queries";
import { useActorName } from "@multica/core/workspace/hooks";
import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import { useNavigation } from "../../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { useT } from "../../../i18n";
import { PageHeader } from "../../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { AlertCircle, ArrowLeft, PanelsTopLeft } from "lucide-react";

import { PanoramaToolbar } from "./panorama-toolbar";
import { CanvasStageLabels } from "./canvas-stage-labels";
import { NodeConfigPanel } from "../node-config-panel";
import { NodePalette } from "../node-palette";
import { StageCreateDialog } from "./stage-create-dialog";
import { panoramaNodeTypes } from "./reactflow-nodes";
import { panoramaEdgeTypes } from "./reactflow-edges";
import { computeLaneAutoLayout } from "../layout";

import {
  LANE_STEP,
  LANE_HEIGHT,
  WORKER_HEIGHT,
  WORKER_CRITIC_GAP,
  UNASSIGNED_LANE_Y,
  computeLaneY,
} from "./constants";

import type { WorkflowNode, WorkflowStage, WorkflowEdge } from "@multica/core/types";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";

// ── Types ──

export interface WorkflowPanoramaPageProps {
  workflowId: string;
  viewToggle?: ReactNode;
}

// ── Data conversion: API nodes → ReactFlow nodes ──

function apiNodesToReactFlowNodes(
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  agentLookup: Map<string, Agent | null>,
  pluginLookup: Map<string, BuiltinPlugin | null>,
  getActorName: (type: string, id: string) => string | null,
): Node[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return nodes.flatMap((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const sortOrder = stage?.sort_order ?? stages.length; // unassigned goes to end
    const laneY = stage ? computeLaneY(stage.sort_order) : UNASSIGNED_LANE_Y(stages.length);
    const x = node.position_x ?? 100;

    const stageColorIndex = Math.abs(sortOrder) % 6;

    // Worker node
    const workerNode: Node = {
      id: node.id,
      type: "compactWorker",
      position: { x, y: laneY },
      data: {
        node,
        stage_id: node.stage_id,
        stageColorIndex,
        pluginName: node.worker_id
          ? (agentLookup.get(node.worker_id)?.plugin_id
              ? pluginLookup.get(agentLookup.get(node.worker_id)!.plugin_id!)?.name
              : undefined)
          : undefined,
        workerName: node.worker_id ? getActorName(node.worker_type ?? "agent", node.worker_id) ?? undefined : undefined,
      },
    };

    // Critic badge node (rendered below worker if critic is configured)
    if (!node.critic_id && !node.critic_api_url) return [workerNode];

    const criticNode: Node = {
      id: `${node.id}:critic`,
      type: "criticBadge",
      position: { x, y: laneY + WORKER_HEIGHT + WORKER_CRITIC_GAP },
      data: {
        node,
        parentNodeId: node.id,
        criticName: node.critic_id ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined : undefined,
      },
      parentId: node.id,
      extent: "parent",
    };

    return [workerNode, criticNode];
  });
}

// ── API edges → ReactFlow edges ──

function apiEdgesToReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: "panorama",
    style: edge.target_node_id.endsWith(":critic") || edges.some((e) =>
      e.source_node_id === edge.target_node_id && e.target_node_id.endsWith(":critic")
    ) ? { strokeDasharray: "4 3" } : undefined,
  }));
}

// ── Background nodes: lane backgrounds + gradient transitions ──

function buildBackgroundNodes(stages: WorkflowStage[]): Node[] {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const result: Node[] = [];

  sorted.forEach((stage, idx) => {
    // Lane background
    result.push({
      id: `lane-bg-${stage.id}`,
      type: "laneBg",
      position: { x: 0, y: stage.sort_order * LANE_STEP },
      data: { stageIndex: stage.sort_order },
      draggable: false,
      selectable: false,
      deletable: false,
      zIndex: -2,
    });

    // Gradient transition (except after last stage)
    if (idx < sorted.length - 1) {
      result.push({
        id: `gradient-bg-${stage.id}`,
        type: "gradientBg",
        position: { x: 0, y: stage.sort_order * LANE_STEP + LANE_HEIGHT },
        data: { fromStageIndex: stage.sort_order },
        draggable: false,
        selectable: false,
        deletable: false,
        zIndex: -2,
      });
    }
  });

  return result;
}

// ── Drag constraint: snap Y to lane ──

function findStageAtY(y: number, stages: WorkflowStage[]): WorkflowStage | undefined {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  for (const stage of sorted) {
    const laneTop = stage.sort_order * LANE_STEP;
    const laneBottom = laneTop + LANE_HEIGHT;
    if (y >= laneTop && y <= laneBottom) return stage;
  }
  return undefined;
}

// ── Skeleton ──

function PanoramaSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="panorama-skeleton">
      <Skeleton className="h-8 w-64" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

// ── Main Page Component ──

export function WorkflowPanoramaPage({ workflowId, viewToggle }: WorkflowPanoramaPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  // ── Queries ──
  const { data: workflow, isLoading: wfLoading, isError: wfError, refetch } = useQuery(
    workflowOverviewOptions(wsId, workflowId),
  );
  const { data: stages = [], isLoading: stLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );
  const { data: apiNodes = [], isLoading: ndLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );
  const { data: apiEdges = [], isLoading: edLoading } = useQuery(
    workflowEdgesOptions(wsId, workflowId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: pluginsData } = useQuery(builtinPluginListOptions());
  const { getActorName } = useActorName();

  const isLoading = wfLoading || stLoading || ndLoading || edLoading;

  // ── Mutations ──
  const updateNodeMutation = useUpdateNode(wsId, workflowId);
  const createEdgeMutation = useCreateEdge(wsId, workflowId);
  const deleteEdgeMutation = useDeleteEdge(wsId, workflowId);
  const deleteNodeMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);

  // ── Store ──
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const deletedNodeIds = useWorkflowEditorStore((s) => s.deletedNodeIds);
  const cacheNodeDelete = useWorkflowEditorStore((s) => s.cacheNodeDelete);
  const clearNodeEdits = useWorkflowEditorStore((s) => s.clearNodeEdits);
  const clearNodeDelete = useWorkflowEditorStore((s) => s.clearNodeDelete);
  const pushServerAction = useWorkflowEditorStore((s) => s.pushServerAction);

  // ── Local state ──
  const [viewportY, setViewportY] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [showStageDialog, setShowStageDialog] = useState(false);

  // ── Derived lookups ──
  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const pluginLookup = useMemo(() => {
    const map = new Map<string, BuiltinPlugin | null>();
    const items = pluginsData?.items ?? [];
    for (const p of items) map.set(p.id, p);
    return map;
  }, [pluginsData]);

  // ── ReactFlow nodes/edges ──
  const rfNodes = useMemo(
    () => [
      ...buildBackgroundNodes(stages),
      ...apiNodesToReactFlowNodes(apiNodes, stages, agentLookup, pluginLookup, getActorName),
    ],
    [stages, apiNodes, agentLookup, pluginLookup, getActorName],
  );

  const rfEdges = useMemo(() => apiEdgesToReactFlowEdges(apiEdges), [apiEdges]);

  // ── Selected node for config panel ──
  const selectedNode = useMemo(
    () => apiNodes.find((n) => n.id === selectedNodeId) ?? null,
    [apiNodes, selectedNodeId],
  );

  // ── Unsaved check ──
  const hasUnsaved = Object.keys(nodeEdits).length > 0 || deletedNodeIds.length > 0;

  // ── Handlers ──
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === "laneBg" || node.type === "gradientBg") return;
      const workerId = (node.data.parentNodeId as string | undefined) ?? node.id;
      selectNode(workerId as string);
      setConfigPanelOpen(true);
    },
    [selectNode],
  );

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      if (node.type !== "compactWorker") return;

      const nodeData = node.data as Record<string, unknown>;
      const nodeId = (nodeData.node as { id: string } | undefined)?.id;
      const stageId = nodeData.stage_id as string | undefined;
      if (!nodeId) return;

      // Persist position_x
      updateNodeMutation.mutate({
        nodeId,
        position_x: node.position.x,
      } as Parameters<typeof updateNodeMutation.mutate>[0]);

      // Check if y moved to a different lane
      const newStage = findStageAtY(node.position.y, stages);
      if (newStage && newStage.id !== stageId) {
        assignStageMutation.mutate({
          nodeId,
          stage_id: newStage.id,
        });
      }
    },
    [stages, updateNodeMutation, assignStageMutation],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      createEdgeMutation.mutate({
        source_node_id: connection.source,
        target_node_id: connection.target,
      } as Parameters<typeof createEdgeMutation.mutate>[0], {
        onSuccess: (_data, vars) => {
          pushServerAction({
            type: "create-edge",
            sourceNodeId: vars.source_node_id,
            targetNodeId: vars.target_node_id,
          });
        },
      });
    },
    [createEdgeMutation, pushServerAction],
  );

  const handleEdgeDelete = useCallback(
    (edgesToDelete: Edge[]) => {
      for (const edge of edgesToDelete) {
        deleteEdgeMutation.mutate(edge.id);
        pushServerAction({ type: "delete-edge", edgeId: edge.id });
      }
    },
    [deleteEdgeMutation, pushServerAction],
  );

  const handleAutoLayout = useCallback(() => {
    const newPositions = computeLaneAutoLayout(apiNodes, apiEdges);
    for (const [nodeId, x] of newPositions) {
      updateNodeMutation.mutate({ nodeId, position_x: x } as Parameters<typeof updateNodeMutation.mutate>[0]);
    }
  }, [apiNodes, apiEdges, updateNodeMutation]);

  const handleSave = useCallback(async () => {
    // Batch save all cached edits
    for (const [nodeId, edits] of Object.entries(nodeEdits)) {
      await updateNodeMutation.mutateAsync({ nodeId, ...edits } as Parameters<typeof updateNodeMutation.mutate>[0]);
      clearNodeEdits(nodeId);
    }
    // Batch delete
    for (const nodeId of deletedNodeIds) {
      await deleteNodeMutation.mutateAsync(nodeId);
      clearNodeDelete(nodeId);
    }
  }, [nodeEdits, deletedNodeIds, updateNodeMutation, deleteNodeMutation, clearNodeEdits, clearNodeDelete]);

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      cacheNodeDelete(nodeId);
      setConfigPanelOpen(false);
    },
    [cacheNodeDelete],
  );

  const handleStageChange = useCallback(
    (nodeId: string, stageId: string | null) => {
      assignStageMutation.mutate({ nodeId, stage_id: stageId });
    },
    [assignStageMutation],
  );

  // ── Viewport tracking ──
  const handleViewportChange = useCallback((viewport: Viewport) => {
    setViewportY(viewport.y);
    setZoomLevel(Math.round(viewport.zoom * 100));
  }, []);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <PanoramaSkeleton />
      </div>
    );
  }

  // ── Error ──
  if (wfError || !workflow) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t(($) => $.detail.not_found)}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigation.push(wsPaths.workflows())}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t(($) => $.detail.back_to_workflows)}
                </Button>
                <Button variant="default" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (stages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader className="justify-between px-5 shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-muted-foreground">
              <PanelsTopLeft className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h1 className="text-sm font-medium truncate">{workflow.title}</h1>
            </div>
          </div>
          {viewToggle && <div className="flex items-center gap-1">{viewToggle}</div>}
        </PageHeader>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {t(($) => $.panorama.empty_all)}
            </p>
            <Button variant="default" size="sm" onClick={() => setShowStageDialog(true)}>
              Create Stage
            </Button>
          </div>
        </div>
        {showStageDialog && (
          <StageCreateDialog
            workflowId={workflowId}
            wsId={wsId}
            onClose={() => setShowStageDialog(false)}
          />
        )}
      </div>
    );
  }

  // ── Main panorama ──
  return (
    <div className="flex flex-col h-full">
      <PanoramaToolbar
        onAutoLayout={handleAutoLayout}
        onSave={handleSave}
        hasUnsaved={hasUnsaved}
        zoomIn={() => {}}  // handled by ReactFlow Controls
        zoomOut={() => {}}
        zoomLevel={zoomLevel}
      />

      <div className="flex flex-1 min-h-0 relative">
        {/* Node palette sidebar */}
        <NodePalette
          className="absolute left-3 top-3 z-10"
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed(!paletteCollapsed)}
        />

        {/* Canvas stage labels */}
        <CanvasStageLabels
          stages={stages}
          viewportY={viewportY}
          onEdit={() => {}}
          onDelete={() => {}}
          onReorder={() => {}}
        />

        {/* ReactFlow canvas */}
        <div className="flex-1 ml-32" data-testid="panorama-canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={panoramaNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            onNodeClick={handleNodeClick}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onEdgesDelete={handleEdgeDelete}
            fitView
            minZoom={0.2}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode="Shift"
            selectionOnDrag
            onMove={(_, viewport) => handleViewportChange(viewport)}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Node config panel (right slide-out) */}
        {configPanelOpen && selectedNode && (
          <div className="w-96 border-l bg-card shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              nodes={apiNodes}
              stages={stages}
              onClose={() => setConfigPanelOpen(false)}
              onDeleteNode={handleNodeDelete}
              onStageChange={handleStageChange}
            />
          </div>
        )}
      </div>

      {showStageDialog && (
        <StageCreateDialog
          workflowId={workflowId}
          wsId={wsId}
          onClose={() => setShowStageDialog(false)}
        />
      )}
    </div>
  );
}

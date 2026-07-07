"use client";

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
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
  workflowRunsOptions,
  workflowNodeRunsOptions,
  useUpdateWorkflow,
  useCreateNode,
  useUpdateNode,
  useCreateEdge,
  useDeleteEdge,
  useDeleteNode,
  useDeleteWorkflow,
  useStartWorkflowRun,
  useAssignNodeToStage,
  useDeleteStage,
  useReorderStages,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { AlertCircle, ArrowLeft, Layers, PanelsTopLeft, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { toast } from "sonner";

import { WorkflowCanvasCore } from "../canvas/workflow-canvas-core";
import { NodeConfigPanel } from "../node-config-panel";
import { StageCreateDialog } from "./stage-create-dialog";
import { panoramaNodeTypes } from "./reactflow-nodes";
import { panoramaEdgeTypes } from "./reactflow-edges";
import { computeLaneAutoLayout, computeStageTransferPositionX } from "../layout";
import { PreflightBar } from "./preflight-bar";
import { runAllPreflightChecks } from "@multica/core/workflows/preflight-checks";
import { NodeTemplatePicker } from "./node-template-picker";
import { WorkflowEditorToolbar } from "./workflow-editor-toolbar";
import {
  buildCreateNodeRequestFromTemplate,
  type NodeTemplate,
} from "./node-template-catalog";

import {
  LANE_STEP,
  LANE_HEIGHT,
  WORKER_WIDTH,
  WORKER_HEIGHT,
  WORKER_CRITIC_GAP,
  CRITIC_WIDTH,
  CRITIC_HEIGHT,
  UNASSIGNED_LANE_Y,
  computeLaneY,
  createStageVisualIndexMap,
  getStageColor,
  getStageColorIndex,
  sortStagesForDisplay,
} from "./constants";

import type { WorkflowNode, WorkflowStage, WorkflowEdge, ReorderStagesItem, WorkflowStatus, Workflow, WorkflowNodeRun } from "@multica/core/types";
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
  onOpenNode: (nodeId: string) => void,
): Node[] {
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const stageVisualIndexMap = createStageVisualIndexMap(stages);

  return nodes.flatMap((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const isAnnotation = Boolean(
      node.format_schema &&
      typeof node.format_schema === "object" &&
      !Array.isArray(node.format_schema) &&
      (node.format_schema as Record<string, unknown>).type === "annotation",
    );
    const visualIndex = stage ? stageVisualIndexMap.get(stage.id) ?? stages.length : stages.length;
    const laneY = stage ? computeLaneY(visualIndex) : UNASSIGNED_LANE_Y(stages.length);
    const x = node.position_x ?? 100;

    const stageColorIndex = getStageColorIndex(visualIndex);

    // Worker node
    const workerNode: Node = {
      id: node.id,
      type: "compactWorker",
      position: { x, y: laneY },
      width: WORKER_WIDTH,
      height: WORKER_HEIGHT,
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
        workerConfigured: isAnnotation ? true : Boolean(node.worker_id),
        criticConfigured: isAnnotation ? false : node.critic_type === "api" ? Boolean(node.critic_api_url?.trim()) : Boolean(node.critic_id),
        isAnnotation,
        onOpen: onOpenNode,
      },
    };

    // Critic badge node (rendered below worker if critic is configured)
    if (!node.critic_id && !node.critic_api_url) return [workerNode];

    const criticNode: Node = {
      id: `${node.id}:critic`,
      type: "criticBadge",
      position: { x: x + (WORKER_WIDTH - CRITIC_WIDTH) / 2, y: laneY + WORKER_HEIGHT + WORKER_CRITIC_GAP },
      width: CRITIC_WIDTH,
      height: CRITIC_HEIGHT,
      data: {
        node,
        parentNodeId: node.id,
        criticName: node.critic_id ? getActorName(node.critic_type ?? "agent", node.critic_id) ?? undefined : undefined,
      },
    };

    return [workerNode, criticNode];
  });
}

// ── API edges → ReactFlow edges ──

function apiEdgesToReactFlowEdges(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  onDeleteEdge?: (edgeId: string) => void,
  selectedEdgeId?: string | null,
  selectedEdgeAnchor?: { x: number; y: number } | null,
): Edge[] {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const stageVisualIndexMap = createStageVisualIndexMap(stages);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const positionMap = new Map(nodes.map((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const visualIndex = stage ? stageVisualIndexMap.get(stage.id) ?? stages.length : stages.length;
    return [node.id, {
      x: node.position_x ?? 100,
      y: stage ? computeLaneY(visualIndex) : UNASSIGNED_LANE_Y(stages.length),
    }];
  }));

  const workflowEdges = edges.map((edge) => ({
    ...(() => {
      const edgeSemantics = deriveEdgeSemantics(edge.condition);
      const markerColor = getEdgeMarkerColor(edge.source_node_id, nodeMap, stageMap, stageVisualIndexMap, edgeSemantics.edgeTone);
      return {
        data: {
          stageColorIndex: getEdgeStageColorIndex(edge.source_node_id, nodeMap, stageMap, stageVisualIndexMap),
          ...(onDeleteEdge ? { onDeleteEdge } : {}),
          ...(edge.id === selectedEdgeId && selectedEdgeAnchor ? { deleteButtonPosition: selectedEdgeAnchor } : {}),
          ...edgeSemantics,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: markerColor,
          strokeWidth: 1.5,
        },
      };
    })(),
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    selected: edge.id === selectedEdgeId,
    type: "panorama",
    sourceHandle: "right",
    targetHandle: "left",
    interactionWidth: 24,
    style: edge.target_node_id.endsWith(":critic") || edges.some((e) =>
      e.source_node_id === edge.target_node_id && e.target_node_id.endsWith(":critic")
    ) ? { strokeDasharray: "4 3" } : undefined,
    ...(() => {
      const source = positionMap.get(edge.source_node_id);
      const target = positionMap.get(edge.target_node_id);
      if (!source || !target) return {};
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      if (Math.abs(dy) > Math.abs(dx)) {
        return { sourceHandle: "bottom", targetHandle: "left" };
      }
      return { sourceHandle: "right", targetHandle: "left" };
    })(),
  }));

  const criticEdges: Edge[] = nodes
    .filter((node) => node.critic_id || node.critic_api_url)
    .map((node) => ({
      id: `${node.id}:critic-edge`,
      source: node.id,
      target: `${node.id}:critic`,
      sourceHandle: "bottom",
      targetHandle: "top",
      type: "panorama",
      data: {
        stageColorIndex: getEdgeStageColorIndex(node.id, nodeMap, stageMap, stageVisualIndexMap),
        edgeKind: "critic",
        edgeTone: "critic",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: getEdgeMarkerColor(node.id, nodeMap, stageMap, stageVisualIndexMap, "critic"),
        strokeWidth: 1.5,
      },
      interactionWidth: 16,
      selectable: false,
      deletable: false,
      style: { strokeDasharray: "4 3" },
    }));

  return [...workflowEdges, ...criticEdges];
}

function getEdgeMarkerColor(
  sourceNodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  stageMap: Map<string, WorkflowStage>,
  stageVisualIndexMap: Map<string, number>,
  edgeTone: CanvasEdgeTone = "data",
): string {
  if (edgeTone === "condition") return "rgb(59 130 246)";
  if (edgeTone === "error") return "rgb(239 68 68)";
  if (edgeTone === "rework" || edgeTone === "critic") return "rgb(245 158 11)";
  return getStageColor(getEdgeStageColorIndex(sourceNodeId, nodeMap, stageMap, stageVisualIndexMap)).markerColor;
}

function getEdgeStageColorIndex(
  sourceNodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  stageMap: Map<string, WorkflowStage>,
  stageVisualIndexMap: Map<string, number>,
): number {
  const sourceNode = nodeMap.get(sourceNodeId);
  const sourceStage = sourceNode?.stage_id ? stageMap.get(sourceNode.stage_id) : undefined;
  return sourceStage ? stageVisualIndexMap.get(sourceStage.id) ?? 0 : 0;
}

type CanvasEdgeKind = "data" | "condition" | "error" | "rework" | "critic";
type CanvasEdgeTone = "data" | "condition" | "error" | "rework" | "critic";

function isCanvasEdgeKind(value: unknown): value is CanvasEdgeKind {
  return value === "data" || value === "condition" || value === "error" || value === "rework" || value === "critic";
}

function edgeToneForKind(kind: CanvasEdgeKind, severity?: unknown): CanvasEdgeTone {
  if (severity === "error" || severity === "danger") return "error";
  if (severity === "warning") return "rework";
  if (kind === "error" || kind === "rework" || kind === "critic" || kind === "condition") return kind;
  return "data";
}

function deriveEdgeSemantics(condition: unknown): {
  edgeKind: CanvasEdgeKind;
  edgeTone: CanvasEdgeTone;
} {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    const obj = condition as Record<string, unknown>;
    const kind = isCanvasEdgeKind(obj.kind) ? obj.kind : "condition";
    return {
      edgeKind: kind,
      edgeTone: edgeToneForKind(kind, obj.severity),
    };
  }

  return {
    edgeKind: "data",
    edgeTone: "data",
  };
}

// ── Background nodes: lane backgrounds + gradient transitions ──

// ── Drag constraint: snap Y to lane ──

function findStageAtY(y: number, stages: WorkflowStage[]): WorkflowStage | undefined {
  const sorted = sortStagesForDisplay(stages);
  for (const [index, stage] of sorted.entries()) {
    const laneTop = index * LANE_STEP;
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

// ── Inner canvas component (lives inside ReactFlowProvider to use useReactFlow) ──

interface PanoramaContentProps {
  rfNodes: Node[];
  rfEdges: Edge[];
  stages: WorkflowStage[];
  apiNodes: WorkflowNode[];
  visibleNodes: WorkflowNode[];
  apiEdges: WorkflowEdge[];
  agentIds: Set<string>;
  workflow: Workflow;
  workflowId: string;
  wsId: string;
  selectedNode: WorkflowNode | null;
  viewportY: number;
  viewportZoom: number;
  configPanelOpen: boolean;
  recentNodeRun: WorkflowNodeRun | null;
  showStageDialog: boolean;
  editingStage: WorkflowStage | null;
  onAutoLayout: () => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge, position: { x: number; y: number }) => void;
  onPaneClick: () => void;
  onNodeDragStop: (event: MouseEvent | TouchEvent, node: Node) => void;
  onConnect: (connection: Connection) => void;
  onTemplateDrop: (template: NodeTemplate, position: { x: number; y: number }) => void;
  onEdgeDelete: (edges: Edge[]) => void;
  onNodeDelete: (nodeId: string) => void;
  onStageChange: (nodeId: string, stageId: string | null) => void;
  onStageDelete: (stage: WorkflowStage) => void;
  onStageReorder: (stageId: string, direction: "up" | "down") => void;
  onViewportChange: (viewport: Viewport) => void;
  onOpenStageDialog: (stage?: WorkflowStage) => void;
  onCloseStageDialog: () => void;
  onCloseConfigPanel: () => void;
  onBackToWorkflows: () => void;
  onToggleWorkflowStatus: () => void;
  onUpdateTitle: (title: string) => void;
  onDeleteWorkflow: () => void;
  onSave: () => boolean | Promise<boolean>;
  onTestRun: () => Promise<void>;
  onOpenRunHistory: () => void;
}

function PanoramaContent({
  rfNodes,
  rfEdges,
  stages,
  apiNodes,
  visibleNodes,
  apiEdges,
  agentIds,
  workflow,
  workflowId,
  wsId,
  selectedNode,
  viewportY,
  viewportZoom,
  configPanelOpen,
  recentNodeRun,
  showStageDialog,
  editingStage,
  onAutoLayout,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onTemplateDrop,
  onEdgeDelete,
  onNodeDelete,
  onStageChange,
  onStageDelete,
  onStageReorder,
  onViewportChange,
  onOpenStageDialog,
  onCloseStageDialog,
  onCloseConfigPanel,
  onBackToWorkflows,
  onToggleWorkflowStatus,
  onUpdateTitle,
  onDeleteWorkflow,
  onSave,
  onTestRun,
  onOpenRunHistory,
}: PanoramaContentProps) {
  const { t } = useT("workflows");
  const reactFlowInstance = useReactFlow();
  const canUndo = useWorkflowEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowEditorStore((s) => s.redoStack.length > 0);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const hasUnsavedEdits = useWorkflowEditorStore((s) => Object.keys(s.nodeEdits).length > 0);
  const statusLabel = t(($) => $.status[workflow.status as keyof typeof $.status] ?? workflow.status);

  // Delete workflow dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dialogRootRef = useRef<HTMLDivElement>(null);
  const [firstStepPickerOpen, setFirstStepPickerOpen] = useState(false);

  // ── Preflight checks ──
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const [preflightDismissed, setPreflightDismissed] = useState(false);
  const preflightResult = useMemo(
    () => runAllPreflightChecks({
      nodes: visibleNodes,
      edges: apiEdges,
      stages,
      agentIds,
    }),
    [visibleNodes, apiEdges, stages, agentIds],
  );

  const handleNavigateToNode = useCallback((nodeId: string) => {
    const rfNode = reactFlowInstance.getNode(nodeId);
    if (rfNode) {
      reactFlowInstance.setCenter(
        rfNode.position.x + (rfNode.width ?? WORKER_WIDTH) / 2,
        rfNode.position.y + (rfNode.height ?? WORKER_HEIGHT) / 2,
        { zoom: 1.2, duration: 400 },
      );
    }
    selectNode(nodeId);
  }, [reactFlowInstance, selectNode]);

  // ── Onboarding guide state ──
  const rlNodesCount = rfNodes.filter(n => n.type !== "laneBg" && n.type !== "gradientBg").length;
  const showFirstStageGuide = stages.length === 0;
  const showFirstStepGuide = stages.length > 0 && rlNodesCount === 0;
  const handleSelectTemplate = useCallback((template: NodeTemplate) => {
    const center = reactFlowInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    onTemplateDrop(template, center);
  }, [onTemplateDrop, reactFlowInstance]);

  // Keyboard shortcuts for undo/redo (document level because ReactFlow
  // container focus is unreliable).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;

      // Ctrl+Z / Cmd+Z → undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        if (editable) return;
        e.preventDefault();
        useWorkflowEditorStore.getState().undo();
        return;
      }

      // Ctrl+Shift+Z / Cmd+Shift+Z → redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") {
        if (editable) return;
        e.preventDefault();
        useWorkflowEditorStore.getState().redo();
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <WorkflowEditorToolbar
        workflow={workflow}
        statusLabel={statusLabel}
        canUndo={canUndo}
        canRedo={canRedo}
        hasUnsavedEdits={hasUnsavedEdits}
        hasBlockingPreflightIssues={preflightResult.blockingCount > 0}
        onBackToWorkflows={onBackToWorkflows}
        onUpdateTitle={onUpdateTitle}
        onUndo={undo}
        onRedo={redo}
        onSave={onSave}
        onAutoLayout={onAutoLayout}
        onSelectTemplate={handleSelectTemplate}
        onTestRun={onTestRun}
        onToggleWorkflowStatus={onToggleWorkflowStatus}
        onOpenRunHistory={onOpenRunHistory}
        onDeleteWorkflow={() => setDeleteDialogOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        <WorkflowCanvasCore
            nodes={rfNodes}
            edges={rfEdges}
          stages={stages}
            nodeTypes={panoramaNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgeDelete}
            defaultViewport={{ x: 0, y: 24, zoom: 0.95 }}
          viewportY={viewportY}
          viewportZoom={viewportZoom}
          onMove={onViewportChange}
          onStageEdit={onOpenStageDialog}
          onStageDelete={onStageDelete}
          onStageReorder={onStageReorder}
        >

          {/* First step guide overlay */}
          {showFirstStepGuide && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="animate-in fade-in zoom-in-95 duration-300 max-w-sm rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Plus className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  {t(($) => $.panorama.add_first_step)}
                </p>
                <Popover open={firstStepPickerOpen} onOpenChange={setFirstStepPickerOpen} modal={false}>
                  <PopoverTrigger
                    render={
                      <Button variant="default" size="sm" aria-label={t(($) => $.detail.add_node)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        {t(($) => $.detail.add_node)}
                      </Button>
                    }
                  />
                  <PopoverContent
                    className="w-[min(360px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                    align="center"
                    side="bottom"
                  >
                    <NodeTemplatePicker
                      onSelect={(template) => {
                        handleSelectTemplate(template);
                        setFirstStepPickerOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </WorkflowCanvasCore>

        {/* Node config panel (right slide-out) */}
        {configPanelOpen && selectedNode && (
          <aside className="w-[560px] max-w-[48vw] border-l bg-card shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              nodes={apiNodes}
              stages={stages}
              recentNodeRun={recentNodeRun}
              onClose={onCloseConfigPanel}
              onDeleteNode={onNodeDelete}
              onStageChange={onStageChange}
            />
          </aside>
        )}
      </div>

      {/* Preflight bar */}
      {!showFirstStageGuide && visibleNodes.length > 0 && (!preflightDismissed || preflightResult.passed) && (
        <PreflightBar
          result={preflightResult}
          hasUnsavedEdits={hasUnsavedEdits}
          workflowStatus={workflow.status}
          onNavigateToNode={handleNavigateToNode}
          onActivate={async () => {
            const saved = await onSave();
            if (!saved) return;
            if (workflow.status !== "active") {
              onToggleWorkflowStatus();
            }
          }}
          onDismiss={() => setPreflightDismissed(true)}
        />
      )}

      {showStageDialog && (
        <StageCreateDialog
          workflowId={workflowId}
          wsId={wsId}
          stage={editingStage}
          onClose={onCloseStageDialog}
        />
      )}

      {/* Dialog portal container for iframe compatibility */}
      <div ref={dialogRootRef} />

      {/* Delete workflow confirm dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent container={dialogRootRef.current}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.detail.delete_dialog.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.detail.delete_dialog.description, { title: workflow.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.detail.delete_dialog.cancel)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDeleteWorkflow}>
              {t(($) => $.detail.delete_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const { data: recentRuns = [] } = useQuery(workflowRunsOptions(wsId, workflowId));
  const latestRunId = recentRuns[0]?.id ?? null;
  const { data: recentNodeRuns = [] } = useQuery({
    ...workflowNodeRunsOptions(wsId, workflowId, latestRunId ?? ""),
    enabled: !!latestRunId,
  });
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: pluginsData } = useQuery(builtinPluginListOptions());
  const { getActorName } = useActorName();

  const isLoading = wfLoading || stLoading || ndLoading || edLoading;

  // ── Mutations ──
  const updateNodeMutation = useUpdateNode(wsId, workflowId);
  const updateWorkflowMutation = useUpdateWorkflow(wsId);
  const createNodeMutation = useCreateNode(wsId, workflowId);
  const createEdgeMutation = useCreateEdge(wsId, workflowId);
  const deleteEdgeMutation = useDeleteEdge(wsId, workflowId);
  const deleteNodeMutation = useDeleteNode(wsId, workflowId);
  const assignStageMutation = useAssignNodeToStage(wsId, workflowId);
  const deleteStageMutation = useDeleteStage(wsId, workflowId);
  const reorderStagesMutation = useReorderStages(wsId, workflowId);
  const deleteWorkflowMutation = useDeleteWorkflow(wsId);
  const startWorkflowRunMutation = useStartWorkflowRun(wsId);

  // ── Store ──
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowEditorStore((s) => s.selectedEdgeId);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const selectEdge = useWorkflowEditorStore((s) => s.selectEdge);
  const nodeEdits = useWorkflowEditorStore((s) => s.nodeEdits);
  const deletedNodeIds = useWorkflowEditorStore((s) => s.deletedNodeIds);
  const clearNodeEdits = useWorkflowEditorStore((s) => s.clearNodeEdits);
  const cacheNodeDelete = useWorkflowEditorStore((s) => s.cacheNodeDelete);
  const pushServerAction = useWorkflowEditorStore((s) => s.pushServerAction);

  // ── Local state ──
  const [viewportY, setViewportY] = useState(0);
  const [viewportZoom, setViewportZoom] = useState(1);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [editingStage, setEditingStage] = useState<WorkflowStage | null>(null);
  const [emptyStatePickerOpen, setEmptyStatePickerOpen] = useState(false);
  const [selectedEdgeAnchor, setSelectedEdgeAnchor] = useState<{ x: number; y: number } | null>(null);
  const openNodePanel = useCallback((nodeId: string) => {
    selectNode(nodeId);
    setConfigPanelOpen(true);
  }, [selectNode]);

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
  const visibleNodes = useMemo(
    () => apiNodes
      .filter((node) => !deletedNodeIds.includes(node.id))
      .map((node) => ({
        ...node,
        ...(nodeEdits[node.id] ?? {}),
      })),
    [apiNodes, deletedNodeIds, nodeEdits],
  );

  const rfNodes = useMemo(
    () => apiNodesToReactFlowNodes(visibleNodes, stages, agentLookup, pluginLookup, getActorName, openNodePanel),
    [stages, visibleNodes, agentLookup, pluginLookup, getActorName, openNodePanel],
  );

  const handleInlineEdgeDelete = useCallback(
    (edgeId: string) => {
      deleteEdgeMutation.mutate(edgeId);
      pushServerAction({ type: "delete-edge", edgeId });
      selectEdge(null);
    },
    [deleteEdgeMutation, pushServerAction, selectEdge],
  );

  const rfEdges = useMemo(
    () => apiEdgesToReactFlowEdges(apiEdges, visibleNodes, stages, handleInlineEdgeDelete, selectedEdgeId, selectedEdgeAnchor),
    [apiEdges, visibleNodes, stages, handleInlineEdgeDelete, selectedEdgeId, selectedEdgeAnchor],
  );

  // ── Selected node for config panel ──
  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );
  const selectedRecentNodeRun = useMemo(
    () => selectedNode ? recentNodeRuns.find((run) => run.workflow_node_id === selectedNode.id) ?? null : null,
    [recentNodeRuns, selectedNode],
  );

  // ── Handlers ──
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedEdgeAnchor(null);
      const workerId = (node.data.parentNodeId as string | undefined) ?? node.id;
      openNodePanel(workerId as string);
    },
    [openNodePanel],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge, position: { x: number; y: number }) => {
      selectEdge(edge.id);
      setSelectedEdgeAnchor(position);
      setConfigPanelOpen(false);
    },
    [selectEdge],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
    setSelectedEdgeAnchor(null);
    setConfigPanelOpen(false);
  }, [selectNode, selectEdge]);

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      if (node.type !== "compactWorker") return;

      const nodeData = node.data as Record<string, unknown>;
      const nodeId = (nodeData.node as { id: string } | undefined)?.id;
      const stageId = nodeData.stage_id as string | undefined;
      if (!nodeId) return;

      // Track position change for undo
      pushServerAction({ type: "move-node", nodeId });

      // Persist position_x
      updateNodeMutation.mutate({
        nodeId,
        position_x: Math.max(0, Math.round(node.position.x)),
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
    [stages, updateNodeMutation, assignStageMutation, pushServerAction],
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

  const createTemplateNode = useCallback(
    (template: NodeTemplate, position: { x: number; y: number }) => {
      const stage = findStageAtY(position.y, stages);

      createNodeMutation.mutate(buildCreateNodeRequestFromTemplate(template, {
        x: position.x,
        y: position.y,
        stageId: stage?.id ?? null,
      }), {
        onSuccess: (created) => {
          pushServerAction({ type: "create-node", nodeId: created.id });
        },
      });
    },
    [createNodeMutation, stages, pushServerAction],
  );

  const handleTemplateDrop = useCallback(
    (template: NodeTemplate, position: { x: number; y: number }) => {
      createTemplateNode(template, position);
    },
    [createTemplateNode],
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

  const handleNodeDelete = useCallback(
    async (nodeId: string) => {
      cacheNodeDelete(nodeId);
      await deleteNodeMutation.mutateAsync(nodeId);
      setConfigPanelOpen(false);
    },
    [deleteNodeMutation, cacheNodeDelete],
  );

  const handleStageChange = useCallback(
    (nodeId: string, stageId: string | null) => {
      const positionX = computeStageTransferPositionX(visibleNodes, nodeId, stageId);
      updateNodeMutation.mutate({ nodeId, position_x: positionX } as Parameters<typeof updateNodeMutation.mutate>[0]);
      assignStageMutation.mutate({ nodeId, stage_id: stageId });
    },
    [assignStageMutation, updateNodeMutation, visibleNodes],
  );

  const handleStageDelete = useCallback(
    (stage: WorkflowStage) => {
      if (window.confirm(`Delete stage "${stage.name}"?`)) {
        deleteStageMutation.mutate(stage.id);
      }
    },
    [deleteStageMutation],
  );

  const handleStageReorder = useCallback(
    (stageId: string, direction: "up" | "down") => {
      const sorted = sortStagesForDisplay(stages);
      const idx = sorted.findIndex((s) => s.id === stageId);
      if (idx === -1) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;

      const items: ReorderStagesItem[] = [
        { id: sorted[idx]!.id, sort_order: sorted[swapIdx]!.sort_order },
        { id: sorted[swapIdx]!.id, sort_order: sorted[idx]!.sort_order },
      ];
      reorderStagesMutation.mutate(items);
    },
    [stages, reorderStagesMutation],
  );

  // ── Viewport tracking ──
  const handleOpenStageDialog = useCallback((stage?: WorkflowStage) => {
    setEditingStage(stage ?? null);
    setShowStageDialog(true);
  }, []);

  const handleCloseStageDialog = useCallback(() => {
    setEditingStage(null);
    setShowStageDialog(false);
  }, []);

  const handleToggleWorkflowStatus = useCallback(() => {
    if (!workflow) return;
    const nextStatus: WorkflowStatus = workflow.status === "active" ? "paused" : "active";
    updateWorkflowMutation.mutate(
      { id: workflowId, status: nextStatus },
      {
        onSuccess: () => {
          toast.success(nextStatus === "active"
            ? t(($) => $.detail.toast_activated)
            : t(($) => $.detail.toast_deactivated));
        },
        onError: () => toast.error(t(($) => $.detail.toast_activate_failed)),
      },
    );
  }, [workflow, workflowId, updateWorkflowMutation, t]);

  const handleSave = useCallback(async () => {
    const entries = Object.entries(useWorkflowEditorStore.getState().nodeEdits);
    if (entries.length === 0) return true;
    try {
      await Promise.all(
        entries.map(([nodeId, edits]) =>
          updateNodeMutation.mutateAsync({ nodeId, ...edits } as Parameters<typeof updateNodeMutation.mutateAsync>[0]),
        ),
      );
      entries.forEach(([nodeId]) => clearNodeEdits(nodeId));
      toast.success(t(($) => $.detail.toast_saved));
      return true;
    } catch {
      toast.error(t(($) => $.detail.toast_save_failed));
      return false;
    }
  }, [updateNodeMutation, clearNodeEdits, t]);

  const handleTestRun = useCallback(async () => {
    const saved = await handleSave();
    if (!saved) return;
    try {
      const run = await startWorkflowRunMutation.mutateAsync({ workflowId });
      toast.success(t(($) => $.detail.toast_run_started));
      navigation.push(wsPaths.workflowRunDetail(workflowId, run.id));
    } catch {
      toast.error(t(($) => $.detail.toast_run_failed));
    }
  }, [handleSave, startWorkflowRunMutation, workflowId, navigation, wsPaths, t]);

  const handleViewportChange = useCallback((viewport: Viewport) => {
    setViewportY(viewport.y);
    setViewportZoom(viewport.zoom);
  }, []);

  const handleUpdateTitle = useCallback(
    (title: string) => {
      updateWorkflowMutation.mutate({ id: workflowId, title });
    },
    [workflowId, updateWorkflowMutation],
  );

  const handleDeleteWorkflow = useCallback(async () => {
    try {
      await deleteWorkflowMutation.mutateAsync(workflowId);
      toast.success(t(($) => $.detail.toast_deleted));
      navigation.push(wsPaths.workflows());
    } catch {
      toast.error(t(($) => $.detail.toast_delete_failed));
    }
  }, [workflowId, deleteWorkflowMutation, navigation, wsPaths, t]);

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

  // ── Empty state (first stage guide) ── show only when truly empty
  if (stages.length === 0 && apiNodes.length === 0) {
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
          <div className="animate-in fade-in zoom-in-95 duration-300 max-w-sm rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Layers className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <h2 className="text-base font-semibold mb-2">
              {t(($) => $.preflight.first_stage_guide_title)}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {t(($) => $.preflight.first_stage_guide_description)}
            </p>
            <div className="flex flex-col items-center gap-2">
              <Popover open={emptyStatePickerOpen} onOpenChange={setEmptyStatePickerOpen} modal={false}>
                <PopoverTrigger render={
                  <Button variant="default" size="sm" aria-label={t(($) => $.detail.add_node)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t(($) => $.detail.add_node)}
                  </Button>
                } />
                <PopoverContent
                  className="w-[min(360px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
                  align="center"
                  side="bottom"
                >
                  <NodeTemplatePicker
                    onSelect={(template) => {
                      createTemplateNode(template, { x: 200, y: 0 });
                      setEmptyStatePickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setShowStageDialog(true)}>
                {t(($) => $.preflight.first_stage_guide_cta)}
              </Button>
            </div>
          </div>
        </div>
        {showStageDialog && (
          <StageCreateDialog
            workflowId={workflowId}
            wsId={wsId}
            stage={editingStage}
            onClose={handleCloseStageDialog}
          />
        )}
      </div>
    );
  }

  // ── Main panorama ──
  return (
    <ReactFlowProvider>
      <PanoramaContent
        rfNodes={rfNodes}
        rfEdges={rfEdges}
        stages={stages}
        apiNodes={apiNodes}
        visibleNodes={visibleNodes}
        apiEdges={apiEdges}
        agentIds={new Set(agentLookup.keys())}
        workflow={workflow}
        workflowId={workflowId}
        wsId={wsId}
        selectedNode={selectedNode}
        viewportY={viewportY}
        viewportZoom={viewportZoom}
        configPanelOpen={configPanelOpen}
        recentNodeRun={selectedRecentNodeRun}
        showStageDialog={showStageDialog}
        editingStage={editingStage}
        onAutoLayout={handleAutoLayout}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onTemplateDrop={handleTemplateDrop}
        onEdgeDelete={handleEdgeDelete}
        onNodeDelete={handleNodeDelete}
        onStageChange={handleStageChange}
        onStageDelete={handleStageDelete}
        onStageReorder={handleStageReorder}
        onViewportChange={handleViewportChange}
        onOpenStageDialog={handleOpenStageDialog}
        onCloseStageDialog={handleCloseStageDialog}
        onCloseConfigPanel={() => setConfigPanelOpen(false)}
        onBackToWorkflows={() => navigation.push(wsPaths.workflows())}
        onToggleWorkflowStatus={handleToggleWorkflowStatus}
        onUpdateTitle={handleUpdateTitle}
        onDeleteWorkflow={handleDeleteWorkflow}
        onSave={handleSave}
        onTestRun={handleTestRun}
        onOpenRunHistory={() => navigation.push(wsPaths.workflowRuns(workflowId))}
      />
    </ReactFlowProvider>
  );
}

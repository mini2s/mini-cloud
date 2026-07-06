"use client";

import { useState, useMemo, useCallback, useRef, useEffect, createElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  MarkerType,
  ConnectionMode,
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
  useUpdateWorkflow,
  useCreateNode,
  useUpdateNode,
  useCreateEdge,
  useDeleteEdge,
  useDeleteNode,
  useDeleteWorkflow,
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
import { AlertCircle, ArrowLeft, AppWindow, CheckCircle2, Layers, Monitor, Moon, PanelsTopLeft, PauseCircle, Plus, Redo2, Save, Sun, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@multica/ui/components/ui/badge";
import { Separator } from "@multica/ui/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { toast } from "sonner";

import { CanvasStageLabels } from "./canvas-stage-labels";
import { NodeConfigPanel } from "../node-config-panel";
import { StageCreateDialog } from "./stage-create-dialog";
import { panoramaNodeTypes } from "./reactflow-nodes";
import { panoramaEdgeTypes } from "./reactflow-edges";
import { computeLaneAutoLayout, computeStageTransferPositionX } from "../layout";
import { PreflightBar } from "./preflight-bar";
import { runAllPreflightChecks } from "@multica/core/workflows/preflight-checks";

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
  getStageColor,
  getStageColorIndex,
} from "./constants";

import type { WorkflowNode, WorkflowStage, WorkflowEdge, ReorderStagesItem, NodeShape, WorkflowStatus, Workflow } from "@multica/core/types";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";

// ── Types ──

const DRAG_SHAPE_MIME = "application/x-multica-shape";
const SHAPE_LABELS: Record<NodeShape, string> = {
  rectangle: "Rectangle",
  diamond: "Diamond",
  pill: "Pill",
  hexagon: "Hexagon",
};

const SHAPES = [
  { type: "rectangle" as const, label: "Rectangle", icon: (
    <svg width="20" height="15" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "diamond" as const, label: "Diamond", icon: (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <polygon points="12,1 23,12 12,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "pill" as const, label: "Pill", icon: (
    <svg width="20" height="15" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "hexagon" as const, label: "Hexagon", icon: (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <polygon points="6,1 18,1 23,12 18,23 6,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "critic" as const, label: "Critic", icon: (
    <svg width="20" height="15" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  )},
];

function isNodeShape(shape: string): shape is NodeShape {
  return shape in SHAPE_LABELS;
}

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

    const stageColorIndex = getStageColorIndex(sortOrder);

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

function apiEdgesToReactFlowEdges(edges: WorkflowEdge[], nodes: WorkflowNode[], stages: WorkflowStage[]): Edge[] {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const positionMap = new Map(nodes.map((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    return [node.id, {
      x: node.position_x ?? 100,
      y: stage ? computeLaneY(stage.sort_order) : UNASSIGNED_LANE_Y(stages.length),
    }];
  }));

  const workflowEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: "panorama",
    sourceHandle: "right",
    targetHandle: "left",
    data: {
      stageColorIndex: getEdgeStageColorIndex(edge.source_node_id, nodeMap, stageMap),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: getEdgeMarkerColor(edge.source_node_id, nodeMap, stageMap),
      strokeWidth: 1.5,
    },
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
        stageColorIndex: getEdgeStageColorIndex(node.id, nodeMap, stageMap),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: getEdgeMarkerColor(node.id, nodeMap, stageMap),
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
): string {
  return getStageColor(getEdgeStageColorIndex(sourceNodeId, nodeMap, stageMap)).markerColor;
}

function getEdgeStageColorIndex(
  sourceNodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  stageMap: Map<string, WorkflowStage>,
): number {
  const sourceNode = nodeMap.get(sourceNodeId);
  const sourceStage = sourceNode?.stage_id ? stageMap.get(sourceNode.stage_id) : undefined;
  return sourceStage?.sort_order ?? 0;
}

// ── Background nodes: lane backgrounds + gradient transitions ──

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
  showStageDialog: boolean;
  editingStage: WorkflowStage | null;
  onAutoLayout: () => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  onNodeDragStop: (event: MouseEvent | TouchEvent, node: Node) => void;
  onConnect: (connection: Connection) => void;
  onShapeDrop: (shape: NodeShape, position: { x: number; y: number }) => void;
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
  onSave: () => void;
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
  showStageDialog,
  editingStage,
  onAutoLayout,
  onNodeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onShapeDrop,
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
}: PanoramaContentProps) {
  const { t } = useT("workflows");
  const reactFlowInstance = useReactFlow();
  const canvasColorMode = useWorkflowEditorStore((s) => s.canvasColorMode);
  const cycleCanvasColorMode = useWorkflowEditorStore((s) => s.cycleCanvasColorMode);
  const canUndo = useWorkflowEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowEditorStore((s) => s.redoStack.length > 0);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const hasUnsavedEdits = useWorkflowEditorStore((s) => Object.keys(s.nodeEdits).length > 0);
  const statusLabel = t(($) => $.status[workflow.status as keyof typeof $.status] ?? workflow.status);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workflow.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Delete workflow dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dialogRootRef = useRef<HTMLDivElement>(null);

  // Shape palette popover
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleStartEditTitle = useCallback(() => {
    setDraftTitle(workflow.title);
    setEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.select());
  }, [workflow.title]);

  const handleSaveTitle = useCallback(() => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== workflow.title) {
      onUpdateTitle(trimmed);
    } else {
      setDraftTitle(workflow.title);
    }
    setEditingTitle(false);
  }, [draftTitle, workflow.title, onUpdateTitle]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSaveTitle();
      if (e.key === "Escape") {
        setDraftTitle(workflow.title);
        setEditingTitle(false);
      }
    },
    [handleSaveTitle, workflow.title],
  );

  const themeIcon = canvasColorMode === "dark" ? Moon : canvasColorMode === "light" ? Sun : Monitor;
  const themeLabel =
    canvasColorMode === "dark"
      ? t(($) => $.detail.canvas_theme_dark)
      : canvasColorMode === "light"
        ? t(($) => $.detail.canvas_theme_light)
        : t(($) => $.detail.canvas_theme_system);

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

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const shape = event.dataTransfer.getData(DRAG_SHAPE_MIME);
      if (!isNodeShape(shape)) return;
      onShapeDrop(shape, reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }));
    },
    [onShapeDrop, reactFlowInstance],
  );

  const handleDragStart = useCallback((e: React.DragEvent, shapeType: string) => {
    e.dataTransfer.setData(DRAG_SHAPE_MIME, shapeType);
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleClickToPlace = useCallback((shape: string) => {
    if (!isNodeShape(shape)) return;
    const center = reactFlowInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    onShapeDrop(shape, center);
    setPopoverOpen(false);
  }, [reactFlowInstance, onShapeDrop]);

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
      <PageHeader className="justify-between gap-3 border-b bg-background/95 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBackToWorkflows}
            aria-label={t(($) => $.detail.back_to_workflows)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50 text-muted-foreground">
            <PanelsTopLeft className="size-4" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            {editingTitle ? (
              <input
                ref={titleInputRef}
                className="w-full truncate bg-transparent text-sm font-semibold outline-none border-b border-primary"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleTitleKeyDown}
              />
            ) : (
              <h1
                className="truncate text-sm font-semibold cursor-pointer hover:text-primary transition-colors"
                onClick={handleStartEditTitle}
                title={t(($) => $.detail.click_to_rename)}
              >
                {workflow.title}
              </h1>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              <Badge variant={workflow.status === "active" ? "default" : "secondary"} className="h-4 rounded px-1.5 text-[10px] capitalize">
                {statusLabel}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Editing */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={undo} aria-label={t(($) => $.panorama.toolbar.undo)}>
                  <Undo2 className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{t(($) => $.panorama.toolbar.undo)}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={redo} aria-label={t(($) => $.panorama.toolbar.redo)}>
                  <Redo2 className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{t(($) => $.panorama.toolbar.redo)}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" disabled={!hasUnsavedEdits} onClick={onSave} aria-label={t(($) => $.panorama.toolbar.save)}>
                  <Save className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{t(($) => $.panorama.toolbar.save)}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Canvas tools */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={onAutoLayout} aria-label={t(($) => $.panorama.toolbar.auto_layout)}>
                  <AppWindow className="size-4" />
                </Button>
              }
            />
            <TooltipContent>{t(($) => $.panorama.toolbar.auto_layout)}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Add node popover */}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={false}>
            <PopoverTrigger>
              <Button variant="outline" size="sm" aria-label="Add node">
                <Plus className="size-3.5 mr-1" />
                Add node
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start" side="bottom">
              <div className="flex gap-1">
                {SHAPES.map((shape) => (
                  <button
                    key={shape.type}
                    draggable
                    title={shape.label}
                    aria-label={shape.label}
                    className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing transition-colors"
                    onDragStart={(e) => {
                      handleDragStart(e, shape.type);
                    }}
                    onDragEnd={() => setPopoverOpen(false)}
                    onClick={() => handleClickToPlace(shape.type)}
                  >
                    {shape.icon}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />

          {/* Workflow management */}
          <Button
            variant={workflow.status === "active" ? "outline" : "default"}
            size="sm"
            onClick={onToggleWorkflowStatus}
          >
            {workflow.status === "active" ? (
              <PauseCircle className="size-3.5" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {workflow.status === "active"
              ? t(($) => $.detail.deactivate)
              : t(($) => $.detail.activate)}
          </Button>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={cycleCanvasColorMode} aria-label={themeLabel}>
                  {createElement(themeIcon, { className: "size-4" })}
                </Button>
              }
            />
            <TooltipContent>{themeLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  aria-label={t(($) => $.detail.delete)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t(($) => $.detail.delete)}</TooltipContent>
          </Tooltip>
        </div>
      </PageHeader>

      <div className="flex flex-1 min-h-0">
        <div className="relative flex min-w-0 flex-1">
          {/* Canvas stage labels */}
          <CanvasStageLabels
            stages={stages}
            viewportY={viewportY}
            viewportZoom={viewportZoom}
            onEdit={onOpenStageDialog}
            onDelete={onStageDelete}
            onReorder={onStageReorder}
          />

          {/* ReactFlow canvas */}
          <div className="absolute inset-0 z-10 min-w-0" data-testid="panorama-canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={panoramaNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onEdgesDelete={onEdgeDelete}
            fitView={false}
            minZoom={0.2}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 24, zoom: 0.95 }}
            deleteKeyCode={["Backspace", "Delete"]}
            connectionMode={ConnectionMode.Loose}
            multiSelectionKeyCode="Shift"
            selectionOnDrag
            colorMode={canvasColorMode}
            onMove={(_, viewport) => onViewportChange(viewport)}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(node) => {
              return node.type === "criticBadge" ? "#f59e0b" : "#64748b";
            }} />
          </ReactFlow>

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
                <Button
                  variant="default"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Place a default rectangle node at the center of the first stage lane
                    const firstLaneY = stages.length > 0 ? stages[0]!.sort_order * LANE_STEP + LANE_HEIGHT / 2 : 100;
                    onShapeDrop("rectangle", { x: 200, y: firstLaneY });
                  }}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t(($) => $.detail.add_node)}
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Node config panel (right slide-out) */}
        {configPanelOpen && selectedNode && (
          <aside className="w-96 border-l bg-card shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              nodes={apiNodes}
              stages={stages}
              onClose={onCloseConfigPanel}
              onDeleteNode={onNodeDelete}
              onStageChange={onStageChange}
            />
          </aside>
        )}
      </div>

      {/* Preflight bar */}
      {!preflightDismissed && !preflightResult.passed && !showFirstStageGuide && (
        <PreflightBar
          result={preflightResult}
          onNavigateToNode={handleNavigateToNode}
          onPublish={async () => {
            await onSave();
            onToggleWorkflowStatus();
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

  // ── Store ──
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
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
    () => apiNodesToReactFlowNodes(visibleNodes, stages, agentLookup, pluginLookup, getActorName),
    [stages, visibleNodes, agentLookup, pluginLookup, getActorName],
  );

  const rfEdges = useMemo(() => apiEdgesToReactFlowEdges(apiEdges, visibleNodes, stages), [apiEdges, visibleNodes, stages]);

  // ── Selected node for config panel ──
  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );

  // ── Handlers ──
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const workerId = (node.data.parentNodeId as string | undefined) ?? node.id;
      selectNode(workerId as string);
      setConfigPanelOpen(true);
    },
    [selectNode],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    setConfigPanelOpen(false);
  }, [selectNode]);

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

  const handleShapeDrop = useCallback(
    (shape: NodeShape, position: { x: number; y: number }) => {
      const stage = findStageAtY(position.y, stages);

      createNodeMutation.mutate({
        title: SHAPE_LABELS[shape],
        description: "",
        position_x: Math.max(0, Math.round(position.x)),
        position_y: 0,
        stage_id: stage?.id ?? null,
        format_schema: { shape },
        worker_type: "agent",
        worker_id: null,
        critic_type: "human",
        critic_id: null,
        critic_api_url: null,
      }, {
        onSuccess: (created) => {
          pushServerAction({ type: "create-node", nodeId: created.id });
        },
      });
    },
    [createNodeMutation, stages, pushServerAction],
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
      const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
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
    if (entries.length === 0) return;
    try {
      await Promise.all(
        entries.map(([nodeId, edits]) =>
          updateNodeMutation.mutateAsync({ nodeId, ...edits } as Parameters<typeof updateNodeMutation.mutateAsync>[0]),
        ),
      );
      entries.forEach(([nodeId]) => clearNodeEdits(nodeId));
      toast.success(t(($) => $.detail.toast_saved));
    } catch {
      toast.error(t(($) => $.detail.toast_save_failed));
    }
  }, [updateNodeMutation, clearNodeEdits, t]);

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
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  createNodeMutation.mutate({
                    title: SHAPE_LABELS["rectangle"],
                    description: "",
                    position_x: 200,
                    position_y: 0,
                    stage_id: null,
                    format_schema: { shape: "rectangle" as NodeShape },
                    worker_type: "agent",
                    worker_id: null,
                    critic_type: "human",
                    critic_id: null,
                    critic_api_url: null,
                  });
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t(($) => $.detail.add_node)}
              </Button>
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
        showStageDialog={showStageDialog}
        editingStage={editingStage}
        onAutoLayout={handleAutoLayout}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onShapeDrop={handleShapeDrop}
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
      />
    </ReactFlowProvider>
  );
}

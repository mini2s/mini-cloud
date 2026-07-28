"use client";

import { useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkspaceId } from "@multica/core/hooks";
import { ApiError } from "@multica/core/api";
import {
  workflowOverviewOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowRunsOptions,
  workflowNodeRunsOptions,
  workflowRolesOptions,
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
  splitIssueWorkflowOptions,
} from "@multica/core/workflows/queries";
import { agentListOptions, builtinPluginListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { useActorName } from "@multica/core/workspace/hooks";
import { useWorkspacePresenceMap, type AgentAvailability } from "@multica/core/agents";
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
import { getDeleteConflictMessage } from "../../../common/delete-conflict-error";

import { WorkflowCanvasCore } from "../canvas/workflow-canvas-core";
import {
  MIN_NODE_HORIZONTAL_GAP,
  workflowCanvasStages,
  workflowEdgesToReactFlowEdges,
  workflowNodesToReactFlowNodes,
} from "../canvas/workflow-canvas-model";
import { NodeConfigPanel } from "../node-config-panel";
import { StageCreateDialog } from "./stage-create-dialog";
import { panoramaNodeTypes } from "./reactflow-nodes";
import { BOUNDARY_WIDTH } from "./reactflow-nodes/boundary-node";
import { panoramaEdgeTypes } from "./reactflow-edges";
import { computeLaneAutoLayout, computeStageTransferPositionX } from "../layout";
import { PreflightBar } from "./preflight-bar";
import { runAllPreflightChecks, type SplitIssueWorkflowPreflightContext } from "@multica/core/workflows/preflight-checks";
import { NodeTemplatePicker } from "./node-template-picker";
import { WorkflowEditorToolbar } from "./workflow-editor-toolbar";
import {
  WorkflowRuntimeStrategyDialog,
  type WorkflowRuntimeStrategyValue,
} from "../workflow-runtime-strategy-dialog";
import { useUsableWorkflowRuntimes } from "../use-usable-workflow-runtimes";
import {
  buildCreateNodeRequestFromTemplate,
  type NodeTemplate,
} from "./node-template-catalog";

import {
  LANE_STEP,
  LANE_HEIGHT,
  WORKER_WIDTH,
  WORKER_HEIGHT,
  sortStagesForDisplay,
} from "./constants";

import { isBoundaryNode, isEndNode, isInvalidBoundaryConnection, isStartNode, parseNodeFormat, workerTypeToActorType, type WorkflowNode, type WorkflowStage, type WorkflowEdge, type ReorderStagesItem, type WorkflowStatus, type Workflow, type WorkflowNodeRun, type UpdateNodeRequest } from "@multica/core/types";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";
import type { CriticType, WorkerType } from "@multica/core/types";
import type {
  WorkflowActorEntityType,
  WorkflowActorIdentity,
} from "../../../common/workflow-actor-slots";

// ── Types ──

export interface WorkflowPanoramaPageProps {
  workflowId: string;
  viewToggle?: ReactNode;
}

function buildEditorActorIdentity(input: {
  type: WorkerType | CriticType;
  id: string | null;
  roleName?: string;
  getActorName: (type: string, id: string) => string;
  getActorInitials: (type: string, id: string) => string;
  getActorAvatarUrl: (type: string, id: string) => string | null;
  availability?: AgentAvailability;
  labels: Record<WorkflowActorEntityType, string>;
  availabilityLabels: { online: string; offline: string };
}): WorkflowActorIdentity | null {
  const { type, id, roleName, labels } = input;
  if (type === "role") {
    return roleName
      ? { type: "role", id: null, name: roleName, typeLabel: labels.role }
      : null;
  }
  if (type === "api") {
    return roleName
      ? { type: "api", id: null, name: roleName, typeLabel: labels.api }
      : null;
  }
  if (!id) return null;

  const actorType: Exclude<WorkflowActorEntityType, "role" | "api"> =
    type === "human" ? "member" : type;
  const identity: WorkflowActorIdentity = {
    type: actorType,
    id,
    name: input.getActorName(actorType, id),
    typeLabel: labels[actorType],
    initials: input.getActorInitials(actorType, id),
    avatarUrl: input.getActorAvatarUrl(actorType, id),
  };
  if (actorType === "agent" && input.availability) {
    identity.availability = input.availability;
    identity.availabilityLabel = input.availability === "online"
      ? input.availabilityLabels.online
      : input.availabilityLabels.offline;
  }
  return identity;
}

// ── Data conversion: API nodes → ReactFlow nodes ──

// ── API edges → ReactFlow edges ──

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

export function isValidWorkflowConnection(
  connection: Connection | Edge,
  nodesById: Map<string, WorkflowNode>,
): boolean {
  const source = connection.source ? nodesById.get(connection.source) : undefined;
  const target = connection.target ? nodesById.get(connection.target) : undefined;
  return Boolean(source && target && !isInvalidBoundaryConnection(source, target));
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
  splitChildWorkflows: SplitIssueWorkflowPreflightContext[];
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
  connectedNodePickerSourceId: string | null;
  onConnectedTemplateSelect: (template: NodeTemplate) => void;
  onEdgeDelete: (edges: Edge[]) => void;
  onNodeDelete: (nodeId: string) => void;
  onStageChange: (nodeId: string, stageId: string | null) => void;
  onStageDelete: (stage: WorkflowStage) => void;
  onStageReorder: (stageId: string, direction: "up" | "down") => void;
  onViewportChange: (viewport: Viewport) => void;
  onOpenStageDialog: (stage?: WorkflowStage) => void;
  onCloseStageDialog: () => void;
  onCloseConfigPanel: () => void;
  onConfigPanelDirtyChange: (dirty: boolean) => void;
  onRegisterConfigPanelSave: (save: (() => Promise<boolean>) | null) => void;
  onBackToWorkflows: () => void;
  onToggleWorkflowStatus: () => void;
  onUpdateTitle: (title: string) => void;
  onDeleteWorkflow: () => void;
  onSave: () => boolean | Promise<boolean>;
  onTestRun: () => Promise<void>;
  onOpenRunHistory: () => void;
  onOpenRunSettings: () => void;
  disabledBoundaryTemplateIds: Set<string>;
}

function PanoramaContent({
  rfNodes,
  rfEdges,
  stages,
  apiNodes,
  visibleNodes,
  apiEdges,
  agentIds,
  splitChildWorkflows,
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
  connectedNodePickerSourceId,
  onConnectedTemplateSelect,
  onEdgeDelete,
  onNodeDelete,
  onStageChange,
  onStageDelete,
  onStageReorder,
  onViewportChange,
  onOpenStageDialog,
  onCloseStageDialog,
  onCloseConfigPanel,
  onConfigPanelDirtyChange,
  onRegisterConfigPanelSave,
  onBackToWorkflows,
  onToggleWorkflowStatus,
  onUpdateTitle,
  onDeleteWorkflow,
  onSave,
  onTestRun,
  onOpenRunHistory,
  onOpenRunSettings,
  disabledBoundaryTemplateIds,
}: PanoramaContentProps) {
  const { t } = useT("workflows");
  const reactFlowInstance = useReactFlow();
  const canUndo = useWorkflowEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowEditorStore((s) => s.redoStack.length > 0);
  const undo = useWorkflowEditorStore((s) => s.undo);
  const redo = useWorkflowEditorStore((s) => s.redo);
  const hasUnsavedEdits = useWorkflowEditorStore((s) => Object.keys(s.nodeEdits).length > 0);
  const statusLabel = t(($) => $.status[workflow.status as keyof typeof $.status] ?? workflow.status);
  const canvasStages = useMemo(
    () => workflowCanvasStages(stages, visibleNodes, workflowId),
    [stages, visibleNodes, workflowId],
  );

  // Delete workflow dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dialogRootRef = useRef<HTMLDivElement>(null);
  const [firstStepPickerOpen, setFirstStepPickerOpen] = useState(false);
  const [stagePendingDelete, setStagePendingDelete] = useState<WorkflowStage | null>(null);

  // ── Preflight checks ──
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const [preflightDismissed, setPreflightDismissed] = useState(false);
  const preflightResult = useMemo(
    () => runAllPreflightChecks({
      nodes: visibleNodes,
      edges: apiEdges,
      stages,
      agentIds,
      splitChildWorkflows,
    }),
    [visibleNodes, apiEdges, stages, agentIds, splitChildWorkflows],
  );
  const nodesById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const validateConnection = useCallback(
    (connection: Edge | Connection) => isValidWorkflowConnection(connection, nodesById),
    [nodesById],
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
  const showFirstStepGuide = stages.length > 0 && rlNodesCount === 0;
  const connectedNodePickerPosition = useMemo(() => {
    if (!connectedNodePickerSourceId) return null;
    const sourceNode = rfNodes.find((node) => node.id === connectedNodePickerSourceId);
    if (!sourceNode) return null;
    if (!("flowToScreenPosition" in reactFlowInstance)) {
      return { x: window.innerWidth / 2 - 180, y: 96 };
    }
    return reactFlowInstance.flowToScreenPosition({
      x: sourceNode.position.x + (sourceNode.width ?? WORKER_WIDTH) + 16,
      y: sourceNode.position.y,
    });
  }, [connectedNodePickerSourceId, reactFlowInstance, rfNodes]);
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
        blockingPreflightIssueCount={preflightResult.blockingCount}
        onBackToWorkflows={onBackToWorkflows}
        onUpdateTitle={onUpdateTitle}
        onUndo={undo}
        onRedo={redo}
        onSave={onSave}
        onAutoLayout={onAutoLayout}
        onSelectTemplate={handleSelectTemplate}
        disabledTemplateIds={disabledBoundaryTemplateIds}
        onTestRun={onTestRun}
        onToggleWorkflowStatus={onToggleWorkflowStatus}
        onReviewIssues={() => setPreflightDismissed(false)}
        onOpenRunHistory={onOpenRunHistory}
        onOpenRunSettings={onOpenRunSettings}
        onDeleteWorkflow={() => setDeleteDialogOpen(true)}
      />

      <div className="flex flex-1 min-h-0">
        <WorkflowCanvasCore
            nodes={rfNodes}
            edges={rfEdges}
          stages={canvasStages}
            nodeTypes={panoramaNodeTypes}
            edgeTypes={panoramaEdgeTypes}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            isValidConnection={validateConnection}
            onEdgesDelete={onEdgeDelete}
            defaultViewport={{ x: 0, y: 24, zoom: 0.95 }}
          viewportY={viewportY}
          viewportZoom={viewportZoom}
          onMove={onViewportChange}
          onStageEdit={onOpenStageDialog}
          onStageDelete={setStagePendingDelete}
          onStageReorder={onStageReorder}
        >

          {connectedNodePickerSourceId && connectedNodePickerPosition && (
            <div
              className="fixed z-50 w-[min(360px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
              style={{
                left: Math.min(connectedNodePickerPosition.x, window.innerWidth - 380),
                top: Math.min(connectedNodePickerPosition.y, window.innerHeight - 420),
              }}
            >
              <NodeTemplatePicker
                onSelect={onConnectedTemplateSelect}
                disabledTemplateIds={disabledBoundaryTemplateIds}
              />
            </div>
          )}

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
          <aside className="shrink-0">
            <NodeConfigPanel
              node={selectedNode}
              workflowId={workflowId}
              nodes={apiNodes}
              stages={stages}
              recentNodeRun={recentNodeRun}
						incomingCount={apiEdges.filter((edge) => edge.target_node_id === selectedNode.id).length}
						outgoingCount={apiEdges.filter((edge) => edge.source_node_id === selectedNode.id).length}
						onTrialRun={() => void onTestRun()}
              onClose={onCloseConfigPanel}
              onSaveNode={onSave}
              onDirtyChange={onConfigPanelDirtyChange}
              onRegisterSave={onRegisterConfigPanelSave}
              onDeleteNode={onNodeDelete}
              onStageChange={onStageChange}
            />
          </aside>
        )}
      </div>

      {/* Preflight bar */}
      {visibleNodes.length > 0 && (!preflightDismissed || preflightResult.passed) && (
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

      <AlertDialog open={Boolean(stagePendingDelete)} onOpenChange={(open) => {
        if (!open) setStagePendingDelete(null);
      }}>
        <AlertDialogContent container={dialogRootRef.current}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stagePendingDelete ? `Delete stage "${stagePendingDelete.name}"?` : "Delete stage?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Nodes assigned to this stage will become unassigned. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!stagePendingDelete) return;
                onStageDelete(stagePendingDelete);
                setStagePendingDelete(null);
              }}
            >
              Delete stage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(runtimeListOptions(wsId));
  const usableWorkflowRuntimes = useUsableWorkflowRuntimes(runtimes);
  const { data: pluginsData } = useQuery(builtinPluginListOptions());
  const { data: workflowRoles = [] } = useQuery(workflowRolesOptions(wsId));
  const { data: childWorkflows = [] } = useQuery(splitIssueWorkflowOptions(wsId, workflowId));
  const { getActorName, getActorInitials, getActorAvatarUrl } = useActorName();
  const { byAgent: presenceByAgent } = useWorkspacePresenceMap(wsId);
  const actorTypeLabels = useMemo<Record<WorkflowActorEntityType, string>>(() => ({
    agent: t(($) => $.panorama.card.actor_type_agent),
    member: t(($) => $.panorama.card.actor_type_member),
    squad: t(($) => $.panorama.card.actor_type_squad),
    role: t(($) => $.panorama.card.actor_type_role),
    api: t(($) => $.panorama.card.actor_type_api),
  }), [t]);
  const actorAvailabilityLabels = useMemo(() => ({
    online: t(($) => $.panorama.card.actor_online),
    offline: t(($) => $.panorama.card.actor_offline),
  }), [t]);
  const roleById = useMemo(
    () => new Map(workflowRoles.map((role) => [role.id, role])),
    [workflowRoles],
  );

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
  const pendingHistoryAction = useWorkflowEditorStore((s) => s._reverseAction);
  const clearReverseAction = useWorkflowEditorStore((s) => s.clearReverseAction);
  const updateLatestUndoAction = useWorkflowEditorStore((s) => s.updateLatestUndoAction);

  // ── Local state ──
  const [viewportY, setViewportY] = useState(0);
  const [viewportZoom, setViewportZoom] = useState(1);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [showStageDialog, setShowStageDialog] = useState(false);
  const [showRuntimeDialog, setShowRuntimeDialog] = useState(false);
  const [showRuntimeSettingsDialog, setShowRuntimeSettingsDialog] = useState(false);
  const [editingStage, setEditingStage] = useState<WorkflowStage | null>(null);
  const [emptyStatePickerOpen, setEmptyStatePickerOpen] = useState(false);
  const [selectedEdgeAnchor, setSelectedEdgeAnchor] = useState<{ x: number; y: number } | null>(null);
  const [connectedNodePickerSourceId, setConnectedNodePickerSourceId] = useState<string | null>(null);
  const [configPanelDirty, setConfigPanelDirty] = useState(false);
  const [configPanelCloseDialogOpen, setConfigPanelCloseDialogOpen] = useState(false);
  const [configPanelCloseSaving, setConfigPanelCloseSaving] = useState(false);
  const configPanelSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const pendingConfigPanelCloseActionRef = useRef<(() => void | Promise<void>) | null>(null);

  const closeConfigPanelNow = useCallback(async (afterClose?: () => void | Promise<void>) => {
    setConfigPanelOpen(false);
    setConfigPanelDirty(false);
    await afterClose?.();
  }, []);

  const requestCloseConfigPanel = useCallback((afterClose?: () => void | Promise<void>) => {
    if (configPanelDirty && configPanelSaveRef.current) {
      pendingConfigPanelCloseActionRef.current = afterClose ?? null;
      setConfigPanelCloseDialogOpen(true);
      return false;
    }
    void closeConfigPanelNow(afterClose);
    return true;
  }, [closeConfigPanelNow, configPanelDirty]);

  const handleConfirmSaveAndCloseConfigPanel = useCallback(async () => {
    const save = configPanelSaveRef.current;
    if (!save) {
      const pending = pendingConfigPanelCloseActionRef.current;
      pendingConfigPanelCloseActionRef.current = null;
      setConfigPanelCloseDialogOpen(false);
      await closeConfigPanelNow(pending ?? undefined);
      return;
    }

    setConfigPanelCloseSaving(true);
    const saved = await save();
    setConfigPanelCloseSaving(false);
    if (!saved) return;

    const pending = pendingConfigPanelCloseActionRef.current;
    pendingConfigPanelCloseActionRef.current = null;
    setConfigPanelCloseDialogOpen(false);
    await closeConfigPanelNow(pending ?? undefined);
  }, [closeConfigPanelNow]);

  const handleCancelCloseConfigPanel = useCallback(() => {
    pendingConfigPanelCloseActionRef.current = null;
    setConfigPanelCloseDialogOpen(false);
  }, []);

  const handleDiscardAndCloseConfigPanel = useCallback(async () => {
    const pending = pendingConfigPanelCloseActionRef.current;
    pendingConfigPanelCloseActionRef.current = null;
    setConfigPanelCloseDialogOpen(false);
    if (selectedNodeId) {
      clearNodeEdits(selectedNodeId);
    }
    await closeConfigPanelNow(pending ?? undefined);
  }, [clearNodeEdits, closeConfigPanelNow, selectedNodeId]);

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

  const splitChildWorkflowContexts = useMemo<SplitIssueWorkflowPreflightContext[]>(
    () => (childWorkflows ?? []).map((wf) => ({ id: wf.id, status: wf.status, nodes: [] })),
    [childWorkflows],
  );

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
  const apiNodesById = useMemo(
    () => new Map(apiNodes.map((node) => [node.id, node])),
    [apiNodes],
  );
  const disabledBoundaryTemplateIds = useMemo(() => new Set([
    ...(visibleNodes.some(isStartNode) ? ["workflow-start"] : []),
    ...(visibleNodes.some(isEndNode) ? ["workflow-end"] : []),
  ]), [visibleNodes]);
  const visibleNodesById = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, node])),
    [visibleNodes],
  );

  const handleOpenConnectedNodePicker = useCallback((sourceNodeId: string) => {
    setConnectedNodePickerSourceId(sourceNodeId);
    setSelectedEdgeAnchor(null);
    setConfigPanelOpen(false);
  }, []);

  // Builtin role names are seeded in English in the DB; render localized
  // labels on the canvas so they match the node-config-panel display. Custom
  // roles fall through to their raw name.
  const renderRoleName = useCallback(
    (role: { is_builtin: boolean; name: string } | undefined, rawKey?: string | null): string | undefined => {
      if (role) {
        if (!role.is_builtin) return role.name;
        if (role.name === "developer") return t(($) => $.builtin_roles.developer.name);
        if (role.name === "qa") return t(($) => $.builtin_roles.qa.name);
        if (role.name === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
        return role.name;
      }
      if (rawKey) {
        if (rawKey === "developer") return t(($) => $.builtin_roles.developer.name);
        if (rawKey === "qa") return t(($) => $.builtin_roles.qa.name);
        if (rawKey === "tech_lead") return t(($) => $.builtin_roles.tech_lead.name);
        return rawKey;
      }
      return undefined;
    },
    [t],
  );

  const rfNodes = useMemo(
    () => workflowNodesToReactFlowNodes({
      nodes: visibleNodes,
      stages,
      nodeType: "compactWorker",
      makeNodeData: (node, context) => {
        const isAnnotation = Boolean(
          node.format_schema &&
          typeof node.format_schema === "object" &&
          !Array.isArray(node.format_schema) &&
          (node.format_schema as Record<string, unknown>).type === "annotation",
        );
        const nodeFormat = parseNodeFormat(node.format_schema);
        const splitChildWorkflowId = nodeFormat.split_config?.default_issue_workflow_id ?? null;
        const workerAgent = node.worker_id ? agentLookup.get(node.worker_id) : null;
        const workerRoleName = node.worker_role_id
          ? renderRoleName(roleById.get(node.worker_role_id)) ?? node.worker_role_id
          : node.worker_role
            ? renderRoleName(undefined, node.worker_role)
            : undefined;
        const criticRoleName = node.critic_role_id
          ? renderRoleName(roleById.get(node.critic_role_id)) ?? node.critic_role_id
          : node.critic_role
            ? renderRoleName(undefined, node.critic_role)
            : undefined;
        const workerIdentity = buildEditorActorIdentity({
          type: workerRoleName ? "role" : node.worker_type,
          id: workerRoleName ? null : node.worker_id,
          roleName: workerRoleName,
          getActorName,
          getActorInitials,
          getActorAvatarUrl,
          availability: node.worker_type === "agent" && node.worker_id
            ? presenceByAgent.get(node.worker_id)?.availability
            : undefined,
          labels: actorTypeLabels,
          availabilityLabels: actorAvailabilityLabels,
        });
        const criticApiName = node.critic_api_url?.trim() ? "API review" : undefined;
        const criticIdentity = buildEditorActorIdentity({
          type: criticRoleName ? "role" : criticApiName ? "api" : node.critic_type,
          id: criticRoleName || criticApiName ? null : node.critic_id,
          roleName: criticRoleName ?? criticApiName,
          getActorName,
          getActorInitials,
          getActorAvatarUrl,
          availability: node.critic_type === "agent" && node.critic_id
            ? presenceByAgent.get(node.critic_id)?.availability
            : undefined,
          labels: actorTypeLabels,
          availabilityLabels: actorAvailabilityLabels,
        });
        return {
          node,
          stage_id: context.stage_id,
          stageColorIndex: context.stageColorIndex,
          pluginName: workerAgent?.plugin_id
            ? pluginLookup.get(workerAgent.plugin_id)?.name
            : undefined,
          workerName: workerRoleName
            ?? (node.worker_id ? getActorName(workerTypeToActorType(node.worker_type), node.worker_id) ?? undefined : undefined),
          criticName: criticRoleName
              ? criticRoleName
              : node.critic_id
                ? getActorName(workerTypeToActorType(node.critic_type), node.critic_id) ?? undefined
                : criticApiName,
          workerIdentity,
          criticIdentity,
          workerConfigured: isAnnotation ? true : Boolean(node.worker_id || node.worker_role_id || node.worker_role),
          criticConfigured: isAnnotation
            ? false
            : Boolean(node.critic_id || node.critic_role_id || node.critic_role || node.critic_api_url?.trim()),
          splitChildWorkflowName: splitChildWorkflowId
            ? childWorkflows.find((workflow) => workflow.id === splitChildWorkflowId)?.title
            : undefined,
          isAnnotation,
          onOpen: openNodePanel,
          onAddConnectedNode: handleOpenConnectedNodePicker,
          addConnectedNodeLabel: t(($) => $.panorama.add_connected_node),
        };
      },
      includeCriticBadges: false,
      makeCriticName: (node) => node.critic_role_id ? renderRoleName(roleById.get(node.critic_role_id)) ?? node.critic_role_id : node.critic_role ? renderRoleName(undefined, node.critic_role) : node.critic_id ? getActorName(workerTypeToActorType(node.critic_type), node.critic_id) ?? undefined : undefined,
    }),
    [stages, visibleNodes, agentLookup, pluginLookup, getActorName, getActorInitials, getActorAvatarUrl, presenceByAgent, actorTypeLabels, actorAvailabilityLabels, openNodePanel, handleOpenConnectedNodePicker, roleById, renderRoleName, childWorkflows, t],
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
    () => workflowEdgesToReactFlowEdges({
      edges: apiEdges,
      nodes: visibleNodes,
      stages,
      includeCriticEdges: false,
      onDeleteEdge: handleInlineEdgeDelete,
      selectedEdgeId,
      selectedEdgeAnchor,
    }),
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
      const workerId = (node.data.parentNodeId as string | undefined) ?? node.id;
      requestCloseConfigPanel(() => {
        setSelectedEdgeAnchor(null);
        openNodePanel(workerId as string);
      });
    },
    [openNodePanel, requestCloseConfigPanel],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge, position: { x: number; y: number }) => {
      requestCloseConfigPanel(() => {
        selectEdge(edge.id);
        setSelectedEdgeAnchor(position);
      });
    },
    [requestCloseConfigPanel, selectEdge],
  );

  const handlePaneClick = useCallback(() => {
    requestCloseConfigPanel(() => {
      selectNode(null);
      selectEdge(null);
      setSelectedEdgeAnchor(null);
      setConnectedNodePickerSourceId(null);
    });
  }, [requestCloseConfigPanel, selectNode, selectEdge]);

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      if (node.type !== "compactWorker" && node.type !== "boundary") return;

      const nodeData = node.data as Record<string, unknown>;
      const nodeId = (nodeData.node as { id: string } | undefined)?.id;
      const stageId = nodeData.stage_id as string | undefined;
      if (!nodeId) return;

      // Track position change for undo
      pushServerAction({ type: "move-node", nodeId });

      // Persist position_x
      updateNodeMutation.mutate({
        nodeId,
        position_x: Math.round(node.position.x),
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
      if (!isValidWorkflowConnection(connection, visibleNodesById)) {
        toast.error(t(($) => $.panorama.node_picker.boundary_connection_invalid));
        return;
      }
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
    [createEdgeMutation, pushServerAction, t, visibleNodesById],
  );

  useEffect(() => {
    if (!pendingHistoryAction) return;

    const { direction, action } = pendingHistoryAction;
    clearReverseAction();

    if (action.type !== "create-node") return;

    if (direction === "undo" && action.nodeId) {
      void deleteNodeMutation.mutateAsync(action.nodeId);
      return;
    }

    if (direction === "redo" && action.nodeRequest) {
      createNodeMutation.mutate(action.nodeRequest, {
        onSuccess: (created) => {
          updateLatestUndoAction({ ...action, nodeId: created.id });
        },
      });
    }
  }, [clearReverseAction, createNodeMutation, deleteNodeMutation, pendingHistoryAction, updateLatestUndoAction]);

  const createTemplateNode = useCallback(
    (template: NodeTemplate, position: { x: number; y: number }, sourceNodeId?: string) => {
      const sourceNode = sourceNodeId ? visibleNodes.find((node) => node.id === sourceNodeId) : undefined;
      const stage = sourceNode ? undefined : findStageAtY(position.y, stages);
      const nodeRequest = buildCreateNodeRequestFromTemplate(template, {
        x: sourceNode
          ? template.boundary_kind === "start"
            ? (sourceNode.position_x ?? 0) - BOUNDARY_WIDTH - MIN_NODE_HORIZONTAL_GAP
            : (sourceNode.position_x ?? 0) + WORKER_WIDTH + MIN_NODE_HORIZONTAL_GAP
          : position.x,
        y: sourceNode ? sourceNode.position_y ?? 0 : position.y,
        stageId: sourceNode ? sourceNode.stage_id ?? null : stage?.id ?? null,
      });

      createNodeMutation.mutate(nodeRequest, {
        onSuccess: (created) => {
          pushServerAction({ type: "create-node", nodeId: created.id, nodeRequest });
          if (!sourceNodeId) return;
          const sourceId = template.boundary_kind === "start" ? created.id : sourceNodeId;
          const targetId = template.boundary_kind === "start" ? sourceNodeId : created.id;
          createEdgeMutation.mutate({
            source_node_id: sourceId,
            target_node_id: targetId,
          } as Parameters<typeof createEdgeMutation.mutate>[0], {
            onSuccess: (_edge, vars) => {
              pushServerAction({
                type: "create-edge",
                sourceNodeId: vars.source_node_id,
                targetNodeId: vars.target_node_id,
              });
            },
          });
        },
        onError: (error) => {
          if (!template.boundary_kind || !(error instanceof ApiError)) return;
          if (error.status === 409) {
            toast.error(t(($) => $.panorama.node_picker.boundary_create_conflict));
          } else if (error.status === 422) {
            toast.error(t(($) => $.panorama.node_picker.boundary_create_invalid));
          }
        },
      });
    },
    [createEdgeMutation, createNodeMutation, stages, pushServerAction, t, visibleNodes],
  );

  const handleConnectedTemplateSelect = useCallback(
    (template: NodeTemplate) => {
      const sourceNode = connectedNodePickerSourceId
        ? visibleNodes.find((node) => node.id === connectedNodePickerSourceId)
        : undefined;
      if (!sourceNode || !connectedNodePickerSourceId) return;
      createTemplateNode(template, {
        x: (sourceNode.position_x ?? 0) + WORKER_WIDTH + 96,
        y: sourceNode.position_y ?? 0,
      }, connectedNodePickerSourceId);
      setConnectedNodePickerSourceId(null);
    },
    [connectedNodePickerSourceId, createTemplateNode, visibleNodes],
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
      clearNodeEdits(nodeId);
      await deleteNodeMutation.mutateAsync(nodeId);
      selectNode(null);
      setConfigPanelOpen(false);
    },
    [deleteNodeMutation, cacheNodeDelete, clearNodeEdits, selectNode],
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
      deleteStageMutation.mutate(stage.id);
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
    const editorState = useWorkflowEditorStore.getState();
    const deletedNodeIdSet = new Set(editorState.deletedNodeIds);
    const entries = Object.entries(editorState.nodeEdits);
    const activeEntries = entries.filter(([nodeId]) => !deletedNodeIdSet.has(nodeId));
    const deletedEntries = entries.filter(([nodeId]) => deletedNodeIdSet.has(nodeId));
    deletedEntries.forEach(([nodeId]) => clearNodeEdits(nodeId));
    if (activeEntries.length === 0) return true;
    try {
      await Promise.all(
        activeEntries.map(([nodeId, edits]) => {
          let updates: Partial<UpdateNodeRequest> = edits;
          const apiNode = apiNodesById.get(nodeId);
          if (apiNode && isBoundaryNode(apiNode)) {
            updates = {
              ...(edits.title !== undefined ? { title: edits.title } : {}),
              ...(edits.description !== undefined ? { description: edits.description } : {}),
            };
          }
          return updateNodeMutation.mutateAsync({
            nodeId,
            ...updates,
          } as Parameters<typeof updateNodeMutation.mutateAsync>[0]);
        }),
      );
      activeEntries.forEach(([nodeId]) => clearNodeEdits(nodeId));
      toast.success(t(($) => $.detail.toast_saved));
      return true;
    } catch {
      toast.error(t(($) => $.detail.toast_save_failed));
      return false;
    }
  }, [apiNodesById, updateNodeMutation, clearNodeEdits, t]);

  const handleTestRun = useCallback(async () => {
    const saved = await handleSave();
    if (!saved) return;
    setShowRuntimeDialog(true);
  }, [handleSave]);

  const startTestRun = useCallback(async ({ policy, runtimeId }: WorkflowRuntimeStrategyValue) => {
    setShowRuntimeDialog(false);
    try {
      const run = await startWorkflowRunMutation.mutateAsync({
        workflowId,
        runtimeSelectionPolicy: policy,
        ...(runtimeId ? { runtimeId } : {}),
      });
      toast.success(t(($) => $.detail.toast_run_started));
      navigation.push(wsPaths.workflowRunDetail(workflowId, run.id));
    } catch {
      toast.error(t(($) => $.detail.toast_run_failed));
    }
  }, [startWorkflowRunMutation, workflowId, navigation, wsPaths, t]);

  const saveDefaultRuntimeStrategy = useCallback(async ({
    policy,
    runtimeId,
  }: WorkflowRuntimeStrategyValue) => {
    try {
      await updateWorkflowMutation.mutateAsync({
        id: workflowId,
        default_runtime_selection_policy: policy,
        default_runtime_id: runtimeId,
      });
      setShowRuntimeSettingsDialog(false);
      toast.success(t(($) => $.runtime_strategy.toast_default_saved));
    } catch {
      toast.error(t(($) => $.runtime_strategy.toast_default_failed));
    }
  }, [updateWorkflowMutation, workflowId, t]);

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
    } catch (error) {
      toast.error(
        getDeleteConflictMessage(error, {
          template_has_derived_workflows: t(($) => $.detail.template_has_derived_workflows),
        }) ?? t(($) => $.detail.toast_delete_failed),
      );
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
        splitChildWorkflows={splitChildWorkflowContexts}
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
        connectedNodePickerSourceId={connectedNodePickerSourceId}
        onConnectedTemplateSelect={handleConnectedTemplateSelect}
        onEdgeDelete={handleEdgeDelete}
        onNodeDelete={handleNodeDelete}
        onStageChange={handleStageChange}
        onStageDelete={handleStageDelete}
        onStageReorder={handleStageReorder}
        onViewportChange={handleViewportChange}
        onOpenStageDialog={handleOpenStageDialog}
        onCloseStageDialog={handleCloseStageDialog}
        onCloseConfigPanel={() => {
          void requestCloseConfigPanel();
        }}
        onConfigPanelDirtyChange={setConfigPanelDirty}
        onRegisterConfigPanelSave={(save) => {
          configPanelSaveRef.current = save;
        }}
        onBackToWorkflows={() => navigation.push(wsPaths.workflows())}
        onToggleWorkflowStatus={handleToggleWorkflowStatus}
        onUpdateTitle={handleUpdateTitle}
        onDeleteWorkflow={handleDeleteWorkflow}
        onSave={handleSave}
        onTestRun={handleTestRun}
        onOpenRunHistory={() => navigation.push(wsPaths.workflowRuns(workflowId))}
        onOpenRunSettings={() => setShowRuntimeSettingsDialog(true)}
        disabledBoundaryTemplateIds={disabledBoundaryTemplateIds}
      />
      {showRuntimeDialog && (
        <WorkflowRuntimeStrategyDialog
          mode="run"
          workflowTitle={workflow.title}
          initialValue={{
            policy: workflow.default_runtime_selection_policy,
            runtimeId: workflow.default_runtime_id,
          }}
          runtimes={usableWorkflowRuntimes.runtimes}
          loading={runtimesLoading || usableWorkflowRuntimes.isLoading}
          directRun
          onConfirm={startTestRun}
          onClose={() => setShowRuntimeDialog(false)}
        />
      )}
      {showRuntimeSettingsDialog && (
        <WorkflowRuntimeStrategyDialog
          mode="default"
          workflowTitle={workflow.title}
          initialValue={{
            policy: workflow.default_runtime_selection_policy,
            runtimeId: workflow.default_runtime_id,
          }}
          runtimes={usableWorkflowRuntimes.runtimes}
          loading={runtimesLoading || usableWorkflowRuntimes.isLoading}
          saving={updateWorkflowMutation.isPending}
          onConfirm={saveDefaultRuntimeStrategy}
          onClose={() => setShowRuntimeSettingsDialog(false)}
        />
      )}
      <AlertDialog open={configPanelCloseDialogOpen} onOpenChange={(open) => {
        if (!open) handleCancelCloseConfigPanel();
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.detail_panel.close_confirm_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.detail_panel.close_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={configPanelCloseSaving}>
              {t(($) => $.overview.stage_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={configPanelCloseSaving}
              onClick={(event) => {
                event.preventDefault();
                void handleDiscardAndCloseConfigPanel();
              }}
            >
              {t(($) => $.detail_panel.discard_changes)}
            </AlertDialogAction>
            <AlertDialogAction
              disabled={configPanelCloseSaving}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmSaveAndCloseConfigPanel();
              }}
            >
              {t(($) => $.detail_panel.save_changes)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ReactFlowProvider>
  );
}

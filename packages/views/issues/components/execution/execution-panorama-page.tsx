"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
  workflowRolesOptions,
  workflowRoleResolutionsOptions,
  workflowKeys,
} from "@multica/core/workflows/queries";
import { api } from "@multica/core/api";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { workerTypeToActorType } from "@multica/core/types";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowRole,
  WorkflowStage,
  Agent,
} from "@multica/core/types";
import { useT } from "../../../i18n";
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
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
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
  const { data: workflowRoles = [] } = useQuery(workflowRolesOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: roleResolutions = [] } = useQuery({
    ...workflowRoleResolutionsOptions(wsId, workflowId, runId ?? ""),
    enabled: !!runId,
  });
  const { t: tWf } = useT("workflows");

  // ---- Local state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 24, zoom: 0.95 });
  const [retryingNodeRunId, setRetryingNodeRunId] = useState<string | null>(null);

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

  const roleById = useMemo(
    () => new Map(workflowRoles.map((role) => [role.id, role])),
    [workflowRoles],
  );

  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name])),
    [members],
  );

  // Resolved user per node-run + slot, so role-based worker/critic names can
  // surface the actual member once role resolution completes. Falls back to
  // the role name when no resolution exists yet (manual assignment pending or
  // auto-resolution disabled).
  const resolvedUserNameByNodeRunSlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const resolution of roleResolutions) {
      if (resolution.status !== "resolved" || !resolution.resolved_user_id) continue;
      const memberName = memberNameById.get(resolution.resolved_user_id);
      if (!memberName) continue;
      map.set(`${resolution.workflow_node_run_id}:${resolution.slot_type}`, memberName);
    }
    return map;
  }, [roleResolutions, memberNameById]);

  const getActorName = useCallback((type: string, id: string): string | null => {
    if (type === "agent" || type === "human" || type === "member") {
      return agentLookup.get(id)?.name ?? null;
    }
    return null;
  }, [agentLookup]);

  // Built-in role names are seeded in English (developer/qa/tech_lead); render
  // localized labels so the canvas matches the rest of the UI. Custom roles
  // fall through to their raw name.
  const renderRoleName = useCallback(
    (role: WorkflowRole | undefined, rawKey?: string | null): string | undefined => {
      if (role) {
        if (!role.is_builtin) return role.name;
        if (role.name === "developer") return tWf(($) => $.builtin_roles.developer.name);
        if (role.name === "qa") return tWf(($) => $.builtin_roles.qa.name);
        if (role.name === "tech_lead") return tWf(($) => $.builtin_roles.tech_lead.name);
        return role.name;
      }
      if (rawKey) {
        if (rawKey === "developer") return tWf(($) => $.builtin_roles.developer.name);
        if (rawKey === "qa") return tWf(($) => $.builtin_roles.qa.name);
        if (rawKey === "tech_lead") return tWf(($) => $.builtin_roles.tech_lead.name);
        return rawKey;
      }
      return undefined;
    },
    [tWf],
  );

  // Precedence for runtime display: explicit agent/member → resolved user from
  // role resolution → role name (localized for built-ins). Returns null when
  // nothing applies so callers can render their placeholder.
  const resolveWorkerName = useCallback(
    (node: WorkflowNode): string | null => {
      if (node.worker_id) {
        return getActorName(workerTypeToActorType(node.worker_type), node.worker_id);
      }
      if (node.worker_role_id || node.worker_role) {
        const nodeRun = nodeRunMap.get(node.id);
        if (nodeRun) {
          const resolved = resolvedUserNameByNodeRunSlot.get(`${nodeRun.id}:worker`);
          if (resolved) return resolved;
        }
        const rendered = renderRoleName(
          node.worker_role_id ? roleById.get(node.worker_role_id) : undefined,
          node.worker_role_id ?? node.worker_role,
        );
        return rendered ?? null;
      }
      return null;
    },
    [getActorName, nodeRunMap, renderRoleName, resolvedUserNameByNodeRunSlot, roleById],
  );

  const resolveCriticName = useCallback(
    (node: WorkflowNode): string | null => {
      if (node.critic_id) {
        return getActorName(node.critic_type ?? "agent", node.critic_id);
      }
      if (node.critic_role_id || node.critic_role) {
        const nodeRun = nodeRunMap.get(node.id);
        if (nodeRun) {
          const resolved = resolvedUserNameByNodeRunSlot.get(`${nodeRun.id}:critic`);
          if (resolved) return resolved;
        }
        const rendered = renderRoleName(
          node.critic_role_id ? roleById.get(node.critic_role_id) : undefined,
          node.critic_role_id ?? node.critic_role,
        );
        return rendered ?? null;
      }
      return null;
    },
    [getActorName, nodeRunMap, renderRoleName, resolvedUserNameByNodeRunSlot, roleById],
  );

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
  const selectedRuntimeSummary = selectedNodeId
    ? runtimeSummaryMap.get(selectedNodeId) ?? null
    : null;
  const isRetryableSelectedRun =
    selectedRun?.status === "failed" ||
    selectedRun?.status === "format_failed" ||
    selectedRun?.status === "blocked" ||
    selectedRun?.status === "critic_rework";

  const rfNodes = workflowNodesToReactFlowNodes({
    nodes: allNodes,
    stages: sortStagesForDisplay(allStages),
    nodeType: "runtimeNode",
    nodeHeight: RUNTIME_NODE_HEIGHT,
    includeCriticBadges: false,
    makeNodeData: (node) => ({
      node,
      nodeRun: nodeRunMap.get(node.id) ?? null,
      runtimeSummary: runtimeSummaryMap.get(node.id) ?? null,
      workerName: resolveWorkerName(node),
      criticName: resolveCriticName(node),
      onOpen: setSelectedNodeId,
    }),
    makeCriticName: (node) => resolveCriticName(node) ?? undefined,
  });
  const rfEdges = workflowEdgesToReactFlowEdges({
    edges: edges ?? [],
    nodes: allNodes,
    stages: sortStagesForDisplay(allStages),
    includeCriticEdges: false,
  });

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
          fillAvailableHeight={fillAvailableHeight}
        />
      </ReactFlowProvider>

      {/* Detail panel */}
      {selectedNodeId && selectedNode && (
        <ExecutionDetailPanel
          node={selectedNode}
          nodeRun={selectedRun}
          workerName={resolveWorkerName(selectedNode)}
          criticName={resolveCriticName(selectedNode)}
          onClose={() => setSelectedNodeId(null)}
          wsId={wsId}
          runtimeSummary={selectedRuntimeSummary}
          onRetry={
            issueId && selectedRun && isRetryableSelectedRun && retryingNodeRunId !== selectedRun.id
              ? () => void handleRetryNodeRun(selectedRun)
              : undefined
          }
        />
      )}
    </div>
  );
}

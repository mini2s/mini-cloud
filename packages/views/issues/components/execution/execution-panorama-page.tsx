"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  workflowDetailOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowNodeRunsOptions,
} from "@multica/core/workflows/queries";
import { buildCanvasModel } from "@multica/core/workflows/canvas";
import { agentListOptions } from "@multica/core/workspace/queries";
import { workerTypeToActorType } from "@multica/core/types";
import type {
  Agent,
  WorkflowNodeRun,
} from "@multica/core/types";
import { StageLaneSurface, WorkflowCanvasShell } from "../../../workflows/canvas";
import { ExecutionDetailPanel } from "./execution-detail-panel";
import { Loader2 } from "lucide-react";

export interface ExecutionPanoramaPageProps {
  workflowId: string;
  runId: string | null;
  wsId: string;
}

/**
 * Main issue-execution panorama view.
 *
 * Composes the shared workflow canvas runtime surface with the issue execution
 * detail panel so Issue panorama and Workflow editor share one canvas model.
 */
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
  const { data: nodeRuns } = useQuery({
    ...workflowNodeRunsOptions(wsId, workflowId, runId ?? ""),
    enabled: !!runId,
  });
  const { data: edges } = useQuery({
    ...workflowEdgesOptions(wsId, workflowId),
  });
  const { data: agents } = useQuery(agentListOptions(wsId));

  // ---- Local state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ---- Lookup maps ----
  const nodeRunMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeRun>();
    if (nodeRuns) {
      for (const nr of nodeRuns) {
        map.set(nr.workflow_node_id, nr);
      }
    }
    return map;
  }, [nodeRuns]);

  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    if (agents) {
      for (const a of agents) map.set(a.id, a);
    }
    return map;
  }, [agents]);

  const getActorName = (type: string, id: string): string | null => {
    if (type === "agent" || type === "human" || type === "member") {
      return agentLookup.get(id)?.name ?? null;
    }
    return null;
  };

  // ---- Derived ----
  const isLoading = wfLoading || stLoading || ndLoading;
  const allStages = stages ?? [];
  const allNodes = nodes ?? [];
  const allEdges = edges ?? [];
  const allNodeRuns = nodeRuns ?? [];
  const canvasModel = useMemo(
    () =>
      buildCanvasModel({
        stages: allStages,
        nodes: allNodes,
        edges: allEdges,
        nodeRuns: allNodeRuns,
      }),
    [allStages, allNodes, allEdges, allNodeRuns],
  );

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

  const selectedNode = allNodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedRun = selectedNodeId
    ? nodeRunMap.get(selectedNodeId) ?? null
    : null;

  return (
    <div
      className="relative flex flex-col min-h-0"
      data-testid="execution-panorama"
    >
      <div
        className="relative flex min-h-0 flex-1"
        data-testid="panorama-canvas"
      >
        <WorkflowCanvasShell mode="readonly-runtime" model={canvasModel}>
          {({ model }) => (
            <StageLaneSurface
              model={model}
              variant="runtime"
              selectedNodeId={selectedNodeId}
              onNodeSelect={(id) => setSelectedNodeId((prev) => (prev === id ? null : id))}
            />
          )}
        </WorkflowCanvasShell>
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

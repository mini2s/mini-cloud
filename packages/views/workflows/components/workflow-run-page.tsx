"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowRunOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
  workflowNodeRunsOptions,
  useCancelWorkflowRun,
} from "@multica/core/workflows/queries";
import { PageHeader } from "../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { useT } from "../../i18n";
import { DAGCanvas } from "./dag-canvas";
import { ReactFlowProvider } from "@xyflow/react";
import { NodeRunCard } from "./node-run-card";
import { parseNodeFormat, type WorkflowRunStatus, type NodeRunStatus } from "@multica/core/types";
import { SplitReviewPanel } from "./split/split-review-panel";

const RUNNING_STATES = new Set<NodeRunStatus>(["format_checking", "working", "critic_reviewing", "splitting", "split_active"]);

const STATUS_COLOR: Record<NodeRunStatus, string> = {
  pending: "rgba(107,114,128,0.2)",
  format_checking: "rgba(245,158,11,0.3)",
  format_ok: "rgba(34,197,94,0.25)",
  format_failed: "rgba(239,68,68,0.3)",
  worker_assigned: "rgba(245,158,11,0.25)",
  working: "rgba(59,130,246,0.3)",
  awaiting_input: "rgba(6,182,212,0.3)",
  awaiting_critic: "rgba(168,85,247,0.25)",
  critic_reviewing: "rgba(168,85,247,0.3)",
  critic_approved: "rgba(34,197,94,0.25)",
  critic_rework: "rgba(249,115,22,0.25)",
  splitting: "rgba(59,130,246,0.3)",
  awaiting_split_review: "rgba(245,158,11,0.3)",
  split_active: "rgba(59,130,246,0.3)",
  completed: "rgba(34,197,94,0.3)",
  failed: "rgba(239,68,68,0.3)",
  blocked: "rgba(239,68,68,0.3)",
  skipped: "rgba(107,114,128,0.2)",
  cancelled: "rgba(107,114,128,0.2)",
};

interface WorkflowRunPageProps {
  workflowId: string;
  runId: string;
}

type WorkflowTranslator = ReturnType<typeof useT<"workflows">>["t"];

function formatWorkflowRunStatus(t: WorkflowTranslator, status: WorkflowRunStatus): string {
  switch (status) {
    case "running":
      return t(($) => $.run.status.running);
    case "completed":
      return t(($) => $.run.status.completed);
    case "failed":
      return t(($) => $.run.status.failed);
    case "cancelled":
      return t(($) => $.run.status.cancelled);
    default:
      return status;
  }
}

function formatNodeRunStatus(t: WorkflowTranslator, status: NodeRunStatus): string {
  switch (status) {
    case "pending":
      return t(($) => $.node_run.status.pending);
    case "format_checking":
      return t(($) => $.node_run.status.format_checking);
    case "format_ok":
      return t(($) => $.node_run.status.format_ok);
    case "format_failed":
      return t(($) => $.node_run.status.format_failed);
    case "worker_assigned":
      return t(($) => $.node_run.status.worker_assigned);
    case "working":
      return t(($) => $.node_run.status.working);
    case "awaiting_input":
      return t(($) => $.node_run.status.awaiting_input);
    case "awaiting_critic":
      return t(($) => $.node_run.status.awaiting_critic);
    case "critic_reviewing":
      return t(($) => $.node_run.status.critic_reviewing);
    case "critic_approved":
      return t(($) => $.node_run.status.critic_approved);
    case "critic_rework":
      return t(($) => $.node_run.status.critic_rework);
    case "splitting":
      return t(($) => $.node_run.status.splitting);
    case "awaiting_split_review":
      return t(($) => $.node_run.status.awaiting_split_review);
    case "split_active":
      return t(($) => $.node_run.status.split_active);
    case "completed":
      return t(($) => $.node_run.status.completed);
    case "failed":
      return t(($) => $.node_run.status.failed);
    case "blocked":
      return t(($) => $.node_run.status.blocked);
    case "skipped":
      return t(($) => $.node_run.status.skipped);
    case "cancelled":
      return t(($) => $.node_run.status.cancelled);
    default:
      return status;
  }
}

export function WorkflowRunPage({ workflowId, runId }: WorkflowRunPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const [selectedSplitNodeId, setSelectedSplitNodeId] = useState<string | null>(null);

  const { data: run, isLoading: runLoading } = useQuery(workflowRunOptions(wsId, workflowId, runId));
  const { data: nodes = [], isLoading: nodesLoading } = useQuery(workflowNodesOptions(wsId, workflowId));
  const { data: edges = [] } = useQuery(workflowEdgesOptions(wsId, workflowId));
  const { data: nodeRuns = [], isLoading: nodeRunsLoading } = useQuery(workflowNodeRunsOptions(wsId, workflowId, runId));

  const cancelMutation = useCancelWorkflowRun(wsId);

  const isLoading = runLoading || nodesLoading || nodeRunsLoading;

  const nodeRunByNodeId = new Map(nodeRuns.map((nr) => [nr.workflow_node_id, nr]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const nodeStatusColors: Record<string, string> = {};
  const nodeStatuses: Record<string, { status: string; isRunning: boolean; isAwaitingInput: boolean }> = {};
  for (const node of nodes) {
    const nr = nodeRunByNodeId.get(node.id);
    if (nr) {
      const s = nr.status as NodeRunStatus;
      nodeStatusColors[node.id] = STATUS_COLOR[s] ?? "fill-muted stroke-muted";
      nodeStatuses[node.id] = {
        status: formatNodeRunStatus(t, s),
        isRunning: RUNNING_STATES.has(s),
        isAwaitingInput: s === "awaiting_input",
      };
    }
  }

  const splitNodeIds = new Set(
    nodes
      .filter((node) => parseNodeFormat(node.format_schema).kind === "split")
      .map((node) => node.id),
  );
  const selectedSplitNode = selectedSplitNodeId ? nodeById.get(selectedSplitNodeId) ?? null : null;
  const selectedSplitNodeRun = selectedSplitNodeId ? nodeRunByNodeId.get(selectedSplitNodeId) ?? null : null;

  const handleNodeClick = (nodeId: string) => {
    if (splitNodeIds.has(nodeId)) {
      setSelectedSplitNodeId(nodeId);
    }
  };

  const handleCancel = () => {
    cancelMutation.mutate({ workflowId, runId });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-[400px] w-[600px]" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t(($) => $.detail.not_found)}</p>
      </div>
    );
  }

  const canCancel = run.status === "running";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium truncate">{run.workflow_title}</h1>
          <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
            {formatWorkflowRunStatus(t, run.status as WorkflowRunStatus)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? t(($) => $.run.cancelling) : t(($) => $.run.cancel)}
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Content: DAG + Node Run list */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 bg-muted/20">
          {nodes.length > 0 ? (
            <ReactFlowProvider>
              <DAGCanvas
                nodes={nodes}
                edges={edges}
                nodeStatusColors={nodeStatusColors}
                nodeStatuses={nodeStatuses}
                onNodeClick={handleNodeClick}
              />
            </ReactFlowProvider>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">{t(($) => $.detail.no_nodes)}</p>
            </div>
          )}
        </div>
        <div className="w-80 shrink-0 border-l bg-card overflow-y-auto p-3 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Node Runs
          </h3>
          {nodeRuns.map((nr) => (
            <NodeRunCard
              key={nr.id}
              nodeRun={nr}
              maxRetries={3}
              workflowId={workflowId}
              runId={runId}
              isSplitNode={splitNodeIds.has(nr.workflow_node_id)}
              onOpenSplit={() => setSelectedSplitNodeId(nr.workflow_node_id)}
            />
          ))}
        </div>
      </div>
      {selectedSplitNode ? (
        <SplitReviewPanel
          node={selectedSplitNode}
          nodeRun={selectedSplitNodeRun}
          wsId={wsId}
          workflowId={workflowId}
          runId={runId}
          onClose={() => setSelectedSplitNodeId(null)}
        />
      ) : null}
    </div>
  );
}

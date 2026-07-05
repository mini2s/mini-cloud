import { parseNodeShape } from "../../types";
import type { WorkflowNode } from "../../types";
import {
  UNASSIGNED_STAGE_ID,
  type BuildCanvasModelInput,
  type CanvasEdge,
  type CanvasModel,
  type CanvasNode,
  type CanvasStage,
  type RuntimeNodeOverlay,
} from "./types";

function sortByOrderThenName<T extends { sortOrder: number; name?: string; title?: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    return (a.name ?? a.title ?? a.id).localeCompare(b.name ?? b.title ?? b.id);
  });
}

function mergeNodeDraft(node: WorkflowNode, edit: Partial<WorkflowNode> | undefined): WorkflowNode {
  if (!edit) return node;
  return {
    ...node,
    ...edit,
    id: node.id,
    workflow_id: node.workflow_id,
    created_at: node.created_at,
    updated_at: edit.updated_at ?? node.updated_at,
  };
}

function toRuntimeOverlay(run: NonNullable<BuildCanvasModelInput["nodeRuns"]>[number]): RuntimeNodeOverlay {
  return {
    nodeRunId: run.id,
    workflowRunId: run.workflow_run_id,
    status: run.status,
    retryCount: run.retry_count,
    workerOutput: run.worker_output,
    criticOutput: run.critic_output,
    criticComment: run.critic_comment,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    sessionId: run.session_id,
    runtimeId: run.runtime_id,
    deviceId: run.device_id,
  };
}

export function buildCanvasModel(input: BuildCanvasModelInput): CanvasModel {
  const deleted = new Set(input.draft?.deletedNodeIds ?? []);
  const runtimeByNodeId = new Map((input.nodeRuns ?? []).map((run) => [run.workflow_node_id, toRuntimeOverlay(run)]));

  const stages: CanvasStage[] = sortByOrderThenName(
    input.stages.map((stage) => ({
      id: stage.id,
      workflowId: stage.workflow_id,
      name: stage.name,
      description: stage.description,
      sortOrder: stage.sort_order,
      nodeCount: stage.node_count,
      source: stage,
      isVirtual: false,
    })),
  );

  const nodes: CanvasNode[] = sortByOrderThenName(
    input.nodes
      .filter((node) => !deleted.has(node.id))
      .map((node) => mergeNodeDraft(node, input.draft?.nodeEdits[node.id]))
      .map((node) => ({
        id: node.id,
        workflowId: node.workflow_id,
        title: node.title,
        description: node.description,
        position: { x: node.position_x, y: node.position_y },
        sortOrder: node.sort_order,
        stageId: node.stage_id,
        shape: parseNodeShape(node.format_schema),
        formatSchema: node.format_schema,
        workerType: node.worker_type,
        workerId: node.worker_id,
        criticType: node.critic_type,
        criticId: node.critic_id,
        criticApiUrl: node.critic_api_url,
        source: node,
        runtime: runtimeByNodeId.get(node.id) ?? null,
      })),
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = input.edges
    .filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id))
    .map((edge) => ({
      id: edge.id,
      workflowId: edge.workflow_id,
      sourceNodeId: edge.source_node_id,
      targetNodeId: edge.target_node_id,
      condition: edge.condition,
      source: edge,
    }));

  const unassignedCount = nodes.filter((node) => node.stageId === null).length;
  stages.push({
    id: UNASSIGNED_STAGE_ID,
    workflowId: input.nodes[0]?.workflow_id ?? input.stages[0]?.workflow_id ?? "",
    name: "Unassigned",
    description: "",
    sortOrder: Number.MAX_SAFE_INTEGER,
    nodeCount: unassignedCount,
    source: null,
    isVirtual: true,
  });

  return {
    stages,
    nodes,
    edges,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
    edgesById: new Map(edges.map((edge) => [edge.id, edge])),
  };
}

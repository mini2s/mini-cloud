import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { WorkflowEdge, WorkflowNode, WorkflowStage } from "@multica/core/types";
import {
  CRITIC_HEIGHT,
  CRITIC_WIDTH,
  UNASSIGNED_LANE_Y,
  WORKER_CRITIC_GAP,
  WORKER_HEIGHT,
  WORKER_WIDTH,
  computeLaneY,
  createStageVisualIndexMap,
  getStageColor,
} from "../overview/constants";

export interface WorkflowCanvasNodeContext {
  stage: WorkflowStage | undefined;
  stage_id: string | null;
  stageColorIndex: number;
  laneY: number;
}

export interface WorkflowCanvasNodeModelOptions {
  nodes: WorkflowNode[];
  stages: WorkflowStage[];
  nodeType: string;
  nodeWidth?: number;
  nodeHeight?: number;
  includeCriticBadges?: boolean;
  makeNodeData: (node: WorkflowNode, context: WorkflowCanvasNodeContext) => Record<string, unknown>;
  makeCriticName?: (node: WorkflowNode) => string | undefined;
}

export interface WorkflowCanvasEdgeModelOptions {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  stages: WorkflowStage[];
  includeCriticEdges?: boolean;
  onDeleteEdge?: (edgeId: string) => void;
  selectedEdgeId?: string | null;
  selectedEdgeAnchor?: { x: number; y: number } | null;
}

type CanvasEdgeKind = "data" | "condition" | "error" | "rework" | "critic";
type CanvasEdgeTone = "data" | "condition" | "error" | "rework" | "critic" | "success" | "running" | "blocked" | "waiting";

export const MIN_NODE_HORIZONTAL_GAP = 96;

function normalizedNodeXMap(
  nodes: WorkflowNode[],
  nodeWidth: number,
): Map<string, number> {
  const nodesByStage = new Map<string | null, WorkflowNode[]>();

  for (const node of nodes) {
    const stageId = node.stage_id ?? null;
    const stageNodes = nodesByStage.get(stageId) ?? [];
    stageNodes.push(node);
    nodesByStage.set(stageId, stageNodes);
  }

  const positions = new Map<string, number>();
  for (const stageNodes of nodesByStage.values()) {
    const sortedNodes = [...stageNodes].sort((a, b) => {
      const xDifference = (a.position_x ?? 100) - (b.position_x ?? 100);
      if (xDifference !== 0) return xDifference;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id.localeCompare(b.id);
    });

    let previousX: number | null = null;
    for (const node of sortedNodes) {
      const storedX = node.position_x ?? 100;
      const x: number = previousX === null
        ? storedX
        : Math.max(storedX, previousX + nodeWidth + MIN_NODE_HORIZONTAL_GAP);
      positions.set(node.id, x);
      previousX = x;
    }
  }

  return positions;
}

export function workflowNodesToReactFlowNodes({
  nodes,
  stages,
  nodeType,
  nodeWidth = WORKER_WIDTH,
  nodeHeight = WORKER_HEIGHT,
  includeCriticBadges = false,
  makeNodeData,
  makeCriticName,
}: WorkflowCanvasNodeModelOptions): Node[] {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const stageVisualIndexMap = createStageVisualIndexMap(stages);
  const normalizedX = normalizedNodeXMap(nodes, nodeWidth);

  return nodes.flatMap((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const visualIndex = stage ? stageVisualIndexMap.get(stage.id) ?? stages.length : stages.length;
    const laneY = stage ? computeLaneY(visualIndex) : UNASSIGNED_LANE_Y(stages.length);
    const stageColorIndex = visualIndex;
    const x = normalizedX.get(node.id) ?? node.position_x ?? 100;
    const context: WorkflowCanvasNodeContext = {
      stage,
      stage_id: node.stage_id,
      stageColorIndex,
      laneY,
    };

    const workerNode: Node = {
      id: node.id,
      type: nodeType,
      position: { x, y: laneY },
      width: nodeWidth,
      height: nodeHeight,
      data: makeNodeData(node, context),
    };

    if (!includeCriticBadges || (!node.critic_id && !node.critic_api_url && !node.critic_role_id && !node.critic_role)) return [workerNode];

    const criticNode: Node = {
      id: `${node.id}:critic`,
      type: "criticBadge",
      position: {
        x: x + (WORKER_WIDTH - CRITIC_WIDTH) / 2,
        y: laneY + WORKER_HEIGHT + WORKER_CRITIC_GAP,
      },
      width: CRITIC_WIDTH,
      height: CRITIC_HEIGHT,
      data: {
        node,
        parentNodeId: node.id,
        criticName: makeCriticName?.(node),
      },
    };

    return [workerNode, criticNode];
  });
}

export function workflowEdgesToReactFlowEdges({
  edges,
  nodes,
  stages,
  includeCriticEdges = false,
  onDeleteEdge,
  selectedEdgeId,
  selectedEdgeAnchor,
}: WorkflowCanvasEdgeModelOptions): Edge[] {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const stageVisualIndexMap = createStageVisualIndexMap(stages);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const normalizedX = normalizedNodeXMap(nodes, WORKER_WIDTH);
  const positionMap = new Map(nodes.map((node) => {
    const stage = node.stage_id ? stageMap.get(node.stage_id) : undefined;
    const visualIndex = stage ? stageVisualIndexMap.get(stage.id) ?? stages.length : stages.length;
    return [node.id, {
      x: normalizedX.get(node.id) ?? node.position_x ?? 100,
      y: stage ? computeLaneY(visualIndex) : UNASSIGNED_LANE_Y(stages.length),
    }];
  }));

  const workflowEdges = edges.map((edge) => ({
    ...(() => {
      const edgeSemantics = deriveEdgeSemantics(edge.condition);
      const markerColor = getEdgeMarkerColor(
        edge.source_node_id,
        nodeMap,
        stageMap,
        stageVisualIndexMap,
        edgeSemantics.edgeTone,
      );
      return {
        data: {
          stageColorIndex: getEdgeStageColorIndex(edge.source_node_id, nodeMap, stageMap, stageVisualIndexMap),
          sameStage: isSameStageEdge(edge.source_node_id, edge.target_node_id, nodeMap),
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
    style: edge.target_node_id.endsWith(":critic") || edges.some((item) =>
      item.source_node_id === edge.target_node_id && item.target_node_id.endsWith(":critic")
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

  const criticEdges: Edge[] = includeCriticEdges ? nodes
    .filter((node) => node.critic_id || node.critic_api_url || node.critic_role_id || node.critic_role)
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
    })) : [];

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
  if (edgeTone === "success") return "rgb(16 185 129)";
  if (edgeTone === "running") return "rgb(59 130 246)";
  if (edgeTone === "blocked") return "rgb(239 68 68)";
  if (edgeTone === "waiting") return "rgb(100 116 139)";
  return getStageColor(getEdgeStageColorIndex(sourceNodeId, nodeMap, stageMap, stageVisualIndexMap)).markerColor;
}

function isSameStageEdge(
  sourceNodeId: string,
  targetNodeId: string,
  nodeMap: Map<string, WorkflowNode>,
): boolean {
  const sourceNode = nodeMap.get(sourceNodeId);
  const targetNode = nodeMap.get(targetNodeId);
  return !!sourceNode && !!targetNode && sourceNode.stage_id === targetNode.stage_id;
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
    const hasExplicitSemantics = "kind" in obj || "severity" in obj;
    if (!hasExplicitSemantics) {
      return {
        edgeKind: "data",
        edgeTone: "data",
      };
    }
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

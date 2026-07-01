import dagre from "@dagrejs/dagre";
import type { WorkflowNode, WorkflowEdge } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import { WORKER_WIDTH } from "./overview/constants";

const LANE_START_X = 120;
const LANE_SLOT_GAP = 96;
const LANE_SLOT_STEP = WORKER_WIDTH + LANE_SLOT_GAP;

const SHAPE_DEFAULTS = {
  rectangle: { width: 150, height: 70 },
  pill: { width: 150, height: 70 },
  diamond: { width: 180, height: 180 },
  hexagon: { width: 200, height: 200 },
} as const;

interface LayoutResult {
  nodeId: string;
  x: number;
  y: number;
}

function getNodeDimensions(formatSchema: unknown): { width: number; height: number } {
  const shape = parseNodeShape(formatSchema);
  const shapeDefaults = SHAPE_DEFAULTS[shape];

  let width: number = shapeDefaults?.width ?? SHAPE_DEFAULTS.rectangle.width;
  let height: number = shapeDefaults?.height ?? SHAPE_DEFAULTS.rectangle.height;

  if (formatSchema && typeof formatSchema === "object" && formatSchema !== null) {
    const obj = formatSchema as Record<string, unknown>;
    if (typeof obj.width === "number" && obj.width > 0) width = obj.width;
    if (typeof obj.height === "number" && obj.height > 0) height = obj.height;
  }

  return { width, height };
}

export function computeAutoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): LayoutResult[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 150, marginx: 100, marginy: 100 });

  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node.format_schema);
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source_node_id, edge.target_node_id);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const dagreNode = g.node(n.id);
    const { width, height } = getNodeDimensions(n.format_schema);
    return {
      nodeId: n.id,
      x: dagreNode.x - width / 2,
      y: dagreNode.y - height / 2,
    };
  });
}

/**
 * Compute lane-internal auto-layout using dagre.
 * Groups nodes by stage_id, runs dagre on each group separately (LR direction),
 * and returns a map of nodeId → new position_x.
 * Nodes within each lane are distributed horizontally with uniform spacing.
 * Y positions are NOT computed — they come from stage sort_order at runtime.
 */
export function computeLaneAutoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Map<string, number> {
  const result = new Map<string, number>();

  // Group nodes by stage_id
  const byStage = new Map<string | null, WorkflowNode[]>();
  for (const node of nodes) {
    const key = node.stage_id ?? null;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key)!.push(node);
  }

  for (const [, stageNodes] of byStage) {
    if (stageNodes.length === 0) continue;

    if (stageNodes.length === 1) {
      result.set(stageNodes[0]!.id, 120);
      continue;
    }

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 50, marginy: 20 });

    const nodeIds = new Set(stageNodes.map((n) => n.id));
    for (const node of stageNodes) {
      g.setNode(node.id, { width: WORKER_WIDTH, height: 64 });
    }

    for (const edge of edges) {
      if (nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id)) {
        g.setEdge(edge.source_node_id, edge.target_node_id);
      }
    }

    dagre.layout(g);

    const positioned: Array<{ nodeId: string; x: number }> = [];
    for (const node of stageNodes) {
      const dagreNode = g.node(node.id);
      if (dagreNode) {
        positioned.push({ nodeId: node.id, x: dagreNode.x - WORKER_WIDTH / 2 });
      } else {
        positioned.push({ nodeId: node.id, x: 120 });
      }
    }

    positioned.sort((a, b) => a.x - b.x);
    positioned.forEach((item, index) => {
      result.set(item.nodeId, LANE_START_X + index * LANE_SLOT_STEP);
    });
  }

  return result;
}

/**
 * Pick a stable x position when a node is moved into another stage from the
 * config panel. Without this, it keeps its old lane x and can render directly
 * on top of an existing node in the target lane.
 */
export function computeStageTransferPositionX(
  nodes: WorkflowNode[],
  nodeId: string,
  targetStageId: string | null,
): number {
  const occupied = new Set(
    nodes
      .filter((node) => node.id !== nodeId && (node.stage_id ?? null) === targetStageId)
      .map((node) => Math.round(node.position_x ?? LANE_START_X)),
  );

  let x = LANE_START_X;
  while (occupied.has(x)) {
    x += LANE_SLOT_STEP;
  }
  return x;
}

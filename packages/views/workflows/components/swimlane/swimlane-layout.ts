import dagre from "@dagrejs/dagre";
import type { WorkflowNode, WorkflowEdge, WorkflowStage } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";

// ── Constants ─────────────────────────────────────────────────

const SHAPE_DEFAULTS = {
  rectangle: { width: 150, height: 70 },
  pill: { width: 150, height: 70 },
  diamond: { width: 180, height: 180 },
  hexagon: { width: 200, height: 200 },
} as const;

export const LANE_HEADER_HEIGHT = 52;
export const LANE_PADDING = 16;
export const LANE_HEIGHT = 260;
export const LANE_GAP = 8;
export const LANE_SPACING = LANE_HEIGHT + LANE_GAP;

const STAGE_PALETTE = [
  { bg: "rgba(79,70,229,0.08)", border: "#4F46E5", text: "#4F46E5" },   // indigo
  { bg: "rgba(8,145,178,0.08)", border: "#0891B2", text: "#0891B2" },   // cyan
  { bg: "rgba(5,150,105,0.08)", border: "#059669", text: "#059669" },   // emerald
  { bg: "rgba(217,119,6,0.08)", border: "#D97706", text: "#D97706" },   // amber
  { bg: "rgba(220,38,38,0.08)", border: "#DC2626", text: "#DC2626" },   // red
  { bg: "rgba(124,58,237,0.08)", border: "#7C3AED", text: "#7C3AED" },  // violet
  { bg: "rgba(219,39,119,0.08)", border: "#DB2777", text: "#DB2777" },  // pink
  { bg: "rgba(37,99,235,0.08)", border: "#2563EB", text: "#2563EB" },   // blue
];

const UNASSIGNED_COLOR = {
  bg: "rgba(107,114,128,0.06)",
  border: "#6B7280",
  text: "#6B7280",
};

// ── Types ──────────────────────────────────────────────────────

export interface SwimlaneLane {
  stageId: string;
  stageName: string;
  sortOrder: number;
  y: number;
  height: number;
  color: { bg: string; border: string; text: string };
  isUnassigned: boolean;
}

export interface SwimlaneLayoutResult {
  nodePositions: Map<string, { x: number; y: number }>;
  lanes: SwimlaneLane[];
  canvasWidth: number;
  canvasHeight: number;
}

// ── Helpers ────────────────────────────────────────────────────

function getNodeDimensions(formatSchema: unknown): { width: number; height: number } {
  const shape = parseNodeShape(formatSchema);
  const defaults = SHAPE_DEFAULTS[shape] ?? SHAPE_DEFAULTS.rectangle;

  let width: number = defaults.width;
  let height: number = defaults.height;

  if (formatSchema && typeof formatSchema === "object" && formatSchema !== null) {
    const obj = formatSchema as Record<string, unknown>;
    if (typeof obj.width === "number" && obj.width > 0) width = obj.width;
    if (typeof obj.height === "number" && obj.height > 0) height = obj.height;
  }

  return { width, height };
}

function getStageColor(sortOrder: number) {
  return STAGE_PALETTE[sortOrder % STAGE_PALETTE.length];
}

// ── Main export ────────────────────────────────────────────────

export function computeSwimlaneLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  stages: WorkflowStage[],
): SwimlaneLayoutResult {
  const nodePositions = new Map<string, { x: number; y: number }>();
  const lanes: SwimlaneLane[] = [];
  const sortedStages = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  // Group nodes by stage
  const nodesByStage = new Map<string | null, WorkflowNode[]>();
  for (const node of nodes) {
    const key = node.stage_id ?? null;
    if (!nodesByStage.has(key)) nodesByStage.set(key, []);
    nodesByStage.get(key)!.push(node);
  }

  // Build set of assigned node ids for edge filtering
  const assignedNodeIds = new Set<string>();
  for (const s of sortedStages) {
    const stageNodes = nodesByStage.get(s.id) ?? [];
    for (const n of stageNodes) assignedNodeIds.add(n.id);
  }

  // Helper: run dagre on a subset of nodes
  const layoutSubgraph = (
    subNodes: WorkflowNode[],
    subEdges: WorkflowEdge[],
  ): Map<string, { x: number; y: number }> => {
    const positions = new Map<string, { x: number; y: number }>();
    if (subNodes.length === 0) return positions;

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 100, marginy: 20 });

    for (const node of subNodes) {
      const { width, height } = getNodeDimensions(node.format_schema);
      g.setNode(node.id, { width, height });
    }

    for (const edge of subEdges) {
      g.setEdge(edge.source_node_id, edge.target_node_id);
    }

    dagre.layout(g);

    for (const node of subNodes) {
      const dagreNode = g.node(node.id);
      if (dagreNode) {
        const { width, height } = getNodeDimensions(node.format_schema);
        positions.set(node.id, {
          x: dagreNode.x - width / 2,
          y: dagreNode.y - height / 2 + LANE_HEADER_HEIGHT + LANE_PADDING,
        });
      }
    }

    return positions;
  };

  let currentY = 0;

  // Layout each stage
  for (const stage of sortedStages) {
    const stageNodes = nodesByStage.get(stage.id) ?? [];
    const stageNodeIds = new Set(stageNodes.map((n) => n.id));
    const stageEdges = edges.filter(
      (e) => stageNodeIds.has(e.source_node_id) && stageNodeIds.has(e.target_node_id),
    );

    const color = getStageColor(stage.sort_order)!;
    lanes.push({
      stageId: stage.id,
      stageName: stage.name,
      sortOrder: stage.sort_order,
      y: currentY,
      height: LANE_HEIGHT,
      color,
      isUnassigned: false,
    });

    const positions = layoutSubgraph(stageNodes, stageEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y + currentY });
    }

    currentY += LANE_SPACING;
  }

  // Unassigned lane
  const unassignedNodes = nodesByStage.get(null) ?? [];
  if (unassignedNodes.length > 0) {
    const unassignedNodeIds = new Set(unassignedNodes.map((n) => n.id));
    const unassignedEdges = edges.filter(
      (e) => unassignedNodeIds.has(e.source_node_id) && unassignedNodeIds.has(e.target_node_id),
    );

    lanes.push({
      stageId: "unassigned",
      stageName: "Unassigned",
      sortOrder: sortedStages.length,
      y: currentY,
      height: LANE_HEIGHT,
      color: UNASSIGNED_COLOR,
      isUnassigned: true,
    });

    const positions = layoutSubgraph(unassignedNodes, unassignedEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y + currentY });
    }

    currentY += LANE_SPACING;
  }

  // If no stages and no unassigned, still create one lane for all nodes
  if (lanes.length === 0 && nodes.length > 0) {
    const allEdges = edges.filter((e) => {
      const src = nodes.find((n) => n.id === e.source_node_id);
      const tgt = nodes.find((n) => n.id === e.target_node_id);
      return src != null && tgt != null;
    });

    lanes.push({
      stageId: "default",
      stageName: "",
      sortOrder: 0,
      y: 0,
      height: LANE_HEIGHT,
      color: UNASSIGNED_COLOR,
      isUnassigned: true,
    });

    const positions = layoutSubgraph(nodes, allEdges);
    for (const [nodeId, pos] of positions) {
      nodePositions.set(nodeId, { x: pos.x, y: pos.y });
    }

    currentY = LANE_HEIGHT;
  }

  // Compute total canvas size
  let maxX = 0;
  for (const pos of nodePositions.values()) {
    maxX = Math.max(maxX, pos.x + 200); // 200px padding for node width
  }

  return {
    nodePositions,
    lanes,
    canvasWidth: Math.max(maxX, 800),
    canvasHeight: Math.max(currentY, 400),
  };
}

import type { CanvasNode, CanvasPoint, CanvasStage } from "./types";

export type CanvasHandle = "top" | "right" | "bottom" | "left";

export interface EdgeHandlePair {
  sourceHandle: CanvasHandle;
  targetHandle: CanvasHandle;
}

export interface LayoutInput {
  stages: CanvasStage[];
  nodes: CanvasNode[];
}

export interface NodeLayoutPosition {
  nodeId: string;
  x: number;
  y: number;
}

const STAGE_TOP = 120;
const STAGE_GAP_Y = 160;
const NODE_LEFT = 160;
const NODE_GAP_X = 200;

export function chooseEdgeHandles(source: CanvasPoint, target: CanvasPoint): EdgeHandlePair {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { sourceHandle: "right", targetHandle: "left" };
  }
  return { sourceHandle: "bottom", targetHandle: "top" };
}

export function layoutNodesByStage(input: LayoutInput): NodeLayoutPosition[] {
  const stages = [...input.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const stageIndex = new Map(stages.map((stage, index) => [stage.id, index]));

  const grouped = new Map<string | null, CanvasNode[]>();
  for (const node of input.nodes) {
    const key = node.stageId;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }

  const result: NodeLayoutPosition[] = [];
  for (const [stageId, nodes] of grouped) {
    const yIndex = stageId ? (stageIndex.get(stageId) ?? stages.length) : stages.length;
    const sortedNodes = [...nodes].sort((a, b) => {
      const byOrder = a.sortOrder - b.sortOrder;
      if (byOrder !== 0) return byOrder;
      return a.title.localeCompare(b.title);
    });
    sortedNodes.forEach((node, index) => {
      result.push({
        nodeId: node.id,
        x: NODE_LEFT + index * NODE_GAP_X,
        y: STAGE_TOP + yIndex * STAGE_GAP_Y,
      });
    });
  }

  return result.sort((a, b) => {
    const nodeA = input.nodes.find((node) => node.id === a.nodeId);
    const nodeB = input.nodes.find((node) => node.id === b.nodeId);
    const stageA = nodeA?.stageId ? (stageIndex.get(nodeA.stageId) ?? stages.length) : stages.length;
    const stageB = nodeB?.stageId ? (stageIndex.get(nodeB.stageId) ?? stages.length) : stages.length;
    if (stageA !== stageB) return stageA - stageB;
    return a.x - b.x;
  });
}

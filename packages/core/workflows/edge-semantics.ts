import type { WorkflowEdge, WorkflowNode } from "../types";

/** Unified edge semantic — determines visual rendering. */
export type EdgeSemantics = "data" | "control" | "error";

export interface EdgeVisualConfig {
  strokeDasharray: "none" | "6 3";
  strokeWidth: number;
  hasLabel: boolean;
  strokeColorToken: string;
  labelColorToken: string;
}

export const EDGE_VISUAL_CONFIGS: Record<EdgeSemantics, EdgeVisualConfig> = {
  data: {
    strokeDasharray: "none",
    strokeWidth: 2,
    hasLabel: false,
    strokeColorToken: "--workflow-info",
    labelColorToken: "--muted-foreground",
  },
  control: {
    strokeDasharray: "none",
    strokeWidth: 2,
    hasLabel: true,
    strokeColorToken: "--workflow-success",
    labelColorToken: "--workflow-success",
  },
  error: {
    strokeDasharray: "6 3",
    strokeWidth: 2,
    hasLabel: false,
    strokeColorToken: "--workflow-danger",
    labelColorToken: "--workflow-danger",
  },
};

/**
 * Infer edge semantics from edge condition and node stage membership.
 * - condition.error → "error"
 * - condition.path (true/false) → "control"
 * - cross-stage → "control"
 * - default → "data"
 */
export function inferEdgeSemantics(
  edge: WorkflowEdge,
  nodes: WorkflowNode[],
): EdgeSemantics {
  const condition = edge.condition as Record<string, unknown> | null;

  if (condition && typeof condition === "object") {
    if ("error" in condition) return "error";
    if ("path" in condition) return "control";
  }

  // Cross-stage edges default to control semantics
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const source = nodeMap.get(edge.source_node_id);
  const target = nodeMap.get(edge.target_node_id);
  if (source && target && source.stage_id !== target.stage_id) {
    return "control";
  }

  return "data";
}

/** Get the visual config for an edge given its semantics. */
export function getEdgeVisualConfig(semantics: EdgeSemantics): EdgeVisualConfig {
  return EDGE_VISUAL_CONFIGS[semantics];
}

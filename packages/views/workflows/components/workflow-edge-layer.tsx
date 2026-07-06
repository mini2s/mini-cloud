"use client";

import { useMemo } from "react";
import type { WorkflowEdge, WorkflowNode } from "@multica/core/types";
import { inferEdgeSemantics, getEdgeVisualConfig } from "@multica/core/workflows/edge-semantics";
import type { EdgeSemantics } from "@multica/core/workflows/edge-semantics";
import { cn } from "@multica/ui/lib/utils";

export interface ComputedPath {
  edgeId: string;
  d: string;
  semantic: EdgeSemantics;
  label: string | null;
  midX: number;
  midY: number;
}

interface Rect {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function computePaths(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  nodePositions: Map<string, DOMRect>,
  containerRect: Rect,
): ComputedPath[] {
  const results: ComputedPath[] = [];

  for (const edge of edges) {
    const sourceRect = nodePositions.get(edge.source_node_id);
    const targetRect = nodePositions.get(edge.target_node_id);
    if (!sourceRect || !targetRect) continue;

    const semantic = inferEdgeSemantics(edge, nodes);
    const config = getEdgeVisualConfig(semantic);

    // Compute relative coordinates
    const sx = sourceRect.right - containerRect.left;
    const sy = sourceRect.top + sourceRect.height / 2 - containerRect.top;
    const tx = targetRect.left - containerRect.left;
    const ty = targetRect.top + targetRect.height / 2 - containerRect.top;
    const midX = (sx + tx) / 2;
    const midY = (sy + ty) / 2;

    // Smooth cubic bezier for data/control, dashed straight for error
    let d: string;
    if (semantic === "error") {
      d = `M ${sx} ${sy} L ${tx} ${ty}`;
    } else {
      const cpOffset = Math.abs(tx - sx) * 0.4;
      d = `M ${sx} ${sy} C ${sx + cpOffset} ${sy}, ${tx - cpOffset} ${ty}, ${tx} ${ty}`;
    }

    // Extract label from condition if control semantics
    let label: string | null = null;
    if (config.hasLabel && edge.condition && typeof edge.condition === "object") {
      const cond = edge.condition as Record<string, unknown>;
      if (cond.path === "true") label = "true";
      else if (cond.path === "false") label = "false";
      else if (typeof cond.path === "string") label = cond.path;
    }

    results.push({ edgeId: edge.id, d, semantic, label, midX, midY });
  }

  return results;
}

export interface WorkflowEdgeLayerProps {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  containerRect: Rect;
  nodePositions: Map<string, DOMRect>;
  surface: "reactflow" | "stage-lane";
  className?: string;
}

/** SVG overlay that renders workflow edges with semantic-aware visual styles. */
export function WorkflowEdgeLayer({
  edges,
  nodes,
  containerRect,
  nodePositions,
  surface,
  className,
}: WorkflowEdgeLayerProps) {
  const paths = useMemo(
    () => computePaths(edges, nodes, nodePositions, containerRect),
    [edges, nodes, nodePositions, containerRect],
  );

  if (paths.length === 0) return null;

  return (
    <svg
      className={cn("pointer-events-none absolute inset-0 z-10 overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <marker id="edge-arrow-data" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--workflow-info))" />
        </marker>
        <marker id="edge-arrow-control" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--workflow-success))" />
        </marker>
        <marker id="edge-arrow-error" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--workflow-danger))" />
        </marker>
      </defs>
      {paths.map((path) => {
        const config = getEdgeVisualConfig(path.semantic);
        return (
          <g key={path.edgeId}>
            <path
              d={path.d}
              fill="none"
              stroke={`hsl(var(${config.strokeColorToken}))`}
              strokeWidth={surface === "reactflow" ? config.strokeWidth : 2}
              strokeDasharray={config.strokeDasharray === "none" ? undefined : config.strokeDasharray}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={`url(#edge-arrow-${path.semantic})`}
              opacity={0.6}
            />
            {path.label && (
              <text
                x={path.midX}
                y={path.midY - 6}
                textAnchor="middle"
                fontSize="10"
                fill={`hsl(var(${config.labelColorToken}))`}
                className="font-medium"
              >
                {path.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

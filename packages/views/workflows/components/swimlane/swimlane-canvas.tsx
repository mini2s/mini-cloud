"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { WorkflowNode as WorkflowNodeType, WorkflowEdge as WorkflowEdgeType } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import {
  WorkflowNode,
  NODE_WIDTH,
  NODE_HEIGHT,
  DIAMOND_SIZE,
  HEXAGON_SIZE,
  type WorkflowNodeData,
} from "../reactflow-nodes";
import type { SwimlaneLayoutResult } from "./swimlane-layout";
import { LANE_HEADER_HEIGHT } from "./swimlane-layout";

const nodeTypes = { workflow: WorkflowNode };

// ── Component ──────────────────────────────────────────────────

export interface SwimlaneCanvasProps {
  layout: SwimlaneLayoutResult;
  nodes: WorkflowNodeType[];
  edges: WorkflowEdgeType[];
  onNodeClick?: (nodeId: string) => void;
  /** i18n label for unassigned lane header (falls back to lane.stageName) */
  unassignedLabel?: string;
}

export function SwimlaneCanvas({ layout, nodes, edges, onNodeClick, unassignedLabel }: SwimlaneCanvasProps) {
  // Build ReactFlow nodes from layout positions
  const rfNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    return nodes
      .filter((n) => layout.nodePositions.has(n.id))
      .map((n) => {
        const pos = layout.nodePositions.get(n.id)!;
        const shape = parseNodeShape(n.format_schema);
        let nodeWidth = NODE_WIDTH;
        let nodeHeight = NODE_HEIGHT;
        if (n.format_schema && typeof n.format_schema === "object") {
          const obj = n.format_schema as Record<string, unknown>;
          if (typeof obj.width === "number") nodeWidth = obj.width;
          if (typeof obj.height === "number") nodeHeight = obj.height;
        }
        if (shape === "diamond") { nodeWidth = DIAMOND_SIZE; nodeHeight = DIAMOND_SIZE; }
        if (shape === "hexagon") { nodeWidth = HEXAGON_SIZE; nodeHeight = HEXAGON_SIZE; }

        return {
          id: n.id,
          type: "workflow",
          position: { x: pos.x, y: pos.y },
          width: nodeWidth,
          height: nodeHeight,
          data: {
            title: n.title,
            shape,
            nodeColor: undefined,
            fontSize: undefined,
          } satisfies WorkflowNodeData,
        };
      });
  }, [nodes, layout.nodePositions]);

  // Build ReactFlow edges
  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((e) => {
      // Determine color: use lane color if both nodes in same stage lane, else neutral
      const sourceNode = nodes.find((n) => n.id === e.source_node_id);
      const targetNode = nodes.find((n) => n.id === e.target_node_id);
      const sameLane = sourceNode?.stage_id === targetNode?.stage_id && sourceNode?.stage_id != null;

      let strokeColor = "#94A3B8"; // neutral slate-400
      if (sameLane) {
        const lane = layout.lanes.find((l) => l.stageId === sourceNode!.stage_id);
        if (lane) strokeColor = lane.color.border;
      }

      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        type: "step",
        style: { stroke: strokeColor, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 16, height: 16 },
      };
    });
  }, [edges, nodes, layout.lanes]);

  // Node click handler
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        className="bg-muted/20"
        data-testid="swimlane-reactflow"
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />

        {/* Lane background overlay */}
        <svg
          className="absolute inset-0 pointer-events-none overflow-visible"
          style={{ zIndex: -1 }}
          data-testid="swimlane-overlay"
        >
          {layout.lanes.map((lane) => (
            <g key={lane.stageId}>
              {/* Lane background */}
              <rect
                x={-10000}
                y={lane.y}
                width={20000}
                height={lane.height}
                fill={lane.color.bg}
                stroke={lane.isUnassigned ? lane.color.border : "transparent"}
                strokeWidth={lane.isUnassigned ? 1 : 0}
                strokeDasharray={lane.isUnassigned ? "8 4" : undefined}
              />
              {/* Lane header bar */}
              <rect
                x={-10000}
                y={lane.y}
                width={20000}
                height={LANE_HEADER_HEIGHT}
                fill={lane.color.border}
                opacity={0.15}
              />
              {/* Lane header text */}
              <text
                x={16}
                y={lane.y + LANE_HEADER_HEIGHT / 2}
                dominantBaseline="central"
                fill={lane.color.text}
                fontSize={13}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
                style={{ pointerEvents: "auto" }}
              >
                {lane.isUnassigned && unassignedLabel ? unassignedLabel : lane.stageName}
              </text>
            </g>
          ))}
        </svg>
      </ReactFlow>
    </div>
  );
}

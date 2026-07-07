"use client";

import type { ReactNode } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowStage } from "@multica/core/types";
import { CanvasStageLabels } from "../overview/canvas-stage-labels";

export interface WorkflowCanvasCoreProps {
  nodes: Node[];
  edges: Edge[];
  stages: WorkflowStage[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  readOnly?: boolean;
  colorMode?: "light" | "dark" | "system";
  viewportY: number;
  viewportZoom: number;
  defaultViewport?: Viewport;
  children?: ReactNode;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onPaneClick?: () => void;
  onNodeDragStop?: (event: MouseEvent | TouchEvent, node: Node) => void;
  onConnect?: (connection: Connection) => void;
  onEdgesDelete?: (edges: Edge[]) => void;
  onMove?: (viewport: Viewport) => void;
  onStageEdit?: (stage: WorkflowStage) => void;
  onStageDelete?: (stage: WorkflowStage) => void;
  onStageReorder?: (stageId: string, direction: "up" | "down") => void;
}

export function WorkflowCanvasCore({
  nodes,
  edges,
  stages,
  nodeTypes,
  edgeTypes,
  readOnly = false,
  colorMode = "light",
  viewportY,
  viewportZoom,
  defaultViewport = { x: 0, y: 24, zoom: 0.95 },
  children,
  onNodeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onEdgesDelete,
  onMove,
  onStageEdit,
  onStageDelete,
  onStageReorder,
}: WorkflowCanvasCoreProps) {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1" data-testid="workflow-canvas-core">
      <CanvasStageLabels
        stages={stages}
        viewportY={viewportY}
        viewportZoom={viewportZoom}
        readOnly={readOnly}
        onEdit={onStageEdit}
        onDelete={onStageDelete}
        onReorder={onStageReorder}
      />

      <div className="absolute inset-y-0 left-40 right-0 z-10 min-w-0" data-testid="panorama-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={readOnly ? undefined : onNodeDragStop}
          onConnect={readOnly ? undefined : onConnect}
          onEdgesDelete={readOnly ? undefined : onEdgesDelete}
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          defaultViewport={defaultViewport}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          multiSelectionKeyCode={readOnly ? null : "Shift"}
          selectionOnDrag={!readOnly}
          colorMode={colorMode}
          onMove={(_, viewport) => onMove?.(viewport)}
        >
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => (node.type === "criticBadge" ? "#f59e0b" : "#64748b")}
          />
        </ReactFlow>
        {children}
      </div>
    </div>
  );
}

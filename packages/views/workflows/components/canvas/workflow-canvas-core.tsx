"use client";

import type { ReactNode } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type FitViewOptions,
  type Node,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowStage } from "@multica/core/types";
import { CanvasStageLabels } from "../overview/canvas-stage-labels";

const canvasControlsClassName =
  "!m-5 overflow-hidden rounded-lg border border-border/80 bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85 " +
  "[&_.react-flow__controls-button]:h-8 [&_.react-flow__controls-button]:w-8 [&_.react-flow__controls-button]:border-0 " +
  "[&_.react-flow__controls-button]:border-r [&_.react-flow__controls-button]:border-border/70 " +
  "[&_.react-flow__controls-button]:bg-transparent [&_.react-flow__controls-button]:text-muted-foreground " +
  "[&_.react-flow__controls-button:hover]:bg-accent [&_.react-flow__controls-button:hover]:text-foreground " +
  "[&_.react-flow__controls-button:last-child]:border-r-0";

const canvasMiniMapClassName =
  "!m-5 overflow-hidden rounded-lg border border-border/70 bg-card/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80";

export interface WorkflowCanvasCoreProps {
  nodes: Node[];
  edges: Edge[];
  stages: WorkflowStage[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  readOnly?: boolean;
  viewportY: number;
  viewportZoom: number;
  defaultViewport?: Viewport;
  fitView?: boolean;
  fitViewOptions?: FitViewOptions;
  children?: ReactNode;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge, position: { x: number; y: number }) => void;
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
  viewportY,
  viewportZoom,
  defaultViewport = { x: 0, y: 24, zoom: 0.95 },
  fitView = false,
  fitViewOptions,
  children,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodeDragStop,
  onConnect,
  onEdgesDelete,
  onMove,
  onStageEdit,
  onStageDelete,
  onStageReorder,
}: WorkflowCanvasCoreProps) {
  const { screenToFlowPosition } = useReactFlow();

  const handleEdgeClick = (event: React.MouseEvent, edge: Edge) => {
    onEdgeClick?.(event, edge, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 self-stretch" data-testid="workflow-canvas-core">
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
          onEdgeClick={handleEdgeClick}
          onPaneClick={onPaneClick}
          onNodeDragStop={readOnly ? undefined : onNodeDragStop}
          onConnect={readOnly ? undefined : onConnect}
          onEdgesDelete={readOnly ? undefined : onEdgesDelete}
          fitView={fitView}
          fitViewOptions={fitViewOptions}
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
          onMove={(_, viewport) => onMove?.(viewport)}
        >
          <Background />
          <Controls
            position="bottom-left"
            orientation="horizontal"
            className={canvasControlsClassName}
          />
          <MiniMap
            position="bottom-right"
            className={canvasMiniMapClassName}
            pannable
            zoomable
            style={{ width: 156, height: 104 }}
            bgColor="hsl(var(--card))"
            maskColor="hsl(var(--muted) / 0.14)"
            maskStrokeColor="hsl(var(--border))"
            maskStrokeWidth={1}
            nodeBorderRadius={4}
            nodeColor={(node) => (node.type === "criticBadge" ? "#f59e0b" : "#64748b")}
          />
        </ReactFlow>
        {children}
      </div>
    </div>
  );
}

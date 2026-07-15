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
import { cn } from "@multica/ui/lib/utils";
import { CanvasStageLabels } from "../overview/canvas-stage-labels";
import {
  workflowCanvasControlsClassName,
  workflowCanvasMiniMapClassName,
  workflowCanvasMiniMapStyle,
} from "./workflow-canvas-controls";

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
  viewport?: Viewport;
  fitView?: boolean;
  fitViewOptions?: FitViewOptions;
  reserveStageRail?: boolean;
  showControls?: boolean;
  showMiniMap?: boolean;
  children?: ReactNode;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void;
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
  viewport,
  fitView = false,
  fitViewOptions,
  reserveStageRail = true,
  showControls = true,
  showMiniMap = true,
  children,
  onNodeClick,
  onNodeDoubleClick,
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

      <div
        className={cn(
          "absolute inset-y-0 right-0 z-10 min-w-0",
          reserveStageRail ? "left-40" : "left-0",
        )}
        data-testid="panorama-canvas"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
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
          viewport={viewport}
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
          {showControls ? (
            <Controls
              position="bottom-left"
              orientation="horizontal"
              className={workflowCanvasControlsClassName}
            />
          ) : null}
          {showMiniMap ? (
            <MiniMap
              position="bottom-right"
              className={workflowCanvasMiniMapClassName}
              pannable
              zoomable
              style={workflowCanvasMiniMapStyle}
              bgColor="hsl(var(--card))"
              maskColor="hsl(var(--muted) / 0.14)"
              maskStrokeColor="transparent"
              maskStrokeWidth={0}
              nodeBorderRadius={4}
              nodeColor={(node) => (node.type === "criticBadge" ? "#f59e0b" : "#64748b")}
            />
          ) : null}
        </ReactFlow>
        {children}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, type Node, type Viewport } from "@xyflow/react";
import type { WorkflowEdge, WorkflowNode, WorkflowStage } from "@multica/core/types";
import { WorkflowCanvasCore } from "./canvas/workflow-canvas-core";
import {
  workflowEdgesToReactFlowEdges,
  workflowNodesToReactFlowNodes,
} from "./canvas/workflow-canvas-model";
import { panoramaEdgeTypes } from "./overview/reactflow-edges";
import { panoramaNodeTypes } from "./overview/reactflow-nodes";

interface WorkflowTemplatePreviewCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stages: WorkflowStage[];
}

const TEMPLATE_PREVIEW_FIT_VIEW = {
  padding: 0.08,
  maxZoom: 0.85,
} as const;

const TEMPLATE_PREVIEW_DEFAULT_VIEWPORT: Viewport = { x: 0, y: 24, zoom: 0.85 };

interface TemplatePreviewSize {
  width: number;
  height: number;
}

export function computeTemplatePreviewViewport(
  nodes: Array<Pick<Node, "position" | "width" | "height">>,
  size: TemplatePreviewSize,
): Viewport {
  if (nodes.length === 0 || size.width <= 0 || size.height <= 0) {
    return TEMPLATE_PREVIEW_DEFAULT_VIEWPORT;
  }

  const bounds = nodes.reduce(
    (acc, node) => {
      const width = typeof node.width === "number" ? node.width : 0;
      const height = typeof node.height === "number" ? node.height : 0;
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + width),
        maxY: Math.max(acc.maxY, node.position.y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const availableWidth = Math.max(size.width * (1 - TEMPLATE_PREVIEW_FIT_VIEW.padding * 2), 1);
  const availableHeight = Math.max(size.height * (1 - TEMPLATE_PREVIEW_FIT_VIEW.padding * 2), 1);
  const zoom = Math.min(
    TEMPLATE_PREVIEW_FIT_VIEW.maxZoom,
    availableWidth / boundsWidth,
    availableHeight / boundsHeight,
  );
  const centerX = bounds.minX + boundsWidth / 2;
  const centerY = bounds.minY + boundsHeight / 2;

  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom,
  };
}

function isAnnotationNode(node: WorkflowNode): boolean {
  return Boolean(
    node.format_schema &&
    typeof node.format_schema === "object" &&
    !Array.isArray(node.format_schema) &&
    (node.format_schema as Record<string, unknown>).type === "annotation",
  );
}

function WorkflowTemplatePreviewCanvasInner({
  nodes,
  edges,
  stages,
  canvasSize,
}: WorkflowTemplatePreviewCanvasProps & { canvasSize: TemplatePreviewSize | null }) {
  const [viewport, setViewport] = useState<Viewport>(TEMPLATE_PREVIEW_DEFAULT_VIEWPORT);

  const rfNodes = useMemo(
    () => workflowNodesToReactFlowNodes({
      nodes,
      stages,
      nodeType: "compactWorker",
      makeNodeData: (node, context) => ({
        node,
        stage_id: context.stage_id,
        stageColorIndex: context.stageColorIndex,
        workerConfigured: isAnnotationNode(node) ? true : Boolean(node.worker_id),
        criticConfigured: isAnnotationNode(node)
          ? false
          : node.critic_type === "api"
            ? Boolean(node.critic_api_url?.trim())
            : Boolean(node.critic_id),
        isAnnotation: isAnnotationNode(node),
      }),
    }),
    [nodes, stages],
  );

  const rfEdges = useMemo(
    () => workflowEdgesToReactFlowEdges({
      edges,
      nodes,
      stages,
    }),
    [edges, nodes, stages],
  );

  const previewViewport = useMemo(
    () => canvasSize ? computeTemplatePreviewViewport(rfNodes, canvasSize) : undefined,
    [canvasSize, rfNodes],
  );

  return (
    <WorkflowCanvasCore
      nodes={rfNodes}
      edges={rfEdges}
      stages={stages}
      nodeTypes={panoramaNodeTypes}
      edgeTypes={panoramaEdgeTypes}
      readOnly
      fitView={!previewViewport}
      fitViewOptions={TEMPLATE_PREVIEW_FIT_VIEW}
      defaultViewport={TEMPLATE_PREVIEW_DEFAULT_VIEWPORT}
      viewport={previewViewport}
      viewportY={previewViewport?.y ?? viewport.y}
      viewportZoom={previewViewport?.zoom ?? viewport.zoom}
      reserveStageRail={false}
      showControls={false}
      showMiniMap={false}
      onMove={setViewport}
    />
  );
}

export function WorkflowTemplatePreviewCanvas(props: WorkflowTemplatePreviewCanvasProps) {
  const [canvasSize, setCanvasSize] = useState<TemplatePreviewSize | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setCanvasSize((current) =>
        current?.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };

    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSize);
    observer?.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  return (
    <div ref={containerRef} className="flex h-full w-full min-h-0 min-w-0" data-testid="workflow-template-preview-canvas">
      <ReactFlowProvider>
        <WorkflowTemplatePreviewCanvasInner {...props} canvasSize={canvasSize} />
      </ReactFlowProvider>
    </div>
  );
}

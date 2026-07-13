"use client";

import { useMemo, useState } from "react";
import { ReactFlowProvider, type Viewport } from "@xyflow/react";
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
}: WorkflowTemplatePreviewCanvasProps) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 24, zoom: 0.85 });

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

  return (
    <WorkflowCanvasCore
      nodes={rfNodes}
      edges={rfEdges}
      stages={stages}
      nodeTypes={panoramaNodeTypes}
      edgeTypes={panoramaEdgeTypes}
      readOnly
      fitView
      fitViewOptions={{ padding: 0.2 }}
      defaultViewport={{ x: 0, y: 24, zoom: 0.85 }}
      viewportY={viewport.y}
      viewportZoom={viewport.zoom}
      onMove={setViewport}
    />
  );
}

export function WorkflowTemplatePreviewCanvas(props: WorkflowTemplatePreviewCanvasProps) {
  return (
    <div className="flex h-full w-full min-h-0 min-w-0" data-testid="workflow-template-preview-canvas">
      <ReactFlowProvider>
        <WorkflowTemplatePreviewCanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

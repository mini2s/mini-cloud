"use client";

import {
  ReactFlowSurface,
  type ReactFlowSurfaceProps,
} from "../canvas/reactflow-surface";

export type WorkflowCanvasProps = ReactFlowSurfaceProps;

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowSurface {...props} />;
}

/** @deprecated Use WorkflowCanvas or ReactFlowSurface instead. */
export const DAGCanvas = WorkflowCanvas;

"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import { RuntimeNodeCard } from "./runtime-node-card";

export interface RuntimeCanvasNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  runtimeSummary: WorkflowNodeRuntimeSummary | null;
  workerName: string | null;
  criticName: string | null;
  onOpen: (nodeId: string) => void;
}

export const RuntimeCanvasNode = memo(function RuntimeCanvasNode({
  id,
  data,
}: NodeProps) {
  const nodeData = data as RuntimeCanvasNodeData;

  return (
    <div data-testid={`runtime-canvas-node-${id}`} className="relative">
      <Handle type="target" position={Position.Left} id="left" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0" />
      <RuntimeNodeCard
        node={nodeData.node}
        nodeRun={nodeData.nodeRun}
        workerName={nodeData.workerName}
        criticName={nodeData.criticName}
        onClick={nodeData.onOpen}
        runtimeSummary={nodeData.runtimeSummary}
      />
    </div>
  );
});

export const runtimeCanvasNodeTypes = {
  runtimeNode: RuntimeCanvasNode,
};

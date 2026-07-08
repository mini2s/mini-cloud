"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import { CriticBadgeNode } from "../../../workflows/components/overview/reactflow-nodes";
import { WORKER_HEIGHT } from "../../../workflows/components/overview/constants";
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
      <RuntimeNodeCard
        node={nodeData.node}
        nodeRun={nodeData.nodeRun}
        workerName={nodeData.workerName}
        criticName={nodeData.criticName}
        onClick={nodeData.onOpen}
        runtimeSummary={nodeData.runtimeSummary}
        handles={["left-target", "right-source", "bottom-source"]}
        lateralHandleTop={WORKER_HEIGHT / 2}
      />
    </div>
  );
});

export const runtimeCanvasNodeTypes = {
  runtimeNode: RuntimeCanvasNode,
  criticBadge: CriticBadgeNode,
};

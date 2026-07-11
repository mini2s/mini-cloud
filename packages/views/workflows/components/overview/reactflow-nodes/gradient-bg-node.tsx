import type { NodeProps } from "@xyflow/react";
import { STAGE_TRANSITION_GRADIENTS, GRADIENT_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface GradientBgNodeData extends Record<string, unknown> {
  fromStageIndex: number;
}

export function GradientBgNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as GradientBgNodeData;
  const colorIndex = Math.abs(nodeData.fromStageIndex) % STAGE_TRANSITION_GRADIENTS.length;
  const gradientClass = STAGE_TRANSITION_GRADIENTS[colorIndex];

  return (
    <div
      data-testid={`gradient-bg-${id}`}
      data-nodrag="true"
      className={`${gradientClass} pointer-events-none`}
      style={{ width: PANORAMA_WIDTH, height: GRADIENT_HEIGHT }}
    />
  );
}

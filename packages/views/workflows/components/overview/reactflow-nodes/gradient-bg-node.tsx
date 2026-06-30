import type { NodeProps } from "@xyflow/react";
import { STAGE_TRANSITION_GRADIENTS, GRADIENT_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface GradientBgNodeData {
  fromStageIndex: number;
}

export function GradientBgNode({ id, data }: NodeProps<GradientBgNodeData>) {
  const colorIndex = Math.abs(data.fromStageIndex) % STAGE_TRANSITION_GRADIENTS.length;
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

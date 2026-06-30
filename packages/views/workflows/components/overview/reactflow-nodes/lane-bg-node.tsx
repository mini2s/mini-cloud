import type { NodeProps } from "@xyflow/react";
import { STAGE_BG_COLORS, LANE_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface LaneBgNodeData {
  stageIndex: number;
}

export function LaneBgNode({ id, data }: NodeProps<LaneBgNodeData>) {
  const colorIndex = Math.abs(data.stageIndex) % STAGE_BG_COLORS.length;
  const bgClass = STAGE_BG_COLORS[colorIndex];

  return (
    <div
      data-testid={`lane-bg-${id}`}
      data-nodrag="true"
      className={`${bgClass} pointer-events-none`}
      style={{ width: PANORAMA_WIDTH, height: LANE_HEIGHT }}
    />
  );
}

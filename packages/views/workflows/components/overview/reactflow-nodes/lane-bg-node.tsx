import type { NodeProps } from "@xyflow/react";
import { STAGE_BG_COLORS, LANE_HEIGHT, PANORAMA_WIDTH } from "../constants";

export interface LaneBgNodeData extends Record<string, unknown> {
  stageIndex: number;
  stageName?: string;
}

export function LaneBgNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as LaneBgNodeData;
  const colorIndex = Math.abs(nodeData.stageIndex) % STAGE_BG_COLORS.length;
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

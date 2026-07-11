import type { NodeProps } from "@xyflow/react";
import { STAGE_BG_COLORS, LANE_HEIGHT, PANORAMA_WIDTH, getStageColorIndex } from "../constants";

export interface LaneBgNodeData extends Record<string, unknown> {
  stageIndex: number;
  stageName?: string;
}

export function LaneBgNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as LaneBgNodeData;
  const colorIndex = getStageColorIndex(nodeData.stageIndex);
  const bgClass = STAGE_BG_COLORS[colorIndex];

  return (
    <div
      data-testid={`lane-bg-${id}`}
      data-nodrag="true"
      className={`${bgClass} pointer-events-none border-b border-border/30`}
      style={{ width: PANORAMA_WIDTH, height: LANE_HEIGHT }}
    />
  );
}

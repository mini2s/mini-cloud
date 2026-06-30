import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@multica/ui/lib/utils";
import { STAGE_LINE_COLORS, LANE_STEP, LANE_PADDING_TOP } from "../constants";

function PanoramaEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const laneIndex = Math.round((sourceY - LANE_PADDING_TOP) / LANE_STEP);
  const colorClass = STAGE_LINE_COLORS[laneIndex % STAGE_LINE_COLORS.length];

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      className={cn(
        colorClass,
        selected && "[filter:drop-shadow(0_0_3px_hsl(var(--primary)/0.4))]",
      )}
      style={{
        stroke: "currentColor",
        strokeWidth: 1.5,
        opacity: 0.35,
        ...style,
      }}
      markerEnd={markerEnd}
    />
  );
}

export const PanoramaEdge = memo(PanoramaEdgeComponent);

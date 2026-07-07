import { memo } from "react";
import { BaseEdge, getSmoothStepPath, getStraightPath, Position, type EdgeProps } from "@xyflow/react";
import { cn } from "@multica/ui/lib/utils";
import { LANE_STEP, LANE_PADDING_TOP, getStageColor } from "../constants";

type PanoramaEdgeData = {
  stageColorIndex?: number;
  edgeKind?: "data" | "condition" | "error" | "rework" | "critic";
  edgeTone?: "data" | "condition" | "error" | "rework" | "critic";
};

function toneClass(tone: PanoramaEdgeData["edgeTone"]): string {
  if (tone === "condition") return "text-blue-500";
  if (tone === "error") return "text-red-500";
  if (tone === "rework") return "text-amber-500";
  if (tone === "critic") return "text-amber-500";
  return "";
}

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
  data,
}: EdgeProps) {
  // Direct same-axis connections should not route through SmoothStep waypoints.
  const isVertical =
    (sourcePosition === Position.Top || sourcePosition === Position.Bottom) &&
    (targetPosition === Position.Top || targetPosition === Position.Bottom);
  const isHorizontal =
    (sourcePosition === Position.Left || sourcePosition === Position.Right) &&
    (targetPosition === Position.Left || targetPosition === Position.Right) &&
    Math.abs(sourceY - targetY) < 1;

  const [edgePath] = isVertical || isHorizontal
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

  const edgeData = data as PanoramaEdgeData | undefined;
  const laneIndex = edgeData?.stageColorIndex ?? Math.round((sourceY - LANE_PADDING_TOP) / LANE_STEP);
  const colorClass = edgeData?.edgeTone && edgeData.edgeTone !== "data"
    ? toneClass(edgeData.edgeTone)
    : getStageColor(laneIndex).lineClass;

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
        strokeWidth: selected ? 2.25 : 1.5,
        opacity: selected ? 0.75 : 0.35,
        ...style,
      }}
      markerEnd={markerEnd}
    />
  );
}

export const PanoramaEdge = memo(PanoramaEdgeComponent);

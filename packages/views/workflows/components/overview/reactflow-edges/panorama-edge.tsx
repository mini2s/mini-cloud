import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, Position, type EdgeProps } from "@xyflow/react";
import { cn } from "@multica/ui/lib/utils";
import { Trash2 } from "lucide-react";
import { LANE_STEP, LANE_PADDING_TOP, getStageColor } from "../constants";

type PanoramaEdgeData = {
  stageColorIndex?: number;
  edgeKind?: "data" | "condition" | "error" | "rework" | "critic";
  edgeTone?: "data" | "condition" | "error" | "rework" | "critic";
  onDeleteEdge?: (edgeId: string) => void;
  deleteButtonPosition?: { x: number; y: number };
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

  const canDelete = selected && edgeData?.edgeKind !== "critic" && typeof edgeData?.onDeleteEdge === "function";
  const labelX = edgeData?.deleteButtonPosition?.x ?? (sourceX + targetX) / 2;
  const labelY = edgeData?.deleteButtonPosition?.y ?? (sourceY + targetY) / 2;

  return (
    <>
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
      {canDelete ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete edge"
            title="Delete edge"
            className="nodrag nopan pointer-events-auto absolute flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition hover:bg-destructive/10 hover:text-destructive"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              edgeData.onDeleteEdge?.(id);
            }}
          >
            <Trash2 className="size-3" strokeWidth={2} />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const PanoramaEdge = memo(PanoramaEdgeComponent);

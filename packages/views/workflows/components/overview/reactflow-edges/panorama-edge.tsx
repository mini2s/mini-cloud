import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, Position, type EdgeProps } from "@xyflow/react";
import { cn } from "@multica/ui/lib/utils";
import { Trash2 } from "lucide-react";
import { LANE_STEP, LANE_PADDING_TOP, getStageColor } from "../constants";

type PanoramaEdgeTone =
  | "data"
  | "condition"
  | "error"
  | "rework"
  | "critic"
  | "success"
  | "running"
  | "blocked"
  | "waiting";

type PanoramaEdgeData = {
  stageColorIndex?: number;
  sameStage?: boolean;
  edgeKind?: "data" | "condition" | "error" | "rework" | "critic";
  edgeTone?: PanoramaEdgeTone;
  edgeLabel?: string;
  onDeleteEdge?: (edgeId: string) => void;
  deleteButtonPosition?: { x: number; y: number };
};

function toneClass(tone: PanoramaEdgeData["edgeTone"]): string {
  if (tone === "condition" || tone === "running") return "text-blue-500";
  if (tone === "error" || tone === "blocked") return "text-red-500";
  if (tone === "rework" || tone === "critic") return "text-amber-500";
  if (tone === "success") return "text-emerald-500";
  if (tone === "waiting") return "text-slate-500";
  return "";
}

function edgeOpacity(tone: PanoramaEdgeData["edgeTone"], selected: boolean): number {
  if (selected) return 0.95;
  if (tone === "success") return 0.46;
  if (tone === "waiting") return 0.34;
  if (tone === "running" || tone === "blocked") return 0.78;
  return 0.72;
}

function edgeStrokeWidth(tone: PanoramaEdgeData["edgeTone"], selected: boolean): number {
  if (selected) return 3.5;
  if (tone === "success") return 2.25;
  if (tone === "waiting") return 2;
  return 2.75;
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
  const edgeData = data as PanoramaEdgeData | undefined;
  // Direct lateral connections stay straight even when card content makes
  // handle centers slightly different across nodes in the same stage.
  const isVertical =
    (sourcePosition === Position.Top || sourcePosition === Position.Bottom) &&
    (targetPosition === Position.Top || targetPosition === Position.Bottom);
  const isLateral =
    (sourcePosition === Position.Left || sourcePosition === Position.Right) &&
    (targetPosition === Position.Left || targetPosition === Position.Right);
  const isSameStageLateral =
    isLateral &&
    (edgeData?.sameStage === true || (edgeData?.sameStage === undefined && Math.abs(sourceY - targetY) < 1));

  const [edgePath] = isVertical || isSameStageLateral
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

  const laneIndex = edgeData?.stageColorIndex ?? Math.round((sourceY - LANE_PADDING_TOP) / LANE_STEP);
  const colorClass = edgeData?.edgeTone && edgeData.edgeTone !== "data"
    ? toneClass(edgeData.edgeTone)
    : getStageColor(laneIndex).lineClass;

  const canDelete = selected && edgeData?.edgeKind !== "critic" && typeof edgeData?.onDeleteEdge === "function";
  const labelX = edgeData?.deleteButtonPosition?.x ?? (sourceX + targetX) / 2;
  const labelY = edgeData?.deleteButtonPosition?.y ?? (sourceY + targetY) / 2;
  const isSelected = selected === true;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={cn(
          colorClass,
          isSelected && "[filter:drop-shadow(0_0_3px_hsl(var(--primary)/0.4))]",
        )}
        style={{
          stroke: "currentColor",
          strokeWidth: edgeStrokeWidth(edgeData?.edgeTone, isSelected),
          opacity: edgeOpacity(edgeData?.edgeTone, isSelected),
          strokeDasharray: edgeData?.edgeTone === "blocked" ? "7 5" : style?.strokeDasharray,
          ...style,
        }}
        markerEnd={markerEnd}
      />
      {edgeData?.edgeLabel ? (
        <EdgeLabelRenderer>
          <div
            data-testid={`panorama-edge-label-${id}`}
            className="nodrag nopan pointer-events-none absolute inline-flex h-5 items-center rounded-full border border-border bg-background px-2 text-[10px] font-medium text-muted-foreground shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
            }}
          >
            {edgeData.edgeLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
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

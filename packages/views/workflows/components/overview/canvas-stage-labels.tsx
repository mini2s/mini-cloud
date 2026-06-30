import { Button } from "@multica/ui/components/ui/button";
import { Pencil, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import type { WorkflowStage } from "@multica/core/types";
import { LANE_STEP, LANE_HEIGHT, UNASSIGNED_LANE_Y } from "./constants";

export interface CanvasStageLabelsProps {
  stages: WorkflowStage[];
  viewportY: number;
  onEdit: (stage: WorkflowStage) => void;
  onDelete: (stage: WorkflowStage) => void;
  onReorder: (stageId: string, direction: "up" | "down") => void;
}

export function CanvasStageLabels({
  stages,
  viewportY,
  onEdit,
  onDelete,
  onReorder,
}: CanvasStageLabelsProps) {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      data-testid="canvas-stage-labels"
      className="absolute left-0 top-0 z-10 pointer-events-none"
      style={{ transform: `translateY(${viewportY}px)` }}
    >
      {sorted.map((stage) => {
        const top = stage.sort_order * LANE_STEP;
        return (
          <div
            key={stage.id}
            className="absolute pointer-events-auto flex items-center gap-1"
            style={{ top, height: LANE_HEIGHT }}
          >
            <div className="flex flex-col justify-center w-28 px-2">
              <span className="text-[10px] font-medium text-muted-foreground leading-none">
                Stage {stage.sort_order + 1}
              </span>
              <span className="text-xs font-semibold truncate leading-tight">
                {stage.name}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onEdit(stage)} aria-label="Edit stage">
                <Pencil className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onDelete(stage)} aria-label="Delete stage">
                <Trash2 className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onReorder(stage.id, "up")} aria-label="Move stage up"
                disabled={stage.sort_order === 0}>
                <ChevronUp className="size-2.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-5"
                onClick={() => onReorder(stage.id, "down")} aria-label="Move stage down"
                disabled={stage.sort_order === sorted.length - 1}>
                <ChevronDown className="size-2.5" />
              </Button>
            </div>
            <GripVertical className="size-3 text-muted-foreground/40 cursor-grab" />
          </div>
        );
      })}

      {sorted.length > 0 && (
        <div
          className="absolute pointer-events-auto flex items-center px-2"
          style={{ top: UNASSIGNED_LANE_Y(sorted.length), height: LANE_HEIGHT }}
        >
          <span className="text-[10px] font-medium text-muted-foreground/60">
            Unassigned
          </span>
        </div>
      )}
    </div>
  );
}

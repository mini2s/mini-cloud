"use client";

import { Button } from "@multica/ui/components/ui/button";
import { Pencil, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import type { WorkflowStage } from "@multica/core/types";
import { LANE_STEP, LANE_HEIGHT, getStageColor } from "./constants";

export interface CanvasStageLabelsProps {
  stages: WorkflowStage[];
  viewportY: number;
  viewportZoom: number;
  onEdit: (stage: WorkflowStage) => void;
  onDelete: (stage: WorkflowStage) => void;
  onReorder: (stageId: string, direction: "up" | "down") => void;
}

export function CanvasStageLabels({
  stages,
  viewportY,
  viewportZoom,
  onEdit,
  onDelete,
  onReorder,
}: CanvasStageLabelsProps) {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div
      data-testid="canvas-stage-labels"
      className="absolute left-0 top-0 z-10 w-40 pointer-events-none"
    >
      {sorted.map((stage) => {
        // Apply viewport transform to match ReactFlow coordinate system:
        // screenY = flowY * zoom + viewportY
        const top = stage.sort_order * LANE_STEP * viewportZoom + viewportY;
        const barClass = getStageColor(stage.sort_order).barClass;
        const isFirst = stage.sort_order === 0;
        const isLast = stage.sort_order === sorted.length - 1;

        return (
          <div
            key={stage.id}
            className="absolute pointer-events-auto flex w-40 items-center pr-2 group"
            style={{ top, height: LANE_HEIGHT }}
          >
            {/* Unified card with left color bar */}
            <div
              className={`relative flex min-w-0 flex-1 flex-col justify-center rounded-lg border border-border/70 bg-background/95 px-2.5 py-1.5 shadow-sm backdrop-blur ${barClass} border-l-[3px] cursor-pointer`}
              onClick={() => onEdit(stage)}
              data-testid="stage-label-card"
            >
              <span className="text-[10px] font-semibold leading-none text-muted-foreground">
                Stage {stage.sort_order + 1}
              </span>
              <span className="text-xs font-semibold truncate leading-tight">
                {stage.name}
              </span>
              {stage.description && (
                <span className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
                  {stage.description}
                </span>
              )}

              {/* Action buttons — top-right 2×2 grid, hover visible */}
              <div
                className="absolute right-1 top-1 grid grid-cols-2 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => onEdit(stage)}
                  aria-label="Edit stage"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => onDelete(stage)}
                  aria-label="Delete stage"
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => onReorder(stage.id, "up")}
                  aria-label="Move stage up"
                  disabled={isFirst}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  onClick={() => onReorder(stage.id, "down")}
                  aria-label="Move stage down"
                  disabled={isLast}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </div>

              {/* Drag handle — bottom-left, hover visible */}
              <div
                className="absolute left-1.5 bottom-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
                onClick={(e) => e.stopPropagation()}
                aria-label="Drag to reorder"
              >
                <GripVertical className="size-3.5 text-muted-foreground/50" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

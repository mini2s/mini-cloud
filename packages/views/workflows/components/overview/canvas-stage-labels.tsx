"use client";

import { Button } from "@multica/ui/components/ui/button";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { WorkflowStage } from "@multica/core/types";
import {
  GRADIENT_HEIGHT,
  LANE_HEIGHT,
  LANE_STEP,
  STAGE_TRANSITION_GRADIENTS,
  createStageVisualIndexMap,
  getStageColor,
  getStageColorIndex,
  sortStagesForDisplay,
} from "./constants";

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
  const sorted = sortStagesForDisplay(stages);
  const visualIndexByStageId = createStageVisualIndexMap(stages);

  return (
    <>
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" data-testid="canvas-stage-lanes">
        {sorted.flatMap((stage, idx) => {
          const visualIndex = visualIndexByStageId.get(stage.id) ?? idx;
          const top = visualIndex * LANE_STEP * viewportZoom + viewportY;
          const height = LANE_HEIGHT * viewportZoom;
          const { bgClass } = getStageColor(visualIndex);
          const band = (
            <div
              key={`lane-${stage.id}`}
              className={`absolute left-0 w-full border-b border-border/20 ${bgClass}`}
              data-testid="stage-lane-band"
              style={{ top, height }}
            />
          );

          if (idx === sorted.length - 1) return [band];

          const gradientTop = (visualIndex * LANE_STEP + LANE_HEIGHT) * viewportZoom + viewportY;
          const gradientClass = STAGE_TRANSITION_GRADIENTS[getStageColorIndex(visualIndex)]!;
          const gradient = (
            <div
              key={`gradient-${stage.id}`}
              className={`absolute left-0 w-full ${gradientClass}`}
              data-testid="stage-gradient-bar"
              style={{ top: gradientTop, height: GRADIENT_HEIGHT * viewportZoom }}
            />
          );

          return [band, gradient];
        })}
      </div>

      <div
        data-testid="canvas-stage-labels"
        className="absolute inset-y-0 left-0 z-20 w-40 overflow-hidden pointer-events-none"
      >
        {sorted.map((stage, idx) => {
          const visualIndex = visualIndexByStageId.get(stage.id) ?? idx;
          const top = visualIndex * LANE_STEP * viewportZoom + viewportY;
          const height = LANE_HEIGHT * viewportZoom;
          const isFirst = visualIndex === 0;
          const isLast = visualIndex === sorted.length - 1;

          return (
            <div
              key={stage.id}
              className="absolute pointer-events-auto flex w-40 items-center pr-2 group"
              data-testid="stage-label-rail"
              style={{ top, height }}
            >
              <div className="absolute left-3 top-0 h-px w-28 bg-border/40" aria-hidden="true" />
              <div
                className="relative flex min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-md px-3 py-2 transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
                onClick={() => onEdit(stage)}
                data-testid="stage-label-card"
              >
                <span className="text-[10px] font-medium leading-none text-muted-foreground">
                  Stage {visualIndex + 1}
                </span>
                <span className="mt-1 truncate text-[13px] font-semibold leading-tight text-foreground">{stage.name}</span>
                {stage.description && (
                  <span className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
                    {stage.description}
                  </span>
                )}

                <div
                  className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  data-testid="stage-label-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => onEdit(stage)} aria-label="Edit stage">
                    <Pencil className="size-3" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => onDelete(stage)} aria-label="Delete stage">
                    <Trash2 className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => onReorder(stage.id, "up")}
                    aria-label="Move stage up"
                    disabled={isFirst}
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => onReorder(stage.id, "down")}
                    aria-label="Move stage down"
                    disabled={isLast}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                </div>

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
    </>
  );
}

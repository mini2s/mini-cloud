"use client";

import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { Trash2, Power, PowerOff } from "lucide-react";

export interface CanvasHoverToolbarProps {
  nodeId: string;
  position: { x: number; y: number };
  onDelete: (nodeId: string) => void;
  onToggleDisabled?: (nodeId: string) => void;
  isDisabled?: boolean;
  mode: "editor" | "runtime";
  className?: string;
}

/** Floating toolbar that appears above a node on hover. */
export function CanvasHoverToolbar({
  nodeId,
  position,
  onDelete,
  onToggleDisabled,
  isDisabled = false,
  mode,
  className,
}: CanvasHoverToolbarProps) {
  return (
    <div
      data-testid="hover-toolbar"
      className={cn(
        "absolute z-50 flex items-center gap-0.5 rounded-lg border bg-popover shadow-md p-0.5 -translate-x-1/2 -translate-y-full",
        className,
      )}
      style={{ left: position.x, top: position.y - 8 }}
    >
      {mode === "editor" && onToggleDisabled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onToggleDisabled(nodeId); }}
          aria-label={isDisabled ? "Enable" : "Disable"}
        >
          {isDisabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); onDelete(nodeId); }}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

"use client";

import { cn } from "@multica/ui/lib/utils";

const DRAG_TYPE = "application/x-multica-shape";

export interface NodePaletteProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const SHAPES = [
  { type: "rectangle", label: "Rectangle", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "diamond", label: "Diamond", icon: (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <polygon points="12,1 23,12 12,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "pill", label: "Pill", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "hexagon", label: "Hexagon", icon: (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <polygon points="6,1 18,1 23,12 18,23 6,23 1,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )},
  { type: "critic", label: "Critic", icon: (
    <svg width="24" height="18" viewBox="0 0 24 18">
      <rect x="1" y="1" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  )},
] as const;

export function NodePalette({ className, collapsed, onToggleCollapse }: NodePaletteProps) {
  if (collapsed) {
    return (
      <div className={cn("p-1", className)}>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/30 hover:bg-muted"
            aria-label="Expand palette"
            title="Expand palette"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5 p-1.5 rounded-lg bg-card border shadow-sm", className)}>
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">Shapes</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground" aria-label="Collapse palette">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
      </div>
      {SHAPES.map((shape) => (
        <div
          key={shape.type}
          draggable
          role="button"
          tabIndex={0}
          aria-label={shape.label}
          title={shape.label}
          className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/30 cursor-grab active:cursor-grabbing hover:bg-muted hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, shape.type);
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          {shape.icon}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import { X } from "lucide-react";

export interface InspectorTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface CanvasInspectorProps {
  title: string;
  tabs: InspectorTab[];
  actions?: ReactNode;
  onClose: () => void;
  open?: boolean;
  className?: string;
}

/** Reusable right-side inspector panel for both editor and runtime views. */
export function CanvasInspector({
  title,
  tabs,
  actions,
  onClose,
  open = true,
  className,
}: CanvasInspectorProps) {
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");

  if (!open) return null;

  return (
    <div
      data-testid="canvas-inspector"
      className={cn("flex flex-col h-full w-96 shrink-0 border-l bg-card", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h3 className="text-sm font-medium truncate">{title}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTabId === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {tabs.find((t) => t.id === activeTabId)?.content}
      </div>

      {/* Actions footer */}
      {actions && (
        <div className="px-4 py-3 border-t shrink-0 flex gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

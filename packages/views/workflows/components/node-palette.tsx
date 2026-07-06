"use client";

import { useState } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { Search, ChevronDown, ChevronRight } from "lucide-react";

const DRAG_TYPE = "application/x-multica-shape";

interface PaletteCategory {
  key: string;
  label: string;
  items: PaletteItem[];
}

interface PaletteItem {
  type: string;
  label: string;
  shape: "rectangle" | "diamond" | "pill" | "hexagon";
}

const CATEGORIES: PaletteCategory[] = [
  {
    key: "trigger",
    label: "Trigger",
    items: [
      { type: "rectangle", label: "Manual", shape: "rectangle" },
      { type: "rectangle", label: "Webhook", shape: "pill" },
      { type: "rectangle", label: "Schedule", shape: "hexagon" },
    ],
  },
  {
    key: "action",
    label: "Action",
    items: [
      { type: "rectangle", label: "Task", shape: "rectangle" },
      { type: "diamond", label: "Decision", shape: "diamond" },
      { type: "pill", label: "Process", shape: "pill" },
      { type: "hexagon", label: "Sub-flow", shape: "hexagon" },
    ],
  },
  {
    key: "logic",
    label: "Logic",
    items: [
      { type: "rectangle", label: "Condition", shape: "diamond" },
      { type: "rectangle", label: "Merge", shape: "rectangle" },
    ],
  },
  {
    key: "annotation",
    label: "Annotation",
    items: [
      { type: "annotation", label: "Note", shape: "rectangle" },
    ],
  },
];

function ShapePreview({ shape, className }: { shape: string; className?: string }) {
  const common = "fill-none stroke-current";
  switch (shape) {
    case "diamond":
      return (
        <svg width="20" height="14" viewBox="0 0 24 18" className={cn(common, className)}>
          <polygon points="12,1 23,9 12,17 1,9" strokeWidth="1.5" />
        </svg>
      );
    case "pill":
      return (
        <svg width="28" height="14" viewBox="0 0 28 18" className={cn(common, className)}>
          <rect x="1" y="1" width="26" height="16" rx="8" strokeWidth="1.5" />
        </svg>
      );
    case "hexagon":
      return (
        <svg width="22" height="14" viewBox="0 0 24 18" className={cn(common, className)}>
          <polygon points="6,1 18,1 23,9 18,17 6,17 1,9" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg width="22" height="14" viewBox="0 0 24 18" className={cn(common, className)}>
          <rect x="1" y="1" width="22" height="16" rx="3" strokeWidth="1.5" />
        </svg>
      );
  }
}

export interface NodePaletteProps {
  className?: string;
}

export function NodePalette({ className }: NodePaletteProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCategory = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filterItem = (item: PaletteItem) =>
    !search || item.label.toLowerCase().includes(search.toLowerCase());

  const filteredCategories = CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter(filterItem),
  })).filter((cat) => cat.items.length > 0);

  return (
    <div className={cn("flex flex-col rounded-lg border bg-card shadow-sm", className)}>
      {/* Header */}
      <div className="border-b px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 pl-7 text-xs"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex flex-col gap-0.5 p-1">
        {filteredCategories.map((cat) => {
          const isCollapsed = collapsed.has(cat.key);
          return (
            <div key={cat.key}>
              <button
                type="button"
                onClick={() => toggleCategory(cat.key)}
                className="flex w-full items-center gap-1 px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {cat.label}
              </button>
              {!isCollapsed && (
                <div className="flex flex-wrap gap-1 px-1 pb-1">
                  {cat.items.map((item) => (
                    <div
                      key={`${cat.key}-${item.label}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      aria-label={item.label}
                      title={item.label}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs cursor-grab active:cursor-grabbing hover:bg-muted hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground"
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, item.type);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      <ShapePreview shape={item.shape} />
                      <span className="truncate">{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filteredCategories.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            No nodes found
          </p>
        )}
      </div>
    </div>
  );
}

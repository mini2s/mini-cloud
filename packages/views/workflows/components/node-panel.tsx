"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@multica/ui/lib/utils";
import { Input } from "@multica/ui/components/ui/input";
import { Search, Bot, User, Users, StickyNote } from "lucide-react";

const DRAG_TYPE = "application/x-multica-shape";

interface NodeTypeEntry {
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface NodeGroup {
  id: string;
  label: string;
  colorClass: string;
  items: NodeTypeEntry[];
}

export const NODE_GROUPS: NodeGroup[] = [
  {
    id: "agent",
    label: "Agent Worker",
    colorClass: "bg-workflow-agent/10 text-workflow-agent",
    items: [
      { type: "rectangle", label: "Agent Task", description: "Assign a task to an AI agent", icon: <Bot className="h-4 w-4" /> },
    ],
  },
  {
    id: "human",
    label: "Human Worker",
    colorClass: "bg-workflow-info/10 text-workflow-info",
    items: [
      { type: "rectangle", label: "Human Task", description: "Assign a task to a human team member", icon: <User className="h-4 w-4" /> },
    ],
  },
  {
    id: "squad",
    label: "Squad",
    colorClass: "bg-workflow-success/10 text-workflow-success",
    items: [
      { type: "rectangle", label: "Squad Task", description: "Assign work to a squad of agents", icon: <Users className="h-4 w-4" /> },
    ],
  },
  {
    id: "annotation",
    label: "Annotation",
    colorClass: "bg-workflow-warning/10 text-workflow-warning",
    items: [
      { type: "annotation", label: "Sticky Note", description: "Add a note or comment to the canvas", icon: <StickyNote className="h-4 w-4" /> },
    ],
  },
];

export interface NodePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDragStart?: (nodeType: string) => void;
  className?: string;
}

export function NodePanel({ isOpen, onClose, onDragStart, className }: NodePanelProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return NODE_GROUPS;
    const q = search.toLowerCase();
    return NODE_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((item) =>
          item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [search]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="node-panel"
      className={cn("flex flex-col w-64 shrink-0 border-r bg-card", className)}
    >
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Node groups */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredGroups.map((group) => (
          <div key={group.id} className="mb-2">
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded",
              group.colorClass,
            )}>
              {group.label}
            </div>
            {group.items.map((item) => (
              <div
                key={item.type}
                draggable
                role="button"
                tabIndex={0}
                className="flex items-center gap-2 px-3 py-2 rounded-md mx-1 my-0.5 cursor-grab active:cursor-grabbing hover:bg-muted transition-colors text-sm"
                title={item.description}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, item.type);
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart?.(item.type);
                }}
              >
                <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                <span className="truncate text-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        ))}

        {filteredGroups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No matching nodes</p>
        )}
      </div>
    </div>
  );
}

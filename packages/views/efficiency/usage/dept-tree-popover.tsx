"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@multica/ui/components/ui/popover";
import { cn } from "@multica/ui/lib/utils";
import type { DeptTreeNode } from "@multica/core/efficiency";
import { DeptTreeContent, findDeptName } from "./dept-tree-panel";

// Department tree popover — a compact trigger button that opens a floating
// panel hosting the full department tree. Replaces the persistent 288px
// (18rem) left sidebar (DeptTreePanel) on the cost & usage kanban pages so
// the content area can span full width.
//
// The trigger shows the currently-selected department name + a chevron that
// flips on open. The popover is controlled so selecting a node does NOT close
// the panel — users can keep drilling into children. Click-outside / Esc
// closes as normal. Style matches the hub FilterDropdown pill so the two
// modules share one dropdown vocabulary.

export interface DeptTreePopoverProps {
  /** Forest of dept nodes (from deptTreeOptions). */
  tree: DeptTreeNode[];
  /** Loading state from the parent query. */
  loading?: boolean;
  /** Error message from the parent query (rendered in place of the tree). */
  error?: string | null;
  /** Currently-selected dept id (highlighted + shown on the trigger). */
  selectedId: string;
  /** Fired when the user clicks a node. */
  onSelect: (deptId: string) => void;
}

export function DeptTreePopover({
  tree,
  loading,
  error,
  selectedId,
  onSelect,
}: DeptTreePopoverProps) {
  const [open, setOpen] = useState(false);
  const selectedName = findDeptName(tree, selectedId) || "选择部门";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-border/60 bg-background px-3 text-[12.5px] font-bold text-foreground transition-[color,border-color,background-color] duration-150 hover:border-muted-foreground/30",
              open && "border-primary/45 bg-primary/10 text-primary",
            )}
          />
        }
      >
        <span className="max-w-[12rem] truncate">{selectedName}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-semibold text-card-foreground">部门导航</span>
          <span className="text-xs text-muted-foreground">点部门看其使用指标</span>
        </div>
        <DeptTreeContent
          tree={tree}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={onSelect}
          className="max-h-[60vh] overflow-y-auto p-2"
        />
      </PopoverContent>
    </Popover>
  );
}

export default DeptTreePopover;

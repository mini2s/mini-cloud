"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@multica/ui/components/ui/collapsible";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import type { DeptTreeNode } from "@multica/core/efficiency";
import { DRILLDOWN_TREE_ITEM_CLASS } from "../components/drilldown-styles";

export const UNASSIGNED_DEPT_NODE: DeptTreeNode = {
  dept_id: "unassigned",
  dept_name: "未划分",
  parent_dept_id: "",
  dept_path: "",
  dept_level: 0,
  order_num: 9999,
  child_dept_count: 0,
  status: 1,
  children: [],
};

// Department tree panel (the usage dimension's left navigation). The source
// put everything in URL searchParams; per slice-3b design decision #1 we use
// component state and onSelect callbacks instead — no react-router, no URL.
//
// The parent appends the source-compatible virtual "未划分" top-level node so
// users without a department remain queryable through the same callbacks.
//
// shadcn Collapsible drives expand/collapse (per design decision #4). We
// render the tree lazily: collapsed subtrees never enter the DOM, matching
// the source's behavior on large orgs.

export interface DeptTreePanelProps {
  /** Forest of dept nodes (from deptTreeOptions). */
  tree: DeptTreeNode[];
  /** Loading state from the parent query. */
  loading?: boolean;
  /** Error message from the parent query (rendered in place of the tree). */
  error?: string | null;
  /** Currently-selected dept id (highlighted). */
  selectedId: string;
  /** Fired when the user clicks a node. */
  onSelect: (deptId: string) => void;
}

// Default-expanded ids: for a single-root tree expand root + first level; for
// a multi-root forest expand the top level. Mirrors the source's rule.
function initialExpandedIds(nodes: DeptTreeNode[]): string[] {
  const ids: string[] = [];
  let firstLevel: DeptTreeNode[] = nodes;
  const root = nodes[0];
  if (nodes.length === 1 && root && root.children?.length) {
    ids.push(root.dept_id);
    firstLevel = root.children;
  }
  for (const n of firstLevel) ids.push(n.dept_id);
  return ids;
}

export function DeptTreePanel({
  tree,
  loading,
  error,
  selectedId,
  onSelect,
}: DeptTreePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Initialize once when the tree first arrives; don't override the user's
  // later toggles. Matches the source's "prev.size > 0 ? prev : default" rule.
  useEffect(() => {
    if (!tree.length) return;
    setExpanded((prev) => (prev.size > 0 ? prev : new Set(initialExpandedIds(tree))));
  }, [tree]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <aside className="flex max-h-[72vh] flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold text-card-foreground">部门导航</span>
        <span className="text-xs text-muted-foreground">点部门看其使用指标</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {error ? (
          <div className="px-3 py-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : !tree.length ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            暂无部门数据
          </div>
        ) : (
          <ul role="tree" aria-label="部门树" className="m-0 list-none p-0">
            {tree.map((n) => (
              <TreeNode
                key={n.dept_id}
                node={n}
                depth={0}
                selectedId={selectedId}
                expanded={expanded}
                onToggle={toggle}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

interface TreeNodeProps {
  node: DeptTreeNode;
  depth: number;
  selectedId: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

const TreeNode = memo(function TreeNode({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: TreeNodeProps) {
  const hasChildren = (node.children?.length ?? 0) > 0 || node.child_dept_count > 0;
  const isOpen = expanded.has(node.dept_id);
  const isSelected = selectedId === node.dept_id;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isSelected}>
      <Collapsible open={isOpen} onOpenChange={() => onToggle(node.dept_id)} disabled={!hasChildren}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-md py-1.5 pr-2 transition-colors",
            isSelected
              ? "bg-primary/10 text-primary"
              : "text-card-foreground hover:bg-muted",
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {hasChildren ? (
            <CollapsibleTrigger
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={isOpen ? "收起" : "展开"}
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")}
                aria-hidden="true"
              />
            </CollapsibleTrigger>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => onSelect(node.dept_id)}
            className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded border-none bg-transparent px-1 py-0.5 text-left text-sm text-inherit ${DRILLDOWN_TREE_ITEM_CLASS}`}
          >
            <span className="truncate" title={node.dept_name}>
              {node.dept_name}
            </span>
            {hasChildren && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {node.child_dept_count || node.children?.length || 0}
              </span>
            )}
          </button>
        </div>
        {hasChildren && (
          <CollapsibleContent>
            <ul role="group" className="m-0 list-none p-0">
              {node.children?.map((ch) => (
                <TreeNode
                  key={ch.dept_id}
                  node={ch}
                  depth={depth + 1}
                  selectedId={selectedId}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  );
});

// Recursive helper: find a node by id in the forest. Exported so the parent
// page can resolve the selected dept's name for the breadcrumb.
export function findDeptName(nodes: DeptTreeNode[], id: string): string {
  for (const n of nodes) {
    if (n.dept_id === id) return n.dept_name;
    if (n.children?.length) {
      const hit = findDeptName(n.children, id);
      if (hit) return hit;
    }
  }
  return "";
}

// Recursive helper: find direct children of a node by id. Exported for the
// compare view (which needs the selected dept's children to query each one).
export function findDeptChildren(nodes: DeptTreeNode[], id: string): DeptTreeNode[] {
  for (const n of nodes) {
    if (n.dept_id === id) return n.children ?? [];
    if (n.children?.length) {
      const hit = findDeptChildren(n.children, id);
      if (hit.length) return hit;
    }
  }
  return [];
}

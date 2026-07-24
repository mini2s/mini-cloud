"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptTreeOptions,
  useViewState,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { PageHeader } from "../../layout/page-header";
import { PeriodSelect } from "../components";
import { DeptAggregateView } from "./dept-aggregate-view";
import { DeptCompareView } from "./dept-compare-view";
import { DeptTreePanel, findDeptName } from "./dept-tree-panel";
import { MembersView } from "./members-view";
import { MemberDetailDialog } from "./member-detail";

// Usage Kanban — the usage dimension page. Ports the source UsageKanban
// (181 lines, URL-driven) to component-state-driven per design decision #1
// (NO URL query state). Layout: PageHeader (title + period select) → left
// dept tree panel + right main area (view tabs + include_children switch +
// dispatched content) → member detail dialog overlay.
//
// State (all useState, no react-router):
//   - selectedDeptId: defaults to the dept-tree's root once it loads
//   - view: 'aggregate' | 'compare' | 'members'
//   - includeChildren: default true (matches source default)
//   - selectedUser: the uid for the member detail dialog, null when closed
//
// Per design decision #2 (NO navigation), the source's drill-down
// useNavigate is omitted; selecting a dept or clicking a member row only
// updates local state. TODO: navigation slice 5.

type View = "aggregate" | "compare" | "members";

export function UsageKanban() {
  const wsId = useWorkspaceId();
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;

  const [selectedDeptId, setSelectedDeptId] = useState<string>("");
  const [view, setView] = useState<View>("aggregate");
  const [includeChildren, setIncludeChildren] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const treeQ = useQuery(deptTreeOptions(wsId));
  const tree = useMemo(() => treeQ.data ?? [], [treeQ.data]);
  const rootDeptId = tree[0]?.dept_id ?? "";

  // Default landing: once the tree arrives, auto-select the root dept (the
  // "whole company" view). Skipped if the user already picked something.
  useEffect(() => {
    if (!rootDeptId || selectedDeptId) return;
    setSelectedDeptId(rootDeptId);
  }, [rootDeptId, selectedDeptId]);

  const deptName = selectedDeptId ? findDeptName(tree, selectedDeptId) : "";

  // While the tree is loading and nothing is selected, show a page-level
  // skeleton rather than the "select a dept" empty state.
  if (treeQ.isLoading && !tree.length && !selectedDeptId) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-sm font-medium">使用看板</h1>
          </div>
        </PageHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <Skeleton className="h-[60vh] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">使用看板</h1>
          {deptName && (
            <span className="truncate text-xs text-muted-foreground">
              · {deptName}
            </span>
          )}
        </div>
        <PeriodSelect
          value={startDate}
          onChange={(range) => setTimeRange(range)}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6 lg:space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr] lg:gap-6 lg:items-start">
            {/* Left: dept tree. */}
            <DeptTreePanel
              tree={tree}
              loading={treeQ.isLoading}
              error={treeQ.error ? (treeQ.error as Error).message : null}
              selectedId={selectedDeptId}
              onSelect={(id) => {
                setSelectedDeptId(id);
                setView("aggregate");
              }}
            />

            {/* Right: view tabs + include_children switch + content. */}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
                <div className="flex items-center gap-1" role="tablist" aria-label="视角">
                  <ViewTab active={view === "aggregate"} onClick={() => setView("aggregate")}>
                    部门聚合
                  </ViewTab>
                  <ViewTab active={view === "compare"} onClick={() => setView("compare")}>
                    子部门对比
                  </ViewTab>
                  <ViewTab active={view === "members"} onClick={() => setView("members")}>
                    本部门人员
                  </ViewTab>
                </div>
                <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={includeChildren}
                    onCheckedChange={setIncludeChildren}
                    aria-label="包含子部门"
                  />
                  包含子部门
                </label>
              </div>

              {/* Content dispatch. */}
              {view === "members" ? (
                <MembersView
                  deptId={selectedDeptId}
                  startDate={startDate}
                  endDate={endDate}
                  includeChildren={includeChildren}
                  onRowClick={(uid) => setSelectedUser(uid)}
                />
              ) : view === "compare" ? (
                <DeptCompareView
                  deptId={selectedDeptId}
                  startDate={startDate}
                  endDate={endDate}
                  includeChildren={includeChildren}
                  onSelectDept={(id) => {
                    setSelectedDeptId(id);
                    setView("aggregate");
                  }}
                />
              ) : (
                <DeptAggregateView
                  deptId={selectedDeptId}
                  startDate={startDate}
                  endDate={endDate}
                  includeChildren={includeChildren}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedUser && (
        <MemberDetailDialog
          uid={selectedUser}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}

/** A flat tab button (the shadcn Tabs primitive is overkill for 3 inline tabs). */
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors"
          : "rounded-md bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

// PeriodSelect is imported from ../components (shared with the Overview page).


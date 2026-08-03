"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptTreeOptions,
  globalConfigOptions,
  useViewState,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { PageHeader } from "../../layout/page-header";
import { DateRangePicker } from "../components";
import { DeptAggregateView } from "./dept-aggregate-view";
import { DeptCompareView } from "./dept-compare-view";
import {
  DeptTreePopover,
} from "./dept-tree-popover";
import {
  findDeptName,
  UNASSIGNED_DEPT_NODE,
} from "./dept-tree-panel";
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

  const configQ = useQuery(globalConfigOptions(wsId));
  const treeQ = useQuery(deptTreeOptions(wsId));
  const sourceTree = useMemo(() => treeQ.data ?? [], [treeQ.data]);
  const tree = useMemo(
    () => [...sourceTree, UNASSIGNED_DEPT_NODE],
    [sourceTree],
  );
  const rootDeptId = sourceTree[0]?.dept_id ?? "";

  // Default landing: once the tree arrives, auto-select the root dept (the
  // "whole company" view). Skipped if the user already picked something.
  useEffect(() => {
    if (!rootDeptId || selectedDeptId) return;
    setSelectedDeptId(rootDeptId);
  }, [rootDeptId, selectedDeptId]);

  const deptName = selectedDeptId ? findDeptName(tree, selectedDeptId) : "";

  // While the tree is loading and nothing is selected, show a page-level
  // skeleton rather than the "select a dept" empty state.
  if (
    configQ.isLoading ||
    (treeQ.isLoading && !sourceTree.length && !selectedDeptId)
  ) {
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

  if (configQ.data?.chat_stats_enabled !== true) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-sm font-medium">使用看板</h1>
          </div>
        </PageHeader>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-lg border bg-card p-8 text-center">
            <h2 className="text-base font-semibold">平台统计尚未启用</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              当前环境未开启 Chat 平台统计，用量数据暂不可用。
            </p>
          </div>
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
        <DateRangePicker value={timeRange} onChange={setTimeRange} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6 lg:gap-6 lg:px-8">
          {/* Toolbar: dept-tree popover (left) + view tabs + include_children switch. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="视角">
              <DeptTreePopover
                tree={tree}
                loading={treeQ.isLoading}
                error={treeQ.error ? (treeQ.error as Error).message : null}
                selectedId={selectedDeptId}
                onSelect={(id) => {
                  setSelectedDeptId(id);
                  setView("aggregate");
                }}
              />
              <div className="flex items-center gap-1">
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

// DateRangePicker is imported from ../components (shared with the Overview page).

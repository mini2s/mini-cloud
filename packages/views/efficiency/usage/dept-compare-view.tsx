"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptTreeOptions,
  formatNumber,
  usageDeptOverviewOptions,
  type DeptOverviewResp,
  type DeptQuery,
} from "@multica/core/efficiency";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { findDeptChildren } from "./dept-tree-panel";
import { PCT, SortHeader, shortToken, Td, TdNum, Th, ThNum } from "./shared";

// Sub-department comparison (PK) — third tab of the Usage Kanban. Ports the
// source DeptCompareView. Lists the direct children of the selected dept and
// fetches each one's overview (the same usageDeptOverviewOptions call as the
// aggregate view, so cache is shared). Row click switches the parent to that
// child's aggregate view.
//
// Per design decision #2, no navigation — we surface drill-down via an
// onSelectDept callback that updates parent state.

interface DeptCompareViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
  /** Called when the user clicks a child dept row. */
  onSelectDept: (deptId: string) => void;
}

type SortKey =
  | "active_users"
  | "total_requests"
  | "sum_total_tokens"
  | "success_rate"
  | "error_rate"
  | "total_sessions";

const COLS: { key: SortKey; label: string }[] = [
  { key: "active_users", label: "活跃用户" },
  { key: "total_requests", label: "总请求" },
  { key: "sum_total_tokens", label: "总 Token" },
  { key: "total_sessions", label: "会话数" },
  { key: "success_rate", label: "成功率" },
  { key: "error_rate", label: "失败率" },
];

export function DeptCompareView({
  deptId,
  startDate,
  endDate,
  includeChildren,
  onSelectDept,
}: DeptCompareViewProps) {
  const wsId = useWorkspaceId();
  const [sortBy, setSortBy] = useState<SortKey>("total_requests");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const treeQ = useQuery(deptTreeOptions(wsId));
  const tree = treeQ.data ?? [];

  const children = useMemo(() => findDeptChildren(tree, deptId), [tree, deptId]);

  // One overview query per child dept (same queryOptions factory as the
  // aggregate view → cache shared when the user later clicks into a child).
  const queries = useMemo(
    () =>
      children.map((ch) => {
        const q: DeptQuery = {
          deptId: ch.dept_id,
          start: startDate,
          end: endDate,
          includeChildren,
        };
        return usageDeptOverviewOptions(wsId, q);
      }),
    [children, wsId, startDate, endDate, includeChildren],
  );
  const results = useQueries({ queries });

  const rows = useMemo(() => {
    const merged = children.map((ch, i) => ({
      dept: ch,
      ov: (results[i]?.data ?? undefined) as DeptOverviewResp | undefined,
    }));
    const get = (ov: DeptOverviewResp | undefined, k: SortKey) =>
      ov ? Number(ov[k] ?? 0) : 0;
    merged.sort((a, b) => {
      const diff = get(a.ov, sortBy) - get(b.ov, sortBy);
      return sortOrder === "desc" ? -diff : diff;
    });
    return merged;
  }, [children, results, sortBy, sortOrder]);

  const loading = results.some((r) => r.isLoading);

  const handleSort = (field: SortKey) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  if (treeQ.isLoading) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (!children.length) {
    return (
      <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          子部门对比
        </h2>
        <div className="mt-4 flex min-h-[10rem] items-center justify-center text-sm text-muted-foreground">
          该部门下无子部门可对比
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            子部门对比（PK）
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {children.length} 个子部门 ·{" "}
            {includeChildren ? "含各子部门下级（整棵子树）" : "仅各子部门直属"} · 点行下钻
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <ThNum>#</ThNum>
              <Th>子部门</Th>
              {COLS.map((c) => (
                <ThNum key={c.key}>
                  <SortHeader
                    label={c.label}
                    active={sortBy === c.key}
                    desc={sortOrder === "desc"}
                    onClick={() => handleSort(c.key)}
                  />
                </ThNum>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.every((r) => !r.ov) ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={r.dept.dept_id}
                  tabIndex={0}
                  onClick={() => onSelectDept(r.dept.dept_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSelectDept(r.dept.dept_id);
                  }}
                  className={`${DRILLDOWN_ROW_CLASS} border-b border-border/50`}
                >
                  <TdNum>{i + 1}</TdNum>
                  <Td>
                    <span
                      className="max-w-[220px] truncate align-middle text-primary"
                      title={r.dept.dept_name}
                    >
                      {r.dept.dept_name}
                    </span>
                    {(r.dept.child_dept_count ?? 0) > 0 && (
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {r.dept.child_dept_count}
                      </span>
                    )}
                  </Td>
                  <TdNum>{formatNumber(r.ov?.active_users)}</TdNum>
                  <TdNum>{formatNumber(r.ov?.total_requests)}</TdNum>
                  <TdNum title={formatNumber(r.ov?.sum_total_tokens)}>
                    {shortToken(r.ov?.sum_total_tokens)}
                  </TdNum>
                  <TdNum>{formatNumber(r.ov?.total_sessions)}</TdNum>
                  <TdNum>{PCT(r.ov?.success_rate)}</TdNum>
                  <TdNum>{PCT(r.ov?.error_rate)}</TdNum>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sortable column header + table cell primitives (Th/ThNum/Td/TdNum) are
 * imported from ./shared — single source of truth shared with the other
 * usage views. */

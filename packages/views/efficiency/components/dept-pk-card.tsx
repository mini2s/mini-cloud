"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptRankingOptions,
  deptTreeOptions,
  formatNumber,
  formatV2Ratio,
  glossaryTip,
} from "@multica/core/efficiency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { RankingBarChart, type BarDatum } from "../charts";
import type { DeptTreeNode } from "@multica/core/efficiency";

// Department PK: pick a parent level from the dept tree, then rank its direct
// child departments by calendar efficiency (top 5) as a horizontal bar chart.
// Data: dept-tree (for the parent selector) + dept-tree/ranking?parent_dept_id=
// (one aggregated call returning each direct child's whole-subtree summary).
// Default ranks "whole-company first-level" (parent_dept_id empty → backend
// uses the configured root).
//
// Navigation: the source rows were clickable and drilled into the org detail
// page via useNavigate (react-router). packages/views cannot import
// react-router-dom and the detail pages don't exist yet, so this card is
// display-only for now. TODO: navigation wired in slice 5.

interface DeptPKCardProps {
  startDate?: string;
  endDate?: string;
}

const ROOT = "__root__";

/** Collect every node that has children, as selector options (indent shows depth). */
function collectParents(
  nodes: DeptTreeNode[],
  depth = 0,
  acc: { id: string; label: string }[] = [],
): { id: string; label: string }[] {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      acc.push({
        id: n.dept_id,
        label: `${"　".repeat(depth)}${n.dept_name}`,
      });
      collectParents(n.children, depth + 1, acc);
    }
  }
  return acc;
}

export function DeptPKCard({ startDate, endDate }: DeptPKCardProps) {
  const wsId = useWorkspaceId();
  const treeQ = useQuery(deptTreeOptions(wsId));
  const tree = treeQ.data ?? [];
  const [parentId, setParentId] = useState<string>(ROOT);

  const parentOptions = useMemo(() => collectParents(tree), [tree]);

  // One aggregation: ROOT → parent_dept_id empty (backend default = configured
  // root, ranks "whole-company first-level"); otherwise the selected parent id.
  const rankingQ = useQuery(
    deptRankingOptions(
      wsId,
      parentId === ROOT ? undefined : parentId,
      startDate,
      endDate,
    ),
  );

  // Sort by calendar_ratio desc (nulls last), take top 5.
  const top5 = useMemo(() => {
    const rows = (rankingQ.data?.items ?? []).filter(
      (it) => it.summary?.calendar_ratio != null,
    );
    rows.sort(
      (a, b) =>
        (b.summary.calendar_ratio ?? -Infinity) -
        (a.summary.calendar_ratio ?? -Infinity),
    );
    return rows.slice(0, 5);
  }, [rankingQ.data]);

  // Narrow to the chart's {label, value} shape. value is the efficiency %.
  // Tooltip carries member/need counts via the chart's default tooltip; the
  // source's richer tooltip is simplified to label + value here.
  const chartData: BarDatum[] = useMemo(
    () =>
      top5.map((r) => ({
        label: r.dept_name,
        value: Number(((r.summary.calendar_ratio ?? 0) * 100).toFixed(1)),
      })),
    [top5],
  );

  const loading = treeQ.isLoading || rankingQ.isLoading;
  const errored = treeQ.isError || rankingQ.isError;

  return (
    <div className="flex flex-col rounded-lg border bg-card p-5 transition-shadow hover:shadow-lg md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            部门 PK
          </h2>
          <span
            className="inline-flex cursor-help text-muted-foreground"
            title={glossaryTip("dept_efficiency")}
            aria-label={glossaryTip("dept_efficiency")}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
        </div>
        <Select value={parentId} onValueChange={(v) => setParentId(v ?? ROOT)}>
          <SelectTrigger size="sm" className="max-w-[10rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT}>全公司（一级部门）</SelectItem>
            {parentOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errored ? (
        <div className="flex min-h-[14rem] flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          部门数据暂不可用（需 dept-sync 服务连通）
        </div>
      ) : loading ? (
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-md" />
          ))}
        </div>
      ) : top5.length === 0 ? (
        <div className="flex min-h-[14rem] flex-1 items-center justify-center text-sm text-muted-foreground">
          该层级暂无可计入部门数据
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <RankingBarChart data={chartData} />
          {/* Supplementary member / need counts under the bars — the chart's
              default tooltip only shows label+value, so the per-dept counts
              (which the source surfaced inline) are listed compactly here to
              preserve that context. Display-only. */}
          <ul className="space-y-1 text-xs text-muted-foreground">
            {top5.map((r, i) => (
              <li key={r.dept_id} className="flex items-center gap-2">
                <span className="w-4 shrink-0 tabular-nums text-muted-foreground/70">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate" title={r.dept_name}>
                  {r.dept_name}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatNumber(r.summary.kanban_member_count)} 人 · 需求{" "}
                  {formatNumber(r.summary.merged_need_count)} ·{" "}
                  {formatV2Ratio(r.summary.calendar_ratio)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

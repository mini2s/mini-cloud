"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  efficiencyAggregateOptions,
  formatNumber,
  isoWeekOf,
  weekLabel,
  type UserProductivityV2,
} from "@multica/core/efficiency";
import { DualAxisTrendChart } from "../charts";

// Shared "weekly contribution trend" section for the 4 contribution entity
// views (org / user / project / repo). Ports the source
// UserContribution.ContributionTrend (ECharts, 3 series, dual Y axis) onto
// the recharts DualAxisTrendChart (Bar = code lines on the left axis, Line =
// merged needs + commits on the right axis).
//
// Data path (matches source AggregateContribution): efficiencyAggregateOptions
// with no userId returns the full user×week rows (UserProductivityV2[]) from
// /v2/efficiency. Those are bucketed by ISO week and SUMMED across users per
// week → a company-wide weekly contribution trend. Pass `userId` to scope to
// one user (source FocusedContribution does the same for the per-user trend).
//
// Magnitude problem this solves: commit_diff_lines (often thousands) dwarfs
// merged_need_count + commit_count (single digits to low hundreds). One Y
// axis flattens the small series to noise → code lines on the left axis
// (Bar), merged-needs+commits on the right axis (Line).

interface ContribTrendWeek {
  key: string;
  label: string;
  monday: number;
  diffLines: number;
  smallCounts: number;
}

/** Bucket user×week rows by ISO week, summing contribution counts per week. */
function aggregateContribByWeek(rows: UserProductivityV2[]): ContribTrendWeek[] {
  const buckets = new Map<string, ContribTrendWeek>();
  for (const r of rows) {
    const wk = isoWeekOf(r.week_start);
    if (!wk) continue;
    const cur =
      buckets.get(wk.key) || {
        key: wk.key,
        label: weekLabel(wk.monday),
        monday: wk.monday.getTime(),
        diffLines: 0,
        smallCounts: 0,
      };
    cur.diffLines += r.commit_diff_lines || 0;
    // Secondary axis = merged needs + commits (both small counts relative to
    // code lines; combined into one line so the dual-axis chart stays a clean
    // Bar + Line pair rather than a 3-series mix).
    cur.smallCounts += (r.merged_need_count || 0) + (r.commit_count || 0);
    buckets.set(wk.key, cur);
  }
  return Array.from(buckets.values()).sort((a, b) => a.monday - b.monday);
}

interface ContributionTrendSectionProps {
  startDate: string;
  endDate: string;
  /** Optional userId to scope the trend to one user (focused mode). */
  userId?: string;
  /** Section subtitle (who/what the trend covers). */
  subtitle?: string;
}

export function ContributionTrendSection({
  startDate,
  endDate,
  userId,
  subtitle,
}: ContributionTrendSectionProps) {
  const wsId = useWorkspaceId();
  const q = useQuery(efficiencyAggregateOptions(wsId, startDate, endDate, userId));
  const rows = useMemo<UserProductivityV2[]>(
    () => q.data?.data ?? [],
    [q.data?.data],
  );
  const points = useMemo(() => aggregateContribByWeek(rows), [rows]);

  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-card-foreground">
            按周贡献趋势
          </span>
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">按 ISO 周 · 看板派生</span>
      </div>
      <div className="p-4">
        {q.error ? (
          <div className="flex min-h-[16rem] items-center justify-center text-sm text-destructive">
            加载失败：{(q.error as Error).message}
          </div>
        ) : q.isLoading ? (
          <div className="h-[280px] w-full animate-pulse rounded-md bg-muted" />
        ) : points.length === 0 ? (
          <div className="flex min-h-[16rem] items-center justify-center text-sm text-muted-foreground">
            暂无贡献趋势数据
          </div>
        ) : (
          <DualAxisTrendChart
            data={points.map((p) => ({
              label: p.label,
              primary: p.diffLines,
              secondary: p.smallCounts,
            }))}
            primaryLabel="代码行"
            secondaryLabel="合并需求/提交"
            formatLeftY={(v) => formatNumber(v, 0)}
          />
        )}
      </div>
    </section>
  );
}

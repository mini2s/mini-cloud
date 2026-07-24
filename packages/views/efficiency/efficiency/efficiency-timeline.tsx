"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  efficiencyAggregateOptions,
  isoWeekOf,
  weekLabel,
  type UserProductivityV2,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  MultiTrendChart,
  type MultiTrendPoint,
  type MultiTrendSeries,
} from "../charts";

// Efficiency trend — weekly efficiency (%) built from the /v2/efficiency
// user×week aggregate rows (the only efficiency endpoint that carries a
// weekly time axis). The source's DimensionTrend does the same bucketing
// in ECharts; we keep the bucketing verbatim (ISO-week Monday bucket,
// average the decimal efficiency_ratio × 100 → %) but render with recharts
// via MultiTrendChart (calendar + work ratio as two translucent bands).
//
// Scope (matches source): this endpoint is user×week only. Org aggregation
// = all users (no userId). Project/repo have no weekly axis at this
// endpoint → the parent renders a "caliber N/A" note instead of this chart.
//
// Caliber note: efficiency_ratio / work_efficiency_ratio are DECIMAL
// multipliers (2.8 => 2.8x). ×100 yields the % shown. Null/non-finite
// rows are dropped (the same skip the source applies).

interface EfficiencyTimelineProps {
  startDate: string;
  endDate: string;
  /** Optional userId to restrict to a single user (focused mode, slice 5). */
  userId?: string;
}

export function EfficiencyTimeline({
  startDate,
  endDate,
  userId,
}: EfficiencyTimelineProps) {
  const wsId = useWorkspaceId();
  const q = useQuery(
    efficiencyAggregateOptions(wsId, startDate, endDate, userId),
  );

  const rows = q.data?.data ?? [];

  // Bucket user×week rows by ISO week, averaging each ratio caliber.
  // Emits {label, calendar, work} per week sorted by Monday.
  const points = useMemo(() => buildWeeklyPoints(rows), [rows]);

  return (
    <div className="rounded-lg border bg-card p-4 lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          提效趋势
        </h2>
        <span className="text-right text-xs text-muted-foreground">
          全部用户 · 按 ISO 周平均提效率
        </span>
      </div>

      {q.error ? (
        <div className="py-12 text-center text-sm text-destructive">
          加载失败：{(q.error as Error).message}
        </div>
      ) : q.isLoading ? (
        <Skeleton className="h-[280px] w-full rounded-md" />
      ) : points.length < 2 ? (
        <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
          <TrendIcon />
          <p className="text-sm text-muted-foreground">
            趋势数据积累中（当前样本较少）
          </p>
          {points.length === 1 && points[0] && (
            <p className="text-xs text-muted-foreground">
              本期数据集中在单周（{points[0].label} · 平均{" "}
              {Number(points[0].calendar).toFixed(1)}%）
            </p>
          )}
        </div>
      ) : (
        <MultiTrendChart
          data={points}
          series={SERIES}
          formatY={(v) => `${v.toFixed(0)}%`}
        />
      )}
    </div>
  );
}

// Two translucent bands (calendar + work efficiency %). Plain array (not
// `as const`) so it satisfies MultiTrendSeries[] (mutable).
const SERIES: MultiTrendSeries[] = [
  { key: "calendar", name: "日历提效率", color: "var(--chart-1)" },
  { key: "work", name: "人力提效率", color: "var(--chart-2)" },
];

interface WeekAcc {
  label: string;
  monday: number;
  calSum: number;
  calCount: number;
  workSum: number;
  workCount: number;
}

/** Bucket user×week rows into per-week average ratio percentages. */
function buildWeeklyPoints(rows: UserProductivityV2[]): MultiTrendPoint[] {
  const buckets = new Map<string, WeekAcc>();
  for (const r of rows) {
    const wk = isoWeekOf(r.week_start);
    if (!wk) continue;
    let acc = buckets.get(wk.key);
    if (!acc) {
      acc = {
        label: weekLabel(wk.monday),
        monday: wk.monday.getTime(),
        calSum: 0,
        calCount: 0,
        workSum: 0,
        workCount: 0,
      };
      buckets.set(wk.key, acc);
    }
    const cal = r.efficiency_ratio;
    if (cal != null && Number.isFinite(cal)) {
      acc.calSum += cal;
      acc.calCount += 1;
    }
    const work = r.work_efficiency_ratio;
    if (work != null && Number.isFinite(work)) {
      acc.workSum += work;
      acc.workCount += 1;
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.monday - b.monday)
    .map((acc) => ({
      label: acc.label,
      // decimal → % (null when no samples in this caliber for the week)
      calendar:
        acc.calCount > 0 ? Number(((acc.calSum / acc.calCount) * 100).toFixed(2)) : 0,
      work:
        acc.workCount > 0
          ? Number(((acc.workSum / acc.workCount) * 100).toFixed(2))
          : 0,
    }));
}

function TrendIcon() {
  return (
    <svg
      className="h-10 w-10 text-muted-foreground/40"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  );
}

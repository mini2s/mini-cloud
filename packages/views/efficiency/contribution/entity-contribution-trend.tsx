"use client";

import { useMemo } from "react";
import { formatNumber, type EntityTrendPoint } from "@multica/core/efficiency";
import { TrendChart } from "../charts";

type ContributionTrendMetric = "needs" | "commits" | "efficiency";

const METRICS: Record<
  ContributionTrendMetric,
  { label: string; pick: (point: EntityTrendPoint) => number }
> = {
  needs: { label: "需求数", pick: (point) => point.need_count },
  commits: { label: "提交数", pick: (point) => point.commit_count },
  efficiency: {
    label: "提效比",
    pick: (point) => point.efficiency_pct,
  },
};

export function EntityContributionTrend({
  points,
  loading = false,
  error,
  subtitle,
  metric,
  title = "贡献趋势",
}: {
  points?: EntityTrendPoint[];
  loading?: boolean;
  error?: string | null;
  subtitle: string;
  metric: ContributionTrendMetric;
  title?: string;
}) {
  const config = METRICS[metric];
  const rows = useMemo(
    () =>
      [...(points ?? [])].sort(
        (a, b) =>
          new Date(a.week_start).getTime() - new Date(b.week_start).getTime(),
      ),
    [points],
  );

  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-card-foreground">
            {title}
          </span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          按 ISO 周 · {config.label}
        </span>
      </div>
      <div className="p-4">
        {error ? (
          <div className="flex min-h-[16rem] items-center justify-center text-sm text-destructive">
            加载失败：{error}
          </div>
        ) : loading ? (
          <div className="h-[280px] w-full animate-pulse rounded-md bg-muted" />
        ) : rows.length < 2 ? (
          <div className="flex min-h-[16rem] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <span>趋势数据积累中（当前样本较少）</span>
            {rows.length === 1 && (
              <span className="text-xs">
                本期集中在 {rows[0]?.week_start} 起的一周 · {config.label}{" "}
                {formatNumber(config.pick(rows[0]!))}
              </span>
            )}
          </div>
        ) : (
          <TrendChart
            data={rows.map((point) => ({
              label: point.week_start.slice(5),
              value: config.pick(point),
            }))}
          />
        )}
      </div>
    </section>
  );
}

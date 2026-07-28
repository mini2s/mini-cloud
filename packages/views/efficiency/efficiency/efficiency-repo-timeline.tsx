"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { repoTrendOptions } from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  MultiTrendChart,
  type MultiTrendPoint,
  type MultiTrendSeries,
} from "../charts";

const SERIES: MultiTrendSeries[] = [
  { key: "efficiency", name: "平均提效率", color: "var(--chart-1)" },
];

export function EfficiencyRepoTimeline({
  startDate,
  endDate,
  repoAddr,
}: {
  startDate: string;
  endDate: string;
  repoAddr?: string;
}) {
  const wsId = useWorkspaceId();
  const q = useQuery(
    repoTrendOptions(wsId, { repoAddr, startDate, endDate }),
  );
  const points = useMemo<MultiTrendPoint[]>(
    () =>
      (q.data?.data ?? []).map((point) => ({
        label: point.week_start.slice(5),
        efficiency: point.efficiency_pct,
      })),
    [q.data?.data],
  );

  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          提效趋势
        </h2>
        <span className="text-right text-xs text-muted-foreground">
          {repoAddr ? `仓库 · ${repoAddr}` : "全部仓库"} · 按 ISO 周（commits
          聚合）
        </span>
      </div>

      {q.error ? (
        <div className="py-12 text-center text-sm text-destructive">
          加载失败：{(q.error as Error).message}
        </div>
      ) : q.isLoading ? (
        <Skeleton className="h-[280px] w-full rounded-md" />
      ) : points.length < 2 ? (
        <div className="flex h-[280px] items-center justify-center text-center text-sm text-muted-foreground">
          趋势数据积累中（当前样本较少）
        </div>
      ) : (
        <MultiTrendChart
          data={points}
          series={SERIES}
          formatY={(value) => `${value.toFixed(1)}%`}
        />
      )}
    </section>
  );
}

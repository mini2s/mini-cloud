"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allNeedsOptions,
  aggregateByWeek,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { TrendChart, type TrendPoint } from "../charts";

// Weekly efficiency trend. Aggregates all needs into ISO weeks (mean
// efficiency ratio per week) and draws the area trend. The source used
// ECharts; this is rewritten on the ready TrendChart (recharts). Data shape
// narrows from the source's WeekPoint to TrendChart's {label, value} where
// value is the avg efficiency % rounded to 2dp.
//
// Empty state mirrors the source: fewer than 2 weekly points means the trend
// is "accumulating" — we show a hint rather than a single-point line.

interface TrendCardProps {
  startDate?: string;
  endDate?: string;
}

export function TrendCard({ startDate, endDate }: TrendCardProps) {
  const wsId = useWorkspaceId();
  const needsQ = useQuery(allNeedsOptions(wsId, startDate, endDate));

  const points = useMemo(
    () => aggregateByWeek(needsQ.data ?? []),
    [needsQ.data],
  );

  // Narrow to the chart's {label, value} shape.
  const chartData: TrendPoint[] = useMemo(
    () =>
      points.map((pt) => ({
        label: pt.label,
        value: Number(pt.avgPct.toFixed(2)),
      })),
    [points],
  );

  return (
    <div className="flex min-h-[20rem] flex-col rounded-lg border bg-card shadow-sm p-5 transition-shadow hover:shadow-lg md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          提效趋势
        </h2>
        <span className="text-xs text-muted-foreground">
          按 ISO 周 · 可计入需求平均日历提效
        </span>
      </div>

      {needsQ.error ? (
        <Centered>
          加载失败：{(needsQ.error as Error).message}
        </Centered>
      ) : needsQ.isLoading ? (
        <Skeleton className="min-h-[16rem] flex-1 rounded-xl" />
      ) : points.length < 2 ? (
        <Centered>
          <div className="flex flex-col items-center gap-2 text-center">
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
            <p className="text-sm text-muted-foreground">
              趋势数据积累中（当前样本较少）
            </p>
            {(() => {
              const only = points[0];
              if (!only) return null;
              return (
                <p className="text-xs text-muted-foreground">
                  本期可计入需求集中在单周（{only.label} 起 · {only.count} 个
                  · 平均 {only.avgPct.toFixed(1)}%）
                </p>
              );
            })()}
          </div>
        </Centered>
      ) : (
        <div className="flex-1">
          <TrendChart data={chartData} />
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[16rem] flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  buildBuckets,
  chatCostTrendOptions,
  chatGlobalDailyOptions,
  formatNumber,
  globalConfigOptions,
  type ChatCostTrendRow,
  type ChatDailyGlobal,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { KpiCard } from "../../runtimes/components/shared";
import {
  MultiTrendChart,
  type MultiTrendPoint,
  type MultiTrendSeries,
} from "../charts";
import { chartColorFor } from "../usage/shared";
import { useEfficiencyFormatters } from "../i18n";
import { GranularityToggle, useGranularity } from "./granularity-toggle";

interface PlatformObjectiveCardProps {
  startDate?: string;
  endDate?: string;
}

function shortPlatformNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatRatio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "-"
    : `${(value * 100).toFixed(2)}%`;
}

export function PlatformObjectiveCard({
  startDate,
  endDate,
}: PlatformObjectiveCardProps) {
  const wsId = useWorkspaceId();
  const { formatBucketLabel, granularityLabel } =
    useEfficiencyFormatters();
  const start = startDate ?? "";
  const end = endDate ?? "";
  const configQ = useQuery(globalConfigOptions(wsId));
  const chatEnabled = configQ.data?.chat_stats_enabled === true;
  const enabled =
    chatEnabled && start.length > 0 && end.length > 0 && start <= end;

  const dailyQ = useQuery({
    ...chatGlobalDailyOptions(wsId, start, end),
    enabled,
  });
  const costQ = useQuery({
    ...chatCostTrendOptions(wsId, start, end, "all"),
    enabled,
  });

  const daily = useMemo(() => dailyQ.data ?? [], [dailyQ.data]);
  const costRows = useMemo(() => costQ.data ?? [], [costQ.data]);
  const { gran, setGran, options: granOptions } = useGranularity(start, end);

  const aggregate = useMemo(() => {
    const sum = (pick: (row: ChatDailyGlobal) => number | null | undefined) =>
      daily.reduce((total, row) => total + (pick(row) || 0), 0);
    const requests = sum((row) => row.total_requests);
    const requestsIncludingErrors = sum((row) =>
      row.total_requests_including_errors > 0
        ? row.total_requests_including_errors
        : row.total_requests,
    );
    const errors = sum((row) => row.total_error_requests);
    const errorRate =
      requestsIncludingErrors > 0 ? errors / requestsIncludingErrors : null;

    return {
      requests,
      totalTokens: sum((row) => row.sum_total_tokens),
      cacheTokens: sum((row) => row.sum_cache_tokens),
      promptTokens: sum((row) => row.sum_prompt_tokens),
      cost: sum((row) => row.estimated_total_cost),
      peakUsers: daily.reduce(
        (peak, row) => Math.max(peak, row.total_users),
        0,
      ),
      avgUsers:
        daily.length > 0
          ? Math.round(sum((row) => row.total_users) / daily.length)
          : 0,
      errorRate,
      successRate: errorRate == null ? null : 1 - errorRate,
    };
  }, [daily]);

  const cacheHitRate =
    aggregate.promptTokens > 0
      ? aggregate.cacheTokens / aggregate.promptTokens
      : null;

  const trendData = useMemo<MultiTrendPoint[]>(() => {
    if (costRows.length > 0) {
      return bucketCostRows(
        costRows,
        gran,
        start,
        end,
        formatBucketLabel,
      );
    }
    const byDate = new Map(daily.map((row) => [row.date, row]));
    return buildBuckets(
      daily.map((row) => row.date),
      gran,
      { start, end },
      formatBucketLabel,
    ).map((bucket) => ({
      label: bucket.label,
      requests: bucket.dates.reduce(
        (total, date) => total + (byDate.get(date)?.total_requests ?? 0),
        0,
      ),
    }));
  }, [costRows, daily, end, formatBucketLabel, gran, start]);

  const costTrend = costRows.length > 0;
  const trendSeries: MultiTrendSeries[] = [
    {
      key: costTrend ? "cost" : "requests",
      name: costTrend ? "AI 花费（¥）" : "请求量",
      color: chartColorFor(costTrend ? 3 : 2),
    },
  ];

  if (configQ.isLoading) return null;

  const wrap = (children: ReactNode) => (
    <section className="flex flex-col rounded-lg border bg-card p-5 shadow-sm transition-shadow hover:shadow-lg md:p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          平台客观指标
        </h2>
        <span className="text-[11px] text-muted-foreground">
          平台客观采集 · chat-indicator-statistics
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        AI 调用真实花费 / 请求 / Token，按全局时间范围聚合。口径独立于上方看板派生（平台¥=Token
        调用花费，≠ 看板折算人天）。
      </p>
      {children}
    </section>
  );

  if (!chatEnabled) {
    return wrap(
      <div className="flex min-h-[7rem] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示
        AI 调用花费 / 请求 / Token 等客观数据。
      </div>,
    );
  }

  const fatalError = dailyQ.error || costQ.error;
  if (fatalError) {
    return wrap(
      <div className="flex min-h-[7rem] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        平台指标暂不可用（{(fatalError as Error).message}）。恢复后将自动展示。
      </div>,
    );
  }

  if (dailyQ.isLoading || costQ.isLoading) {
    return wrap(
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-lg" />
      </div>,
    );
  }

  const kpis = [
    {
      label: "总 AI 花费",
      value: `¥${aggregate.cost.toFixed(2)}`,
      hint: "估算 · Token 调用花费",
    },
    {
      label: "总请求",
      value: formatNumber(aggregate.requests),
      hint: `总 Token ${shortPlatformNumber(aggregate.totalTokens)}`,
    },
    {
      label: "活跃用户（峰值）",
      value: formatNumber(aggregate.peakUsers),
      hint: `日均 ${formatNumber(aggregate.avgUsers)} · 单日去重`,
    },
    {
      label: "成功率",
      value: formatRatio(aggregate.successRate),
      hint:
        aggregate.errorRate == null
          ? undefined
          : `错误率 ${formatRatio(aggregate.errorRate)}`,
    },
    {
      label: "缓存命中率",
      value: formatRatio(cacheHitRate),
      hint: `缓存 Token ${shortPlatformNumber(aggregate.cacheTokens)}`,
    },
  ];

  return wrap(
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border bg-card">
            <KpiCard
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">
              {costTrend ? "AI 花费趋势" : "请求量趋势"}（
              {granularityLabel(gran)}）
            </h3>
            <p className="text-xs text-muted-foreground">
              {costTrend ? "估算（chat-indicator-statistics）" : "含错误请求"}
            </p>
          </div>
          <GranularityToggle
            value={gran}
            options={granOptions}
            onChange={setGran}
          />
        </div>
        <div className="p-4">
          {trendData.length > 0 ? (
            <MultiTrendChart
              data={trendData}
              series={trendSeries}
              formatY={(value) =>
                costTrend
                  ? `¥${shortPlatformNumber(value)}`
                  : shortPlatformNumber(value)
              }
            />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          )}
        </div>
      </div>
    </div>,
  );
}

function bucketCostRows(
  rows: ChatCostTrendRow[],
  granularity: Parameters<typeof buildBuckets>[1],
  start: string,
  end: string,
  formatLabel: Parameters<typeof buildBuckets>[3],
): MultiTrendPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return buildBuckets(
    rows.map((row) => row.date),
    granularity,
    { start, end },
    formatLabel,
  ).map((bucket) => ({
    label: bucket.label,
    cost: Number(
      bucket.dates
        .reduce(
          (total, date) => total + (byDate.get(date)?.total_cost ?? 0),
          0,
        )
        .toFixed(2),
    ),
  }));
}

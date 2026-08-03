"use client";

import { useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatGlobalDailyOptions,
  chatUsersRankingOptions,
  formatNumber,
  globalConfigOptions,
  MOCK_ENABLED,
  type ChatDailyGlobal,
  type ChatUserRankingRow,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { PageHeader } from "../../layout/page-header";
import {
  MultiTrendChart,
  type MultiTrendPoint,
} from "../charts";
import { chartColorFor, Td, TdNum, Th, ThNum } from "../usage/shared";
import { Section } from "./shared";

const PRESETS = [
  { label: "近7天", days: 7 },
  { label: "近30天", days: 30 },
  { label: "近90天", days: 90 },
];

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeForDays(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: toDateString(start), end: toDateString(end) };
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function rowErrorRate(row: ChatUserRankingRow): number | null {
  const total = row.success_requests + row.error_requests;
  return total > 0 ? row.error_requests / total : null;
}

export function PlatformHealthPage() {
  const wsId = useWorkspaceId();
  const [{ start, end }, setRange] = useState(() => rangeForDays(30));
  const [presetDays, setPresetDays] = useState<number | null>(30);
  const rangeValid = !!start && !!end && start <= end;

  const configQ = useQuery(globalConfigOptions(wsId));
  const configResolved = MOCK_ENABLED || !configQ.isLoading;
  const chatEnabled =
    MOCK_ENABLED || configQ.data?.chat_stats_enabled === true;
  const enabled = chatEnabled && rangeValid;

  const rankingQ = useQuery({
    ...chatUsersRankingOptions(
      wsId,
      start,
      end,
      "error_rate",
      undefined,
      50,
    ),
    enabled,
  });
  const dailyQ = useQuery({
    ...chatGlobalDailyOptions(wsId, start, end),
    enabled,
  });

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <HeartPulse className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">AI 服务健康度</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 成功率 / 错误率 / 时延 · 平台客观采集
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => (
          <Button
            key={preset.days}
            type="button"
            size="sm"
            variant={presetDays === preset.days ? "default" : "outline"}
            onClick={() => {
              setPresetDays(preset.days);
              setRange(rangeForDays(preset.days));
            }}
            aria-pressed={presetDays === preset.days}
          >
            {preset.label}
          </Button>
        ))}
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span>从</span>
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(event) => {
              setPresetDays(null);
              setRange((range) => ({ ...range, start: event.target.value }));
            }}
            aria-label="健康度开始日期"
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span>至</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(event) => {
              setPresetDays(null);
              setRange((range) => ({ ...range, end: event.target.value }));
            }}
            aria-label="健康度结束日期"
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </PageHeader>
  );

  if (!configResolved) {
    return <PageFrame header={header}><HealthSkeleton /></PageFrame>;
  }

  if (!chatEnabled) {
    return (
      <PageFrame header={header}>
        <div className="flex min-h-[12rem] items-center justify-center rounded-lg border bg-card px-4 text-center text-sm text-muted-foreground">
          当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示 AI 服务健康度。
        </div>
      </PageFrame>
    );
  }

  const errors = [rankingQ.error, dailyQ.error].filter(Boolean);
  const rows = rankingQ.data?.data ?? [];

  return (
    <PageFrame header={header}>
      <CaliberNotice />
      {!rangeValid ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          请选择有效的起止日期（开始 ≤ 结束）
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {errors
            .map((error) => (error as Error)?.message || "加载健康数据失败")
            .join("；")}
        </div>
      ) : null}
      {rankingQ.isLoading || dailyQ.isLoading ? (
        <HealthSkeleton />
      ) : (
        <HealthBody rows={rows} daily={dailyQ.data ?? []} />
      )}
    </PageFrame>
  );
}

function PageFrame({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}

function HealthBody({
  rows,
  daily,
}: {
  rows: ChatUserRankingRow[];
  daily: ChatDailyGlobal[];
}) {
  const total = rows.reduce((sum, row) => sum + row.total_requests, 0);
  const success = rows.reduce((sum, row) => sum + row.success_requests, 0);
  const errors = rows.reduce((sum, row) => sum + row.error_requests, 0);
  const denominator = success + errors;
  const errorRate = denominator > 0 ? errors / denominator : null;
  const successRate = errorRate == null ? null : 1 - errorRate;
  const weightedDuration = rows.reduce(
    (sum, row) => sum + row.avg_duration_ms * row.total_requests,
    0,
  );
  const avgDuration = total > 0 ? weightedDuration / total : null;
  const trend = useMemo(() => weeklyErrorTrend(daily), [daily]);
  const metrics = [
    { label: "成功率", value: pct(successRate), hint: "1 − 错误率" },
    {
      label: "错误率",
      value: pct(errorRate),
      hint: `错误请求 ${formatNumber(errors)}`,
      alert: (errorRate ?? 0) > 0.05,
    },
    {
      label: "平均时延",
      value: avgDuration == null ? "-" : `${avgDuration.toFixed(0)} ms`,
      hint: "按请求数加权",
    },
    {
      label: "总请求（Top 50）",
      value: formatNumber(total),
      hint: "区间用户排行样本",
    },
  ];

  return (
    <>
      <Section title="错误率趋势（AI 服务健康度）" count="全部用户 · 按周" bodyClassName="p-4">
        {trend.length > 0 ? (
          <MultiTrendChart
            data={trend}
            series={[
              {
                key: "errorRate",
                name: "错误率",
                color: chartColorFor(4),
              },
            ]}
            formatY={(value) => `${value}%`}
          />
        ) : (
          <EmptyHint />
        )}
      </Section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="text-xs font-medium text-muted-foreground">
              {metric.label}
            </div>
            <div
              className={`mt-1 text-xl font-bold tabular-nums ${
                metric.alert ? "text-destructive" : "text-card-foreground"
              }`}
            >
              {metric.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {metric.hint}
            </div>
          </div>
        ))}
      </div>

      <Section
        title="用户健康度排行（AI 服务）"
        count="区间聚合 · Top 50 · 按错误率倒序"
        bodyClassName="max-h-[520px] overflow-auto"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b">
              <ThNum>排名</ThNum>
              <Th>Universal ID</Th>
              <Th>用户名</Th>
              <ThNum>请求数</ThNum>
              <ThNum>错误率</ThNum>
              <ThNum>错误请求</ThNum>
              <ThNum>平均时延</ThNum>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const errorRate = rowErrorRate(row);
                return (
                  <tr key={row.universal_id || index} className="border-b last:border-0">
                    <TdNum>{index + 1}</TdNum>
                    <Td>
                      <span className="font-mono text-xs">
                        {row.universal_id || "-"}
                      </span>
                    </Td>
                    <Td>{row.username || "-"}</Td>
                    <TdNum>{formatNumber(row.total_requests)}</TdNum>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                        (errorRate ?? 0) > 0.05
                          ? "text-destructive"
                          : "text-card-foreground"
                      }`}
                    >
                      {pct(errorRate)}
                    </td>
                    <TdNum>{formatNumber(row.error_requests)}</TdNum>
                    <TdNum>{row.avg_duration_ms.toFixed(0)} ms</TdNum>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function weeklyErrorTrend(daily: ChatDailyGlobal[]): MultiTrendPoint[] {
  const rows = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const points: MultiTrendPoint[] = [];
  for (let index = 0; index < rows.length; index += 7) {
    const bucket = rows.slice(index, index + 7);
    if (bucket.length === 0) continue;
    const errors = bucket.reduce(
      (sum, row) => sum + row.total_error_requests,
      0,
    );
    const total = bucket.reduce(
      (sum, row) =>
        sum +
        (row.total_requests_including_errors > 0
          ? row.total_requests_including_errors
          : row.total_requests),
      0,
    );
    points.push({
      label:
        bucket.length === 1
          ? bucket[0]!.date.slice(5, 10)
          : `${bucket[0]!.date.slice(5, 10)} 至 ${bucket.at(-1)!.date.slice(5, 10)}`,
      errorRate: total > 0 ? +((errors / total) * 100).toFixed(2) : 0,
    });
  }
  return points;
}

function CaliberNotice() {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border-l-4 border-l-warning bg-warning/5 px-4 py-3 text-sm"
      role="note"
    >
      <HeartPulse className="mt-0.5 size-4 shrink-0 text-warning" />
      <span className="text-muted-foreground">
        本页展示 <b className="text-card-foreground">AI 服务健康度</b>
        （成功率 / 错误率 / 时延，平台侧客观采集），反映模型服务可用性，
        <b className="text-card-foreground">不是代码质量</b>。
      </span>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      暂无数据
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[340px] rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-lg" />
    </div>
  );
}

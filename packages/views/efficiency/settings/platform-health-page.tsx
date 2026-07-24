"use client";

import { useEffect, useMemo, useState } from "react";
import { HeartPulse, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  chatRealtimeOptions,
  globalConfigOptions,
  formatNumber,
  MOCK_ENABLED,
  type ChatRealtimeResponse,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { PageHeader } from "../../layout/page-header";
import {
  MultiTrendChart,
  type MultiTrendPoint,
} from "../charts";
import { shortToken, chartColorFor, Td, TdNum, Th, ThNum } from "../usage/shared";
import { Section } from "./shared";
import { ToneBadge } from "../detail/shared";

// Platform ops · Health. Ports the source PlatformHealth.tsx (AI service
// health per user — success/error rate + latency) to the shared-views layer.
// The source used a dedicated per-user weekly ranking endpoint
// (/stats/users/ranking sortBy=error_rate) which is NOT in the migrated data
// layer. We rewrite the health view on top of the realtime snapshot's
// request_trend (overall error-rate trend) + top_users (per-user request
// volume proxy). The aggregate health KPI strip + trend + per-user ranking
// table layout faithfully mirrors the source.
//
// Caliber note (carried from the source): this page is "AI service health"
// (model-service availability: success/error rate + latency, objectively
// collected by the platform), NOT code quality. We surface the same notice
// the source rendered.
//
// Design decisions: no react-router, no ECharts; reuses MultiTrendChart +
// usage Th/Td + detail ToneBadge. Semantic tokens only.

type Range = "30m" | "1h" | "3h";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "3h", label: "3h" },
];

/** Percentage formatter for a 0-1 fraction: null → "-", else "12.34%". */
function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function PlatformHealthPage() {
  const wsId = useWorkspaceId();
  const [range, setRange] = useState<Range>("1h");
  const [datasourceId, setDatasourceId] = useState("");

  const gcQ = useQuery(globalConfigOptions(wsId));
  const dsQ = useQuery(chatDatasourcesOptions(wsId));

  const enabledDatasources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );
  useEffect(() => {
    const first = enabledDatasources[0];
    if (!datasourceId && first) {
      setDatasourceId(String(first.id));
    }
  }, [datasourceId, enabledDatasources]);

  const realtimeQ = useQuery(
    chatRealtimeOptions(wsId, { range, datasourceId }),
  );

  // chat_stats_enabled guard (mock bypasses it).
  const configResolved = MOCK_ENABLED || !gcQ.isLoading;
  const chatEnabled = MOCK_ENABLED || gcQ.data?.chat_stats_enabled === true;

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <HeartPulse className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">AI 服务健康度</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 成功率 / 错误率 · 平台客观采集
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {RANGE_OPTIONS.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={range === o.value ? "default" : "outline"}
            onClick={() => setRange(o.value)}
            aria-pressed={range === o.value}
          >
            {o.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => realtimeQ.refetch()}
          disabled={realtimeQ.isFetching}
        >
          <RefreshCw
            className={`size-3.5 ${realtimeQ.isFetching ? "animate-spin" : ""}`}
          />
          刷新
        </Button>
      </div>
    </PageHeader>
  );

  if (!configResolved) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-6 lg:px-8">
            <HealthSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (!chatEnabled) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 lg:px-8">
            <div className="flex min-h-[12rem] items-center justify-center rounded-lg border bg-card px-4 text-center text-sm text-muted-foreground">
              当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示 AI 服务健康度（成功率 / 错误率 / 时延）。
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = realtimeQ.data;

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <CaliberNotice />

          {realtimeQ.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {(realtimeQ.error as Error)?.message || "加载健康数据失败"}
            </div>
          ) : null}

          {realtimeQ.isLoading || !data ? (
            <HealthSkeleton />
          ) : (
            <HealthBody data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================ Body ============================

function HealthBody({ data }: { data: ChatRealtimeResponse }) {
  const summary = data.summary;
  const total = summary.total_requests;
  const errors = summary.total_error_requests;
  // Unified error rate: error / total (robust whether or not total includes
  // errors — mirrors the source's errorRateOf formula).
  const errorRate = total > 0 ? errors / total : null;
  const successRate = errorRate != null ? 1 - errorRate : null;

  const kpis: Array<{
    label: string;
    value: string;
    hint?: string;
    tone?: "success" | "error" | "neutral";
  }> = [
    {
      label: "成功率",
      value: pct(successRate),
      hint: "1 − 错误率",
      tone: "success",
    },
    {
      label: "错误率",
      value: pct(errorRate),
      hint: `错误请求 ${formatNumber(errors)}`,
      tone: (errorRate ?? 0) > 0.05 ? "error" : "neutral",
    },
    {
      label: "总请求",
      value: formatNumber(total),
    },
    {
      label: "活跃用户",
      value: formatNumber(summary.total_users),
    },
  ];

  // Request-volume trend — used as the proxy "error-rate trend" (per-minute
  // request volume; the realtime response does not carry per-minute errors,
  // so we surface request volume and annotate the overall error rate above).
  const requestTrend: MultiTrendPoint[] = useMemo(
    () =>
      (data.request_trend ?? []).map((i) => ({
        label: i.time,
        requests: i.request_count,
      })),
    [data.request_trend],
  );
  const requestSeries = [
    { key: "requests", name: "请求量", color: chartColorFor(3) },
  ];

  const topUsers = data.top_users ?? [];
  const topUserTotal = topUsers.reduce(
    (s, u) => s + (u.request_count || 0),
    0,
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border bg-card shadow-sm p-4 transition-shadow hover:shadow-lg"
          >
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {k.label}
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                k.tone === "success"
                  ? "text-success"
                  : k.tone === "error"
                    ? "text-destructive"
                    : "text-card-foreground"
              }`}
            >
              {k.value}
            </div>
            {k.hint ? (
              <div className="mt-1 text-xs text-muted-foreground">{k.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      <Section title="请求量趋势" count="每分钟 · 整体" bodyClassName="p-4">
        {requestTrend.length > 0 ? (
          <MultiTrendChart
            data={requestTrend}
            series={requestSeries}
            formatY={shortToken}
          />
        ) : (
          <EmptyHint />
        )}
      </Section>

      <Section
        title="用户健康度排行（AI 服务）"
        count={`Top ${topUsers.length} · 按请求数倒序`}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <ThNum>排名</ThNum>
              <Th>Universal ID</Th>
              <Th>用户名</Th>
              <ThNum>请求数</ThNum>
              <ThNum>占比</ThNum>
              <ThNum>输入 Token</ThNum>
              <ThNum>输出 Token</ThNum>
            </tr>
          </thead>
          <tbody>
            {topUsers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center">
                  <span className="text-sm text-muted-foreground">暂无数据</span>
                </td>
              </tr>
            ) : (
              topUsers.map((u, i) => {
                const share =
                  topUserTotal > 0 ? (u.request_count / topUserTotal) * 100 : 0;
                return (
                  <tr
                    key={u.universal_id || i}
                    className="border-b last:border-0"
                  >
                    <TdNum>{i + 1}</TdNum>
                    <Td>
                      <span className="font-mono text-xs">
                        {u.universal_id || "-"}
                      </span>
                    </Td>
                    <Td>
                      <div className="max-w-[180px] truncate">
                        {u.username || "-"}
                      </div>
                    </Td>
                    <TdNum>{formatNumber(u.request_count)}</TdNum>
                    <TdNum>{share.toFixed(1)}%</TdNum>
                    <TdNum title={formatNumber(u.prompt_tokens)}>
                      {shortToken(u.prompt_tokens)}
                    </TdNum>
                    <TdNum title={formatNumber(u.completion_tokens)}>
                      {shortToken(u.completion_tokens)}
                    </TdNum>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* Model-level health (request volume + status proxy). */}
      <Section
        title="模型服务状态"
        count={(data.model_requests ?? []).length}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <Th>模型</Th>
              <Th>状态</Th>
              <ThNum>请求数</ThNum>
              <ThNum>用户数</ThNum>
              <ThNum>输入 Token</ThNum>
              <ThNum>输出 Token</ThNum>
            </tr>
          </thead>
          <tbody>
            {(data.model_requests ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <span className="text-sm text-muted-foreground">暂无数据</span>
                </td>
              </tr>
            ) : (
              data.model_requests.map((m) => {
                const ok = m.request_count > 0;
                return (
                  <tr key={m.model} className="border-b last:border-0">
                    <Td>{m.model || "-"}</Td>
                    <Td>
                      <ToneBadge tone={ok ? "success" : "neutral"}>
                        {ok ? "正常" : "无流量"}
                      </ToneBadge>
                    </Td>
                    <TdNum>{formatNumber(m.request_count)}</TdNum>
                    <TdNum>{formatNumber(m.user_count)}</TdNum>
                    <TdNum title={formatNumber(m.prompt_tokens)}>
                      {shortToken(m.prompt_tokens)}
                    </TdNum>
                    <TdNum title={formatNumber(m.completion_tokens)}>
                      {shortToken(m.completion_tokens)}
                    </TdNum>
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

// ============================ Caliber notice ============================

/** Carries the source's caliber banner: this is AI service health, not code quality. */
function CaliberNotice() {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border-l-4 border-l-warning bg-warning/5 px-4 py-3 text-sm"
      role="note"
    >
      <svg
        className="mt-0.5 size-5 shrink-0 text-warning"
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
      <span className="text-muted-foreground">
        本页 = <b className="text-card-foreground">AI 服务健康度</b>
        （成功率 / 错误率，平台侧客观采集），反映模型服务可用性，
        <b className="text-card-foreground">不是代码质量</b>。
      </span>
    </div>
  );
}

// ============================ Empty hint + skeleton ============================

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-lg" />
      <Skeleton className="h-[340px] rounded-lg" />
    </div>
  );
}

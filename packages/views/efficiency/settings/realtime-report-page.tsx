"use client";

import { useEffect, useMemo, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  chatRealtimeOptions,
  globalConfigOptions,
  formatNumber,
  fmtCost,
  MOCK_ENABLED,
  type ChatRealtimeResponse,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { PageHeader } from "../../layout/page-header";
import {
  MultiTrendChart,
  PieBreakdownChart,
  type MultiTrendPoint,
  type PieDatum,
} from "../charts";
import { shortToken, chartColorFor, Td, TdNum, Th, ThNum } from "../usage/shared";
import { Section } from "./shared";

// Platform ops · Realtime report. Ports the source RealtimeReport.tsx
// (chat-indicator-statistics /stats/realtime) to the shared-views layer.
// This is the most faithful port of the three platform pages — the realtime
// response shape maps 1:1 onto the source's charts/tables, so the layout
// (range selector + datasource → KPI strip → trend grid → pies → tables) is
// preserved directly. ECharts is replaced with the recharts primitives.
//
// Design decisions (from the migration brief):
//   - chat_stats_enabled guard: mock bypasses it; real mode gates on the live
//     flag and surfaces the source's "not enabled" notice when off.
//   - Server-side 10s rate limit: range, datasource, and refresh controls share
//     the same cooldown after each completed request.
//   - No react-router, no ECharts. Semantic tokens only.

type Range = "30m" | "1h" | "3h";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "30m", label: "近 30 分钟" },
  { value: "1h", label: "近 1 小时" },
  { value: "3h", label: "近 3 小时" },
];

export function RealtimeReportPage() {
  const wsId = useWorkspaceId();
  const [range, setRange] = useState<Range>("30m");
  const [datasourceId, setDatasourceId] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const gcQ = useQuery(globalConfigOptions(wsId));
  const dsQ = useQuery(chatDatasourcesOptions(wsId));

  const enabledDatasources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );

  // Default to the first enabled datasource once the list resolves (matches
  // the source's auto-select-on-first-load behaviour).
  useEffect(() => {
    const first = enabledDatasources[0];
    if (!datasourceId && first) {
      setDatasourceId(String(first.id));
    }
  }, [datasourceId, enabledDatasources]);

  // chat_stats_enabled guard (mock bypasses it).
  const configResolved = MOCK_ENABLED || !gcQ.isLoading;
  const chatEnabled = MOCK_ENABLED || gcQ.data?.chat_stats_enabled === true;
  const realtimeQ = useQuery({
    ...chatRealtimeOptions(wsId, { range, datasourceId }),
    enabled: !!wsId && !!datasourceId && chatEnabled,
  });
  const locked = realtimeQ.isFetching || cooldown > 0;

  useEffect(() => {
    if (realtimeQ.dataUpdatedAt > 0 || realtimeQ.errorUpdatedAt > 0) {
      setCooldown(10);
    }
  }, [realtimeQ.dataUpdatedAt, realtimeQ.errorUpdatedAt]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const noEnabledDatasource =
    !dsQ.isLoading && enabledDatasources.length === 0;
  const noDatasourceSelected =
    !dsQ.isLoading && enabledDatasources.length > 0 && !datasourceId;

  const updatedAt = realtimeQ.dataUpdatedAt
    ? new Date(realtimeQ.dataUpdatedAt).toLocaleTimeString("zh-CN", {
        hour12: false,
      })
    : "";

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <Radar className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">平台实时态势</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 直查源库 · 服务端限频 10s
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DatasourceSelect
          loading={dsQ.isLoading}
          datasources={dsQ.data ?? []}
          value={datasourceId}
          onChange={setDatasourceId}
          disabled={locked}
        />
        {RANGE_OPTIONS.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={range === o.value ? "default" : "outline"}
            onClick={() => setRange(o.value)}
            disabled={locked && o.value !== range}
            title={
              cooldown > 0 && o.value !== range
                ? `服务端限频，${cooldown} 秒后可切换`
                : undefined
            }
            aria-pressed={range === o.value}
          >
            {o.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          onClick={() => realtimeQ.refetch()}
          disabled={locked || !datasourceId}
        >
          <RefreshCw
            className={`size-3.5 ${realtimeQ.isFetching ? "animate-spin" : ""}`}
          />
          {realtimeQ.isFetching
            ? "刷新中…"
            : cooldown > 0
              ? `刷新（${cooldown}s）`
              : "刷新"}
        </Button>
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            更新于 {updatedAt}
          </span>
        ) : null}
      </div>
    </PageHeader>
  );

  if (!configResolved) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-6 lg:px-8">
            <ReportSkeleton />
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
              当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示实时 token / 成本 / 错误 / 模型分布数据。
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          {realtimeQ.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {(realtimeQ.error as Error)?.message || "加载实时数据失败"}
            </div>
          ) : null}
          {dsQ.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {(dsQ.error as Error)?.message || "获取数据源失败"}
            </div>
          ) : null}

          {dsQ.isLoading ? (
            <ReportSkeleton />
          ) : noEnabledDatasource ? (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              暂无可用数据源，请先在「设置 → 数据源」中配置并启用数据源。
            </div>
          ) : noDatasourceSelected ? (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              请选择一个数据源后查看实时态势。
            </div>
          ) : realtimeQ.isLoading || !realtimeQ.data ? (
            <ReportSkeleton />
          ) : (
            <ReportBody data={realtimeQ.data} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================ Body ============================

function ReportBody({ data }: { data: ChatRealtimeResponse }) {
  const summary = data.summary;
  const errRequests = summary.total_error_requests;

  const kpis: Array<{
    title: string;
    value: string;
    full?: string;
    alert?: boolean;
  }> = [
    { title: "请求量", value: formatNumber(summary.total_requests) },
    { title: "活跃用户", value: formatNumber(summary.total_users) },
    {
      title: "输入 Token",
      value: shortToken(summary.total_prompt_tokens),
      full: formatNumber(summary.total_prompt_tokens),
    },
    {
      title: "输出 Token",
      value: shortToken(summary.total_completion_tokens),
      full: formatNumber(summary.total_completion_tokens),
    },
    {
      title: "缓存 Token",
      value: shortToken(summary.total_cache_tokens),
      full: formatNumber(summary.total_cache_tokens),
    },
    {
      title: "错误请求",
      value: formatNumber(errRequests),
      alert: errRequests > 0,
    },
    { title: "实时费用", value: fmtCost(summary.total_cost) },
  ];

  // Token trend (prompt / completion / cache).
  const tokenTrend: MultiTrendPoint[] = useMemo(
    () =>
      (data.token_trend ?? []).map((i) => ({
        label: i.time,
        prompt: i.prompt_tokens,
        completion: i.completion_tokens,
        cache: i.cache_tokens,
      })),
    [data.token_trend],
  );
  const tokenSeries = [
    { key: "prompt", name: "输入 Token", color: chartColorFor(0) },
    { key: "completion", name: "输出 Token", color: chartColorFor(1) },
    { key: "cache", name: "缓存 Token", color: chartColorFor(2) },
  ];

  // Cache hit-rate trend (percentage 0-100).
  const cacheRateTrend: MultiTrendPoint[] = useMemo(
    () =>
      (data.cache_hit_rate ?? []).map((i) => ({
        label: i.time,
        rate: i.rate,
      })),
    [data.cache_hit_rate],
  );
  const cacheRateSeries = [
    { key: "rate", name: "缓存命中率", color: chartColorFor(1) },
  ];

  // Request-volume trend.
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

  // Model distribution pie.
  const modelPie: PieDatum[] = useMemo(
    () =>
      (data.model_requests ?? [])
        .filter((m) => m.request_count > 0)
        .map((m) => ({ name: m.model || "-", value: m.request_count })),
    [data.model_requests],
  );

  const autoRouterRows = data.auto_router_breakdown ?? [];
  const modelRows = data.model_requests ?? [];
  const topUsers = data.top_users ?? [];

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <div
            key={k.title}
            className="rounded-lg border bg-card shadow-sm p-4 transition-shadow hover:shadow-lg"
          >
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {k.title}
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                k.alert ? "text-destructive" : "text-card-foreground"
              }`}
              title={k.full}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Trend grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Token 趋势" count="每分钟 · 输入 / 输出 / 缓存" bodyClassName="p-4">
          {tokenTrend.length > 0 ? (
            <MultiTrendChart data={tokenTrend} series={tokenSeries} formatY={shortToken} />
          ) : (
            <EmptyHint />
          )}
        </Section>
        <Section title="缓存命中率趋势" count="每分钟 · cache / prompt" bodyClassName="p-4">
          {cacheRateTrend.length > 0 ? (
            <MultiTrendChart
              data={cacheRateTrend}
              series={cacheRateSeries}
              formatY={(v) => `${v}%`}
            />
          ) : (
            <EmptyHint />
          )}
        </Section>
        <Section title="请求量趋势" count="每分钟" bodyClassName="p-4">
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
        <Section title="模型请求分布" count="含 auto" bodyClassName="p-4">
          {modelPie.length > 0 ? (
            <PieBreakdownChart data={modelPie} />
          ) : (
            <EmptyHint />
          )}
        </Section>
      </div>

      {/* Auto-router detail (only when present — source hides the whole block). */}
      {autoRouterRows.length > 0 ? (
        <Section
          title="Auto 路由明细"
          count={autoRouterRows.length}
          bodyClassName="overflow-x-auto"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <Th>路由模型</Th>
                <ThNum>请求数</ThNum>
                <ThNum>占比</ThNum>
              </tr>
            </thead>
            <tbody>
              {autoRouterRows.map((r) => (
                <tr key={r.routed_model} className="border-b last:border-0">
                  <Td>{r.routed_model || "-"}</Td>
                  <TdNum>{formatNumber(r.request_count)}</TdNum>
                  <TdNum>{r.percentage.toFixed(1)}%</TdNum>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* Model detail table. */}
      <Section
        title="模型详情"
        count={modelRows.length}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <Th>模型</Th>
              <ThNum>请求数</ThNum>
              <ThNum>用户数</ThNum>
              <ThNum>输入 Token</ThNum>
              <ThNum>输出 Token</ThNum>
              <ThNum>费用</ThNum>
            </tr>
          </thead>
          <tbody>
            {modelRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <span className="text-sm text-muted-foreground">暂无数据</span>
                </td>
              </tr>
            ) : (
              modelRows.map((m) => (
                <tr key={m.model} className="border-b last:border-0">
                  <Td>{m.model || "-"}</Td>
                  <TdNum>{formatNumber(m.request_count)}</TdNum>
                  <TdNum>{formatNumber(m.user_count)}</TdNum>
                  <TdNum title={formatNumber(m.prompt_tokens)}>
                    {shortToken(m.prompt_tokens)}
                  </TdNum>
                  <TdNum title={formatNumber(m.completion_tokens)}>
                    {shortToken(m.completion_tokens)}
                  </TdNum>
                  <TdNum>{fmtCost(m.total_cost)}</TdNum>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>

      {/* Top users table. */}
      <Section
        title="请求量 Top 用户"
        count={topUsers.length}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <ThNum>排名</ThNum>
              <Th>Universal ID</Th>
              <Th>用户名</Th>
              <ThNum>请求数</ThNum>
              <ThNum>输入 Token</ThNum>
              <ThNum>输出 Token</ThNum>
            </tr>
          </thead>
          <tbody>
            {topUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <span className="text-sm text-muted-foreground">暂无数据</span>
                </td>
              </tr>
            ) : (
              topUsers.map((u, i) => (
                <tr key={u.universal_id || i} className="border-b last:border-0">
                  <TdNum>{i + 1}</TdNum>
                  <Td>
                    <span className="font-mono text-xs">
                      {u.universal_id || "-"}
                    </span>
                  </Td>
                  <Td>
                    <div className="max-w-[180px] truncate">{u.username || "-"}</div>
                  </Td>
                  <TdNum>{formatNumber(u.request_count)}</TdNum>
                  <TdNum title={formatNumber(u.prompt_tokens)}>
                    {shortToken(u.prompt_tokens)}
                  </TdNum>
                  <TdNum title={formatNumber(u.completion_tokens)}>
                    {shortToken(u.completion_tokens)}
                  </TdNum>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>
    </>
  );
}

// ============================ Datasource select ============================

interface DatasourceSelectProps {
  datasources: Array<{
    id: number;
    name: string;
    source_type: string;
    is_enabled: boolean;
  }>;
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Compact datasource filter. Mirrors the source RealtimeReport's datasource
 * <select> so the per-source realtime snapshot is explicit (the server default
 * would otherwise be queried). Ported to a plain native select.
 */
function DatasourceSelect({
  datasources,
  loading,
  value,
  onChange,
  disabled,
}: DatasourceSelectProps) {
  if (loading) {
    return <span className="text-xs text-muted-foreground">加载数据源…</span>;
  }
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>数据源</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-w-[200px] rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label="数据源"
      >
        {datasources.length === 0 ? (
          <option value="">暂无可用数据源</option>
        ) : (
          <>
            <option value="">请选择数据源</option>
            {datasources.map((d) => (
              <option key={d.id} value={String(d.id)} disabled={!d.is_enabled}>
                {d.name}（{d.source_type === "postgres" ? "PG" : "ES"}）
                {d.is_enabled ? "" : " - 未启用"}
              </option>
            ))}
          </>
        )}
      </select>
    </label>
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

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[340px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

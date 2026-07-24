"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  chatRealtimeOptions,
  chatSystemConfigOptions,
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

// Platform ops · Overview. Ports the source PlatformOverview.tsx (which was
// built on the chat proxy's historical /stats/global/daily + /stats/cost-trend
// endpoints) to the shared-views layer. Those historical endpoints are NOT in
// the migrated data layer, so this page is rewritten on top of the realtime
// snapshot (chatRealtimeOptions) — the KPI strip, token trend, cache-rate
// trend, model distribution, auto-router and top-users table all map directly
// onto the realtime response fields. The layout (KPI strip → trend grid →
// distribution grid → tables) faithfully mirrors the source's "global" tab.
//
// Design decisions (from the migration brief):
//   - chat_stats_enabled guard: in mock mode we render the data anyway (the
//     mock IS the platform-source stand-in); in real mode we gate on
//     globalConfig.chat_stats_enabled and surface the source's "not enabled"
//     notice when it is off. See `chatEnabled` below.
//   - No react-router, no ECharts — reuses the recharts chart primitives
//     (MultiTrendChart / PieBreakdownChart) and the usage Th/Td table cells.
//   - Semantic tokens only — no hardcoded colours. Chart series colours use
//     var(--chart-1..5) via chartColorFor().

type Range = "30m" | "1h" | "3h";

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "3h", label: "3h" },
];

/** Percentage formatter: null/NaN → "-", otherwise "12.34%". */
function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function PlatformOverviewPage() {
  const wsId = useWorkspaceId();
  const [range, setRange] = useState<Range>("1h");
  const [datasourceId, setDatasourceId] = useState("");

  // Config drives the chat_stats_enabled guard; systemConfig carries the
  // currency label used by the cost KPI; datasources feed the optional
  // datasource filter (the realtime endpoint is per-datasource).
  const gcQ = useQuery(globalConfigOptions(wsId));
  const cfgQ = useQuery(chatSystemConfigOptions(wsId));
  const dsQ = useQuery(chatDatasourcesOptions(wsId));

  const enabledDatasources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );

  // Default to the first enabled datasource once the list resolves.
  useEffect(() => {
    const first = enabledDatasources[0];
    if (!datasourceId && first) {
      setDatasourceId(String(first.id));
    }
  }, [datasourceId, enabledDatasources]);

  const realtimeQ = useQuery(
    chatRealtimeOptions(wsId, { range, datasourceId }),
  );

  // chat_stats_enabled guard. Mock mode bypasses it (the mock is the platform
  // stand-in, so the page is useful during development); real mode gates on
  // the live flag and shows the source's "not enabled" notice when off.
  const configResolved = MOCK_ENABLED || !gcQ.isLoading;
  const chatEnabled = MOCK_ENABLED || gcQ.data?.chat_stats_enabled === true;

  const currency = cfgQ.data?.system_currency || "CNY";
  const currencySymbol = currency === "USD" ? "$" : "¥";

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <Activity className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">平台总览</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 实时聚合 · chat-indicator-statistics
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

  // Guard 0: config still loading (real mode only) → render header + skeleton
  // to avoid a flash of the disabled notice.
  if (!configResolved) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-4 p-6">
            <OverviewSkeleton />
          </div>
        </div>
      </div>
    );
  }

  // Guard 1: chat stats not enabled in real config → source's notice.
  if (!chatEnabled) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6">
            <div className="flex min-h-[12rem] items-center justify-center rounded-lg border bg-card px-4 text-center text-sm text-muted-foreground">
              当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示 AI 调用花费 / 请求 / Token 等客观数据。
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
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          {realtimeQ.error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {(realtimeQ.error as Error)?.message || "加载实时数据失败"}
            </div>
          ) : null}

          {realtimeQ.isLoading || !data ? (
            <OverviewSkeleton />
          ) : (
            <OverviewBody
              data={data}
              currencySymbol={currencySymbol}
              datasources={dsQ.data ?? []}
              datasourcesLoading={dsQ.isLoading}
              datasourceId={datasourceId}
              onDatasourceChange={setDatasourceId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================ Body ============================

interface OverviewBodyProps {
  data: ChatRealtimeResponse;
  currencySymbol: string;
  datasources: Array<{
    id: number;
    name: string;
    source_type: string;
    is_enabled: boolean;
  }>;
  datasourcesLoading: boolean;
  datasourceId: string;
  onDatasourceChange: (id: string) => void;
}

function OverviewBody({
  data,
  currencySymbol,
  datasources,
  datasourcesLoading,
  datasourceId,
  onDatasourceChange,
}: OverviewBodyProps) {
  const summary = data.summary;
  const errRequests = summary.total_error_requests;
  const errorRate =
    summary.total_requests > 0 ? errRequests / summary.total_requests : null;

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
      title: "错误率",
      value: pct(errorRate),
      full: `错误请求 ${formatNumber(errRequests)}`,
      alert: (errorRate ?? 0) > 0.05,
    },
    {
      title: "实时费用",
      value: `${currencySymbol}${fmtCost(summary.total_cost)}`,
      full: `${currencySymbol}${formatNumber(summary.total_cost, 2)}`,
    },
  ];

  // Token trend (prompt / completion / cache) shaped for MultiTrendChart.
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

  // Cache hit-rate trend (single series, percentage 0-100).
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

  // Request-volume trend (single series).
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

  // Model distribution + auto-router pies.
  const modelPie: PieDatum[] = useMemo(
    () =>
      (data.model_requests ?? [])
        .filter((m) => m.request_count > 0)
        .map((m) => ({ name: m.model || "-", value: m.request_count })),
    [data.model_requests],
  );

  const autoRouterPie: PieDatum[] = useMemo(
    () =>
      (data.auto_router_breakdown ?? [])
        .filter((m) => m.request_count > 0)
        .map((m) => ({ name: m.routed_model || "-", value: m.request_count })),
    [data.auto_router_breakdown],
  );

  const modelRows = data.model_requests ?? [];
  const topUsers = data.top_users ?? [];

  const dsRightSlot = (
    <DatasourceSelect
      datasources={datasources}
      loading={datasourcesLoading}
      value={datasourceId}
      onChange={onDatasourceChange}
    />
  );

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <div
            key={k.title}
            className="rounded-lg border bg-card p-4 transition-shadow hover:shadow-lg"
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

      {/* Token trend (full width — the primary series). */}
      <Section
        title="Token 趋势"
        count="输入 / 输出 / 缓存"
        rightSlot={dsRightSlot}
        bodyClassName="p-4"
      >
        {tokenTrend.length > 0 ? (
          <MultiTrendChart data={tokenTrend} series={tokenSeries} formatY={shortToken} />
        ) : (
          <EmptyHint />
        )}
      </Section>

      {/* Cache rate + request volume side by side. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="缓存命中率趋势" count="cache / prompt" bodyClassName="p-4">
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
      </div>

      {/* Model distribution + auto-router side by side. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="模型请求分布" count="按请求次数" bodyClassName="p-4">
          {modelPie.length > 0 ? (
            <PieBreakdownChart data={modelPie} />
          ) : (
            <EmptyHint />
          )}
        </Section>
        <Section title="Auto 路由细分" count="auto 实际路由模型" bodyClassName="p-4">
          {autoRouterPie.length > 0 ? (
            <PieBreakdownChart data={autoRouterPie} />
          ) : (
            <EmptyHint />
          )}
        </Section>
      </div>

      {/* Auto-router detail table (only when present). */}
      {(data.auto_router_breakdown ?? []).length > 0 ? (
        <Section
          title="Auto 路由明细"
          count={data.auto_router_breakdown.length}
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
              {data.auto_router_breakdown.map((r) => (
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
}

/**
 * Compact datasource filter for the overview toolbar. Mirrors the source
 * RealtimeReport's datasource <select> (so the per-source realtime snapshot is
 * explicit), ported to a plain native select to match the settings pages.
 */
function DatasourceSelect({
  datasources,
  loading,
  value,
  onChange,
}: DatasourceSelectProps) {
  if (loading) {
    return <span className="text-xs text-muted-foreground">加载数据源…</span>;
  }
  if (datasources.length === 0) return null;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>数据源</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="数据源"
      >
        {datasources.map((d) => (
          <option key={d.id} value={String(d.id)} disabled={!d.is_enabled}>
            {d.name}（{d.source_type === "postgres" ? "PG" : "ES"}）
            {d.is_enabled ? "" : " - 未启用"}
          </option>
        ))}
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

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-lg" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-lg" />
        <Skeleton className="h-[340px] rounded-lg" />
      </div>
    </div>
  );
}

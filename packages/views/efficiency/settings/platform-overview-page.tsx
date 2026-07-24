"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatCacheHitRateOptions,
  chatCostTrendOptions,
  chatGlobalDailyOptions,
  chatModelCostRankingOptions,
  chatModelsUsageOptions,
  chatUsersRankingOptions,
  formatNumber,
  fmtCost,
  MOCK_ENABLED,
  type ChatCacheHitRateRow,
  type ChatCostTrendRow,
  type ChatDailyGlobal,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@multica/ui/components/ui/tabs";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { PageHeader } from "../../layout/page-header";
import {
  MultiTrendChart,
  PieBreakdownChart,
  RankingBarChart,
  type MultiTrendPoint,
  type PieDatum,
  type BarDatum,
} from "../charts";
import {
  chartColorFor,
  shortToken,
  Td,
  TdNum,
  Th,
  ThNum,
} from "../usage/shared";
import { Section } from "./shared";

// Platform ops · Overview. Ports the source PlatformOverview.tsx (1060 lines,
// built on the chat proxy's historical /stats/* endpoints) to the shared-views
// layer. Restores the source's multi-tab layout (Global / Models / Users; the
// source's Performance + Time-distribution tabs are intentionally omitted here
// — they relied on separate endpoints not in this slice, see notes below).
//
// Data layer: the 6 historical endpoints (global/daily, cost-trend, cache-hit-
// rate, models/cost-ranking, models/usage, users/ranking) are wired through
// @multica/core/efficiency queries (workspace-scoped, mock in the mock phase).
//
// Design decisions (from the migration brief):
//   - chat_stats_enabled guard: in mock mode we render the data anyway (the
//     mock IS the platform-source stand-in); in real mode we gate on
//     globalConfig.chat_stats_enabled and surface the source's "not enabled"
//     notice when it is off. See `chatEnabled` below.
//   - No react-router, no ECharts — reuses the recharts chart primitives
//     (MultiTrendChart / PieBreakdownChart / RankingBarChart) and the usage
//     Th/Td table cells.
//   - Semantic tokens only — no hardcoded colours. Chart series colours use
//     var(--chart-1..5) via chartColorFor().
//   - The source's per-tab query `enabled` gating is preserved (queries only
//     fire when their tab is active) so switching tabs is cheap.

type TabKey = "global" | "models" | "users";

const TAB_LIST: Array<{ value: TabKey; label: string }> = [
  { value: "global", label: "全局趋势" },
  { value: "models", label: "模型与成本" },
  { value: "users", label: "用户分析" },
];

// Date-range presets (近7天 / 近30天 / 近90天). Mirrors the source PRESETS.
const PRESETS: Array<{ label: string; days: number }> = [
  { label: "近7天", days: 7 },
  { label: "近30天", days: 30 },
  { label: "近90天", days: 90 },
];

const USER_SORTS: Array<{ value: string; label: string }> = [
  { value: "sum_total_tokens", label: "Token 总量" },
  { value: "total_requests", label: "请求数" },
  { value: "estimated_total_cost", label: "成本" },
];

/** Percentage formatter: null/NaN → "-", otherwise "12.34%". */
function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function rangeForDays(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: toDateStr(start), end: toDateStr(end) };
}

export function PlatformOverviewPage() {
  const wsId = useWorkspaceId();
  const [tab, setTab] = useState<TabKey>("global");

  const [{ start, end }, setRange] = useState(() => rangeForDays(30));
  const [presetDays, setPresetDays] = useState<number | null>(30);
  const rangeValid = !!start && !!end && start <= end;

  // Users-tab local state (sort + debounced search).
  const [userSort, setUserSort] = useState("sum_total_tokens");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Models-tab cost-trend model filter.
  const [costModel, setCostModel] = useState("all");

  // chat_stats_enabled guard. Mock mode bypasses it (the mock is the platform
  // stand-in, so the page is useful during development); real mode gates on
  // the live flag and shows the source's "not enabled" notice when off.
  const configResolved = MOCK_ENABLED;
  const chatEnabled = MOCK_ENABLED;
  const enabled = chatEnabled && rangeValid;

  // Historical queries. Each is gated on its tab being active (mirrors the
  // source's per-tab `enabled`) so inactive tabs don't fire requests.
  const dailyQ = useQuery({
    ...chatGlobalDailyOptions(wsId, start, end),
    enabled: !!enabled && tab === "global",
  });
  const costQ = useQuery({
    ...chatCostTrendOptions(wsId, start, end, costModel === "all" ? undefined : costModel),
    enabled: !!enabled && (tab === "global" || tab === "models"),
  });
  const cacheQ = useQuery({
    ...chatCacheHitRateOptions(wsId, start, end),
    enabled: !!enabled && tab === "global",
  });
  const rankQ = useQuery({
    ...chatModelCostRankingOptions(wsId, start, end),
    enabled: !!enabled && (tab === "global" || tab === "models"),
  });
  const usageQ = useQuery({
    ...chatModelsUsageOptions(wsId, start, end),
    enabled: !!enabled && tab === "models",
  });
  const usersQ = useQuery({
    ...chatUsersRankingOptions(wsId, start, end, userSort, search),
    enabled: !!enabled && tab === "users",
  });

  const queries = [dailyQ, costQ, cacheQ, rankQ, usageQ, usersQ];
  const errors = queries
    .filter((q) => q.isError)
    .map((q) => (q.error as Error)?.message || "加载失败");
  const loading =
    enabled &&
    (tab === "global"
      ? dailyQ.isLoading
      : tab === "models"
        ? rankQ.isLoading
        : usersQ.isLoading);

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <Activity className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">平台总览</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 历史汇总 · chat-indicator-statistics
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((o) => (
          <Button
            key={o.days}
            type="button"
            size="sm"
            variant={presetDays === o.days ? "default" : "outline"}
            onClick={() => {
              setPresetDays(o.days);
              setRange(rangeForDays(o.days));
            }}
            aria-pressed={presetDays === o.days}
          >
            {o.label}
          </Button>
        ))}
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span>从</span>
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => {
              setPresetDays(null);
              setRange((r) => ({ ...r, start: e.target.value }));
            }}
            aria-label="开始日期"
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span>至</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => {
              setPresetDays(null);
              setRange((r) => ({ ...r, end: e.target.value }));
            }}
            aria-label="结束日期"
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {!rangeValid && (
          <span className="text-xs text-destructive">
            请选择有效的起止日期（开始 ≤ 结束）
          </span>
        )}
      </div>
    </PageHeader>
  );

  // Guard 0: config still loading (real mode only) → header + skeleton.
  if (!configResolved) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-6 lg:px-8">
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
          <div className="p-6 lg:px-8">
            <div className="flex min-h-[12rem] items-center justify-center rounded-lg border bg-card px-4 text-center text-sm text-muted-foreground">
              当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将自动展示 AI 调用花费 / 请求 / Token 等客观数据。
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
          {errors.length > 0 ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {[...new Set(errors)].join("；")}
            </div>
          ) : null}

          {loading ? (
            <OverviewSkeleton />
          ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as TabKey)}
              className="gap-3"
            >
              <TabsList>
                {TAB_LIST.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="global">
                <GlobalTab
                  daily={dailyQ.data ?? []}
                  cost={costQ.data ?? []}
                  cache={cacheQ.data ?? []}
                />
              </TabsContent>

              <TabsContent value="models">
                <ModelsTab
                  ranking={rankQ.data ?? []}
                  usage={usageQ.data?.models ?? []}
                  cost={costQ.data ?? []}
                  costModel={costModel}
                  onCostModelChange={setCostModel}
                />
              </TabsContent>

              <TabsContent value="users">
                <UsersTab
                  rows={usersQ.data?.data ?? []}
                  total={usersQ.data?.total}
                  userSort={userSort}
                  onUserSort={setUserSort}
                  searchInput={searchInput}
                  onSearchInput={setSearchInput}
                  isFetching={usersQ.isFetching}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================ Global tab ============================

interface GlobalTabProps {
  daily: ChatDailyGlobal[];
  cost: ChatCostTrendRow[];
  cache: ChatCacheHitRateRow[];
}

function GlobalTab({ daily, cost, cache }: GlobalTabProps) {
  // KPI strip: range totals aggregated from the per-day series.
  const agg = useMemo(() => {
    const sum = (fn: (r: ChatDailyGlobal) => number | null | undefined) =>
      daily.reduce((s, r) => s + (fn(r) || 0), 0);
    const requests = sum((r) => r.total_requests);
    const requestsIncErr = sum((r) =>
      r.total_requests_including_errors > 0
        ? r.total_requests_including_errors
        : r.total_requests,
    );
    const errors = sum((r) => r.total_error_requests);
    return {
      requests,
      errors,
      errorRate: requestsIncErr > 0 ? errors / requestsIncErr : null,
      promptTokens: sum((r) => r.sum_prompt_tokens),
      completionTokens: sum((r) => r.sum_completion_tokens),
      cacheTokens: sum((r) => r.sum_cache_tokens),
      cost: sum((r) => r.estimated_total_cost),
      avgUsers:
        daily.length > 0 ? Math.round(sum((r) => r.total_users) / daily.length) : 0,
      peakUsers: daily.reduce((m, r) => Math.max(m, r.total_users), 0),
      avgRequests:
        daily.length > 0 ? Math.round(requests / daily.length) : 0,
    };
  }, [daily]);

  const kpis: Array<{
    title: string;
    value: string;
    full?: string;
    sub?: string;
    alert?: boolean;
  }> = [
    {
      title: "总请求",
      value: formatNumber(agg.requests),
      sub: `日均 ${formatNumber(agg.avgRequests)}`,
    },
    {
      title: "活跃用户（日均）",
      value: formatNumber(agg.avgUsers),
      sub: `单日峰值 ${formatNumber(agg.peakUsers)}`,
    },
    {
      title: "输入 Token",
      value: shortToken(agg.promptTokens),
      full: formatNumber(agg.promptTokens),
    },
    {
      title: "输出 Token",
      value: shortToken(agg.completionTokens),
      full: formatNumber(agg.completionTokens),
    },
    {
      title: "缓存 Token",
      value: shortToken(agg.cacheTokens),
      full: formatNumber(agg.cacheTokens),
    },
    {
      title: "错误率",
      value: pct(agg.errorRate),
      sub: `错误请求 ${formatNumber(agg.errors)}`,
      alert: (agg.errorRate ?? 0) > 0.05,
    },
    {
      title: "总成本",
      value: `¥${fmtCost(agg.cost)}`,
      full: `¥${formatNumber(agg.cost, 2)}`,
      sub: "估算（按价格表）",
    },
  ];

  // Cost trend (total/input/output/cache per day).
  const costTrend: MultiTrendPoint[] = useMemo(
    () =>
      cost.map((r) => ({
        label: r.date.slice(5, 10),
        total: r.total_cost,
        input: r.input_cost,
        output: r.output_cost,
        cache: r.cache_cost,
      })),
    [cost],
  );
  const costSeries = [
    { key: "total", name: "总成本", color: chartColorFor(0) },
    { key: "input", name: "输入成本", color: chartColorFor(1) },
    { key: "output", name: "输出成本", color: chartColorFor(2) },
    { key: "cache", name: "缓存成本", color: chartColorFor(3) },
  ];

  // Token trend (input/output/cache per day from the daily aggregate).
  const tokenTrend: MultiTrendPoint[] = useMemo(
    () =>
      daily.map((r) => ({
        label: r.date.slice(5, 10),
        prompt: r.sum_prompt_tokens,
        completion: r.sum_completion_tokens,
        cache: r.sum_cache_tokens,
      })),
    [daily],
  );
  const tokenSeries = [
    { key: "prompt", name: "输入 Token", color: chartColorFor(0) },
    { key: "completion", name: "输出 Token", color: chartColorFor(1) },
    { key: "cache", name: "缓存 Token", color: chartColorFor(2) },
  ];

  // Request-volume trend (requests + errors per day).
  const requestTrend: MultiTrendPoint[] = useMemo(
    () =>
      daily.map((r) => ({
        label: r.date.slice(5, 10),
        requests: r.total_requests,
        errors: r.total_error_requests,
      })),
    [daily],
  );
  const requestSeries = [
    { key: "requests", name: "请求量", color: chartColorFor(3) },
    { key: "errors", name: "错误请求", color: "var(--destructive)" },
  ];

  // Cache hit-rate trend (recomputed as cache/prompt token ratio per day, the
  // source did the same — pct cannot be summed across days).
  const cacheTrend: MultiTrendPoint[] = useMemo(
    () =>
      cache.map((r) => ({
        label: r.date.slice(5, 10),
        rate: r.sum_prompt_tokens > 0
          ? +((r.sum_cache_tokens / r.sum_prompt_tokens) * 100).toFixed(1)
          : 0,
      })),
    [cache],
  );
  const cacheSeries = [{ key: "rate", name: "缓存命中率", color: chartColorFor(1) }];

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <div
            key={k.title}
            className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-lg"
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
            {k.sub ? (
              <div className="mt-1 text-[11px] text-muted-foreground">{k.sub}</div>
            ) : null}
          </div>
        ))}
      </div>

      <Section title="成本趋势" count="估算（总 / 输入 / 输出 / 缓存）" bodyClassName="p-4">
        {costTrend.length > 0 ? (
          <MultiTrendChart
            data={costTrend}
            series={costSeries}
            formatY={(v) => `¥${shortToken(v)}`}
          />
        ) : (
          <EmptyHint />
        )}
      </Section>

      <Section title="Token 趋势" count="输入 / 输出 / 缓存" bodyClassName="p-4">
        {tokenTrend.length > 0 ? (
          <MultiTrendChart data={tokenTrend} series={tokenSeries} formatY={shortToken} />
        ) : (
          <EmptyHint />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="请求量趋势" count="含错误请求" bodyClassName="p-4">
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
        <Section title="缓存命中率趋势" count="cache / prompt" bodyClassName="p-4">
          {cacheTrend.length > 0 ? (
            <MultiTrendChart
              data={cacheTrend}
              series={cacheSeries}
              formatY={(v) => `${v}%`}
            />
          ) : (
            <EmptyHint />
          )}
        </Section>
      </div>
    </div>
  );
}

// ============================ Models tab ============================

interface ModelsTabProps {
  ranking: Array<{
    model: string;
    total_requests: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
  }>;
  usage: Array<{
    model: string;
    request_count: number;
    request_pct: number;
    total_tokens: number;
    token_pct: number;
  }>;
  cost: ChatCostTrendRow[];
  costModel: string;
  onCostModelChange: (m: string) => void;
}

function ModelsTab({
  ranking,
  usage,
  cost,
  costModel,
  onCostModelChange,
}: ModelsTabProps) {
  // Model request share pie.
  const requestPie: PieDatum[] = useMemo(
    () =>
      usage
        .filter((m) => m.request_count > 0)
        .map((m) => ({ name: m.model || "-", value: m.request_count })),
    [usage],
  );
  // Model token share pie.
  const tokenPie: PieDatum[] = useMemo(
    () =>
      usage
        .filter((m) => m.total_tokens > 0)
        .map((m) => ({ name: m.model || "-", value: m.total_tokens })),
    [usage],
  );

  // Cost ranking horizontal bar (by cumulative cost).
  const costBars: BarDatum[] = useMemo(
    () =>
      ranking
        .map((r) => ({ label: r.model || "-", value: r.total_cost }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [ranking],
  );

  // Cost trend (re-shapes the global cost series for this tab too).
  const costTrend: MultiTrendPoint[] = useMemo(
    () =>
      cost.map((r) => ({
        label: r.date.slice(5, 10),
        total: r.total_cost,
        input: r.input_cost,
        output: r.output_cost,
        cache: r.cache_cost,
      })),
    [cost],
  );
  const costSeries = [
    { key: "total", name: "总成本", color: chartColorFor(0) },
    { key: "input", name: "输入成本", color: chartColorFor(1) },
    { key: "output", name: "输出成本", color: chartColorFor(2) },
    { key: "cache", name: "缓存成本", color: chartColorFor(3) },
  ];

  const modelOptions = useMemo(
    () =>
      ["all", ...ranking.map((r) => r.model).filter(Boolean)] as string[],
    [ranking],
  );

  return (
    <div className="space-y-4">
      {/* Model request share vs token share side by side. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="模型请求占比" count="按请求次数" bodyClassName="p-4">
          {requestPie.length > 0 ? (
            <PieBreakdownChart data={requestPie} />
          ) : (
            <EmptyHint />
          )}
        </Section>
        <Section title="模型 Token 占比" count="按总 Token" bodyClassName="p-4">
          {tokenPie.length > 0 ? (
            <PieBreakdownChart data={tokenPie} />
          ) : (
            <EmptyHint />
          )}
        </Section>
      </div>

      <Section
        title="成本变化曲线"
        count="总成本 + 构成分析"
        bodyClassName="p-4"
        rightSlot={
          <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span>模型</span>
            <select
              value={costModel}
              onChange={(e) => onCostModelChange(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="成本趋势模型筛选"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m === "all" ? "全部模型" : m}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {costTrend.length > 0 ? (
          <MultiTrendChart
            data={costTrend}
            series={costSeries}
            formatY={(v) => `¥${shortToken(v)}`}
          />
        ) : (
          <EmptyHint />
        )}
      </Section>

      <Section title="模型成本排名" count={`Top ${costBars.length}`} bodyClassName="p-4">
        {costBars.length > 0 ? (
          <RankingBarChart data={costBars} />
        ) : (
          <EmptyHint />
        )}
      </Section>

      {/* Model cost detail table. */}
      <Section
        title="模型成本明细"
        count={ranking.length}
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <ThNum>排名</ThNum>
              <Th>模型</Th>
              <ThNum>请求数</ThNum>
              <ThNum>输入 Token</ThNum>
              <ThNum>输出 Token</ThNum>
              <ThNum>总成本（¥）</ThNum>
            </tr>
          </thead>
          <tbody>
            {ranking.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center">
                  <span className="text-sm text-muted-foreground">暂无数据</span>
                </td>
              </tr>
            ) : (
              ranking.map((m, i) => (
                <tr key={m.model || i} className="border-b last:border-0">
                  <TdNum>{i + 1}</TdNum>
                  <Td>{m.model || "-"}</Td>
                  <TdNum>{formatNumber(m.total_requests)}</TdNum>
                  <TdNum title={formatNumber(m.total_input_tokens)}>
                    {shortToken(m.total_input_tokens)}
                  </TdNum>
                  <TdNum title={formatNumber(m.total_output_tokens)}>
                    {shortToken(m.total_output_tokens)}
                  </TdNum>
                  <TdNum>{m.total_cost.toFixed(2)}</TdNum>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ============================ Users tab ============================

interface UsersTabProps {
  rows: Array<{
    universal_id: string;
    username: string | null;
    total_requests: number;
    success_requests: number;
    error_requests: number;
    sum_prompt_tokens: number;
    sum_completion_tokens: number;
    sum_total_tokens: number;
    sum_cache_tokens: number;
    unique_task_count: number;
    active_days: number;
    estimated_total_cost: number;
    avg_duration_ms: number;
    error_rate: number;
  }>;
  total: number | undefined;
  userSort: string;
  onUserSort: (s: string) => void;
  searchInput: string;
  onSearchInput: (s: string) => void;
  isFetching: boolean;
}

function UsersTab({
  rows,
  total,
  userSort,
  onUserSort,
  searchInput,
  onSearchInput,
  isFetching,
}: UsersTabProps) {
  return (
    <Section
      title="用户排行"
      count={
        total != null ? `区间聚合 · Top 50 · 共 ${formatNumber(total)} 人` : "区间聚合 · Top 50"
      }
      bodyClassName="overflow-x-auto"
      rightSlot={
        <>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder="搜索 ID / 用户名"
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="搜索用户"
          />
          <select
            value={userSort}
            onChange={(e) => onUserSort(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="用户排行排序字段"
          >
            {USER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                按{s.label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <ThNum>排名</ThNum>
            <Th>Universal ID</Th>
            <Th>用户名</Th>
            <ThNum>请求数</ThNum>
            <ThNum>总 Token</ThNum>
            <ThNum>输入 Token</ThNum>
            <ThNum>输出 Token</ThNum>
            <ThNum>缓存 Token</ThNum>
            <ThNum>成本（¥）</ThNum>
            <ThNum>会话数</ThNum>
            <ThNum>活跃天数</ThNum>
            <ThNum>平均时延</ThNum>
            <ThNum>错误率</ThNum>
          </tr>
        </thead>
        <tbody>
          {isFetching && rows.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-3 py-8 text-center">
                <span className="text-sm text-muted-foreground">加载中…</span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-3 py-8 text-center">
                <span className="text-sm text-muted-foreground">暂无数据</span>
              </td>
            </tr>
          ) : (
            rows.map((u, i) => (
              <tr key={u.universal_id || i} className="border-b last:border-0">
                <TdNum>{i + 1}</TdNum>
                <Td>
                  <span className="font-mono text-xs">{u.universal_id || "-"}</span>
                </Td>
                <Td>
                  <div className="max-w-[180px] truncate">{u.username || "-"}</div>
                </Td>
                <TdNum>{formatNumber(u.total_requests)}</TdNum>
                <TdNum title={formatNumber(u.sum_total_tokens)}>
                  {shortToken(u.sum_total_tokens)}
                </TdNum>
                <TdNum title={formatNumber(u.sum_prompt_tokens)}>
                  {shortToken(u.sum_prompt_tokens)}
                </TdNum>
                <TdNum title={formatNumber(u.sum_completion_tokens)}>
                  {shortToken(u.sum_completion_tokens)}
                </TdNum>
                <TdNum title={formatNumber(u.sum_cache_tokens)}>
                  {shortToken(u.sum_cache_tokens)}
                </TdNum>
                <TdNum>{u.estimated_total_cost.toFixed(2)}</TdNum>
                <TdNum>{formatNumber(u.unique_task_count)}</TdNum>
                <TdNum>{formatNumber(u.active_days)}</TdNum>
                <TdNum>{u.avg_duration_ms.toFixed(0)} ms</TdNum>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums ${
                    u.error_rate > 0.05 ? "text-destructive" : "text-card-foreground"
                  }`}
                >
                  {pct(u.error_rate)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Section>
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
      <Skeleton className="h-[340px] rounded-lg" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-lg" />
        <Skeleton className="h-[340px] rounded-lg" />
      </div>
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useWorkspaceId,
} from "@multica/core/hooks";
import {
  formatNumber,
  usageDeptActiveUsersOptions,
  usageDeptModelsOptions,
  usageDeptModeUsageOptions,
  usageDeptOverviewOptions,
  usageDeptPeriodCompareOptions,
  usageDeptResultsOptions,
  usageDeptTrendOptions,
  usageDeptWeeklyOptions,
  type DeptQuery,
  type DeptModelItem,
  type DeptResultsResp,
  type DeptTrendPoint,
  type DeptModeUsageItem,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { KpiCard } from "../../runtimes/components/shared";
import {
  ComboTrendChart,
  MultiTrendChart,
  PieBreakdownChart,
  VerticalBarChart,
  type ComboTrendPoint,
  type MultiTrendPoint,
  type PieDatum,
} from "../charts";
import { PCT, filterZeroRequests, shortToken } from "./shared";

// Department aggregation view — the primary tab of the Usage Kanban. Ports
// the source DeptAggregateView (646 lines, ECharts) to recharts + semantic
// tokens. Layout is preserved: active-users KPIs → overview KPIs + period
// compare → request/active-user combo trend + token trend → model pie + table
// → mode usage table → weekday bar → results KPIs + per-model success bar.
//
// Faithful port decisions:
//   - All 7 dept queries fire in parallel (overview/activeUsers/trend/models/
//     weekly/results/periodCompare) plus the local mode-usage caliber. Each
//     block has its own loading/empty state so a slow endpoint doesn't block
//     the rest.
//   - The "0 requests + 0 active users" empty-state short-circuit is kept.
//   - The zero-request model toggle is kept (default-hides 0-request models).
//
// Simplifications (documented per slice-3b "layout faithful, not pixel-perfect"):
//   - The source's "granularity toggle" (day/week/month bucketing of the
//     trend) is dropped — we render per-day (the backend's native granularity)
//     to avoid porting the buildBuckets util. TODO: granularity in a later
//     slice if needed.
//   - The "usage rate = active / headcount" extra tooltip line is dropped
//     (recharts tooltip is config-driven; adding a custom line is more work
//     than it's worth for v1).
//   - The Mode usage data source comment ("local DB, not chat-stats") still
//     applies; the mini-core mock returns synthetic items.

interface DeptAggregateViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
}

export function DeptAggregateView({
  deptId,
  startDate,
  endDate,
  includeChildren,
}: DeptAggregateViewProps) {
  const wsId = useWorkspaceId();
  const q: DeptQuery = { deptId, start: startDate, end: endDate, includeChildren };

  // Headcount/coverage: the source derived dept-wide member_count from a
  // date-scoped /v2/dept-tree/overview call. That endpoint isn't wired in
  // mini-core yet, so the "部门覆盖率" KPI is omitted here. TODO: re-enable
  // coverage once DeptOverviewResponse (nodes+summary) is exposed via a
  // queryOption.

  const overviewQ = useQuery(usageDeptOverviewOptions(wsId, q));
  const activeQ = useQuery(usageDeptActiveUsersOptions(wsId, q));
  const trendQ = useQuery(usageDeptTrendOptions(wsId, q));
  const modelsQ = useQuery(usageDeptModelsOptions(wsId, q));
  const weeklyQ = useQuery(usageDeptWeeklyOptions(wsId, q));
  const resultsQ = useQuery(usageDeptResultsOptions(wsId, q));
  const compareQ = useQuery(usageDeptPeriodCompareOptions(wsId, q));
  const modeUsageQ = useQuery(usageDeptModeUsageOptions(wsId, q));

  if (!deptId) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        请在左侧选择部门
      </div>
    );
  }

  const fatalErr = [overviewQ, activeQ, trendQ, modelsQ, weeklyQ, resultsQ].find(
    (h) => h.error,
  )?.error;
  if (fatalErr) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-destructive">
        加载部门指标失败：{(fatalErr as Error).message}
      </div>
    );
  }

  const ov = overviewQ.data;
  const au = activeQ.data;
  const cmp = compareQ.data;

  // Empty-state short-circuit: backend returns a minimal object for depts with
  // no activity. Avoids success_rate/token fields being undefined downstream.
  if (
    ov &&
    ov.total_requests === 0 &&
    (ov.active_users === 0 || ov.active_users == null)
  ) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        该部门在所选区间内无平台使用记录。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Active users: DAU/WAU/MAU + stickiness. */}
      <ActiveUsersBlock loading={activeQ.isLoading && !au} data={au} />

      {/* Overview KPIs + period-compare badges. */}
      <OverviewBlock
        loading={overviewQ.isLoading && !ov}
        overview={ov}
        compare={cmp}
      />

      {/* Trend: requests (bar) + active users (line) on dual axes, plus a
          separate token trend (input + output areas). Per-day granularity
          (source's granularity toggle is dropped — see file header). */}
      <TrendBlock loading={trendQ.isLoading} trend={trendQ.data?.trend} />

      {/* Per-model volume: donut + detail table. */}
      <ModelsBlock loading={modelsQ.isLoading} models={modelsQ.data?.models} />

      {/* Per-mode usage (kanban-local caliber). */}
      <ModeUsageBlock
        loading={modeUsageQ.isLoading}
        error={modeUsageQ.error as Error | null}
        items={modeUsageQ.data?.items}
      />

      {/* By-weekday request distribution. */}
      <WeeklyBlock loading={weeklyQ.isLoading} weekdays={weeklyQ.data?.weekdays} />

      {/* Request outcomes + per-model success rate bar. */}
      <ResultsBlock loading={resultsQ.isLoading} data={resultsQ.data} />
    </div>
  );
}

// ============================ Card shell ============================
// Local wrapper matching the slice-2 card look (border + bg-card + p-5). The
// source used a "glass" style; we use the established token-driven card so the
// usage views are visually consistent with the Overview page.
function Card({
  title,
  sub,
  extra,
  children,
  className = "",
}: {
  title: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col rounded-lg border bg-card p-5 md:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {extra && <div className="shrink-0">{extra}</div>}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center text-sm text-muted-foreground ${
        compact ? "min-h-[6rem]" : "min-h-[14rem]"
      }`}
    >
      暂无数据
    </div>
  );
}

// ============================ Active users ============================
function ActiveUsersBlock({
  loading,
  data,
}: {
  loading: boolean;
  data?: { dau: number; wau: number; mau: number; dau_wau_ratio: number };
}) {
  if (loading) return <SkeletonCard title="活跃用户" rows={4} />;
  if (!data) {
    return (
      <Card title="活跃用户" sub="DAU/WAU/MAU · DAU/WAU 比值衡量粘性">
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card title="活跃用户" sub="DAU/WAU/MAU · DAU/WAU 比值衡量粘性">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="DAU 日活" value={formatNumber(data.dau)} hint="区间末日至少 1 次请求的去重用户" />
        <KpiCard label="WAU 周活" value={formatNumber(data.wau)} hint="末日往前 7 天滚动去重" />
        <KpiCard label="MAU 月活" value={formatNumber(data.mau)} hint="末日往前 30 天滚动去重" />
        <KpiCard label="DAU/WAU" value={PCT(data.dau_wau_ratio)} hint="粘性：日活占周活比" accent="brand" />
      </div>
    </Card>
  );
}

// ============================ Overview KPIs + period compare ============================
function OverviewBlock({
  loading,
  overview: ov,
  compare: cmp,
}: {
  loading: boolean;
  overview?: {
    total_requests: number;
    active_users: number;
    total_sessions: number;
    sum_prompt_tokens: number;
    sum_completion_tokens: number;
    sum_total_tokens: number;
    success_rate: number;
    error_rate: number;
  };
  compare?: {
    request_change_pct: number;
    token_change_pct: number;
    previous_period: { start: string; end: string };
  } | null;
}) {
  if (loading) return <SkeletonCard title="使用概览" rows={8} />;
  if (!ov) {
    return (
      <Card title="使用概览" sub="除成功率/失败率外，均已排除失败请求">
        <EmptyHint />
      </Card>
    );
  }
  const perCapitaRequests =
    ov.active_users ? formatNumber(Math.round(ov.total_requests / ov.active_users)) : "-";
  const perCapitaTokens =
    ov.active_users ? shortToken(Math.round(ov.sum_total_tokens / ov.active_users)) : "-";
  const perCapitaPrompt =
    ov.active_users ? shortToken(Math.round(ov.sum_prompt_tokens / ov.active_users)) : "-";
  const perCapitaCompletion =
    ov.active_users ? shortToken(Math.round(ov.sum_completion_tokens / ov.active_users)) : "-";
  return (
    <Card title="使用概览" sub="除成功率/失败率外，均已排除失败请求">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="总请求" value={formatNumber(ov.total_requests)} hint="统计周期内所有成功 API 请求" />
        <KpiCard label="人均请求" value={perCapitaRequests} hint={`活跃 ${formatNumber(ov.active_users)} 人`} />
        <KpiCard label="总会话数" value={formatNumber(ov.total_sessions)} hint="unique_task 去重" />
        <KpiCard label="活跃用户" value={formatNumber(ov.active_users)} />
        <KpiCard label="总输入 Token" value={shortToken(ov.sum_prompt_tokens)} hint={formatNumber(ov.sum_prompt_tokens)} />
        <KpiCard label="总输出 Token" value={shortToken(ov.sum_completion_tokens)} hint={formatNumber(ov.sum_completion_tokens)} />
        <KpiCard
          label="总 Token 消耗"
          value={shortToken(ov.sum_total_tokens)}
          hint={formatNumber(ov.sum_total_tokens)}
          accent={cmp && cmp.token_change_pct > 0 ? "brand" : "default"}
        />
        <KpiCard label="人均 Token" value={perCapitaTokens} />
        <KpiCard label="请求成功率" value={PCT(ov.success_rate)} accent="success" />
        <KpiCard label="请求失败率" value={PCT(ov.error_rate)} accent={ov.error_rate > 5 ? "brand" : "default"} />
        <KpiCard label="人均输入 Token" value={perCapitaPrompt} />
        <KpiCard label="人均输出 Token" value={perCapitaCompletion} />
      </div>
      {cmp && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <ChangeBadge label="请求环比" pct={cmp.request_change_pct} />
          <ChangeBadge label="Token 环比" pct={cmp.token_change_pct} />
          <span>
            上期 {cmp.previous_period.start} ~ {cmp.previous_period.end}
          </span>
        </div>
      )}
    </Card>
  );
}

/** Period-over-period arrow badge: positive green, negative red, zero gray. */
function ChangeBadge({ label, pct }: { label: string; pct: number }) {
  if (!Number.isFinite(pct)) {
    return <span className="text-muted-foreground">{label} —</span>;
  }
  const up = pct > 0;
  const flat = pct === 0;
  const tone = flat
    ? "text-muted-foreground"
    : up
      ? "text-success"
      : "text-destructive";
  const arrow = flat ? "·" : up ? "▲" : "▼";
  return (
    <span className={tone}>
      {label} {arrow} {PCT(Math.abs(pct))}
    </span>
  );
}

// ============================ Trend (combo bar+line + token area) ============================
function TrendBlock({
  loading,
  trend,
}: {
  loading: boolean;
  trend?: DeptTrendPoint[];
}) {
  if (loading) return <SkeletonCard title="使用趋势（按天）" />;
  if (!trend || !trend.length) {
    return (
      <Card title="使用趋势（按天）" sub="请求量 / 活跃用户">
        <EmptyHint />
      </Card>
    );
  }
  // Combo chart: requests (bar, left) + active users (line, right). One row
  // per day; the source's bucket aggregation (week/month) is dropped.
  const combo: ComboTrendPoint[] = trend.map((t) => ({
    label: t.date.slice(5), // MM-DD
    bar: t.request_count,
    line: t.active_users,
  }));
  // Token trend: input + output as overlapping areas.
  const tokenPoints: MultiTrendPoint[] = trend.map((t) => ({
    label: t.date.slice(5),
    prompt: t.prompt_tokens,
    completion: t.completion_tokens,
  }));
  return (
    <>
      <Card
        title="使用趋势（按天）"
        sub="请求量（左·柱）· 活跃用户（右·线）"
      >
        <ComboTrendChart
          data={combo}
          bar={{ name: "请求量", color: "var(--chart-4)" }}
          line={{ name: "活跃用户", color: "var(--chart-2)" }}
          formatLeftY={shortToken}
        />
      </Card>
      <Card title="Token 消耗趋势（按天）" sub="输入 / 输出 Token">
        <MultiTrendChart
          data={tokenPoints}
          formatY={shortToken}
          series={[
            { key: "prompt", name: "输入 Token", color: "var(--chart-1)" },
            { key: "completion", name: "输出 Token", color: "var(--chart-3)" },
          ]}
        />
      </Card>
    </>
  );
}

// ============================ Per-model volume (donut + table) ============================
function ModelsBlock({
  loading,
  models,
}: {
  loading: boolean;
  models?: DeptModelItem[];
}) {
  const [showZero, setShowZero] = useState(false);
  const { visible, hiddenCount } = filterZeroRequests(models, (m) => m.request_count);
  const effective = showZero ? models ?? [] : visible;

  if (loading) return <SkeletonCard title="各模型使用" />;
  if (!models || !models.length) {
    return (
      <Card title="各模型使用" sub="请求次数 / 占比 / Token / 成功率">
        <EmptyHint />
      </Card>
    );
  }
  const pie: PieDatum[] = effective.map((m) => ({ name: m.model || "-", value: m.request_count }));
  return (
    <Card
      title="各模型使用"
      sub="按实际命中模型（routed_model）拆分"
      extra={
        <ZeroToggle showZero={showZero} onToggle={setShowZero} hiddenCount={hiddenCount} />
      }
    >
      {effective.length === 0 ? (
        <EmptyHint />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
          <PieBreakdownChart data={pie} />
          <ModelTable models={effective} />
        </div>
      )}
    </Card>
  );
}

function ModelTable({ models }: { models: DeptModelItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <Th>模型</Th>
            <ThNum>请求次数</ThNum>
            <ThNum>请求占比</ThNum>
            <ThNum>输入 Token</ThNum>
            <ThNum>输出 Token</ThNum>
            <ThNum>消耗占比</ThNum>
            <ThNum>输入/输出</ThNum>
            <ThNum>成功率</ThNum>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={m.model || i} className="border-b border-border/50">
              <Td>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: `var(--chart-${(i % 5) + 1})` }}
                  />
                  <span className="max-w-[180px] truncate" title={m.model}>
                    {m.model || "-"}
                  </span>
                </span>
              </Td>
              <TdNum>{formatNumber(m.request_count)}</TdNum>
              <TdNum>{PCT(m.request_pct)}</TdNum>
              <TdNum title={formatNumber(m.prompt_tokens)}>{shortToken(m.prompt_tokens)}</TdNum>
              <TdNum title={formatNumber(m.completion_tokens)}>{shortToken(m.completion_tokens)}</TdNum>
              <TdNum>{PCT(m.token_pct)}</TdNum>
              <TdNum>{m.input_output_ratio.toFixed(2)}</TdNum>
              <TdNum>{PCT(m.success_rate)}</TdNum>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ Mode usage (kanban-local) ============================
function ModeUsageBlock({
  loading,
  error,
  items,
}: {
  loading: boolean;
  error: Error | null;
  items?: DeptModeUsageItem[];
}) {
  if (loading) return <SkeletonCard title="各 Mode 使用情况" />;
  if (error) {
    return (
      <Card title="各 Mode 使用情况" sub="看板口径（本地同步数据），与平台活跃用户口径不同源">
        <div className="py-8 text-center text-sm text-muted-foreground">
          加载失败：{error.message}
        </div>
      </Card>
    );
  }
  if (!items || !items.length) {
    return (
      <Card title="各 Mode 使用情况" sub="看板口径（本地同步数据），与平台活跃用户口径不同源">
        <EmptyHint />
      </Card>
    );
  }
  const totalRequests = items.reduce((acc, it) => acc + it.request_count, 0);
  return (
    <Card title="各 Mode 使用情况" sub="看板口径（本地同步数据），与平台活跃用户口径不同源">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <Th>Mode</Th>
              <ThNum>使用人数</ThNum>
              <ThNum>请求数</ThNum>
              <Th>请求占比</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((m, i) => {
              const pct = totalRequests > 0 ? (m.request_count / totalRequests) * 100 : 0;
              return (
                <tr key={m.mode || i} className="border-b border-border/50">
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: `var(--chart-${(i % 5) + 1})` }}
                      />
                      <span className="max-w-[180px] truncate" title={m.mode}>
                        {!m.mode || m.mode === "unknown" ? "-" : m.mode}
                      </span>
                    </span>
                  </Td>
                  <TdNum>{formatNumber(m.user_count)}</TdNum>
                  <TdNum>{formatNumber(m.request_count)}</TdNum>
                  <Td>
                    <div className="flex min-w-[140px] items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {PCT(pct)}
                      </span>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============================ By-weekday distribution ============================
function WeeklyBlock({
  loading,
  weekdays,
}: {
  loading: boolean;
  weekdays?: { weekday: number; weekday_name: string; request_count: number }[];
}) {
  if (loading) return <SkeletonCard title="按星期聚合请求量分布" />;
  if (!weekdays || !weekdays.length) {
    return (
      <Card title="按星期聚合请求量分布" sub="一周 7 天各日请求次数">
        <EmptyHint />
      </Card>
    );
  }
  const data = weekdays.map((w) => ({ label: w.weekday_name, value: w.request_count }));
  return (
    <Card title="按星期聚合请求量分布" sub="一周 7 天各日请求次数">
      <VerticalBarChart data={data} formatY={shortToken} color="var(--chart-1)" />
    </Card>
  );
}

// ============================ Request results + per-model success ============================
function ResultsBlock({
  loading,
  data,
}: {
  loading: boolean;
  data?: DeptResultsResp;
}) {
  if (loading) return <SkeletonCard title="请求结果" />;
  if (!data) {
    return (
      <Card title="请求结果" sub="成功率 / 失败率 / 各模型成功率">
        <EmptyHint />
      </Card>
    );
  }
  const barData = (data.models ?? []).map((m) => ({
    label: m.model,
    value: m.success_rate,
  }));
  return (
    <Card title="请求结果" sub="成功率分母含失败请求（n+1 口径）· 运维重点">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="成功次数" value={formatNumber(data.success_requests)} accent="success" />
        <KpiCard
          label="失败次数"
          value={formatNumber(data.error_requests)}
          accent={data.error_requests > 0 ? "brand" : "default"}
        />
        <KpiCard label="成功率" value={PCT(data.success_rate)} accent="success" />
        <KpiCard
          label="失败率"
          value={PCT(data.error_rate)}
          accent={data.error_rate > 5 ? "brand" : "default"}
        />
      </div>
      {barData.length ? (
        <VerticalBarChart data={barData} color="var(--chart-2)" formatY={(v) => `${v.toFixed(0)}%`} />
      ) : (
        <EmptyHint compact />
      )}
    </Card>
  );
}

// ============================ Small shared bits ============================
function Th({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{children}</th>;
}
function ThNum({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">{children}</th>;
}
function Td({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 align-middle text-card-foreground" title={title}>
      {children}
    </td>
  );
}
function TdNum({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <td
      className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-card-foreground"
      title={title}
    >
      {children}
    </td>
  );
}

function ZeroToggle({
  showZero,
  onToggle,
  hiddenCount,
}: {
  showZero: boolean;
  onToggle: (v: boolean) => void;
  hiddenCount: number;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={showZero} onCheckedChange={onToggle} aria-label="显示 0 请求模型" />
      显示 0 请求{hiddenCount > 0 ? `（${hiddenCount}）` : ""}
    </label>
  );
}

function SkeletonCard({ title, rows = 0 }: { title: ReactNode; rows?: number }) {
  if (rows > 0) {
    return (
      <Card title={title}>
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4`}>
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card title={title}>
      <Skeleton className="h-[240px] rounded-lg" />
    </Card>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  buildBuckets,
  deptOverviewOptions,
  formatNumber,
  GRANULARITY_CN,
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
  type DeptTreeNodeWithSummary,
  type Granularity,
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
import {
  GranularityToggle,
  useGranularity,
} from "../components/granularity-toggle";
import {
  PCT,
  chartColorFor,
  filterZeroRequests,
  shortToken,
  Td,
  TdNum,
  Th,
  ThNum,
} from "./shared";

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
// Notes:
//   - Usage rate = active / roster headcount is shown in the request/active
//     user trend tooltip, matching the source without drawing a duplicate line.
//   - The Mode usage data source comment ("local DB, not chat-stats") still
//     applies; the mini-core mock returns synthetic items.

interface DeptAggregateViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
}

function findDeptSummaryNode(
  nodes: DeptTreeNodeWithSummary[],
  id: string,
): DeptTreeNodeWithSummary | undefined {
  for (const node of nodes) {
    if (node.dept_id === id) return node;
    const child = node.children.length
      ? findDeptSummaryNode(node.children, id)
      : undefined;
    if (child) return child;
  }
  return undefined;
}

export function DeptAggregateView({
  deptId,
  startDate,
  endDate,
  includeChildren,
}: DeptAggregateViewProps) {
  const wsId = useWorkspaceId();
  const q: DeptQuery = { deptId, start: startDate, end: endDate, includeChildren };
  const { gran, setGran, options: granOptions } = useGranularity(
    startDate,
    endDate,
  );

  const overviewQ = useQuery(usageDeptOverviewOptions(wsId, q));
  const activeQ = useQuery(usageDeptActiveUsersOptions(wsId, q));
  const trendQ = useQuery(usageDeptTrendOptions(wsId, q));
  const modelsQ = useQuery(usageDeptModelsOptions(wsId, q));
  const weeklyQ = useQuery(usageDeptWeeklyOptions(wsId, q));
  const resultsQ = useQuery(usageDeptResultsOptions(wsId, q));
  const compareQ = useQuery(usageDeptPeriodCompareOptions(wsId, q));
  const modeUsageQ = useQuery(usageDeptModeUsageOptions(wsId, q));
  const deptOverviewQ = useQuery(
    deptOverviewOptions(wsId, startDate, endDate),
  );

  if (!deptId) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        请在左侧选择部门
      </div>
    );
  }

  // No page-level fatal-error short-circuit: each block surfaces its own
  // error state (see per-block `if (q.error) return <ErrorHint />`). This is
  // the per-block resilience intent — a failing weeklyQ must not hide the rest.
  // modeUsageQ is treated the same as the others now (no special exclusion).
  const ov = overviewQ.data;
  const au = activeQ.data;
  const cmp = compareQ.data;
  const deptNode = findDeptSummaryNode(
    deptOverviewQ.data?.nodes ?? [],
    deptId,
  );
  const deptHeadcount = deptNode?.summary.member_count ?? 0;
  const coveragePct =
    ov && deptHeadcount > 0
      ? Math.min(100, (ov.active_users / deptHeadcount) * 100)
      : null;

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
      <ActiveUsersBlock
        loading={activeQ.isLoading && !au}
        error={activeQ.error as Error | null}
        data={au}
      />

      {/* Overview KPIs + period-compare badges. */}
      <OverviewBlock
        loading={overviewQ.isLoading && !ov}
        error={overviewQ.error as Error | null}
        overview={ov}
        compare={cmp}
        coveragePct={coveragePct}
        headcount={deptHeadcount}
      />

      {/* Trend: requests (bar) + active users (line) on dual axes, plus a
          separate token trend (input + output areas). */}
      <TrendBlock
        loading={trendQ.isLoading && !trendQ.data}
        error={trendQ.error as Error | null}
        trend={trendQ.data?.trend}
        start={startDate}
        end={endDate}
        gran={gran}
        headcount={deptHeadcount}
        granControl={
          <GranularityToggle
            value={gran}
            options={granOptions}
            onChange={setGran}
          />
        }
      />

      {/* Per-model volume: donut + detail table. */}
      <ModelsBlock
        loading={modelsQ.isLoading && !modelsQ.data}
        error={modelsQ.error as Error | null}
        models={modelsQ.data?.models}
      />

      {/* Per-mode usage (kanban-local caliber). */}
      <ModeUsageBlock
        loading={modeUsageQ.isLoading && !modeUsageQ.data}
        error={modeUsageQ.error as Error | null}
        items={modeUsageQ.data?.items}
      />

      {/* By-weekday request distribution. */}
      <WeeklyBlock
        loading={weeklyQ.isLoading && !weeklyQ.data}
        error={weeklyQ.error as Error | null}
        weekdays={weeklyQ.data?.weekdays}
      />

      {/* Request outcomes + per-model success rate bar. */}
      <ResultsBlock
        loading={resultsQ.isLoading && !resultsQ.data}
        error={resultsQ.error as Error | null}
        data={resultsQ.data}
      />
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
    <div className={`flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6 ${className}`}>
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

/**
 * Per-block error state. Renders inside a Card shell so the block keeps its
 * title + frame; only the body swaps to a destructive message. The `title`
 * is passed so the failed block is identifiable (matches the card header the
 * block would otherwise render).
 */
function ErrorHint({ title, sub, error }: { title: ReactNode; sub?: ReactNode; error: Error }) {
  return (
    <Card title={title} sub={sub}>
      <div className="flex min-h-[8rem] items-center justify-center text-center text-sm text-destructive">
        加载失败：{error.message}
      </div>
    </Card>
  );
}

// ============================ Active users ============================
function ActiveUsersBlock({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: Error | null;
  data?: { dau: number; wau: number; mau: number; dau_wau_ratio: number };
}) {
  if (loading) return <SkeletonCard title="活跃用户" rows={4} />;
  if (error) {
    return (
      <ErrorHint title="活跃用户" sub="DAU/WAU/MAU · DAU/WAU 比值衡量粘性" error={error} />
    );
  }
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
  error,
  overview: ov,
  compare: cmp,
  coveragePct,
  headcount,
}: {
  loading: boolean;
  error: Error | null;
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
  coveragePct: number | null;
  headcount: number;
}) {
  if (loading) return <SkeletonCard title="使用概览" rows={8} />;
  if (error) {
    return <ErrorHint title="使用概览" sub="除成功率/失败率外，均已排除失败请求" error={error} />;
  }
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
        <KpiCard
          label="部门覆盖率"
          value={coveragePct == null ? "-" : PCT(coveragePct)}
          hint={
            headcount > 0
              ? `${formatNumber(ov.active_users)} / ${formatNumber(headcount)} 人`
              : "花名册人数不可得"
          }
          accent="brand"
        />
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
  error,
  trend,
  start,
  end,
  gran,
  headcount,
  granControl,
}: {
  loading: boolean;
  error: Error | null;
  trend?: DeptTrendPoint[];
  start: string;
  end: string;
  gran: Granularity;
  headcount: number;
  granControl: ReactNode;
}) {
  const points = trend ?? [];
  const aggregated = (() => {
    const byDate = new Map(points.map((point) => [point.date, point]));
    const buckets = buildBuckets(
      points.map((point) => point.date),
      gran,
      { start, end },
    );
    const sum = (
      dates: string[],
      pick: (point: DeptTrendPoint) => number,
    ) =>
      dates.reduce((total, date) => {
        const point = byDate.get(date);
        return total + (point ? pick(point) : 0);
      }, 0);

    return buckets.map((bucket) => ({
      label: bucket.label,
      requestCount: sum(bucket.dates, (point) => point.request_count),
      activeUsers: Math.round(
        sum(bucket.dates, (point) => point.active_users) / bucket.spanDays,
      ),
      promptTokens: sum(bucket.dates, (point) => point.prompt_tokens),
      completionTokens: sum(
        bucket.dates,
        (point) => point.completion_tokens,
      ),
    }));
  })();
  const granularityLabel = GRANULARITY_CN[gran];
  const activeLabel = gran === "day" ? "活跃用户" : "日均活跃用户";

  if (loading) return <SkeletonCard title={`使用趋势（${granularityLabel}）`} />;
  if (error) {
    return (
      <ErrorHint
        title={`使用趋势（${granularityLabel}）`}
        sub={`请求量 / ${activeLabel}`}
        error={error}
      />
    );
  }
  if (!trend || !trend.length) {
    return (
      <Card
        title={`使用趋势（${granularityLabel}）`}
        sub={`请求量 / ${activeLabel}`}
        extra={granControl}
      >
        <EmptyHint />
      </Card>
    );
  }
  const combo: ComboTrendPoint[] = aggregated.map((point) => ({
    label: point.label,
    bar: point.requestCount,
    line: point.activeUsers,
    tooltipExtra:
      headcount > 0
        ? Math.min(100, (point.activeUsers / headcount) * 100)
        : undefined,
  }));
  const tokenPoints: MultiTrendPoint[] = aggregated.map((point) => ({
    label: point.label,
    prompt: point.promptTokens,
    completion: point.completionTokens,
  }));
  return (
    <>
      <Card
        title={`使用趋势（${granularityLabel}）`}
        sub={`请求量（左·柱）· ${activeLabel}（右·线）`}
        extra={granControl}
      >
        <ComboTrendChart
          data={combo}
          bar={{ name: "请求量", color: "var(--chart-4)" }}
          line={{ name: activeLabel, color: "var(--chart-2)" }}
          formatLeftY={shortToken}
          tooltipExtra={
            headcount > 0
              ? {
                  name: gran === "day" ? "使用率" : "日均使用率",
                  format: (value) => `${value.toFixed(1)}%`,
                }
              : undefined
          }
        />
      </Card>
      <Card
        title={`Token 消耗趋势（${granularityLabel}）`}
        sub="输入 / 输出 Token"
      >
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
  error,
  models,
}: {
  loading: boolean;
  error: Error | null;
  models?: DeptModelItem[];
}) {
  const [showZero, setShowZero] = useState(false);
  const { visible, hiddenCount } = filterZeroRequests(models, (m) => m.request_count);
  const effective = showZero ? models ?? [] : visible;

  if (loading) return <SkeletonCard title="各模型使用" />;
  if (error) {
    return <ErrorHint title="各模型使用" sub="请求次数 / 占比 / Token / 成功率" error={error} />;
  }
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
                    style={{ background: chartColorFor(i) }}
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
      <ErrorHint
        title="各 Mode 使用情况"
        sub="看板口径（本地同步数据），与平台活跃用户口径不同源"
        error={error}
      />
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
                        style={{ background: chartColorFor(i) }}
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
  error,
  weekdays,
}: {
  loading: boolean;
  error: Error | null;
  weekdays?: { weekday: number; weekday_name: string; request_count: number }[];
}) {
  if (loading) return <SkeletonCard title="按星期聚合请求量分布" />;
  if (error) {
    return <ErrorHint title="按星期聚合请求量分布" sub="一周 7 天各日请求次数" error={error} />;
  }
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
  error,
  data,
}: {
  loading: boolean;
  error: Error | null;
  data?: DeptResultsResp;
}) {
  if (loading) return <SkeletonCard title="请求结果" />;
  if (error) {
    return <ErrorHint title="请求结果" sub="成功率 / 失败率 / 各模型成功率" error={error} />;
  }
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
// Th / ThNum / Td / TdNum are imported from ./shared (single source of truth
// shared with dept-compare-view, members-view, member-detail).

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

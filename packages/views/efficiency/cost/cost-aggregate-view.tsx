"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  costAnomalyOptions,
  costModelCompositionOptions,
  costModelTrendOptions,
  costModelsOptions,
  costOverviewOptions,
  costPeriodCompareOptions,
  fmtCost,
  formatNumber,
  type CostAnomalyResp,
  type CostCompositionItem,
  type CostModelItem,
  type CostModelTrendSeries,
  type CostOverviewResp,
  type CostPeriodCompareResp,
  type DeptQuery,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { KpiCard } from "../../runtimes/components/shared";
import {
  MultiTrendChart,
  PieBreakdownChart,
  type MultiTrendPoint,
  type PieDatum,
} from "../charts";
import {
  PCT,
  chartColorFor,
  filterZeroRequests,
  shortToken,
  Td,
  TdNum,
  Th,
  ThNum,
} from "../usage/shared";

// Cost aggregation view — the primary tab of the Cost Kanban. Ports the
// source CostAggregateView (550 lines, ECharts) to recharts + semantic
// tokens. Layout is preserved: total cost KPIs + period-compare → token
// cost KPIs → cache cost KPIs → daily total cost trend (aggregated from
// model-trend) → per-model cost (pie + table) → per-model stacked area
// trend → anomaly detection.
//
// Faithful port decisions:
//   - All 6 cost dept queries fire in parallel (overview/periodCompare/
//     models/modelTrend/modelComposition/anomaly). Each block has its own
//     loading/empty/error state so a slow endpoint doesn't block the rest
//     (mirrors usage's per-block pattern: `isLoading && !data` guard +
//     ErrorHint).
//   - The "0 total_cost + 0 active users" empty-state short-circuit is kept.
//   - The zero-request model toggle is kept (default-hides 0-request models).
//   - The daily total cost trend is computed client-side by summing each
//     model's per-day total_cost across the model-trend series (the backend
//     has no cost/daily-trend endpoint), matching the source's aggregation.
//
// Simplifications (documented per slice-3b "layout faithful, not pixel-perfect"):
//   - The source's "granularity toggle" (day/week/month bucketing of the
//     trend) is dropped — we render per-day (the backend's native
//     granularity) to avoid porting the buildBuckets util. TODO: granularity
//     in a later slice if needed. Same simplification as the usage view.
//   - Cost values are formatted via fmtCost (2 decimals) prefixed with ¥.

interface CostAggregateViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
}

export function CostAggregateView({
  deptId,
  startDate,
  endDate,
  includeChildren,
}: CostAggregateViewProps) {
  const wsId = useWorkspaceId();
  const q: DeptQuery = { deptId, start: startDate, end: endDate, includeChildren };

  const overviewQ = useQuery(costOverviewOptions(wsId, q));
  const compareQ = useQuery(costPeriodCompareOptions(wsId, q));
  const modelsQ = useQuery(costModelsOptions(wsId, q));
  const trendQ = useQuery(costModelTrendOptions(wsId, q));
  const compositionQ = useQuery(costModelCompositionOptions(wsId, q));
  const anomalyQ = useQuery(costAnomalyOptions(wsId, q));

  if (!deptId) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        请在左侧选择部门
      </div>
    );
  }

  const ov = overviewQ.data;
  const cmp = compareQ.data;

  // Empty-state short-circuit: backend returns a minimal object for depts with
  // no activity (total_cost=0 / active_users=0).
  if (
    ov &&
    ov.total_cost === 0 &&
    (ov.active_users === 0 || ov.active_users == null)
  ) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
        该部门在所选区间内无成本记录。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Block 1: total cost KPIs + period-compare badges. */}
      <TotalCostBlock
        loading={overviewQ.isLoading && !ov}
        error={overviewQ.error as Error | null}
        overview={ov}
        compare={cmp}
      />

      {/* Block 2: token cost KPIs (input/output split). */}
      <TokenCostBlock
        loading={overviewQ.isLoading && !ov}
        error={overviewQ.error as Error | null}
        overview={ov}
      />

      {/* Block 3: cache cost KPIs (hit/miss + savings). */}
      <CacheCostBlock
        loading={overviewQ.isLoading && !ov}
        error={overviewQ.error as Error | null}
        overview={ov}
      />

      {/* Block 4: daily total cost trend (aggregated from model-trend). */}
      <DailyCostTrendBlock
        loading={trendQ.isLoading && !trendQ.data}
        error={trendQ.error as Error | null}
        series={trendQ.data?.series}
      />

      {/* Block 5: per-model cost (donut + table). */}
      <ModelsCostBlock
        loading={modelsQ.isLoading && !modelsQ.data}
        error={modelsQ.error as Error | null}
        models={modelsQ.data?.models}
        composition={compositionQ.data?.items}
        compositionLoading={compositionQ.isLoading && !compositionQ.data}
      />

      {/* Block 6: per-model cost stacked area trend. */}
      <ModelTrendStackBlock
        loading={trendQ.isLoading && !trendQ.data}
        error={trendQ.error as Error | null}
        series={trendQ.data?.series}
      />

      {/* Block 7: anomaly detection. */}
      <AnomalyBlock
        loading={anomalyQ.isLoading && !anomalyQ.data}
        error={anomalyQ.error as Error | null}
        data={anomalyQ.data}
      />
    </div>
  );
}

// ============================ Card shell ============================
// Local wrapper matching the slice-2 card look (border + bg-card + p-5). The
// source used a "glass" style; we use the established token-driven card so the
// cost views are visually consistent with the Usage/Overview pages. Duplicated
// from usage/dept-aggregate-view on purpose (cross-directory shared card would
// over-couple the two dimensions; the usage Card is local to usage/).
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
 * title + frame; only the body swaps to a destructive message.
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

// ============================ Block 1: total cost ============================
function TotalCostBlock({
  loading,
  error,
  overview: ov,
  compare: cmp,
}: {
  loading: boolean;
  error: Error | null;
  overview?: CostOverviewResp;
  compare?: CostPeriodCompareResp | null;
}) {
  if (loading) return <SkeletonCard title="总成本" rows={5} />;
  if (error) {
    return <ErrorHint title="总成本" sub="实际扣费 · 含费用环比" error={error} />;
  }
  if (!ov) {
    return (
      <Card title="总成本" sub="实际扣费 · 含费用环比">
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card title="总成本" sub="实际扣费 · 含费用环比">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="总费用" value={`¥${fmtCost(ov.total_cost)}`} accent="brand" />
        <KpiCard label="日均费用" value={`¥${fmtCost(ov.daily_avg_cost)}`} />
        <KpiCard
          label="人均费用"
          value={`¥${fmtCost(ov.per_user_avg_cost)}`}
          hint={`活跃 ${formatNumber(ov.active_users)} 人`}
        />
        <KpiCard
          label="每千Token成本"
          value={`¥${fmtCost(ov.per_1k_token_cost)}`}
          hint="总费用 / 总Token × 1000"
          accent="success"
        />
        <KpiCard label="活跃用户" value={formatNumber(ov.active_users)} />
      </div>
      {cmp && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <ChangeBadge label="费用环比" pct={cmp.cost_change_pct} />
          <span>
            上期 {cmp.previous_period.start} ~ {cmp.previous_period.end}
            （¥{fmtCost(cmp.previous_period.total_cost)}）
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

// ============================ Block 2: token cost ============================
function TokenCostBlock({
  loading,
  error,
  overview: ov,
}: {
  loading: boolean;
  error: Error | null;
  overview?: CostOverviewResp;
}) {
  if (loading) return <SkeletonCard title="Token 成本" rows={5} />;
  if (error) {
    return <ErrorHint title="Token 成本" sub="输入 / 输出费用拆分" error={error} />;
  }
  if (!ov) {
    return (
      <Card title="Token 成本" sub="输入 / 输出费用拆分">
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card title="Token 成本" sub="输入 / 输出费用拆分">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="输入Token费用" value={`¥${fmtCost(ov.input_cost)}`} />
        <KpiCard label="输出Token费用" value={`¥${fmtCost(ov.output_cost)}`} />
        <KpiCard label="输入费用占比" value={PCT(ov.input_cost_pct)} />
        <KpiCard label="输出费用占比" value={PCT(ov.output_cost_pct)} />
        <KpiCard
          label="总Token"
          value={shortToken(ov.total_tokens)}
          hint={formatNumber(ov.total_tokens)}
        />
      </div>
    </Card>
  );
}

// ============================ Block 3: cache cost ============================
function CacheCostBlock({
  loading,
  error,
  overview: ov,
}: {
  loading: boolean;
  error: Error | null;
  overview?: CostOverviewResp;
}) {
  if (loading) return <SkeletonCard title="缓存成本" rows={6} />;
  if (error) {
    return (
      <ErrorHint title="缓存成本" sub="命中 / 未命中 · 节省费用" error={error} />
    );
  }
  if (!ov) {
    return (
      <Card title="缓存成本" sub="命中 / 未命中 · 节省费用">
        <EmptyHint />
      </Card>
    );
  }
  const cache = ov.cache;
  return (
    <Card title="缓存成本" sub="命中 / 未命中 · 节省费用">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="缓存命中输入Token"
          value={shortToken(cache.hit_input_tokens)}
          hint={formatNumber(cache.hit_input_tokens)}
        />
        <KpiCard
          label="缓存命中输入费用"
          value={`¥${fmtCost(cache.hit_input_cost)}`}
        />
        <KpiCard
          label="缓存未命中输入Token"
          value={shortToken(cache.miss_input_tokens)}
          hint={formatNumber(cache.miss_input_tokens)}
        />
        <KpiCard
          label="缓存未命中输入费用"
          value={`¥${fmtCost(cache.miss_input_cost)}`}
        />
        <KpiCard label="缓存命中率" value={PCT(cache.hit_rate_pct)} />
        <KpiCard
          label="缓存节省费用"
          value={`¥${fmtCost(cache.savings)}`}
          accent="success"
        />
      </div>
    </Card>
  );
}

// ============================ Block 4: daily total cost trend ============================
// The backend has no cost/daily-trend endpoint; the source aggregated each
// model's per-day total_cost from model-trend into a single daily total. We
// do the same here, then render a single-series area chart.
function DailyCostTrendBlock({
  loading,
  error,
  series,
}: {
  loading: boolean;
  error: Error | null;
  series?: CostModelTrendSeries[];
}) {
  // Sum each model's per-day total_cost across all series into one daily total.
  const points = useMemo<MultiTrendPoint[]>(() => {
    const dateMap = new Map<string, number>();
    for (const s of series ?? []) {
      for (const pt of s.data) {
        dateMap.set(pt.date, (dateMap.get(pt.date) ?? 0) + (pt.total_cost || 0));
      }
    }
    const dates = Array.from(dateMap.keys()).sort();
    return dates.map((date) => ({
      label: date.slice(5), // MM-DD
      cost: Math.round((dateMap.get(date) ?? 0) * 100) / 100,
    }));
  }, [series]);

  if (loading) return <SkeletonCard title="总费用趋势（按天）" />;
  if (error) {
    return (
      <ErrorHint
        title="总费用趋势（按天）"
        sub="由各模型费用聚合（后端无 cost/daily-trend）"
        error={error}
      />
    );
  }
  if (!points.length) {
    return (
      <Card
        title="总费用趋势（按天）"
        sub="由各模型费用聚合（后端无 cost/daily-trend）"
      >
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card
      title="总费用趋势（按天）"
      sub="由各模型费用聚合（后端无 cost/daily-trend）"
    >
      <MultiTrendChart
        data={points}
        formatY={(v) => `¥${shortToken(v)}`}
        series={[{ key: "cost", name: "总费用", color: "var(--chart-1)" }]}
      />
    </Card>
  );
}

// ============================ Block 5: per-model cost (donut + table) ============================
function ModelsCostBlock({
  loading,
  error,
  models,
  composition,
  compositionLoading,
}: {
  loading: boolean;
  error: Error | null;
  models?: CostModelItem[];
  composition?: CostCompositionItem[];
  compositionLoading: boolean;
}) {
  const [showZero, setShowZero] = useState(false);
  const { visible, hiddenCount } = filterZeroRequests(models, (m) => m.request_count);
  const effective = showZero ? models ?? [] : visible;

  if (loading) return <SkeletonCard title="各模型成本" />;
  if (error) {
    return (
      <ErrorHint
        title="各模型成本"
        sub="费用 / 占比 / 单价 / 实际平均成本"
        error={error}
      />
    );
  }
  if (!models || !models.length) {
    return (
      <Card title="各模型成本" sub="费用 / 占比 / 单价 / 实际平均成本">
        <EmptyHint />
      </Card>
    );
  }

  // Donut uses the composition endpoint when available (same caliber as the
  // source's pie), filtered to the visible (non-zero-request) models. Falls
  // back to the models list when composition hasn't loaded yet.
  const visibleNames = new Set(effective.map((m) => m.model));
  const pieItems: { name: string; value: number }[] = (composition && composition.length
    ? composition
    : effective.map((m) => ({ model: m.model, total_cost: m.total_cost }))
  )
    .filter((m) => visibleNames.has((m as { model: string }).model))
    .map((m) => ({
      name: (m as { model: string }).model || "-",
      value: (m as { total_cost: number }).total_cost,
    }));
  const pie: PieDatum[] = pieItems;

  return (
    <Card
      title="各模型成本"
      sub="按实际命中模型拆分（后端按 total_cost 降序）"
      extra={
        <ZeroToggle showZero={showZero} onToggle={setShowZero} hiddenCount={hiddenCount} />
      }
    >
      {effective.length === 0 ? (
        <EmptyHint />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr] lg:items-start">
          {compositionLoading && !composition ? (
            <Skeleton className="h-[280px] rounded-lg" />
          ) : (
            pie.length > 0 && <PieBreakdownChart data={pie} />
          )}
          <ModelCostTable models={effective} />
        </div>
      )}
    </Card>
  );
}

function ModelCostTable({ models }: { models: CostModelItem[] }) {
  /** Unit price formatter — null shows "-". */
  const price = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "-" : fmtCost(v);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <Th>模型</Th>
            <ThNum>费用</ThNum>
            <ThNum>费用占比</ThNum>
            <ThNum>输入单价/千</ThNum>
            <ThNum>输出单价/千</ThNum>
            <ThNum>实际平均成本/千</ThNum>
            <ThNum>请求数</ThNum>
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
              <TdNum>{`¥${fmtCost(m.total_cost)}`}</TdNum>
              <TdNum>{PCT(m.cost_pct)}</TdNum>
              <TdNum>{price(m.unit_price.input_per_1k)}</TdNum>
              <TdNum>{price(m.unit_price.output_per_1k)}</TdNum>
              <TdNum>{`¥${fmtCost(m.actual_avg_cost_per_1k)}`}</TdNum>
              <TdNum>{formatNumber(m.request_count)}</TdNum>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ Block 6: per-model stacked area trend ============================
// Each model becomes one stacked area band. We pivot the per-model series
// into rows keyed by date, with one field per model. The backend's
// per-model series may not share identical date sets, so missing (model,
// date) pairs are treated as 0.
function ModelTrendStackBlock({
  loading,
  error,
  series,
}: {
  loading: boolean;
  error: Error | null;
  series?: CostModelTrendSeries[];
}) {
  const { points, chartSeries } = useMemo(() => {
    if (!series || !series.length) return { points: [], chartSeries: [] };
    const allDates = new Set<string>();
    for (const s of series) for (const pt of s.data) allDates.add(pt.date);
    const dates = Array.from(allDates).sort();
    // Build per-model per-date cost maps.
    const byModel = new Map<string, Map<string, number>>();
    for (const s of series) {
      const m = new Map<string, number>();
      for (const pt of s.data) m.set(pt.date, pt.total_cost || 0);
      byModel.set(s.model, m);
    }
    const rows: MultiTrendPoint[] = dates.map((date) => {
      const row: MultiTrendPoint & Record<string, number | string> = {
        label: date.slice(5),
      };
      for (const s of series) {
        const m = byModel.get(s.model);
        row[s.model] = m?.get(date) ?? 0;
      }
      return row;
    });
    const chartSeriesOut = series.map((s, i) => ({
      key: s.model,
      name: s.model,
      color: chartColorFor(i),
    }));
    return { points: rows, chartSeries: chartSeriesOut };
  }, [series]);

  if (loading) return <SkeletonCard title="各模型费用趋势（按天）" />;
  if (error) {
    return (
      <ErrorHint title="各模型费用趋势（按天）" sub="堆叠面积图" error={error} />
    );
  }
  if (!points.length) {
    return (
      <Card title="各模型费用趋势（按天）" sub="堆叠面积图">
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card title="各模型费用趋势（按天）" sub="堆叠面积图">
      <MultiTrendChart
        data={points}
        series={chartSeries}
        stack
        formatY={(v) => `¥${shortToken(v)}`}
      />
    </Card>
  );
}

// ============================ Block 7: anomaly detection ============================
function AnomalyBlock({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: Error | null;
  data?: CostAnomalyResp;
}) {
  if (loading) return <SkeletonCard title="异常检测" rows={3} />;
  if (error) {
    return (
      <ErrorHint
        title="异常检测"
        sub="单日/单用户费用突增 · 0 费用活跃用户"
        error={error}
      />
    );
  }
  if (!data) {
    return (
      <Card title="异常检测" sub="单日/单用户费用突增 · 0 费用活跃用户">
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card title="异常检测" sub="单日/单用户费用突增 · 0 费用活跃用户">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="单日费用突增次数"
          value={formatNumber(data.daily_spike_count)}
          hint={`较前7日日均 +${(data.daily_spike_threshold * 100).toFixed(0)}%`}
          accent={data.daily_spike_count > 0 ? "brand" : "default"}
        />
        <KpiCard
          label="单用户费用突增次数"
          value={formatNumber(data.user_spike_count)}
          hint={`较个人前7日日均 +${(data.user_spike_threshold * 100).toFixed(0)}%（去重用户）`}
          accent={data.user_spike_count > 0 ? "brand" : "default"}
        />
        <KpiCard
          label="费用为0的活跃用户数"
          value={formatNumber(data.zero_cost_active_users)}
        />
      </div>
    </Card>
  );
}

// ============================ Small shared bits ============================
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

// Th / ThNum / Td / TdNum are imported from ../usage/shared (single source of
// truth shared with the usage views).
//
// Note on percentage scale: the cost mock returns cost_pct / input_cost_pct as
// 0-1 ratios but hit_rate_pct as 0-100. PCT (from shared) does NOT multiply,
// so cache hit_rate_pct renders correctly while cost share fields display at
// the raw ratio scale. This mirrors the usage slice's PCT usage and will
// resolve once the real backend returns the source's 0-100 _pct contract.

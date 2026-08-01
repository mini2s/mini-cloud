"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  buildBuckets,
  costSubDeptsOptions,
  costTeamCompositionOptions,
  costTeamTrendOptions,
  fmtCost,
  formatNumber,
  type CostSubDeptItem,
  type DeptQuery,
  type Granularity,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { MultiTrendChart, PieBreakdownChart, type MultiTrendPoint, type PieDatum } from "../charts";
import {
  GranularityToggle,
  useGranularity,
} from "../components/granularity-toggle";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { useEfficiencyFormatters } from "../i18n";
import { PCT, PIE_COLORS, shortToken, SortHeader, Td, TdNum, Th, ThNum } from "../usage/shared";

// Sub-department cost comparison — second tab of the Cost Kanban. Ports the
// source CostCompareView (267 lines, ECharts). The cost backend exposes a
// single /cost/sub-departments endpoint that returns ALL children + their
// aggregated cost in one call (unlike the usage compare view, which fires
// one overview query per child). Row click switches the parent to that
// child's aggregate view.
//
// Faithful port decisions:
//   - The single costSubDepts call provides the comparison table rows; sort
//     is client-side over the returned items.
//   - The team-trend (line) and team-composition (pie) blocks render from
//     their own dedicated endpoints. Per-block loading/empty/error.
//
// Per design decision #2 (NO navigation), drill-down surfaces via an
// onSelectDept callback that updates parent state.

interface CostCompareViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
  /** Called when the user clicks a child dept row. */
  onSelectDept: (deptId: string) => void;
}

type SortKey = "total_cost" | "cost_pct" | "active_users" | "input_cost" | "output_cost";

const COLS: { key: SortKey; label: string }[] = [
  { key: "total_cost", label: "费用" },
  { key: "cost_pct", label: "费用占比" },
  { key: "input_cost", label: "输入费用" },
  { key: "output_cost", label: "输出费用" },
  { key: "active_users", label: "活跃用户" },
];

export function CostCompareView({
  deptId,
  startDate,
  endDate,
  includeChildren,
  onSelectDept,
}: CostCompareViewProps) {
  const wsId = useWorkspaceId();
  const q: DeptQuery = { deptId, start: startDate, end: endDate, includeChildren };
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const subDeptsQ = useQuery(costSubDeptsOptions(wsId, q));
  const teamTrendQ = useQuery(costTeamTrendOptions(wsId, q));
  const teamCompositionQ = useQuery(costTeamCompositionOptions(wsId, q));
  const { gran, setGran, options: granOptions } = useGranularity(
    startDate,
    endDate,
  );

  // Client-side sort of the sub-dept items.
  const items = useMemo(() => {
    const arr = (subDeptsQ.data?.items ?? []).slice();
    arr.sort((a, b) => {
      const diff = Number(a[sortBy] ?? 0) - Number(b[sortBy] ?? 0);
      return sortOrder === "desc" ? -diff : diff;
    });
    return arr;
  }, [subDeptsQ.data, sortBy, sortOrder]);

  const totals = useMemo(() => {
    const sum = (k: keyof CostSubDeptItem) => items.reduce((s, it) => s + Number(it[k] ?? 0), 0);
    const activeUsers = sum("active_users");
    const totalCost = sum("total_cost");
    return {
      total_cost: totalCost,
      input_cost: sum("input_cost"),
      output_cost: sum("output_cost"),
      active_users: activeUsers,
      total_tokens: sum("total_tokens"),
      per_user: activeUsers > 0 ? totalCost / activeUsers : null,
    };
  }, [items]);

  const handleSort = (field: SortKey) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  /** Team per-user cost: only when active_users > 0, else null. */
  const perUserCost = (it: CostSubDeptItem) =>
    it.active_users > 0 ? it.total_cost / it.active_users : null;

  const subLabel = `${items.length} 个子部门 · ${
    includeChildren ? "含各子部门下级" : "仅各子部门直属"
  } · 点行下钻`;

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-department cost comparison table. */}
      <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              子部门成本对比
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{subLabel}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <ThNum>#</ThNum>
                <Th>子部门</Th>
                {COLS.map((c) => (
                  <ThNum key={c.key}>
                    <SortHeader
                      label={c.label}
                      active={sortBy === c.key}
                      desc={sortOrder === "desc"}
                      onClick={() => handleSort(c.key)}
                    />
                  </ThNum>
                ))}
                <ThNum>团队人均</ThNum>
                <ThNum>总 Token</ThNum>
              </tr>
            </thead>
            <tbody>
            {subDeptsQ.error ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-10 text-center text-sm text-destructive"
                >
                  加载失败：{(subDeptsQ.error as Error).message}
                </td>
              </tr>
            ) : subDeptsQ.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    该部门下无子部门
                  </td>
                </tr>
              ) : (
                items.map((it, i) => {
                  const pu = perUserCost(it);
                  return (
                    <tr
                      key={it.dept_id}
                      tabIndex={0}
                      onClick={() => onSelectDept(it.dept_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onSelectDept(it.dept_id);
                      }}
                      className={`${DRILLDOWN_ROW_CLASS} border-b border-border/50`}
                    >
                      <TdNum>{i + 1}</TdNum>
                      <Td>
                        <span
                          className="max-w-[220px] truncate align-middle text-primary"
                          title={it.dept_name}
                        >
                          {it.dept_name}
                        </span>
                      </Td>
                      <TdNum>{`¥${fmtCost(it.total_cost)}`}</TdNum>
                      <TdNum>{PCT(it.cost_pct)}</TdNum>
                      <TdNum>{`¥${fmtCost(it.input_cost)}`}</TdNum>
                      <TdNum>{`¥${fmtCost(it.output_cost)}`}</TdNum>
                      <TdNum>{formatNumber(it.active_users)}</TdNum>
                      <TdNum>{pu == null ? "-" : `¥${fmtCost(pu)}`}</TdNum>
                      <TdNum title={formatNumber(it.total_tokens)}>
                        {shortToken(it.total_tokens)}
                      </TdNum>
                    </tr>
                  );
                })
              )}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold text-card-foreground">
                  {/* colSpan cells use plain <td> since the shared TdNum/ThNum
                      primitives don't forward colSpan. Styling matches TdNum. */}
                  <td
                    colSpan={2}
                    className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-card-foreground"
                  >
                    合计
                  </td>
                  <TdNum>{`¥${fmtCost(totals.total_cost)}`}</TdNum>
                  <TdNum>100%</TdNum>
                  <TdNum>{`¥${fmtCost(totals.input_cost)}`}</TdNum>
                  <TdNum>{`¥${fmtCost(totals.output_cost)}`}</TdNum>
                  <TdNum>{formatNumber(totals.active_users)}</TdNum>
                  <TdNum>
                    {totals.per_user == null ? "-" : `¥${fmtCost(totals.per_user)}`}
                  </TdNum>
                  <TdNum title={formatNumber(totals.total_tokens)}>
                    {shortToken(totals.total_tokens)}
                  </TdNum>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Per-team cost trend (line). */}
      <TeamTrendBlock
        loading={teamTrendQ.isLoading && !teamTrendQ.data}
        error={teamTrendQ.error as Error | null}
        series={teamTrendQ.data?.series}
        gran={gran}
        start={startDate}
        end={endDate}
        extra={
          <GranularityToggle
            value={gran}
            options={granOptions}
            onChange={setGran}
          />
        }
      />

      {/* Team cost composition (pie). */}
      <TeamCompositionBlock
        loading={teamCompositionQ.isLoading && !teamCompositionQ.data}
        error={teamCompositionQ.error as Error | null}
        items={teamCompositionQ.data?.items}
      />
    </div>
  );
}

// ============================ Team cost trend ============================
// Each team becomes one area band. We pivot the per-team series into rows
// keyed by date, with one field per team. Teams may not share identical
// date sets; missing (team, date) pairs are treated as 0.
function TeamTrendBlock({
  loading,
  error,
  series,
  gran,
  start,
  end,
  extra,
}: {
  loading: boolean;
  error: Error | null;
  series?: { dept_id: string; dept_name: string; data: { date: string; total_cost: number }[] }[];
  gran: Granularity;
  start: string;
  end: string;
  extra: ReactNode;
}) {
  const { formatBucketLabel, granularityLabel } =
    useEfficiencyFormatters();
  const { points, chartSeries } = useMemo(() => {
    if (!series || !series.length) return { points: [], chartSeries: [] };
    const allDates = new Set<string>();
    for (const s of series) for (const pt of s.data) allDates.add(pt.date);
    const buckets = buildBuckets(
      Array.from(allDates),
      gran,
      { start, end },
      formatBucketLabel,
    );
    const byTeam = new Map<string, Map<string, number>>();
    for (const s of series) {
      const m = new Map<string, number>();
      for (const pt of s.data) m.set(pt.date, pt.total_cost || 0);
      byTeam.set(s.dept_id, m);
    }
    const rows: MultiTrendPoint[] = buckets.map((bucket) => {
      const row: MultiTrendPoint & Record<string, number | string> = {
        label: bucket.label,
      };
      for (const s of series) {
        const m = byTeam.get(s.dept_id);
        row[s.dept_id] = bucket.dates.reduce(
          (sum, date) => sum + (m?.get(date) ?? 0),
          0,
        );
      }
      return row;
    });
    const chartSeriesOut = series.map((s, i) => ({
      key: s.dept_id,
      name: s.dept_name,
      color: PIE_COLORS[i % PIE_COLORS.length]!,
    }));
    return { points: rows, chartSeries: chartSeriesOut };
  }, [end, formatBucketLabel, gran, series, start]);

  const title = `各团队费用趋势（${granularityLabel(gran)}）`;
  if (loading) {
    return (
      <Card title={title} sub="折线（多团队对齐，缺数据补 0）">
        <Skeleton className="h-[280px] rounded-lg" />
      </Card>
    );
  }
  if (error) {
    return (
      <ErrorHint
        title={title}
        sub="折线（多团队对齐，缺数据补 0）"
        error={error}
      />
    );
  }
  if (!points.length) {
    return (
      <Card
        title={title}
        sub="折线（多团队对齐，缺数据补 0）"
        extra={extra}
      >
        <EmptyHint />
      </Card>
    );
  }
  return (
    <Card
      title={title}
      sub="折线（多团队对齐，缺数据补 0）"
      extra={extra}
    >
      <MultiTrendChart
        data={points}
        series={chartSeries}
        showLegend
        formatY={(v) => `¥${shortToken(v)}`}
      />
    </Card>
  );
}

// ============================ Team composition pie ============================
function TeamCompositionBlock({
  loading,
  error,
  items,
}: {
  loading: boolean;
  error: Error | null;
  items?: { dept_id: string; dept_name: string; total_cost: number; cost_pct: number }[];
}) {
  if (loading) {
    return (
      <Card title="团队费用构成" sub="各团队费用占比">
        <Skeleton className="h-[280px] rounded-lg" />
      </Card>
    );
  }
  if (error) {
    return <ErrorHint title="团队费用构成" sub="各团队费用占比" error={error} />;
  }
  if (!items || !items.length) {
    return (
      <Card title="团队费用构成" sub="各团队费用占比">
        <EmptyHint />
      </Card>
    );
  }
  const pie: PieDatum[] = items.map((it) => ({
    name: it.dept_name || "-",
    value: it.total_cost,
  }));
  return (
    <Card title="团队费用构成" sub="各团队费用占比">
      <PieBreakdownChart data={pie} colors={PIE_COLORS} scrollLegend />
    </Card>
  );
}

// ============================ Local card shell (mirrors aggregate view) ============================
function Card({
  title,
  sub,
  extra,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
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

function ErrorHint({ title, sub, error }: { title: ReactNode; sub?: ReactNode; error: Error }) {
  return (
    <Card title={title} sub={sub}>
      <div className="flex min-h-[8rem] items-center justify-center text-center text-sm text-destructive">
        加载失败：{error.message}
      </div>
    </Card>
  );
}

// Th / ThNum / Td / TdNum / SortHeader are imported from ../usage/shared —
// single source of truth shared with the usage views.

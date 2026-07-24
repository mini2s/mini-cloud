"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allUsersOptions,
  formatNumber,
  formatV2Ratio,
  parseOrder,
  sortRows,
  toOrder,
  type UserV2Row,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { PCT, Td, TdNum, Th, ThNum, SortHeader } from "../usage/shared";

// User efficiency ranking — pure-efficiency view of all users (no AI-share /
// code-line / cost cross-dimension columns). Ports the source
// EfficiencyUserRanking (234 lines, ECharts + navigation) to recharts-free,
// display-only per design decisions #1 (no URL state) and #2 (no navigation).
//
// Caliber (matches source):
//   - calendar_ratio / work_ratio are DECIMAL ratios (0.25 => 25%) → formatV2Ratio.
//   - Top KPI cards use the CONSERVED weighted average: Σbaseline / Σactual
//     across all users (the per-user baseline_*/actual_* totals are exposed
//     on UserV2Row), never the arithmetic mean of per-user ratios.
//   - Calendar saved person-days = (baseline_calendar − actual_calendar) / 1440.
//     Top "total saved" card sums positive savings only.
// Sort: three-state cycle (none → asc → desc → none), default calendar_ratio desc.

const CALENDAR_DAY_MIN = 1440;

/** Calendar saved person-days for one user; null when non-positive (sinks). */
function calendarSavedDays(row: UserV2Row): number | null {
  const saved =
    (Number(row.baseline_calendar_min) || 0) -
    (Number(row.actual_calendar_min) || 0);
  return saved > 0 ? saved / CALENDAR_DAY_MIN : null;
}

type SortField =
  | "calendar_ratio"
  | "work_ratio"
  | "calendar_saved_days"
  | "merged_need_count";

function getterFor(
  field: SortField,
): (row: UserV2Row) => unknown {
  if (field === "calendar_saved_days") return (row) => calendarSavedDays(row);
  return (row) => {
    const v = row[field];
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
}

export function EfficiencyUserRanking({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const [order, setOrder] = useState<string>(
    toOrder("calendar_ratio", true) ?? "",
  );
  const parsed = useMemo(() => parseOrder(order), [order]);

  const q = useQuery(allUsersOptions(wsId, startDate, endDate));
  const rows = useMemo<UserV2Row[]>(() => q.data ?? [], [q.data]);

  const sorted = useMemo(() => {
    if (!parsed) return rows;
    return sortRows(rows, getterFor(parsed.field as SortField), parsed.desc);
  }, [rows, parsed]);

  // Conserved KPI: Σbaseline / Σactual weighted (not arithmetic mean).
  const kpi = useMemo(() => {
    let baseCal = 0;
    let actCal = 0;
    let baseWork = 0;
    let actWork = 0;
    let savedCalMin = 0;
    for (const r of rows) {
      const bc = Number(r.baseline_calendar_min) || 0;
      const ac = Number(r.actual_calendar_min) || 0;
      baseCal += bc;
      actCal += ac;
      if (bc - ac > 0) savedCalMin += bc - ac;
      baseWork += Number(r.baseline_work_min) || 0;
      actWork += Number(r.actual_work_min) || 0;
    }
    const weighted = (base: number, act: number) =>
      act > 0 ? base / act : null;
    return {
      userCount: rows.length,
      avgCalRatio: weighted(baseCal, actCal),
      avgWorkRatio: weighted(baseWork, actWork),
      savedCalDays: savedCalMin / CALENDAR_DAY_MIN,
    };
  }, [rows]);

  // Three-state sort cycle: none → asc → desc → none.
  function onSort(field: SortField) {
    if (!parsed || parsed.field !== field) setOrder(toOrder(field, false) ?? "");
    else if (!parsed.desc) setOrder(toOrder(field, true) ?? "");
    else setOrder("");
  }
  const isActive = (f: SortField) => parsed?.field === f;
  const isDesc = (f: SortField) => parsed?.field === f && parsed.desc === true;

  return (
    <div className="space-y-4">
      {/* KPI cards (conserved caliber). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card">
          <KpiCard
            label="用户数"
            value={formatNumber(kpi.userCount)}
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card">
          <KpiCard
            label="平均日历提效比"
            value={formatV2Ratio(kpi.avgCalRatio)}
            hint="守恒加权：Σ基线 ÷ Σ实际（小数口径），非算术均值"
          />
        </div>
        <div className="rounded-lg border bg-card">
          <KpiCard
            label="平均人力提效比"
            value={formatV2Ratio(kpi.avgWorkRatio)}
            hint="守恒加权：Σ基线 ÷ Σ实际（小数口径），非算术均值"
          />
        </div>
        <div className="rounded-lg border bg-card">
          <KpiCard
            label="总节省（人天）"
            value={
              kpi.savedCalDays > 0 ? formatNumber(kpi.savedCalDays, 1) : "-"
            }
            hint="Σ(基线 − 实际) ÷ 1440（仅计正节省）"
          />
        </div>
      </section>

      {/* Ranking table (efficiency-only columns). */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            用户效率排行
          </span>
          <span className="text-xs text-muted-foreground">
            纯效率口径 · 默认按日历提效比降序
          </span>
        </div>

        {q.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(q.error as Error).message}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <ThNum>#</ThNum>
                  <Th>用户</Th>
                  <Th>
                    <SortHeader
                      label="日历提效比"
                      active={isActive("calendar_ratio")}
                      desc={isDesc("calendar_ratio")}
                      onClick={() => onSort("calendar_ratio")}
                    />
                  </Th>
                  <Th>
                    <SortHeader
                      label="人力提效比"
                      active={isActive("work_ratio")}
                      desc={isDesc("work_ratio")}
                      onClick={() => onSort("work_ratio")}
                    />
                  </Th>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="节省（人天）"
                        active={isActive("calendar_saved_days")}
                        desc={isDesc("calendar_saved_days")}
                        onClick={() => onSort("calendar_saved_days")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="合并需求"
                        active={isActive("merged_need_count")}
                        desc={isDesc("merged_need_count")}
                        onClick={() => onSort("merged_need_count")}
                      />
                    </span>
                  </ThNum>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="h-6 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-12 text-center">
                      <span className="text-sm text-muted-foreground">
                        暂无用户数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((row, i) => {
                    const saved = calendarSavedDays(row);
                    return (
                      <tr
                        key={row.user_id}
                        className="border-b transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <TdNum>{i + 1}</TdNum>
                        <Td title={row.user_name}>
                          {shortName(row.user_name)}
                        </Td>
                        <Td>{PCT((row.calendar_ratio ?? 0) * 100)}</Td>
                        <Td>{PCT((row.work_ratio ?? 0) * 100)}</Td>
                        <TdNum>
                          {saved != null ? formatNumber(saved, 1) : "-"}
                        </TdNum>
                        <TdNum>{formatNumber(row.merged_need_count)}</TdNum>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Truncate display name to 20 chars (matches source shortName). */
function shortName(name: string): string {
  const n = name || "-";
  return n.length > 20 ? `${n.slice(0, 20)}…` : n;
}

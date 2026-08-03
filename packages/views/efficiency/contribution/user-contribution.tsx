"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  allUsersOptions,
  formatDateParam,
  formatNumber,
  formatV2Ratio,
  parseOrder,
  sortRows,
  toOrder,
  type UserV2Row,
  useUserNameMap,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { Td, TdNum, Th, ThNum, SortHeader } from "../usage/shared";
import { useNavigation } from "../../navigation";
import { ContributionTrendSection } from "./contribution-trend-section";

// User contribution — personal deliverables derived from /v2/users
// (UserV2Row carries commit_count / commit_diff_lines / merged_need_count,
// the three "contribution" fields). Per design decision #5
// (zero-platform-request) this consumes only the existing allUsersOptions,
// plus efficiencyAggregateOptions for the weekly trend (the source's lead
// chart).
//
// Caliber (matches source UserContribution):
//   - merged_need_count / commit_diff_lines / commit_count are COUNTS → formatNumber.
//   - ai_code_ratio is a decimal ratio (0.25 => 25%).
//   - The source sorts by merged_need_count desc; we keep that as the default
//     but expose a 3-state sort on the 3 count columns.
//   - The source's ContributionTrend (ECharts, dual Y axis for code lines vs
//     needs/commits) is ported to the recharts DualAxisTrendChart via the
//     shared ContributionTrendSection (lead chart, same as the source).

type SortField =
  | "merged_need_count"
  | "commit_diff_lines"
  | "commit_count";

export function UserContribution({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();
  const q = useQuery(allUsersOptions(wsId, startDate, endDate));
  const rows = useMemo<UserV2Row[]>(() => q.data ?? [], [q.data]);

  // Default sort: merged_need_count desc (matches source — contribution
  // ranks by "needs delivered" first).
  const [order, setOrder] = useState<string>(
    toOrder("merged_need_count", true) ?? "",
  );
  const parsed = useMemo(() => parseOrder(order), [order]);
  const sorted = useMemo(() => {
    if (!parsed) return rows;
    return sortRows(rows, getterFor(parsed.field as SortField), parsed.desc);
  }, [rows, parsed]);

  const kpi = useMemo(() => {
    let merged = 0;
    let diffLines = 0;
    let commits = 0;
    for (const r of rows) {
      merged += r.merged_need_count || 0;
      diffLines += r.commit_diff_lines || 0;
      commits += r.commit_count || 0;
    }
    return { contributors: rows.length, merged, diffLines, commits };
  }, [rows]);

  // 3-state sort cycle: none → asc → desc → none.
  function onSort(field: SortField) {
    if (!parsed || parsed.field !== field) setOrder(toOrder(field, false) ?? "");
    else if (!parsed.desc) setOrder(toOrder(field, true) ?? "");
    else setOrder("");
  }
  const isActive = (f: SortField) => parsed?.field === f;
  const isDesc = (f: SortField) => parsed?.field === f && parsed.desc === true;
  function openUserDetail(userId: string) {
    const query = new URLSearchParams({
      startDate: formatDateParam(startDate),
      endDate: formatDateParam(endDate),
    });
    push(`${p.metricsUserDetail(userId)}?${query.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Weekly contribution trend — the source's lead chart. /v2/efficiency
          with no userId = full user×week rows, bucketed by ISO week and
          summed across users → company-wide weekly contribution trend. */}
      <ContributionTrendSection
        startDate={startDate}
        endDate={endDate}
        subtitle="全部用户"
      />

      {/* KPI strip — counts only (contribution caliber, not tokens). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="贡献人数"
            value={formatNumber(kpi.contributors)}
            hint="可计入贡献的用户数"
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="合并需求总数"
            value={formatNumber(kpi.merged)}
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="代码行总数"
            value={formatNumber(kpi.diffLines)}
            hint="commit diff 行合计"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="提交总数"
            value={formatNumber(kpi.commits)}
          />
        </div>
      </section>

      {/* Ranking table — derived from allUsers and linked to user detail. */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            个人贡献排行（看板派生）
          </span>
          <span className="text-xs text-muted-foreground">
            按合并需求倒序，点行查看个人明细
          </span>
        </div>
        {q.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(q.error as Error).message}
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <ThNum>排名</ThNum>
                  <Th>用户</Th>
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
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="代码行"
                        active={isActive("commit_diff_lines")}
                        desc={isDesc("commit_diff_lines")}
                        onClick={() => onSort("commit_diff_lines")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="提交"
                        active={isActive("commit_count")}
                        desc={isDesc("commit_count")}
                        onClick={() => onSort("commit_count")}
                      />
                    </span>
                  </ThNum>
                  <Th>AI 代码占比</Th>
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
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <span className="text-sm text-muted-foreground">
                        暂无个人贡献数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((r, i) => (
                    <tr
                      key={r.user_id}
                      tabIndex={0}
                      onClick={() => openUserDetail(r.user_id)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        openUserDetail(r.user_id);
                      }}
                      className={`${DRILLDOWN_ROW_CLASS} border-b last:border-0`}
                    >
                      <TdNum>
                        <span className="text-muted-foreground">{i + 1}</span>
                      </TdNum>
                      <Td title={resolveName(r.user_id)}>
                        {shortName(resolveName(r.user_id))}
                      </Td>
                      <TdNum>{formatNumber(r.merged_need_count)}</TdNum>
                      <TdNum>{formatNumber(r.commit_diff_lines)}</TdNum>
                      <TdNum>{formatNumber(r.commit_count)}</TdNum>
                      <Td>{formatV2Ratio(r.ai_code_ratio)}</Td>
                    </tr>
                  ))
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

function getterFor(field: SortField): (row: UserV2Row) => unknown {
  return (row) => {
    const v = row[field];
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
}

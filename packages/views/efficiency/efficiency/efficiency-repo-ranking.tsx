"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  allReposOptions,
  formatNumber,
  formatPercent,
  sortRows,
  type RepoListItem,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { Td, TdNum, Th, ThNum } from "../usage/shared";
import { useNavigation } from "../../navigation";

// Repo efficiency ranking — pure-efficiency view of all repos (whole-repo
// scope, aggregated across all branches). Ports the source
// EfficiencyRepoRanking (177 lines, navigation) to display-only per design
// decisions #1 (no URL state) and #2 (no navigation).
//
// Caliber (matches source):
//   - RepoListItem.efficiency_ratio is a PERCENTAGE ratio (300=300%, never
//     ×100) → formatPercent.
//   - Top KPI uses the CONSERVED weighted average:
//       Σ(sum_ancient − sum_real) / Σ(sum_real) × 100
//     derived from per-repo minute totals (NOT the arithmetic mean of ratios).
//   - Saved person-days = Σ(sum_ancient − sum_real) / 480 (work-day, 8h).
//
// Sort: repo efficiency_ratio desc (single-click, client-side; the source
// also fixed desc — no three-state cycle here).

const WORK_MIN_PER_DAY = 480; // 8h work-day

/** Saved person-days from ancient/real minute totals (work-day caliber). */
function savedPersonDays(
  ancientMin: number | null | undefined,
  realMin: number | null | undefined,
): number | null {
  const a = Number(ancientMin);
  const r = Number(realMin);
  if (!Number.isFinite(a) || !Number.isFinite(r)) return null;
  return (a - r) / WORK_MIN_PER_DAY;
}

export function EfficiencyRepoRanking({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { push } = useNavigation();
  const q = useQuery(allReposOptions(wsId, startDate, endDate));
  const rows = useMemo<RepoListItem[]>(() => q.data ?? [], [q.data]);

  const sorted = useMemo(
    () => sortRows(rows, (r: RepoListItem) => r.efficiency_ratio, true),
    [rows],
  );

  // Conserved aggregate from per-repo ancient/real minute totals.
  const agg = useMemo(() => {
    let sumAncient = 0;
    let sumReal = 0;
    for (const r of rows) {
      const a = Number(r.sum_ancient_minutes);
      const rl = Number(r.sum_real_minutes);
      if (Number.isFinite(a)) sumAncient += a;
      if (Number.isFinite(rl)) sumReal += rl;
    }
    const avgRatioPct =
      sumReal > 0 ? ((sumAncient - sumReal) / sumReal) * 100 : null;
    const savedDays = (sumAncient - sumReal) / WORK_MIN_PER_DAY;
    return { repoCount: rows.length, avgRatioPct, savedDays };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* KPI cards (conserved caliber). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="仓库数"
            value={formatNumber(agg.repoCount)}
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="平均提效比"
            value={agg.avgRatioPct == null ? "-" : formatPercent(agg.avgRatioPct)}
            hint="守恒口径：Σ(古法 − 实际) / Σ实际 ×100（百分比口径）"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="总节省"
            value={`${formatNumber(agg.savedDays, 1)} 人天`}
            hint="Σ(古法 − 实际) / 480（工作口径 8h/人天）"
          />
        </div>
      </section>

      {/* Ranking table (efficiency-only columns). */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            仓库效率排行
          </span>
          <span className="text-xs text-muted-foreground">
            按提效比降序 · 整仓跨分支聚合
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
                  <ThNum>排名</ThNum>
                  <Th>仓库地址</Th>
                  <Th>提效比</Th>
                  <ThNum>节省（人天）</ThNum>
                  <ThNum>Commit 数</ThNum>
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={5} className="px-3 py-2">
                        <div className="h-6 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-12 text-center">
                      <span className="text-sm text-muted-foreground">
                        暂无仓库数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((row, i) => {
                    const saved = savedPersonDays(
                      row.sum_ancient_minutes,
                      row.sum_real_minutes,
                    );
                    return (
                      <tr
                        key={row.repo_addr}
                        onClick={() => push(p.metricsRepoDetail(row.repo_addr))}
                        className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                      >
                        <TdNum>
                          <span className="text-muted-foreground">{i + 1}</span>
                        </TdNum>
                        <Td title={row.repo_addr}>
                          <div className="max-w-[360px] truncate">
                            {row.repo_addr || "-"}
                          </div>
                        </Td>
                        <Td>{formatPercent(row.efficiency_ratio)}</Td>
                        <TdNum>
                          {saved == null
                            ? "-"
                            : `${formatNumber(saved, 1)} 人天`}
                        </TdNum>
                        <TdNum>{formatNumber(row.commit_count)}</TdNum>
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

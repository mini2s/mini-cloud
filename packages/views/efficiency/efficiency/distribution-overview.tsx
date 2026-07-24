"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allNeedsOptions,
  allReposOptions,
  allUsersOptions,
  projectListOptions,
  type NeedsV2Summary,
  type ProjectListItem,
  type RepoListItem,
  type UserV2Row,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { VerticalBarChart, type BarDatum } from "../charts";

// Efficiency distribution — a simplified port of the source's
// EntityRatioHistogram / DistributionOverview. The source distinguishes four
// calibers (org=global Need distribution, project/user=decimal ratio,
// repo=percentage ratio). We collapse to a single histogram component that
// buckets each entity's efficiency ratio into fixed bins and renders via
// VerticalBarChart (recharts, no ECharts).
//
// Caliber handling (matches source):
//   - org    → allNeedsOptions, Need.efficiency_ratio (DECIMAL) — global
//              demand-distribution caliber; the canonical "organization" view.
//   - user   → allUsersOptions, UserV2Row.calendar_ratio (DECIMAL).
//   - project→ projectListOptions, ProjectListItem.need_calendar_efficiency_ratio (DECIMAL).
//   - repo   → allReposOptions, RepoListItem.efficiency_ratio (PERCENTAGE).
// Decimal ratios are ×100 into percentage space before bucketing so all four
// share one bucket layout. Bins cover the negative band, the 0-200 core,
// and a long positive tail.

type Entity = "org" | "user" | "project" | "repo";

interface Bucket {
  label: string;
  /** Inclusive low, exclusive high (+Infinity for the last bucket). */
  lo: number;
  hi: number;
}

// Percentage-space buckets. Values are already in % (decimal ratios are
// converted upstream). The buckets match the source's "ratio histogram"
// shape: a negative bucket, the 0-200 core, and a long tail.
const BUCKETS: Bucket[] = [
  { label: "<0", lo: -Infinity, hi: 0 },
  { label: "0-50", lo: 0, hi: 50 },
  { label: "50-100", lo: 50, hi: 100 },
  { label: "100-200", lo: 100, hi: 200 },
  { label: "200-400", lo: 200, hi: 400 },
  { label: "400+", lo: 400, hi: Infinity },
];

export function DistributionOverview({
  entity,
  startDate,
  endDate,
}: {
  entity: Entity;
  startDate: string;
  endDate: string;
}) {
  const ratios = useEntityRatios(entity, startDate, endDate);
  const data = useMemo(() => bucketRatios(ratios.items, entity), [ratios, entity]);

  const caliberNote =
    entity === "repo"
      ? "提效比 · 百分比口径"
      : entity === "org"
        ? "需求日历提效比 · 小数口径 ×100（组织/公司口径）"
        : entity === "user"
          ? "用户日历提效比 · 小数口径 ×100"
          : "项目日历提效比 · 小数口径 ×100";

  return (
    <div className="rounded-lg border bg-card shadow-sm p-4 lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          提效比分布
        </h2>
        <span className="text-right text-xs text-muted-foreground">
          {caliberNote}
        </span>
      </div>

      {ratios.error ? (
        <div className="py-12 text-center text-sm text-destructive">
          加载失败：{(ratios.error as Error).message}
        </div>
      ) : ratios.loading ? (
        <Skeleton className="h-[260px] w-full rounded-md" />
      ) : data.every((d) => d.value === 0) ? (
        <div className="flex h-[260px] items-center justify-center">
          <span className="text-sm text-muted-foreground">暂无分布数据</span>
        </div>
      ) : (
        <VerticalBarChart
          data={data}
          heightClass="h-[260px]"
          color="var(--chart-1)"
        />
      )}
    </div>
  );
}

/**
 * Resolve the per-entity ratio list + loading/error state. Only ONE query
 * fires (the active entity's); the others stay disabled. Keeps the union
 * type tractable by funneling every row type through a single ratio array.
 */
function useEntityRatios(entity: Entity, startDate: string, endDate: string) {
  const wsId = useWorkspaceId();

  // org: global Need distribution (decimal ratio).
  const needsQ = useQuery({
    ...allNeedsOptions(wsId, startDate, endDate),
    enabled: entity === "org",
  });
  // user: calendar_ratio (decimal).
  const usersQ = useQuery({
    ...allUsersOptions(wsId, startDate, endDate),
    enabled: entity === "user",
  });
  // project: need_calendar_efficiency_ratio (decimal).
  const projectsQ = useQuery({
    ...projectListOptions(wsId, startDate, endDate),
    enabled: entity === "project",
  });
  // repo: efficiency_ratio (percentage — NOT ×100 upstream).
  const reposQ = useQuery({
    ...allReposOptions(wsId, startDate, endDate),
    enabled: entity === "repo",
  });

  // Funnel every row type through a single ratio array; each query's data is
  // typed to its own row type so the casts below are pure type-only narrows.
  const items = useMemo(() => {
    switch (entity) {
      case "org":
        return ((needsQ.data as NeedsV2Summary[] | undefined) ?? []).map(
          (n) => n.efficiency_ratio,
        );
      case "user":
        return ((usersQ.data as UserV2Row[] | undefined) ?? []).map(
          (u) => u.calendar_ratio,
        );
      case "project":
        return (
          (projectsQ.data as ProjectListItem[] | undefined) ?? []
        ).map((p) => p.need_calendar_efficiency_ratio ?? null);
      case "repo":
        return ((reposQ.data as RepoListItem[] | undefined) ?? []).map(
          (r) => r.efficiency_ratio,
        );
    }
  }, [entity, needsQ.data, usersQ.data, projectsQ.data, reposQ.data]);

  const active =
    entity === "org"
      ? needsQ
      : entity === "user"
        ? usersQ
        : entity === "project"
          ? projectsQ
          : reposQ;

  return {
    items,
    loading: active.isLoading,
    error: active.error,
  };
}

/**
 * Bucket a list of ratios into the fixed percentage-space bins.
 * Decimal-caliber entities (org/user/project) are ×100 into percent; repo
 * is already percent. Null/non-finite values are dropped.
 */
function bucketRatios(
  ratios: (number | null | undefined)[],
  entity: Entity,
): BarDatum[] {
  const scale = entity === "repo" ? 1 : 100;
  // counts is index-correlated with BUCKETS (same length, fixed order).
  const counts: number[] = BUCKETS.map(() => 0);
  for (const raw of ratios) {
    if (raw == null || !Number.isFinite(raw)) continue;
    const pct = raw * scale;
    for (let i = 0; i < BUCKETS.length; i++) {
      const b = BUCKETS[i]!;
      if (pct >= b.lo && pct < b.hi) {
        counts[i] = (counts[i] ?? 0) + 1;
        break;
      }
    }
  }
  return BUCKETS.map((b, i) => ({ label: b.label, value: counts[i] ?? 0 }));
}

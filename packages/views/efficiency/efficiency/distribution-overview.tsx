"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  allNeedsOptions,
  allReposOptions,
  allUsersOptions,
  computeDistribution,
  computeDistributionExclusionReasons,
  computeDistributionLocBands,
  computeDistributionQuantiles,
  DISTRIBUTION_GRANULARITIES,
  formatV2Ratio,
  projectListOptions,
  type DistributionCaliber,
  type NeedsV2Summary,
  type ProjectListItem,
  type RepoListItem,
  type UserV2Row,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { VerticalBarChart, type BarDatum } from "../charts";

type Entity = "org" | "user" | "project" | "repo";
type RatioEntity = Exclude<Entity, "org">;

interface Bucket {
  label: string;
  lo: number;
  hi: number;
}

const BUCKETS: Bucket[] = [
  { label: "<0", lo: Number.NEGATIVE_INFINITY, hi: 0 },
  { label: "0-50", lo: 0, hi: 50 },
  { label: "50-100", lo: 50, hi: 100 },
  { label: "100-200", lo: 100, hi: 200 },
  { label: "200-400", lo: 200, hi: 400 },
  { label: "400+", lo: 400, hi: Number.POSITIVE_INFINITY },
];

const STACKED_CHART_CONFIG = {
  kept: { label: "计入统计", color: "var(--chart-1)" },
  excluded: { label: "异常隔离", color: "var(--chart-4)" },
} satisfies ChartConfig;

export function DistributionOverview({
  entity,
  startDate,
  endDate,
}: {
  entity: Entity;
  startDate: string;
  endDate: string;
}) {
  if (entity === "org") {
    return <OrganizationDistribution startDate={startDate} endDate={endDate} />;
  }
  return (
    <EntityRatioDistribution
      entity={entity}
      startDate={startDate}
      endDate={endDate}
    />
  );
}

function OrganizationDistribution({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const [caliber, setCaliber] =
    useState<DistributionCaliber>("calendar");
  const [binCount, setBinCount] = useState(12);
  const keptQ = useQuery(allNeedsOptions(wsId, startDate, endDate));
  const excludedQ = useQuery(
    allNeedsOptions(wsId, startDate, endDate, true),
  );

  const rows = useMemo(() => {
    const merged = new Map<string, NeedsV2Summary>();
    for (const row of [...(keptQ.data ?? []), ...(excludedQ.data ?? [])]) {
      merged.set(row.need_id, row);
    }
    return [...merged.values()];
  }, [excludedQ.data, keptQ.data]);

  const distribution = useMemo(
    () => computeDistribution(rows, caliber, binCount),
    [binCount, caliber, rows],
  );
  const calendarQuantiles = useMemo(
    () => computeDistributionQuantiles(rows, "calendar"),
    [rows],
  );
  const workQuantiles = useMemo(
    () => computeDistributionQuantiles(rows, "work"),
    [rows],
  );
  const exclusionReasons = useMemo(
    () => computeDistributionExclusionReasons(rows),
    [rows],
  );
  const locBands = useMemo(
    () => computeDistributionLocBands(rows),
    [rows],
  );
  const latestDate = useMemo(() => {
    const dates = rows
      .map((row) => row.dev_end_ts)
      .filter(Boolean)
      .sort();
    return dates.at(-1)?.slice(0, 10) ?? "—";
  }, [rows]);

  const loading = keptQ.isLoading || excludedQ.isLoading;
  const error = keptQ.error ?? excludedQ.error;
  const truncated =
    (keptQ.data?.length ?? 0) >= 10_000 ||
    (excludedQ.data?.length ?? 0) >= 10_000;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 shadow-sm lg:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              组织提效分布
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              按需求统计；异常数据单独隔离，不参与分位数计算
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={caliber === "calendar" ? "default" : "outline"}
              onClick={() => setCaliber("calendar")}
            >
              日历口径
            </Button>
            <Button
              type="button"
              size="sm"
              variant={caliber === "work" ? "default" : "outline"}
              onClick={() => setCaliber("work")}
            >
              人力口径
            </Button>
            <span className="ml-1 text-xs text-muted-foreground">粒度</span>
            {DISTRIBUTION_GRANULARITIES.map((preset) => (
              <Button
                key={preset.bins}
                type="button"
                size="sm"
                variant={binCount === preset.bins ? "secondary" : "ghost"}
                onClick={() => setBinCount(preset.bins)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {truncated ? (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            当前数据已达到单类 10,000 条拉取上限，分布结果可能被截断。
          </div>
        ) : null}

        {error ? (
          <div className="py-12 text-center text-sm text-destructive">
            加载失败：{(error as Error).message}
          </div>
        ) : loading ? (
          <Skeleton className="mt-4 h-[340px] w-full rounded-md" />
        ) : rows.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground">
            暂无分布数据
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <DistributionMetric
                label="计入需求"
                value={String(distribution.keptCount)}
              />
              <DistributionMetric
                label="隔离异常"
                value={String(distribution.excludedCount)}
              />
              <DistributionMetric
                label="日历中位数"
                value={formatV2Ratio(calendarQuantiles.median)}
              />
              <DistributionMetric
                label="人力中位数"
                value={formatV2Ratio(workQuantiles.median)}
              />
              <DistributionMetric label="最新完成日期" value={latestDate} />
            </div>

            <StackedDistributionChart data={distribution.histogram} />

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <DistributionMetric
                label="P25"
                value={formatV2Ratio(distribution.quantiles.p25)}
              />
              <DistributionMetric
                label="中位数"
                value={formatV2Ratio(distribution.quantiles.median)}
              />
              <DistributionMetric
                label="P75"
                value={formatV2Ratio(distribution.quantiles.p75)}
              />
            </div>
          </>
        )}
      </div>

      {!loading && !error && rows.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <DiagnosticList
            title="异常隔离原因"
            description="原因可能重叠计数"
            items={exclusionReasons}
          />
          <DiagnosticList
            title="LOC 速率分档"
            description="净代码行 / 日历分钟"
            items={locBands}
          />
        </div>
      ) : null}
    </div>
  );
}

function StackedDistributionChart({
  data,
}: {
  data: Array<{ label: string; kept: number; excluded: number }>;
}) {
  return (
    <ChartContainer
      config={STACKED_CHART_CONFIG}
      className="mt-4 h-[300px] w-full"
    >
      <BarChart
        data={data}
        margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={12}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={44}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="kept"
          stackId="distribution"
          fill="var(--color-kept)"
          radius={[0, 0, 3, 3]}
          maxBarSize={52}
        />
        <Bar
          dataKey="excluded"
          stackId="distribution"
          fill="var(--color-excluded)"
          radius={[3, 3, 0, 0]}
          maxBarSize={52}
        />
      </BarChart>
    </ChartContainer>
  );
}

function DistributionMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DiagnosticList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; count: number }>;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm lg:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="tabular-nums">
                {item.count}
                {total > 0
                  ? ` · ${Math.round((item.count / total) * 100)}%`
                  : ""}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(item.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityRatioDistribution({
  entity,
  startDate,
  endDate,
}: {
  entity: RatioEntity;
  startDate: string;
  endDate: string;
}) {
  const ratios = useEntityRatios(entity, startDate, endDate);
  const data = useMemo(() => bucketRatios(ratios.items, entity), [ratios.items, entity]);

  const caliberNote =
    entity === "repo"
      ? "提效比 · 百分比口径"
      : entity === "user"
        ? "用户日历提效比 · 小数口径 ×100"
        : "项目日历提效比 · 小数口径 ×100";

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm lg:p-5">
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
      ) : data.every((item) => item.value === 0) ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          暂无分布数据
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

function useEntityRatios(
  entity: RatioEntity,
  startDate: string,
  endDate: string,
) {
  const wsId = useWorkspaceId();
  const usersQ = useQuery({
    ...allUsersOptions(wsId, startDate, endDate),
    enabled: entity === "user",
  });
  const projectsQ = useQuery({
    ...projectListOptions(wsId, startDate, endDate),
    enabled: entity === "project",
  });
  const reposQ = useQuery({
    ...allReposOptions(wsId, startDate, endDate),
    enabled: entity === "repo",
  });

  const items = useMemo(() => {
    switch (entity) {
      case "user":
        return ((usersQ.data as UserV2Row[] | undefined) ?? []).map(
          (user) => user.calendar_ratio,
        );
      case "project":
        return (
          (projectsQ.data as ProjectListItem[] | undefined) ?? []
        ).map((project) => project.need_calendar_efficiency_ratio ?? null);
      case "repo":
        return ((reposQ.data as RepoListItem[] | undefined) ?? []).map(
          (repo) => repo.efficiency_ratio,
        );
    }
  }, [entity, projectsQ.data, reposQ.data, usersQ.data]);

  const active =
    entity === "user" ? usersQ : entity === "project" ? projectsQ : reposQ;

  return {
    items,
    loading: active.isLoading,
    error: active.error,
  };
}

function bucketRatios(
  ratios: Array<number | null | undefined>,
  entity: RatioEntity,
): BarDatum[] {
  const scale = entity === "repo" ? 1 : 100;
  const counts = BUCKETS.map(() => 0);
  for (const raw of ratios) {
    if (raw == null || !Number.isFinite(raw)) continue;
    const percentage = raw * scale;
    for (let index = 0; index < BUCKETS.length; index += 1) {
      const bucket = BUCKETS[index];
      if (
        bucket &&
        percentage >= bucket.lo &&
        percentage < bucket.hi
      ) {
        counts[index] = (counts[index] ?? 0) + 1;
        break;
      }
    }
  }
  return BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    value: counts[index] ?? 0,
  }));
}

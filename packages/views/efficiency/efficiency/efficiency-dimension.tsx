"use client";

import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  deptRankingOptions,
  deptTreeOptions,
  formatNumber,
  formatV2Ratio,
  projectListOptions,
  sortRows,
  useViewState,
  type ProjectListItem,
} from "@multica/core/efficiency";
import { PageHeader } from "../../layout/page-header";
import { PeriodSelect } from "../components";
import { Th, ThNum, Td, TdNum } from "../usage/shared";
import { DistributionOverview } from "./distribution-overview";
import { EfficiencyTimeline } from "./efficiency-timeline";
import { EfficiencyRepoRanking } from "./efficiency-repo-ranking";
import { EfficiencyUserRanking } from "./efficiency-user-ranking";
import { useNavigation } from "../../navigation";

// Efficiency Dimension — the efficiency dimension page. Ports the source
// EfficiencyDimension (590 lines, URL-driven entity tabs + focused mode) to
// component-state-driven per design decision #1 (NO URL query state) and #2
// (NO navigation).
//
// SCOPE (this slice): AGGREGATE MODE ONLY. The source's focused mode embeds
// full UserDetail/ProjectDetail/RepoDetail pages which don't exist yet —
// those land in slice 5. Here we render the aggregate view for each entity:
//   - entity tab (org/user/project/repo) via COMPONENT-INTERNAL Tabs (useState)
//   - timeline (overall efficiency trend, org/user only — the /v2/efficiency
//     endpoint is user×week; project/repo have no weekly axis at this endpoint)
//   - KPI overview + ranking (entity-dependent)
//   - distribution sub-tab (overview/distribution) via internal state
//
// Entity → content dispatch:
//   - org     → EfficiencyTimeline + OrgRanking (deptRankingOptions) + distribution
//   - user    → EfficiencyTimeline + EfficiencyUserRanking + distribution
//   - project → ProjectRanking (projectListOptions, no weekly timeline) + distribution
//   - repo    → EfficiencyRepoRanking (no weekly timeline) + distribution
//
// Per design decision #3 (no ECharts) all charts use the recharts primitives
// from ../charts. Per #4 (reuse) PeriodSelect, the shared Th/Td table
// primitives, and the ranking sub-components are all reused.

type Entity = "org" | "user" | "project" | "repo";
type SubView = "overview" | "distribution";

const ENTITY_TABS: { key: Entity; label: string }[] = [
  { key: "org", label: "组织" },
  { key: "user", label: "个人" },
  { key: "project", label: "项目" },
  { key: "repo", label: "仓库" },
];

export function EfficiencyDimension() {
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;
  const [entity, setEntity] = useState<Entity>("org");
  const [subView, setSubView] = useState<SubView>("overview");

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">效率看板</h1>
        </div>
        <PeriodSelect
          value={startDate}
          onChange={(range) => setTimeRange(range)}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:space-y-6 lg:px-8">
          {/* Entity tabs (internal state, no URL). */}
          <div
            className="flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label="主体"
          >
            {ENTITY_TABS.map((t) => (
              <EntityTab
                key={t.key}
                active={entity === t.key}
                onClick={() => {
                  setEntity(t.key);
                  setSubView("overview");
                }}
              >
                {t.label}
              </EntityTab>
            ))}
          </div>

          {/* Timeline: org/user have a weekly axis (the /v2/efficiency
              endpoint); project/repo do not — show a caliber note instead. */}
          {entity === "org" || entity === "user" ? (
            <EfficiencyTimeline startDate={startDate} endDate={endDate} />
          ) : (
            <NoWeeklyAxis entity={entity} />
          )}

          {/* Aggregate sub-tab (overview/distribution). Mirrors the source's
              概览 / 分布 secondary tabs (aggregate mode only). */}
          <div
            className="flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label="效率子视图"
          >
            <EntityTab
              active={subView === "overview"}
              onClick={() => setSubView("overview")}
            >
              概览
            </EntityTab>
            <EntityTab
              active={subView === "distribution"}
              onClick={() => setSubView("distribution")}
            >
              分布
            </EntityTab>
          </div>

          {/* Content dispatch. */}
          {subView === "distribution" ? (
            <DistributionOverview
              entity={entity}
              startDate={startDate}
              endDate={endDate}
            />
          ) : entity === "org" ? (
            <OrgRanking startDate={startDate} endDate={endDate} />
          ) : entity === "user" ? (
            <EfficiencyUserRanking startDate={startDate} endDate={endDate} />
          ) : entity === "project" ? (
            <ProjectRanking startDate={startDate} endDate={endDate} />
          ) : (
            <EfficiencyRepoRanking startDate={startDate} endDate={endDate} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Org ranking — direct child departments under the company root with their
 * whole-subtree conserved efficiency summaries (deptRankingOptions). Renders
 * the org-level KPI strip (from the ranking's `self`) + a sortable table of
 * child departments by calendar_ratio.
 *
 * The parent dept id resolves from the dept tree root (the source uses the
 * configured company root). When no root is available, we pass undefined and
 * the backend returns the configured root's children (matches mock behavior).
 */
function OrgRanking({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const treeQ = useQuery(deptTreeOptions(wsId));
  const parentDeptId = treeQ.data?.[0]?.dept_id ?? "";
  const rankingQ = useQuery(
    deptRankingOptions(wsId, parentDeptId || undefined, startDate, endDate),
  );

  const items = useMemo(
    () =>
      sortRows(
        rankingQ.data?.items ?? [],
        (it) => it.summary.calendar_ratio,
        true,
      ),
    [rankingQ.data],
  );

  const self = rankingQ.data?.self ?? null;

  return (
    <div className="space-y-4">
      {/* Org-level KPI strip (conserved whole-company summary). */}
      {self && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OrgKpi
            label="看板成员"
            value={formatNumber(self.kanban_member_count)}
            hint={`总成员 ${formatNumber(self.member_count)}`}
          />
          <OrgKpi
            label="日历提效比"
            value={formatV2Ratio(self.calendar_ratio)}
            hint="守恒口径：Σ基线 ÷ Σ实际（小数口径）"
          />
          <OrgKpi
            label="人力提效比"
            value={formatV2Ratio(self.work_ratio)}
            hint="守恒口径：Σ基线 ÷ Σ实际（小数口径）"
          />
          <OrgKpi
            label="合并需求"
            value={formatNumber(self.merged_need_count)}
          />
        </section>
      )}

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            部门效率排行
          </span>
          <span className="text-xs text-muted-foreground">
            按日历提效比降序 · 全子树聚合
          </span>
        </div>
        {rankingQ.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(rankingQ.error as Error).message}
          </div>
        ) : rankingQ.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            暂无部门数据
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <ThNum>排名</ThNum>
                  <Th>部门</Th>
                  <Th>日历提效比</Th>
                  <Th>人力提效比</Th>
                  <ThNum>看板成员</ThNum>
                  <ThNum>合并需求</ThNum>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr
                    key={it.dept_id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <TdNum>
                      <span className="text-muted-foreground">{i + 1}</span>
                    </TdNum>
                    <Td title={it.dept_name}>{it.dept_name}</Td>
                    <Td>{formatV2Ratio(it.summary.calendar_ratio)}</Td>
                    <Td>{formatV2Ratio(it.summary.work_ratio)}</Td>
                    <TdNum>{formatNumber(it.summary.kanban_member_count)}</TdNum>
                    <TdNum>{formatNumber(it.summary.merged_need_count)}</TdNum>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OrgKpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card shadow-sm p-4">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold leading-none tabular-nums text-card-foreground">
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * Project ranking — projects with their Need-scope efficiency fields. Pure
 * display table (no drill-down per design decision #2). The source uses
 * ProjectList here; we render the same fields directly from
 * projectListOptions. The legacy project efficiency_ratio (percentage) is NOT
 * shown — the list migrated to the Need scope (decimal multipliers) which we
 * render via formatV2Ratio.
 */
function ProjectRanking({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const wp = useWorkspacePaths();
  const { push } = useNavigation();
  const q = useQuery(projectListOptions(wsId, startDate, endDate));
  const rows = useMemo<ProjectListItem[]>(
    () =>
      sortRows(
        q.data ?? [],
        (p) => p.need_calendar_efficiency_ratio ?? null,
        true,
      ),
    [q.data],
  );

  // Conserved cross-project average: Σbaseline / Σactual (NOT arithmetic mean
  // of per-project ratios), matching the source's ProjectAggregateSummary.
  const agg = useMemo(() => {
    let calBase = 0;
    let calAct = 0;
    let workBase = 0;
    let workAct = 0;
    let eligible = 0;
    let total = 0;
    for (const r of rows) {
      eligible += r.need_eligible_count ?? 0;
      total += r.need_total_count ?? 0;
      calBase += r.need_baseline_calendar_min ?? 0;
      calAct += r.need_actual_calendar_min ?? 0;
      workBase += r.need_baseline_work_min ?? 0;
      workAct += r.need_actual_work_min ?? 0;
    }
    return {
      projectCount: rows.length,
      eligible,
      total,
      avgCalRatio: calAct > 0 ? calBase / calAct : null,
      avgWorkRatio: workAct > 0 ? workBase / workAct : null,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OrgKpi label="项目数" value={formatNumber(agg.projectCount)} />
        <OrgKpi
          label="合格需求"
          value={formatNumber(agg.eligible)}
          hint={`合格/候选 ${formatNumber(agg.eligible)} / ${formatNumber(agg.total)}`}
        />
        <OrgKpi
          label="平均日历提效比"
          value={formatV2Ratio(agg.avgCalRatio)}
          hint="守恒口径：Σ基线 ÷ Σ实际（小数口径）"
        />
        <OrgKpi
          label="平均人力提效比"
          value={formatV2Ratio(agg.avgWorkRatio)}
          hint="守恒口径：Σ基线 ÷ Σ实际（小数口径）"
        />
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            项目效率排行
          </span>
          <span className="text-xs text-muted-foreground">
            Need 口径 · 按日历提效比降序
          </span>
        </div>
        {q.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(q.error as Error).message}
          </div>
        ) : q.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            暂无项目数据
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <ThNum>排名</ThNum>
                  <Th>项目</Th>
                  <Th>日历提效比</Th>
                  <Th>人力提效比</Th>
                  <ThNum>合格需求</ThNum>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr
                    key={p.project_id}
                    onClick={() => push(wp.metricsProjectDetail(p.project_id))}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <TdNum>
                      <span className="text-muted-foreground">{i + 1}</span>
                    </TdNum>
                    <Td title={p.name}>{p.name}</Td>
                    <Td>
                      {formatV2Ratio(p.need_calendar_efficiency_ratio ?? null)}
                    </Td>
                    <Td>
                      {formatV2Ratio(p.need_work_efficiency_ratio ?? null)}
                    </Td>
                    <TdNum>{formatNumber(p.need_eligible_count ?? 0)}</TdNum>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Honest "no weekly axis" note for project/repo (the efficiency endpoint is
 *  user×week only). Mirrors the source's "caliber N/A" branch. */
function NoWeeklyAxis({ entity }: { entity: Entity }) {
  const note =
    entity === "project"
      ? "项目维度无按周提效时间线（/v2/efficiency 仅含 user×week）；按项目聚合的提效比见下方排行。"
      : "仓库维度无按周提效时间线（/v2/efficiency 仅含 user×week）；按仓库聚合的提效比见下方排行。";
  return (
    <div className="rounded-lg border bg-card shadow-sm p-4 lg:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          提效趋势
        </h2>
      </div>
      <div className="flex h-[280px] items-center justify-center text-center">
        <span className="max-w-md text-sm text-muted-foreground">{note}</span>
      </div>
    </div>
  );
}

/** A flat entity-tab button (the shadcn Tabs primitive is overkill for
 *  inline entity/sub-view tabs). */
function EntityTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors"
          : "rounded-md bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

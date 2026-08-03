"use client";

import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptTrendOptions,
  formatNumber,
  formatV2Ratio,
  projectListOptions,
  sortRows,
  useViewState,
  type ProjectListItem,
} from "@multica/core/efficiency";
import { PageHeader } from "../../layout/page-header";
import { DateRangePicker } from "../components";
import {
  EntityObjectSelector,
  type EfficiencyEntity,
} from "../components/entity-object-selector";
import { CreateProjectButton } from "../components/create-project-button";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { ProjectDetail, RepoDetail, UserDetail } from "../detail";
import { Th, ThNum, Td, TdNum } from "../usage/shared";
import { DistributionOverview } from "./distribution-overview";
import { EfficiencyTimeline } from "./efficiency-timeline";
import { EfficiencyOrgView } from "./efficiency-org-view";
import { EfficiencyRepoRanking } from "./efficiency-repo-ranking";
import { EfficiencyRepoTimeline } from "./efficiency-repo-timeline";
import { EfficiencyUserRanking } from "./efficiency-user-ranking";
import { EntityContributionTrend } from "../contribution/entity-contribution-trend";

// Efficiency Dimension — aggregate and focused views for all four entities.
// The Web route owns the shareable entity/object/sub query state while the
// shared view keeps an internal-state fallback for other hosts and tests.
// Aggregate mode renders:
//   - entity tab (org/user/project/repo)
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
// from ../charts. Per #4 (reuse) DateRangePicker, the shared Th/Td table
// primitives, and the ranking sub-components are all reused.

type Entity = EfficiencyEntity;
export type EfficiencySubView = "overview" | "distribution";

export interface EfficiencyViewState {
  entity: Entity;
  object: string;
  subView: EfficiencySubView;
}

interface EfficiencyDimensionProps {
  initialEntity?: Entity;
  initialObject?: string;
  initialSubView?: EfficiencySubView;
  onStateChange?: (state: EfficiencyViewState) => void;
}

const ENTITY_TABS: { key: Entity; label: string }[] = [
  { key: "org", label: "组织" },
  { key: "user", label: "个人" },
  { key: "project", label: "项目" },
  { key: "repo", label: "仓库" },
];

export function EfficiencyDimension({
  initialEntity = "org",
  initialObject = "",
  initialSubView = "overview",
  onStateChange,
}: EfficiencyDimensionProps = {}) {
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;
  const [internalState, setInternalState] = useState<EfficiencyViewState>({
    entity: initialEntity,
    object: initialObject,
    subView: initialSubView,
  });
  const state = onStateChange
    ? {
        entity: initialEntity,
        object: initialObject,
        subView: initialSubView,
      }
    : internalState;

  function updateState(next: EfficiencyViewState) {
    setInternalState(next);
    onStateChange?.(next);
  }

  const { entity, object, subView } = state;
  const focused = object !== "";

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">效率看板</h1>
        </div>
        <DateRangePicker value={timeRange} onChange={setTimeRange} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:space-y-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label="主体"
            >
              {ENTITY_TABS.map((t) => (
                <EntityTab
                  key={t.key}
                  active={entity === t.key}
                  onClick={() =>
                    updateState({
                      entity: t.key,
                      object: "",
                      subView: "overview",
                    })
                  }
                >
                  {t.label}
                </EntityTab>
              ))}
            </div>
            <EntityObjectSelector
              entity={entity}
              value={object}
              startDate={startDate}
              endDate={endDate}
              onChange={(value) =>
                updateState({ entity, object: value, subView: "overview" })
              }
            />
            {entity === "project" && (
              <CreateProjectButton
                onCreated={(projectId) =>
                  updateState({
                    entity,
                    object: projectId,
                    subView: "overview",
                  })
                }
              />
            )}
          </div>

          {/* Timeline first (页首主角), then the 概览/分布 sub-tabs below it,
              matching the source page structure. */}
          {!focused &&
            (entity === "org" || entity === "user" ? (
              <EfficiencyTimeline startDate={startDate} endDate={endDate} />
            ) : entity === "repo" ? (
              <EfficiencyRepoTimeline
                startDate={startDate}
                endDate={endDate}
              />
            ) : (
              <NoWeeklyAxis entity={entity} />
            ))}

          {!focused && (
            <div
              className="flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label="效率子视图"
            >
              <EntityTab
                active={subView === "overview"}
                onClick={() =>
                  updateState({ entity, object, subView: "overview" })
                }
              >
                概览
              </EntityTab>
              <EntityTab
                active={subView === "distribution"}
                onClick={() =>
                  updateState({ entity, object, subView: "distribution" })
                }
              >
                分布
              </EntityTab>
            </div>
          )}

          {focused ? (
            <FocusedEfficiency
              entity={entity}
              object={object}
              startDate={startDate}
              endDate={endDate}
              onBack={() =>
                updateState({ entity, object: "", subView: "overview" })
              }
              onObjectChange={(value) =>
                updateState({ entity, object: value, subView: "overview" })
              }
            />
          ) : subView === "distribution" ? (
            <DistributionOverview
              entity={entity}
              startDate={startDate}
              endDate={endDate}
            />
          ) : entity === "org" ? (
            <OrgRanking
              startDate={startDate}
              endDate={endDate}
              onSelect={(value) =>
                updateState({ entity, object: value, subView: "overview" })
              }
            />
          ) : entity === "user" ? (
            <EfficiencyUserRanking
              startDate={startDate}
              endDate={endDate}
              onSelect={(value) =>
                updateState({ entity, object: value, subView: "overview" })
              }
            />
          ) : entity === "project" ? (
            <ProjectRanking
              startDate={startDate}
              endDate={endDate}
              onSelect={(value) =>
                updateState({ entity, object: value, subView: "overview" })
              }
            />
          ) : (
            <EfficiencyRepoRanking
              startDate={startDate}
              endDate={endDate}
            />
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
  onSelect,
}: {
  startDate: string;
  endDate: string;
  onSelect: (deptId: string) => void;
}) {
  return (
    <EfficiencyOrgView
      startDate={startDate}
      endDate={endDate}
      onDeptChange={onSelect}
    />
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
 * display table with focused project drill-down. The source uses
 * ProjectList here; we render the same fields directly from
 * projectListOptions. The legacy project efficiency_ratio (percentage) is NOT
 * shown — the list migrated to the Need scope (decimal multipliers) which we
 * render via formatV2Ratio.
 */
function ProjectRanking({
  startDate,
  endDate,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  onSelect: (projectId: string) => void;
}) {
  const wsId = useWorkspaceId();
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
                    tabIndex={0}
                    onClick={() => onSelect(p.project_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onSelect(p.project_id);
                    }}
                    className={`${DRILLDOWN_ROW_CLASS} border-b last:border-0`}
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

function FocusedEfficiency({
  entity,
  object,
  startDate,
  endDate,
  onBack,
  onObjectChange,
}: {
  entity: Entity;
  object: string;
  startDate: string;
  endDate: string;
  onBack: () => void;
  onObjectChange: (value: string) => void;
}) {
  const wsId = useWorkspaceId();
  const deptTrend = useQuery(
    deptTrendOptions(wsId, {
      deptId: entity === "org" ? object : undefined,
      startDate,
      endDate,
    }),
  );

  if (entity === "org") {
    return (
      <div className="space-y-4">
        <EntityContributionTrend
          title="提效趋势"
          points={deptTrend.data?.data}
          loading={deptTrend.isLoading}
          error={deptTrend.error ? (deptTrend.error as Error).message : null}
          subtitle={`部门 · ${object} · 子树成员守恒口径`}
          metric="efficiency"
        />
        <EfficiencyOrgView
          startDate={startDate}
          endDate={endDate}
          selectedDeptId={object}
          onDeptChange={onObjectChange}
        />
      </div>
    );
  }

  if (entity === "user") {
    return (
      <div className="space-y-4">
        <EfficiencyTimeline
          startDate={startDate}
          endDate={endDate}
          userId={object}
        />
        <UserDetail
          userId={object}
          startDate={startDate}
          endDate={endDate}
          onBack={onBack}
        />
      </div>
    );
  }

  if (entity === "project") {
    return (
      <ProjectDetail
        projectId={object}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
        onDeleted={onBack}
      />
    );
  }

  return (
    <div className="space-y-4">
      <EfficiencyRepoTimeline
        startDate={startDate}
        endDate={endDate}
        repoAddr={object}
      />
      <RepoDetail
        repoAddr={object}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
      />
    </div>
  );
}

/** Honest "no weekly axis" note for project/repo (the efficiency endpoint is
 *  user×week only). Mirrors the source's "caliber N/A" branch. */
function NoWeeklyAxis({ entity }: { entity: Entity }) {
  const note =
    entity === "project"
      ? "项目维度聚合态按 Need 口径展示提效概览；按项目聚合的提效比见下方排行。"
      : "当前主体暂无按周提效趋势。";
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

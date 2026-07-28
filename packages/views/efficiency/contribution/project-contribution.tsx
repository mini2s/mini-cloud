"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  formatNumber,
  formatV2Ratio,
  parseOrder,
  projectListOptions,
  projectTrendOptions,
  sortRows,
  toOrder,
  type ProjectListItem,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { Td, TdNum, Th, ThNum, SortHeader } from "../usage/shared";
import { useNavigation } from "../../navigation";
import { ProjectDetail } from "../detail";
import { EntityContributionTrend } from "./entity-contribution-trend";

// Project contribution — project deliverables derived from /v2/projects
// (ProjectListItem carries need_total_count / need_eligible_count /
// need_total_loc_net / user_count / need_ai_code_ratio). Per design decision
// #5 (zero-platform-request) this consumes only the existing
// projectListOptions.
//
// Caliber (matches source ProjectContribution):
//   - need_total_count / need_eligible_count / user_count / need_total_loc_net
//     are COUNTS → formatNumber.
//   - need_ai_code_ratio is a decimal ratio (0.25 => 25%).
//   - The source sorts by need_total_loc_net desc (contribution = code
//     produced); we keep that as the default but expose a 3-state sort on the
//     three contribution columns (eligible needs / generated code /
//     contributors).

type SortField =
  | "need_eligible_count"
  | "need_total_loc_net"
  | "user_count";

function ProjectContributionCaliberNote() {
  return (
    <p className="text-xs text-muted-foreground">
      贡献为
      <span className="font-medium text-foreground">看板派生口径</span>
      （完成的需求 / 生成代码 / 贡献者）。平台（chat-stats）源无项目维度，且
      tokens 是消耗量非贡献，故贡献维度不接入平台。
    </p>
  );
}

export function ProjectContribution({
  startDate,
  endDate,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  onSelect?: (projectId: string) => void;
}) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { push } = useNavigation();
  const q = useQuery(projectListOptions(wsId, startDate, endDate));
  const trendQ = useQuery(
    projectTrendOptions(wsId, { startDate, endDate }),
  );
  const rows = useMemo<ProjectListItem[]>(() => q.data ?? [], [q.data]);

  // Default sort: need_total_loc_net desc (matches source — contribution
  // ranks by "code produced" first).
  const [order, setOrder] = useState<string>(
    toOrder("need_total_loc_net", true) ?? "",
  );
  const parsed = useMemo(() => parseOrder(order), [order]);
  const sorted = useMemo(() => {
    if (!parsed) return rows;
    return sortRows(rows, getterFor(parsed.field as SortField), parsed.desc);
  }, [rows, parsed]);

  // Conserved KPI: Σ across all projects.
  const kpi = useMemo(() => {
    let needs = 0;
    let eligible = 0;
    let contributors = 0;
    let loc = 0;
    for (const r of rows) {
      needs += r.need_total_count ?? 0;
      eligible += r.need_eligible_count ?? 0;
      contributors += r.user_count ?? 0;
      loc += r.need_total_loc_net ?? 0;
    }
    return { projects: rows.length, needs, eligible, contributors, loc };
  }, [rows]);

  // 3-state sort cycle: none → asc → desc → none.
  function onSort(field: SortField) {
    if (!parsed || parsed.field !== field) setOrder(toOrder(field, false) ?? "");
    else if (!parsed.desc) setOrder(toOrder(field, true) ?? "");
    else setOrder("");
  }
  const isActive = (f: SortField) => parsed?.field === f;
  const isDesc = (f: SortField) => parsed?.field === f && parsed.desc === true;

  return (
    <div className="space-y-4">
      <EntityContributionTrend
        points={trendQ.data?.data}
        loading={trendQ.isLoading}
        error={trendQ.error ? (trendQ.error as Error).message : null}
        subtitle="全部项目 · 干净需求聚合"
        metric="needs"
      />

      {/* KPI strip — counts only (contribution caliber, not tokens). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="项目数"
            value={formatNumber(kpi.projects)}
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="完成需求"
            value={formatNumber(kpi.eligible)}
            hint={`候选 ${formatNumber(kpi.needs)}`}
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="贡献者(累计)"
            value={formatNumber(kpi.contributors)}
            hint="各项目人数合计(可重复)"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="生成代码(合计)"
            value={kpi.loc > 0 ? `${formatNumber(kpi.loc)} 行` : "-"}
          />
        </div>
      </section>

      {/* Ranking table — derived from projectList and linked to project detail. */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            项目贡献排行（看板派生）
          </span>
          <span className="text-xs text-muted-foreground">
            按生成代码量倒序 · 点行下钻
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
                  <Th>项目</Th>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="生成代码"
                        active={isActive("need_total_loc_net")}
                        desc={isDesc("need_total_loc_net")}
                        onClick={() => onSort("need_total_loc_net")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="完成 / 候选需求"
                        active={isActive("need_eligible_count")}
                        desc={isDesc("need_eligible_count")}
                        onClick={() => onSort("need_eligible_count")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="贡献者"
                        active={isActive("user_count")}
                        desc={isDesc("user_count")}
                        onClick={() => onSort("user_count")}
                      />
                    </span>
                  </ThNum>
                  <Th>AI 占比</Th>
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
                        暂无项目贡献数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((r, i) => (
                    <tr
                      key={r.project_id}
                      onClick={() =>
                        onSelect
                          ? onSelect(r.project_id)
                          : push(p.metricsProjectDetail(r.project_id))
                      }
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <TdNum>
                        <span className="text-muted-foreground">{i + 1}</span>
                      </TdNum>
                      <Td title={r.name}>{r.name || "-"}</Td>
                      <TdNum>
                        {r.need_total_loc_net && r.need_total_loc_net > 0
                          ? `${formatNumber(r.need_total_loc_net)} 行`
                          : "-"}
                      </TdNum>
                      <TdNum>
                        {formatNumber(r.need_eligible_count ?? 0)}
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatNumber(r.need_total_count ?? 0)}
                        </span>
                      </TdNum>
                      <TdNum>{formatNumber(r.user_count ?? 0)}</TdNum>
                      <Td>{formatV2Ratio(r.need_ai_code_ratio)}</Td>
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

export function ProjectContributionFocus({
  projectId,
  startDate,
  endDate,
  onBack,
  onDeleted,
}: {
  projectId: string;
  startDate: string;
  endDate: string;
  onBack: () => void;
  onDeleted?: () => void;
}) {
  const wsId = useWorkspaceId();
  const trendQ = useQuery(
    projectTrendOptions(wsId, { projectId, startDate, endDate }),
  );

  return (
    <div className="space-y-4">
      <EntityContributionTrend
        points={trendQ.data?.data}
        loading={trendQ.isLoading}
        error={trendQ.error ? (trendQ.error as Error).message : null}
        subtitle={`项目 · ${projectId} · 干净需求聚合`}
        metric="needs"
      />
      <ProjectContributionCaliberNote />
      <ProjectDetail
        projectId={projectId}
        startDate={startDate}
        endDate={endDate}
        onBack={onBack}
        onDeleted={onDeleted}
      />
    </div>
  );
}

function getterFor(field: SortField): (row: ProjectListItem) => unknown {
  return (row) => {
    const v = row[field];
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
}

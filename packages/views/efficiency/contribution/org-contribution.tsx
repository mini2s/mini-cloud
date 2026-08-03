"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  deptRankingOptions,
  deptOverviewOptions,
  deptTrendOptions,
  formatNumber,
  sortRows,
  toOrder,
  parseOrder,
  type DeptRankingItem,
  type DeptTreeNodeWithSummary,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { Td, TdNum, Th, ThNum, SortHeader } from "../usage/shared";
import { EntityContributionTrend } from "./entity-contribution-trend";
import { DeptMembersPanel } from "../efficiency/efficiency-org-view";

// Org contribution — org deliverables derived from /v2/dept-tree/ranking
// (DeptRankingItem.summary is the DeptMembersSummary scope: merged_need_count
// / commit_diff_lines / commit_count / member_count / kanban_member_count).
// The ranking uses /v2/dept-tree/ranking and the weekly chart uses
// /v2/dept-tree/trend, both scoped to the configured company root.
//
// Caliber (matches source OrgContribution):
//   - merged_need_count / commit_diff_lines / commit_count are COUNTS → formatNumber.
//   - The source sorts by merged_need_count desc; we keep that as the default
//     but expose a 3-state sort (none → asc → desc → none) on the 3 count
//     columns so users can re-rank by code lines / commits too.
//
// The parent dept id resolves from the dept tree root (the source uses the
// configured company root). When no root is available we pass undefined and
// the backend returns the configured root's children.

type SortField = "merged_need_count" | "commit_diff_lines" | "commit_count";

export function OrgContribution({
  startDate,
  endDate,
  deptId = "",
  deptName = "",
  onSelect,
}: {
  startDate: string;
  endDate: string;
  deptId?: string;
  deptName?: string;
  onSelect?: (deptId: string) => void;
}) {
  const wsId = useWorkspaceId();
  const overviewQ = useQuery(
    deptOverviewOptions(wsId, startDate, endDate),
  );
  const rankingQ = useQuery(
    deptRankingOptions(wsId, deptId || undefined, startDate, endDate),
  );
  const trendQ = useQuery(
    deptTrendOptions(wsId, { deptId: deptId || undefined, startDate, endDate }),
  );

  const items = useMemo<DeptRankingItem[]>(
    () => rankingQ.data?.items ?? [],
    [rankingQ.data],
  );

  // Default sort: merged_need_count desc (matches the source's "PK by merged needs").
  const [order, setOrder] = useState<string>(
    toOrder("merged_need_count", true) ?? "",
  );
  const parsed = useMemo(() => parseOrder(order), [order]);
  const sorted = useMemo(() => {
    if (!parsed) return items;
    return sortRows(items, getterFor(parsed.field as SortField), parsed.desc);
  }, [items, parsed]);

  // Conserved KPI: Σ across direct child departments' subtree summaries.
  const kpi = useMemo(() => {
    let mergedNeeds = 0;
    let codeLines = 0;
    let commits = 0;
    let kanbanMembers = 0;
    for (const it of items) {
      mergedNeeds += it.summary.merged_need_count || 0;
      codeLines += it.summary.commit_diff_lines || 0;
      commits += it.summary.commit_count || 0;
      kanbanMembers += it.summary.kanban_member_count || 0;
    }
    return { depts: items.length, mergedNeeds, codeLines, commits, kanbanMembers };
  }, [items]);

  // 3-state sort cycle: none → asc → desc → none.
  function onSort(field: SortField) {
    if (!parsed || parsed.field !== field) setOrder(toOrder(field, false) ?? "");
    else if (!parsed.desc) setOrder(toOrder(field, true) ?? "");
    else setOrder("");
  }
  const isActive = (f: SortField) => parsed?.field === f;
  const isDesc = (f: SortField) => parsed?.field === f && parsed.desc === true;
  const resolvedDeptName =
    deptName ||
    findDepartmentName(overviewQ.data?.nodes ?? [], deptId) ||
    deptId;

  if (deptId) {
    return (
      <div className="space-y-4">
        <EntityContributionTrend
          points={trendQ.data?.data}
          loading={trendQ.isLoading}
          error={trendQ.error ? (trendQ.error as Error).message : null}
          subtitle={`部门 · ${resolvedDeptName} · 子树成员合并需求`}
          metric="needs"
        />
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          仅直属成员，子部门未计入。该部门花名册为直属成员（dept-tree/members
          非递归）；选择含子部门的父部门时，聚合值可能偏小。
        </p>
        <DeptMembersPanel
          deptId={deptId}
          deptName={resolvedDeptName}
          startDate={startDate}
          endDate={endDate}
          aiLabel="AI 代码占比"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EntityContributionTrend
        points={trendQ.data?.data}
        loading={trendQ.isLoading}
        error={trendQ.error ? (trendQ.error as Error).message : null}
        subtitle="全公司 · 各部门子树成员合并需求"
        metric="needs"
      />

      {/* KPI strip — counts only (contribution caliber, not tokens). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="参与部门"
            value={formatNumber(kpi.depts)}
            hint="一级子部门（整棵子树汇总）"
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="合并需求"
            value={formatNumber(kpi.mergedNeeds)}
            hint="各部门 merged_need 合计"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="代码行"
            value={formatNumber(kpi.codeLines)}
            hint="各部门 commit 净代码行合计"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="提交数"
            value={formatNumber(kpi.commits)}
            hint="各部门 commit 合计"
          />
        </div>
      </section>

      {/* Ranking table — derived from department subtree summaries. */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            部门贡献 PK 榜（看板派生）
          </span>
          <span className="text-xs text-muted-foreground">
            按合并需求倒序 · 各一级子部门整棵子树汇总
          </span>
        </div>
        {rankingQ.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(rankingQ.error as Error).message}
          </div>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <ThNum>排名</ThNum>
                  <Th>部门</Th>
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
                        label="提交数"
                        active={isActive("commit_count")}
                        desc={isDesc("commit_count")}
                        onClick={() => onSort("commit_count")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>活跃成员</ThNum>
                </tr>
              </thead>
              <tbody>
                {rankingQ.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
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
                        暂无部门贡献数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((it, i) => (
                    <tr
                      key={it.dept_id}
                      tabIndex={onSelect ? 0 : undefined}
                      onClick={() => onSelect?.(it.dept_id)}
                      onKeyDown={
                        onSelect
                          ? (event) => {
                              if (event.key === "Enter") onSelect(it.dept_id);
                            }
                          : undefined
                      }
                      className={
                        onSelect
                          ? `${DRILLDOWN_ROW_CLASS} border-b last:border-0`
                          : "border-b last:border-0"
                      }
                    >
                      <TdNum>
                        <span className="text-muted-foreground">{i + 1}</span>
                      </TdNum>
                      <Td title={it.dept_name}>{it.dept_name || "-"}</Td>
                      <TdNum>
                        {formatNumber(it.summary.merged_need_count)}
                      </TdNum>
                      <TdNum>
                        {it.summary.commit_diff_lines > 0
                          ? formatNumber(it.summary.commit_diff_lines)
                          : "-"}
                      </TdNum>
                      <TdNum>{formatNumber(it.summary.commit_count)}</TdNum>
                      <TdNum>
                        {formatNumber(it.summary.kanban_member_count)}
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatNumber(it.summary.member_count)}
                        </span>
                      </TdNum>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        「活跃成员 / 总成员」= 所选时间窗口内有看板数据的成员数 / dept-sync
        花名册直属人数。
      </p>
    </div>
  );
}

function getterFor(field: SortField): (row: DeptRankingItem) => unknown {
  return (row) => {
    const v = row.summary[field];
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
}

function findDepartmentName(
  nodes: DeptTreeNodeWithSummary[],
  deptId: string,
): string | undefined {
  for (const node of nodes) {
    if (node.dept_id === deptId) return node.dept_name;
    const childName = findDepartmentName(node.children, deptId);
    if (childName) return childName;
  }
  return undefined;
}

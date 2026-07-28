"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  allReposOptions,
  formatNumber,
  formatV2Ratio,
  parseOrder,
  repoBranchesOptions,
  repoDetailOptions,
  repoTrendOptions,
  sortRows,
  toOrder,
  type RepoCommitItem,
  type RepoListItem,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { Td, TdNum, Th, ThNum, SortHeader } from "../usage/shared";
import { useNavigation } from "../../navigation";
import { EntityContributionTrend } from "./entity-contribution-trend";

// Repo contribution — repo deliverables derived from /v2/repos
// (RepoListItem carries commit_count / task_count / branch_count /
// ai_code_ratio). Per design decision #5 (zero-platform-request) this
// consumes only the existing allReposOptions.
//
// Caliber (matches source RepoContribution, AGGREGATE branch):
//   - commit_count / task_count / branch_count are COUNTS → formatNumber.
//   - ai_code_ratio is a decimal ratio (0.25 => 25%).
//   - ⚠️ DATA REALITY (checked against types.ts): RepoListItem has NO
//     commit_diff_lines (code lines) — those live only in the focused detail
//     page (commits[].diff_lines). The aggregate ranking therefore shows
//     commits / tasks / branches / AI ratio only; code lines per repo remain
//     available in the focused repo detail. The source surfaces the same
//     aggregate fields.
//   - The source sorts by commit_count desc; we keep that as the default
//     but expose a 3-state sort on commits / tasks.

type SortField = "commit_count" | "task_count";

interface ContributorRow {
  name: string;
  commits: number;
  diffLines: number;
}

export function RepoContribution({
  startDate,
  endDate,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  onSelect?: (repoAddr: string) => void;
}) {
  const wsId = useWorkspaceId();
  const p = useWorkspacePaths();
  const { push } = useNavigation();
  const q = useQuery(allReposOptions(wsId, startDate, endDate));
  const trendQ = useQuery(
    repoTrendOptions(wsId, { startDate, endDate }),
  );
  const rows = useMemo<RepoListItem[]>(() => q.data ?? [], [q.data]);

  // Default sort: commit_count desc (matches source — commits are the
  // primary repo contribution signal).
  const [order, setOrder] = useState<string>(
    toOrder("commit_count", true) ?? "",
  );
  const parsed = useMemo(() => parseOrder(order), [order]);
  const sorted = useMemo(() => {
    if (!parsed) return rows;
    return sortRows(rows, getterFor(parsed.field as SortField), parsed.desc);
  }, [rows, parsed]);

  // Conserved KPI: Σ across all repos. avg AI ratio = arithmetic mean of
  // finite ai_code_ratio values (matches source RepoContribAggregate).
  const kpi = useMemo(() => {
    let commits = 0;
    let tasks = 0;
    const aiVals: number[] = [];
    for (const r of rows) {
      commits += r.commit_count || 0;
      tasks += r.task_count || 0;
      const ai = Number(r.ai_code_ratio);
      if (Number.isFinite(ai)) aiVals.push(ai);
    }
    const avgAi =
      aiVals.length > 0 ? aiVals.reduce((a, b) => a + b, 0) / aiVals.length : null;
    return { repos: rows.length, commits, tasks, avgAi };
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
        subtitle="全部仓库 · 每周提交量"
        metric="commits"
      />

      {/* KPI strip — counts only (contribution caliber, not tokens). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="仓库数"
            value={formatNumber(kpi.repos)}
            accent="brand"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="Commit 总数"
            value={formatNumber(kpi.commits)}
            hint="各仓库提交数合计"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="Task 总数"
            value={formatNumber(kpi.tasks)}
            hint="各仓库任务数合计"
          />
        </div>
        <div className="rounded-lg border bg-card shadow-sm">
          <KpiCard
            label="平均 AI 占比"
            value={formatV2Ratio(kpi.avgAi)}
            hint="各仓库 ai_code_ratio 均值"
          />
        </div>
      </section>

      {/* Ranking table — derived from allRepos and linked to repo detail. */}
      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm font-semibold text-card-foreground">
            仓库贡献排行（看板派生）
          </span>
          <span className="text-xs text-muted-foreground">
            按 Commit 数倒序（整仓跨全部分支聚合）· 点行下钻进整仓详情
          </span>
        </div>
        {q.error ? (
          <div className="px-4 py-3 text-sm text-destructive">
            加载失败：{(q.error as Error).message}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b">
                  <ThNum>排名</ThNum>
                  <Th>仓库</Th>
                  <ThNum>分支</ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="Commit 数"
                        active={isActive("commit_count")}
                        desc={isDesc("commit_count")}
                        onClick={() => onSort("commit_count")}
                      />
                    </span>
                  </ThNum>
                  <ThNum>
                    <span className="inline-flex w-full justify-end">
                      <SortHeader
                        label="Task 数"
                        active={isActive("task_count")}
                        desc={isDesc("task_count")}
                        onClick={() => onSort("task_count")}
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
                        暂无仓库贡献数据
                      </span>
                    </td>
                  </tr>
                ) : (
                  sorted.map((r, i) => (
                    <tr
                      key={r.repo_addr}
                      onClick={() =>
                        onSelect
                          ? onSelect(r.repo_addr)
                          : push(p.metricsRepoDetail(r.repo_addr))
                      }
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <TdNum>
                        <span className="text-muted-foreground">{i + 1}</span>
                      </TdNum>
                      <Td title={r.repo_addr}>
                        <div className="max-w-[360px] truncate">
                          {r.repo_addr || "-"}
                        </div>
                      </Td>
                      <TdNum>
                        {r.branch_count ? `${formatNumber(r.branch_count)} 支` : "-"}
                      </TdNum>
                      <TdNum>{formatNumber(r.commit_count)}</TdNum>
                      <TdNum>{formatNumber(r.task_count)}</TdNum>
                      <Td>{formatV2Ratio(r.ai_code_ratio)}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        整仓口径（跨全部分支合并）；代码行与各分支明细可在单仓库详情中查看。
      </p>
    </div>
  );
}

export function RepoContributionFocus({
  repoAddr,
  startDate,
  endDate,
}: {
  repoAddr: string;
  startDate: string;
  endDate: string;
}) {
  const wsId = useWorkspaceId();
  const trendQ = useQuery(
    repoTrendOptions(wsId, { repoAddr, startDate, endDate }),
  );
  const branchesQ = useQuery(repoBranchesOptions(wsId, repoAddr));
  const detailQ = useQuery(
    repoDetailOptions(wsId, { repoAddr, startDate, endDate }),
  );
  const commits = useMemo<RepoCommitItem[]>(
    () => detailQ.data?.commits ?? [],
    [detailQ.data?.commits],
  );
  const branches = useMemo(
    () => branchesQ.data?.branches ?? detailQ.data?.branches ?? [],
    [branchesQ.data?.branches, detailQ.data?.branches],
  );
  const contributors = useMemo<ContributorRow[]>(() => {
    const rows = new Map<string, ContributorRow>();
    for (const commit of commits) {
      const name = commit.git_user_name?.trim() || "(未署名)";
      const current = rows.get(name) ?? { name, commits: 0, diffLines: 0 };
      current.commits += 1;
      current.diffLines += commit.diff_lines ?? 0;
      rows.set(name, current);
    }
    return [...rows.values()].sort(
      (a, b) => b.commits - a.commits || b.diffLines - a.diffLines,
    );
  }, [commits]);
  const totalDiffLines = useMemo(
    () => commits.reduce((sum, commit) => sum + (commit.diff_lines ?? 0), 0),
    [commits],
  );

  return (
    <div className="space-y-4">
      <EntityContributionTrend
        points={trendQ.data?.data}
        loading={trendQ.isLoading}
        error={trendQ.error ? (trendQ.error as Error).message : null}
        subtitle={`仓库 · ${repoAddr} · 每周提交量`}
        metric="commits"
      />

      <p className="text-xs text-muted-foreground">
        平台（chat-stats）源无仓库维度，贡献为
        <span className="font-medium text-foreground">看板派生口径</span>
        （提交数 / 代码行 / 分支 / 贡献者），非平台 tokens 消耗量。
      </p>

      {detailQ.error ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-destructive">
          加载失败：{(detailQ.error as Error).message}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border bg-card shadow-sm">
              <KpiCard
                label="贡献者"
                value={
                  detailQ.isLoading
                    ? "…"
                    : `${formatNumber(contributors.length)} 人`
                }
                hint="按 commit 署名去重"
                accent="brand"
              />
            </div>
            <div className="rounded-lg border bg-card shadow-sm">
              <KpiCard
                label="提交数"
                value={
                  detailQ.isLoading ? "…" : formatNumber(commits.length)
                }
              />
            </div>
            <div className="rounded-lg border bg-card shadow-sm">
              <KpiCard
                label="代码行数"
                value={
                  detailQ.isLoading
                    ? "…"
                    : totalDiffLines > 0
                      ? `${formatNumber(totalDiffLines)} 行`
                      : "-"
                }
                hint="各 commit diff 行合计"
              />
            </div>
            <div className="rounded-lg border bg-card shadow-sm">
              <KpiCard
                label="分支数"
                value={
                  branchesQ.isLoading ? "…" : formatNumber(branches.length)
                }
              />
            </div>
          </section>

          <section className="rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <span className="text-sm font-semibold text-card-foreground">
                按贡献者拆分（看板派生）
              </span>
              <span className="text-xs text-muted-foreground">
                按提交数倒序
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <ThNum>排名</ThNum>
                    <Th>贡献者</Th>
                    <ThNum>提交数</ThNum>
                    <ThNum>代码行数</ThNum>
                    <ThNum>提交占比</ThNum>
                  </tr>
                </thead>
                <tbody>
                  {detailQ.isLoading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="h-6 animate-pulse rounded bg-muted" />
                        </td>
                      </tr>
                    ))
                  ) : contributors.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-12 text-center text-sm text-muted-foreground"
                      >
                        暂无贡献者数据
                      </td>
                    </tr>
                  ) : (
                    contributors.map((row, index) => (
                      <tr
                        key={row.name}
                        className="border-b last:border-0"
                      >
                        <TdNum>{index + 1}</TdNum>
                        <Td title={row.name}>{row.name}</Td>
                        <TdNum>{formatNumber(row.commits)}</TdNum>
                        <TdNum>
                          {row.diffLines > 0
                            ? `${formatNumber(row.diffLines)} 行`
                            : "-"}
                        </TdNum>
                        <TdNum>
                          {commits.length > 0
                            ? `${((row.commits / commits.length) * 100).toFixed(1)}%`
                            : "-"}
                        </TdNum>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function getterFor(field: SortField): (row: RepoListItem) => unknown {
  return (row) => {
    const v = row[field];
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };
}

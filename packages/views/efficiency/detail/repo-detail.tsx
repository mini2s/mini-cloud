"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  fmtCost,
  formatDuration,
  formatLocalTime,
  formatNumber,
  formatPercent,
  formatV2Ratio,
  projectListOptions,
  repoBranchesOptions,
  repoDetailOptions,
  repoTrendOptions,
  useAddRepoToProject,
  useCheckProjectConflicts,
  useCreateProject,
  useViewState,
  type EntityTrendPoint,
  type ProjectConflict,
  type ProjectListItem,
  type RepoCommitItem,
  type RepoEfficiency,
  type TaskListItem,
} from "@multica/core/efficiency";
import { Plus } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { KpiCard } from "../../runtimes/components/shared";
import { useNavigation } from "../../navigation";
import { MultiTrendChart, type MultiTrendPoint, type MultiTrendSeries } from "../charts";
import { PeriodSelect } from "../components";
import { SortHeader, Th, ThNum, Td, TdNum } from "../usage/shared";
import { DetailShell } from "./detail-shell";
import { EmptyRow, ErrorBanner, Kv, KvGrid, Panel, shortId, ToneBadge } from "./shared";

// Repo detail page — the largest of the efficiency drill-downs. Ports the
// source RepoDetail to the shared-views layer: branch selector + efficiency
// KPI grid + sortable commits / tasks tables + branch overview + weekly trend
// + "add to project" modal.
//
// Caliber (matches source §Repo-5, footguns the source comments call out):
//   - efficiency_ratio / commit_efficiency_ratio / task_efficiency_ratio are
//     PERCENTAGE ratios (300 = 300%, gain% = (ancient−real)/real*100). Use
//     formatPercent / PercentPill-style — never ×100 / never formatV2Ratio.
//   - silica (commit-level AI code share) is a DECIMAL ratio → formatV2Ratio.
//   - summary.ai_code_ratio is a DECIMAL ratio → formatV2Ratio.
//   - manual-minute precedence: commit_*_minutes_manual ?? commit_*_minutes
//     (same for tasks). Efficiency only computable when both ancient & real
//     are > 0; otherwise null → renders "-" and sorts to the bottom.
//
// Cross-entity navigation uses the host navigation adapter. Branch switching
// remains shareable through the optional route callback.

interface RepoDetailProps {
  repoAddr: string;
  /** Initial branch; "" / undefined = whole-repo scope (no branch filter). */
  repoBranch?: string;
  /** Optional date window (YYYY-MM-DD). When absent the backend defaults. */
  startDate?: string;
  endDate?: string;
  /** Back navigation — owned by the route page (e.g. router.back()). */
  onBack: () => void;
  /**
   * Optional branch-change handler. When provided the selector calls it
   * instead of updating internal state, so the route page can re-navigate
   * (the source used URL params). Falls back to internal state when omitted
   * (e.g. in tests / embedded shells).
   */
  onBranchChange?: (branch: string) => void;
}

// Sortable table fields. The sort value is derived per-row by a getter; null
// (uncomputable) sinks to the bottom regardless of direction, matching the
// source sortRows semantics.
type SortField =
  | "commitTime"
  | "diffLines"
  | "commitReal"
  | "commitAncient"
  | "silica"
  | "efficiencyRatio"
  | "cost"
  | "tokens"
  | "startTime"
  | "taskReal"
  | "taskAncient";

interface SortState {
  field: SortField;
  desc: boolean;
}

// ---- manual-precedence + efficiency-ratio caliber (ported from source) ----

function commitReal(row: RepoCommitItem): number | null | undefined {
  return row.commit_real_minutes_manual ?? row.commit_real_minutes;
}
function commitAncient(row: RepoCommitItem): number | null | undefined {
  return row.commit_ancient_minutes_manual ?? row.commit_ancient_minutes;
}
function taskReal(row: TaskListItem): number | null | undefined {
  return row.task_real_minutes_manual ?? row.task_real_minutes;
}
function taskAncient(row: TaskListItem): number | null | undefined {
  return row.task_ancient_minutes_manual ?? row.task_ancient_minutes;
}
/** Commit-level gain% = (ancient−real)/real*100. Manual precedence; both >0. */
function commitEffRatio(row: RepoCommitItem): number | null {
  const ancient = commitAncient(row);
  const real = commitReal(row);
  if (ancient != null && real != null && ancient > 0 && real > 0) {
    return ((ancient - real) / real) * 100;
  }
  return null;
}
/** Task-level gain% (same caliber as commit). */
function taskEffRatio(row: TaskListItem): number | null {
  const ancient = taskAncient(row);
  const real = taskReal(row);
  if (ancient != null && real != null && ancient > 0 && real > 0) {
    return ((ancient - real) / real) * 100;
  }
  return null;
}
/** Commit's branch (backend tags each row; normalized to "" when absent). */
function commitBranch(row: RepoCommitItem): string {
  const b = (row as { repo_branch?: unknown }).repo_branch;
  return typeof b === "string" ? b : "";
}
function tokenSum(up?: number | null, down?: number | null): number {
  return (up || 0) + (down || 0);
}
/** AI-code-share tag tone (decimal silica). Matches source aiCodeRatioTone. */
function aiCodeRatioTone(v: number): "success" | "primary" | "info" {
  if (v >= 0.8) return "success";
  if (v >= 0.5) return "primary";
  return "info";
}

export function RepoDetail({
  repoAddr,
  repoBranch,
  startDate,
  endDate,
  onBack,
  onBranchChange,
}: RepoDetailProps) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { timeRange, setTimeRange } = useViewState();
  const effectiveStartDate = startDate ?? timeRange[0];
  const effectiveEndDate = endDate ?? timeRange[1];

  const ALL_BRANCHES = "__all__";
  const [currentBranch, setCurrentBranch] = useState(repoBranch ?? "");
  useEffect(() => setCurrentBranch(repoBranch ?? ""), [repoBranch]);

  // Detail (KPIs + commits + tasks + efficiency). repoBranch empty = whole
  // repo scope (backend returns all branches); passing undefined keeps the
  // queryKey stable and avoids forcing a single-branch filter (source bug #4).
  const detailQ = useQuery(
    repoDetailOptions(wsId, {
      repoAddr,
      repoBranch: currentBranch || undefined,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
    }),
  );
  // Branch list for the selector (separate, lightweight query).
  const branchesQ = useQuery(repoBranchesOptions(wsId, repoAddr));
  // Weekly trend (separate query; shares EntityTrendResponse with project).
  const trendQ = useQuery(
    repoTrendOptions(wsId, {
      repoAddr,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
    }),
  );

  const commits: RepoCommitItem[] = useMemo(
    () => detailQ.data?.commits ?? [],
    [detailQ.data?.commits],
  );
  const tasks: TaskListItem[] = useMemo(
    () => detailQ.data?.tasks ?? [],
    [detailQ.data?.tasks],
  );
  const efficiency: RepoEfficiency | undefined =
    detailQ.data?.efficiency ?? undefined;
  const branches: string[] = useMemo(
    () => branchesQ.data?.branches ?? detailQ.data?.branches ?? [],
    [branchesQ.data?.branches, detailQ.data?.branches],
  );

  // shadcn Select (Radix) disallows empty-string SelectItem values, so the
  // whole-repo scope ("") is represented as "__all__" at the Select boundary
  // and normalized back to "" for the rest of the page + onBranchChange.
  const selectValue = currentBranch === "" ? ALL_BRANCHES : currentBranch;
  function handleBranchChange(next: string | null) {
    const normalized = !next || next === ALL_BRANCHES ? "" : next;
    setCurrentBranch(normalized);
    onBranchChange?.(normalized);
  }

  // Client-side sort state for the two tables.
  const [commitSort, setCommitSort] = useState<SortState | null>(null);
  const [taskSort, setTaskSort] = useState<SortState | null>(null);
  const [addToProjectOpen, setAddToProjectOpen] = useState(false);

  function cycle(prev: SortState | null, field: SortField): SortState | null {
    if (!prev || prev.field !== field) return { field, desc: false };
    if (!prev.desc) return { field, desc: true };
    return null;
  }

  const sortedCommits = useMemo(() => sortCommits(commits, commitSort), [commits, commitSort]);
  const sortedTasks = useMemo(() => sortTasks(tasks, taskSort), [tasks, taskSort]);

  // Derived totals (align with source computed blocks).
  const totalDiffLines = useMemo(
    () => commits.reduce((s, c) => s + (c.diff_lines || 0), 0),
    [commits],
  );
  const contributorCount = useMemo(() => {
    const names = new Set<string>();
    commits.forEach((c) => c.git_user_name && names.add(c.git_user_name));
    tasks.forEach((t) => t.user_name && names.add(t.user_name));
    return names.size;
  }, [commits, tasks]);
  const totalTokens = useMemo(
    () => tasks.reduce((s, t) => s + tokenSum(t.upstream_tokens, t.downstream_tokens), 0),
    [tasks],
  );
  const totalCost = useMemo(
    () => tasks.reduce((s, t) => s + (t.cost || 0), 0),
    [tasks],
  );
  const activityRange = useMemo(() => {
    const times = commits
      .map((c) => c.commit_time)
      .filter(Boolean)
      .map((t) => new Date(t as string).getTime());
    if (!times.length) return "-";
    return `${fmtDate(Math.min(...times))} ~ ${fmtDate(Math.max(...times))}`;
  }, [commits]);

  // Whole-repo branch overview: client-side group commits by repo_branch,
  // compute conserved efficiency% per branch (Σ ancient / Σ real). Only shown
  // in whole-repo scope (no branch filter). Sorted by commit count desc.
  const branchSummary = useMemo(() => {
    if (currentBranch !== "") return [];
    const map = new Map<
      string,
      { branch: string; count: number; diffLines: number; realMin: number; ancientMin: number }
    >();
    for (const c of commits) {
      const b = commitBranch(c);
      const key = b || "(unlabeled)";
      let row = map.get(key);
      if (!row) {
        row = { branch: b, count: 0, diffLines: 0, realMin: 0, ancientMin: 0 };
        map.set(key, row);
      }
      row.count += 1;
      row.diffLines += c.diff_lines || 0;
      row.realMin += commitReal(c) || 0;
      row.ancientMin += commitAncient(c) || 0;
    }
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        effRatio: r.realMin > 0 ? ((r.ancientMin - r.realMin) / r.realMin) * 100 : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [commits, currentBranch]);

  // Trend chart: two conserved series — weekly efficiency% and weekly commit
  // count. efficiency_pct is already a percentage (rendered directly); commit
  // count is a raw count.
  const trendData: MultiTrendPoint[] = useMemo(
    () =>
      (trendQ.data?.data ?? []).map((p: EntityTrendPoint) => ({
        label: p.week_start,
        efficiency: p.efficiency_pct,
        commits: p.commit_count,
      })),
    [trendQ.data?.data],
  );
  const trendSeries: MultiTrendSeries[] = [
    { key: "efficiency", name: "提效比", color: "var(--chart-1)" },
    { key: "commits", name: "Commit 数", color: "var(--chart-2)" },
  ];

  const subtitle = repoAddr || "-";

  return (
    <DetailShell
      onBack={onBack}
      title="仓库详情"
      subtitle={subtitle}
      headerExtra={
        <>
          <PeriodSelect
            value={effectiveStartDate}
            onChange={(range) => setTimeRange(range)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAddToProjectOpen(true)}
            disabled={!detailQ.data}
          >
            <Plus className="h-3.5 w-3.5" />
            添加到项目
          </Button>
          {branches.length > 0 ? (
            <Select value={selectValue} onValueChange={handleBranchChange}>
              <SelectTrigger size="sm" className="w-[200px]" aria-label="切换分支">
                <SelectValue placeholder="全部分支（整仓）" />
              </SelectTrigger>
              <SelectContent>
                {/* "" = whole-repo scope: backend returns all branches. */}
                <SelectItem value={ALL_BRANCHES}>全部分支（整仓）</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </>
      }
      loading={detailQ.isLoading}
      error={detailQ.error}
      empty={!detailQ.data ? "暂无该仓库数据" : undefined}
    >
      {/* KPI grid: efficiency + AI share + volume + cost. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile
          label="提效比"
          value={formatPercent(efficiency?.efficiency_ratio)}
          hint={efficiency?.efficiency_ratio != null ? "传统预估与实际耗时的提升百分比" : undefined}
        />
        <KpiTile
          label="传统开发时长预估"
          value={formatDuration(efficiency?.repo_ancient_minutes)}
          hint={efficiency?.repo_ancient_minutes_reason || undefined}
        />
        <KpiTile
          label="实际耗时"
          value={formatDuration(efficiency?.repo_real_minutes)}
          hint={efficiency?.repo_real_minutes_reason || undefined}
        />
        <KpiTile
          label="AI 代码占比"
          value={formatV2Ratio(detailQ.data?.summary?.ai_code_ratio)}
        />
        <KpiTile label="代码行数" value={totalDiffLines > 0 ? `${totalDiffLines.toLocaleString()} 行` : "-"} />
        <KpiTile
          label="总费用（task）"
          value={totalCost > 0 ? `${fmtCost(totalCost)} 元` : "-"}
          hint={totalTokens > 0 ? `${totalTokens.toLocaleString()} Tokens` : undefined}
        />
      </section>

      {/* Basic info. */}
      <Panel title="基础信息">
        <KvGrid>
          <Kv label="仓库地址" wide mono>{repoAddr || "-"}</Kv>
          <Kv label="分支" mono>{currentBranch || "全部分支"}</Kv>
          <Kv label="活跃时间">{activityRange}</Kv>
          <Kv label="Commit 数">{formatNumber(commits.length)}</Kv>
          <Kv label="task 数">{formatNumber(tasks.length)}</Kv>
          <Kv label="总 Tokens">{totalTokens > 0 ? totalTokens.toLocaleString() : "-"}</Kv>
          <Kv label="贡献者">{contributorCount > 0 ? `${contributorCount} 人` : "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Branch overview (whole-repo scope only). */}
      {currentBranch === "" && branchSummary.length > 0 && (
        <Panel
          title="分支一览"
          hint={`${branchSummary.length} 个分支`}
          bodyClassName="overflow-x-auto"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <Th>分支</Th>
                <ThNum>Commit 数</ThNum>
                <ThNum>代码行数</ThNum>
                <ThNum>实际耗时</ThNum>
                <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                  提效比
                </th>
              </tr>
            </thead>
            <tbody>
              {branchSummary.map((b) => (
                <tr
                  key={b.branch || "__unlabeled__"}
                  onClick={() => b.branch && handleBranchChange(b.branch)}
                  className={`border-b text-card-foreground last:border-0 ${
                    b.branch ? "cursor-pointer hover:bg-muted/50" : ""
                  }`}
                >
                  <Td>
                    <span className="font-mono break-all text-primary" title={b.branch || "(unlabeled)"}>
                      {b.branch || "（未标注分支）"}
                    </span>
                  </Td>
                  <TdNum>{formatNumber(b.count)}</TdNum>
                  <TdNum>{b.diffLines.toLocaleString()}</TdNum>
                  <TdNum>{formatDuration(b.realMin)}</TdNum>
                  <td className="px-3 py-2 text-center align-middle">
                    {b.effRatio != null ? (
                      <PercentPill value={b.effRatio} />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Commits table (sortable). */}
      <Panel title="Commit 列表" hint={`${commits.length} 条`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <Th>Commit ID</Th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                <SortHeader
                  label="时间"
                  active={commitSort?.field === "commitTime"}
                  desc={commitSort?.field === "commitTime" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "commitTime"))}
                />
              </th>
              <Th>用户</Th>
              {currentBranch === "" && <Th>分支</Th>}
              <Th>说明</Th>
              <ThNum>
                <SortHeader
                  label="代码行数"
                  active={commitSort?.field === "diffLines"}
                  desc={commitSort?.field === "diffLines" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "diffLines"))}
                />
              </ThNum>
              <ThNum>
                <SortHeader
                  label="实际耗时"
                  active={commitSort?.field === "commitReal"}
                  desc={commitSort?.field === "commitReal" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "commitReal"))}
                />
              </ThNum>
              <ThNum>
                <SortHeader
                  label="传统开发时长预估"
                  active={commitSort?.field === "commitAncient"}
                  desc={commitSort?.field === "commitAncient" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "commitAncient"))}
                />
              </ThNum>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                <SortHeader
                  label="AI 代码占比"
                  active={commitSort?.field === "silica"}
                  desc={commitSort?.field === "silica" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "silica"))}
                />
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                <SortHeader
                  label="提效比"
                  active={commitSort?.field === "efficiencyRatio"}
                  desc={commitSort?.field === "efficiencyRatio" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "efficiencyRatio"))}
                />
              </th>
              <ThNum>
                <SortHeader
                  label="费用"
                  active={commitSort?.field === "cost"}
                  desc={commitSort?.field === "cost" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "cost"))}
                />
              </ThNum>
              <ThNum>
                <SortHeader
                  label="Tokens 消耗"
                  active={commitSort?.field === "tokens"}
                  desc={commitSort?.field === "tokens" && commitSort.desc}
                  onClick={() => setCommitSort((p) => cycle(p, "tokens"))}
                />
              </ThNum>
            </tr>
          </thead>
          <tbody>
            {sortedCommits.length === 0 ? (
              <EmptyRow colSpan={currentBranch === "" ? 11 : 10}>暂无 Commit 数据</EmptyRow>
            ) : (
              sortedCommits.map((c) => {
                const eff = commitEffRatio(c);
                const tokens = tokenSum(c.upstream_tokens, c.downstream_tokens);
                return (
                  <tr
                    key={c.commit_id}
                    onClick={() => push(paths.metricsCommitDetail(c.commit_id))}
                    className="cursor-pointer border-b text-card-foreground hover:bg-muted/50 last:border-0"
                  >
                    <Td>
                      <span className="font-mono text-xs" title={c.commit_id}>
                        {shortId(c.commit_id, 8)}
                      </span>
                    </Td>
                    <Td>{formatLocalTime(c.commit_time)}</Td>
                    <Td>
                      <span className="block max-w-[140px] truncate" title={c.git_user_name ?? ""}>
                        {c.git_user_name || "-"}
                      </span>
                    </Td>
                    {currentBranch === "" && (
                      <Td>
                        <span
                          className="block max-w-[160px] truncate font-mono text-xs"
                          title={commitBranch(c)}
                        >
                          {commitBranch(c) || "-"}
                        </span>
                      </Td>
                    )}
                    <Td>
                      <span className="block max-w-[260px] truncate" title={c.comment ?? ""}>
                        {c.comment || "-"}
                      </span>
                    </Td>
                    <TdNum>{c.diff_lines ?? 0}</TdNum>
                    <TdNum>{formatDuration(commitReal(c))}</TdNum>
                    <TdNum>{formatDuration(commitAncient(c))}</TdNum>
                    <td className="px-3 py-2 text-center align-middle">
                      {c.silica != null ? (
                        <ToneBadge tone={aiCodeRatioTone(c.silica)}>
                          {formatV2Ratio(c.silica)}
                        </ToneBadge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center align-middle">
                      {eff != null ? <PercentPill value={eff} /> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <TdNum>{c.cost != null && c.cost > 0 ? fmtCost(c.cost) : "-"}</TdNum>
                    <TdNum>{tokens > 0 ? tokens.toLocaleString() : "-"}</TdNum>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Panel>

      {/* Tasks table (only when present). */}
      {tasks.length > 0 && (
        <Panel title="task 列表" hint={`${tasks.length} 条`} bodyClassName="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <Th>task ID</Th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">
                  <SortHeader
                    label="时间"
                    active={taskSort?.field === "startTime"}
                    desc={taskSort?.field === "startTime" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "startTime"))}
                  />
                </th>
                <Th>用户</Th>
                <Th>说明</Th>
                <ThNum>
                  <SortHeader
                    label="代码行数"
                    active={taskSort?.field === "diffLines"}
                    desc={taskSort?.field === "diffLines" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "diffLines"))}
                  />
                </ThNum>
                <ThNum>
                  <SortHeader
                    label="实际耗时"
                    active={taskSort?.field === "taskReal"}
                    desc={taskSort?.field === "taskReal" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "taskReal"))}
                  />
                </ThNum>
                <ThNum>
                  <SortHeader
                    label="传统开发时长预估"
                    active={taskSort?.field === "taskAncient"}
                    desc={taskSort?.field === "taskAncient" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "taskAncient"))}
                  />
                </ThNum>
                <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                  <SortHeader
                    label="提效比"
                    active={taskSort?.field === "efficiencyRatio"}
                    desc={taskSort?.field === "efficiencyRatio" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "efficiencyRatio"))}
                  />
                </th>
                <ThNum>
                  <SortHeader
                    label="费用"
                    active={taskSort?.field === "cost"}
                    desc={taskSort?.field === "cost" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "cost"))}
                  />
                </ThNum>
                <ThNum>
                  <SortHeader
                    label="Tokens 消耗"
                    active={taskSort?.field === "tokens"}
                    desc={taskSort?.field === "tokens" && taskSort.desc}
                    onClick={() => setTaskSort((p) => cycle(p, "tokens"))}
                  />
                </ThNum>
              </tr>
            </thead>
            <tbody>
              {sortedTasks.map((t) => {
                const eff = taskEffRatio(t);
                const tokens = tokenSum(t.upstream_tokens, t.downstream_tokens);
                return (
                  <tr
                    key={t.task_id}
                    onClick={() => push(paths.metricsTaskDetail(t.task_id))}
                    className="cursor-pointer border-b text-card-foreground hover:bg-muted/50 last:border-0"
                  >
                    <Td>
                      <span className="font-mono text-xs" title={t.task_id}>
                        {shortId(t.task_id, 8)}
                      </span>
                    </Td>
                    <Td>{formatLocalTime(t.start_time)}</Td>
                    <Td>
                      <span className="block max-w-[140px] truncate" title={t.user_name ?? ""}>
                        {t.user_name || "-"}
                      </span>
                    </Td>
                    <Td>
                      <span className="block max-w-[260px] truncate" title={t.title ?? ""}>
                        {t.title || "-"}
                      </span>
                    </Td>
                    <TdNum>{t.diff_lines ?? 0}</TdNum>
                    <TdNum>{formatDuration(taskReal(t))}</TdNum>
                    <TdNum>{formatDuration(taskAncient(t))}</TdNum>
                    <td className="px-3 py-2 text-center align-middle">
                      {eff != null ? <PercentPill value={eff} /> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <TdNum>{t.cost != null && t.cost > 0 ? fmtCost(t.cost) : "-"}</TdNum>
                    <TdNum>{tokens > 0 ? tokens.toLocaleString() : "-"}</TdNum>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Weekly trend (efficiency% + commit count). */}
      <Panel title="周趋势" hint="每周提效比 / Commit 数">
        {trendData.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">暂无趋势数据</div>
        ) : (
          <MultiTrendChart data={trendData} series={trendSeries} />
        )}
      </Panel>

      {detailQ.data && (
        <AddRepoToProjectDialog
          open={addToProjectOpen}
          onOpenChange={setAddToProjectOpen}
          wsId={wsId}
          repoAddr={repoAddr}
          repoBranch={currentBranch}
          commits={commits}
          startDate={effectiveStartDate}
          endDate={effectiveEndDate}
        />
      )}
    </DetailShell>
  );
}

// ====================== Add to project dialog ======================
// Two-phase: select/create a target project → checkProjectConflicts against
// the in-scope commit_ids → if conflicts, list them and let the user add
// anyway; otherwise addRepoToProject. Optional whitelist mode limits the repo
// source to explicitly selected commits.

const NEW_PROJECT_VALUE = "__new__";

function AddRepoToProjectDialog({
  open,
  onOpenChange,
  wsId,
  repoAddr,
  repoBranch,
  commits,
  startDate,
  endDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  repoAddr: string;
  repoBranch: string;
  commits: RepoCommitItem[];
  startDate?: string;
  endDate?: string;
}) {
  const projectsQ = useQuery(projectListOptions(wsId, startDate, endDate));
  const createProject = useCreateProject();
  const checkConflicts = useCheckProjectConflicts();
  const addRepo = useAddRepoToProject();

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [whitelistMode, setWhitelistMode] = useState(false);
  const [whitelist, setWhitelist] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<ProjectConflict[]>([]);
  const [conflictsChecked, setConflictsChecked] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedProjectId("");
    setNewName("");
    setNewDesc("");
    setWhitelistMode(false);
    setWhitelist(new Set());
    setConflicts([]);
    setConflictsChecked(false);
    setErr("");
  }, [open]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
  }

  function getTargetCommitIds(): string[] {
    if (whitelistMode) {
      return commits
        .filter((commit) => whitelist.has(commit.commit_id))
        .map((commit) => commit.commit_id);
    }
    return commits
      .filter((commit) => {
        const date = (commit.commit_time || "").slice(0, 10);
        if (!date) return false;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      })
      .map((commit) => commit.commit_id);
  }

  function resetConflictCheck() {
    setConflicts([]);
    setConflictsChecked(false);
  }

  function toggleWhitelist(commitId: string) {
    setWhitelist((previous) => {
      const next = new Set(previous);
      if (next.has(commitId)) next.delete(commitId);
      else next.add(commitId);
      return next;
    });
    resetConflictCheck();
  }

  async function doAdd() {
    setErr("");
    let projectId = selectedProjectId;
    if (selectedProjectId === NEW_PROJECT_VALUE) {
      if (!newName.trim()) {
        setErr("请输入新项目名称");
        return;
      }
      try {
        const created = await createProject.mutateAsync({
          name: newName.trim(),
          description: newDesc.trim(),
        });
        projectId = created.project_id;
        if (!projectId) {
          setErr("创建项目后未返回项目 ID");
          return;
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "无法创建项目");
        return;
      }
    }
    try {
      await addRepo.mutateAsync({
        projectId,
        body: {
          repo_addr: repoAddr,
          repo_branch: repoBranch,
          start_time: null,
          end_time: null,
          include_only_commits: whitelistMode ? getTargetCommitIds() : [],
          exclude_commits: [],
        },
      });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "无法添加仓库");
    }
  }

  async function handleConfirm() {
    if (!selectedProjectId) {
      setErr("请选择目标项目");
      return;
    }
    if (selectedProjectId === NEW_PROJECT_VALUE && !newName.trim()) {
      setErr("请输入新项目名称");
      return;
    }
    // Phase 1: conflict check (skip if already checked).
    if (!conflictsChecked) {
      const targets = getTargetCommitIds();
      if (targets.length === 0) {
        setErr("没有可添加的 Commit");
        return;
      }
      setErr("");
      try {
        const res = await checkConflicts.mutateAsync({ commit_ids: targets });
        const found = res.conflicts ?? [];
        setConflicts(found);
        setConflictsChecked(true);
        if (found.length > 0) {
          // Conflicts → stop and let the user "add anyway".
          return;
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "无法完成冲突检测");
        return;
      }
    }
    // Phase 2: no conflicts (or user confirmed) → add.
    await doAdd();
  }

  const hasConflict = conflictsChecked && conflicts.length > 0;
  const busy =
    createProject.isPending ||
    checkConflicts.isPending ||
    addRepo.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>添加到项目</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {err && <ErrorBanner message={err} />}
          <Field label="目标项目">
            <Select
              value={selectedProjectId}
              onValueChange={(v) => {
                setSelectedProjectId(v ?? "");
                resetConflictCheck();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PROJECT_VALUE}>+ 新建项目</SelectItem>
                {(projectsQ.data ?? []).map((p: ProjectListItem) => (
                  <SelectItem key={p.project_id} value={p.project_id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedProjectId === NEW_PROJECT_VALUE && (
            <>
              <Field label="名称">
                <Input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </Field>
              <Field label="描述">
                <Textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </Field>
            </>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={whitelistMode}
              onCheckedChange={(checked) => {
                setWhitelistMode(checked === true);
                resetConflictCheck();
              }}
            />
            仅包含指定 Commit（白名单）
          </label>
          {whitelistMode && (
            <div className="max-h-[300px] overflow-auto rounded-lg border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b">
                    <th className="w-10 px-3 py-2" />
                    <Th>Commit ID</Th>
                    <Th>说明</Th>
                    <Th>用户</Th>
                    <Th>时间</Th>
                    <ThNum>代码行数</ThNum>
                  </tr>
                </thead>
                <tbody>
                  {commits.map((commit) => (
                    <tr
                      key={commit.commit_id}
                      className="border-b text-card-foreground last:border-0"
                    >
                      <td className="px-3 py-2 text-center">
                        <Checkbox
                          checked={whitelist.has(commit.commit_id)}
                          onCheckedChange={() => toggleWhitelist(commit.commit_id)}
                          aria-label={`选择 ${commit.commit_id}`}
                        />
                      </td>
                      <Td>
                        <span className="font-mono text-xs">
                          {shortId(commit.commit_id, 8)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="block max-w-[200px] truncate"
                          title={commit.comment ?? ""}
                        >
                          {commit.comment || "-"}
                        </span>
                      </Td>
                      <Td>{commit.git_user_name || "-"}</Td>
                      <Td>{formatLocalTime(commit.commit_time)}</Td>
                      <TdNum>{commit.diff_lines ?? 0}</TdNum>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            将仓库 <span className="font-mono">{repoAddr}</span>
            {repoBranch ? ` @ ${repoBranch}` : "（全部分支）"}添加为项目数据源，
            当前范围包含 {getTargetCommitIds().length} 条 Commit。
          </div>
          {hasConflict && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <div className="mb-1 font-medium">
                以下 Commit 已属于其他项目：
              </div>
              <ul className="space-y-0.5">
                {conflicts.map((c) => (
                  <li key={c.commit_id} className="font-mono text-xs">
                    {shortId(c.commit_id, 8)} → {c.project_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          {hasConflict ? (
            <Button
              type="button"
              disabled={busy}
              onClick={doAdd}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {busy ? "添加中..." : "仍然添加"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={handleConfirm}
            >
              {busy ? "处理中..." : "确认"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ---- table sort (null sinks to bottom; matches source sortRows) ----

function commitSortValue(row: RepoCommitItem, field: SortField): number | null {
  switch (field) {
    case "commitTime":
      return row.commit_time ? new Date(row.commit_time).getTime() : null;
    case "diffLines":
      return row.diff_lines ?? null;
    case "commitReal":
      return commitReal(row) ?? null;
    case "commitAncient":
      return commitAncient(row) ?? null;
    case "silica":
      return row.silica ?? null;
    case "efficiencyRatio":
      return commitEffRatio(row);
    case "cost":
      return row.cost ?? null;
    case "tokens": {
      const t = tokenSum(row.upstream_tokens, row.downstream_tokens);
      return t > 0 ? t : null;
    }
    default:
      return null;
  }
}

function taskSortValue(row: TaskListItem, field: SortField): number | null {
  switch (field) {
    case "startTime":
      return row.start_time ? new Date(row.start_time).getTime() : null;
    case "diffLines":
      return row.diff_lines ?? null;
    case "taskReal":
      return taskReal(row) ?? null;
    case "taskAncient":
      return taskAncient(row) ?? null;
    case "efficiencyRatio":
      return taskEffRatio(row);
    case "cost":
      return row.cost ?? null;
    case "tokens": {
      const t = tokenSum(row.upstream_tokens, row.downstream_tokens);
      return t > 0 ? t : null;
    }
    default:
      return null;
  }
}

function sortCommits(rows: RepoCommitItem[], sort: SortState | null): RepoCommitItem[] {
  if (!sort) return rows;
  const get = (r: RepoCommitItem) => commitSortValue(r, sort.field);
  return [...rows].sort((a, b) => compareNullLast(get(a), get(b), sort.desc));
}
function sortTasks(rows: TaskListItem[], sort: SortState | null): TaskListItem[] {
  if (!sort) return rows;
  const get = (r: TaskListItem) => taskSortValue(r, sort.field);
  return [...rows].sort((a, b) => compareNullLast(get(a), get(b), sort.desc));
}

/** Null/undefined sinks to the bottom in BOTH ascending and descending order. */
function compareNullLast(
  a: number | null,
  b: number | null,
  desc: boolean,
): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // a is null → after b
  if (bNull) return -1; // b is null → after a
  return desc ? (b as number) - (a as number) : (a as number) - (b as number);
}

// ---- small presentational helpers ----

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <KpiCard label={label} value={value} hint={hint} />
    </div>
  );
}

/**
 * Percentage-ratio pill (gain %). Source had a dedicated PercentPill with
 * pos/neg/neutral colour classes; we inline a tone-coloured span (semantic
 * tokens only — no hardcoded colours) so the table stays free of extra deps.
 * Input is already a percentage (e.g. 300 = 300%).
 */
function PercentPill({ value }: { value: number }) {
  const tone =
    value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex tabular-nums font-medium ${tone}`}>
      {`${Math.round(value)}%`}
    </span>
  );
}

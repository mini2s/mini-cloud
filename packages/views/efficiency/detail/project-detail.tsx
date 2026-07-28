"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  fmtCost,
  formatV2Ratio,
  needRepoOptionsOptions,
  projectDetailOptions,
  projectNeedsOptions,
  projectTrendOptions,
  useAddRepoToProject,
  useDeleteProject,
  useRemoveRepoFromProject,
  useUpdateProject,
  useUpdateProjectNeedSelection,
  type EntityTrendPoint,
  type NeedRepoOption,
  type ProjectDetailResponse,
  type ProjectNeedItem,
  type ProjectRepo,
  PERSON_DAY_MINUTES,
  useUserNameMap,
} from "@multica/core/efficiency";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { KpiCard } from "../../runtimes/components/shared";
import { MultiTrendChart, type MultiTrendPoint, type MultiTrendSeries } from "../charts";
import { Th, ThNum, Td, TdNum } from "../usage/shared";
import { DetailShell } from "./detail-shell";
import { EmptyRow, ErrorBanner, Kv, KvGrid, Panel, ToneBadge } from "./shared";
import { useNavigation } from "../../navigation";

// Project detail page — the second-largest efficiency drill-down. Ports the
// source ProjectDetail (Need/branch scope) to the shared-views layer: KPI grid
// + needs composition table + repo source chips + contributors (conserved
// derivation) + weekly trend, with full CRUD wired through the mock-aware
// mutation hooks (edit project, delete, add/remove repo source, per-need
// include/exclude).
//
// Caliber (matches source — these are the footguns the source comments call
// out, all carried over verbatim):
//   - need_calendar_efficiency_ratio / need_work_efficiency_ratio are DECIMAL
//     ratios (2.85 = 285%) → formatV2Ratio (×100). The source used RatioPill.
//   - need_ai_code_ratio is a DECIMAL ratio (0..1) → formatV2Ratio.
//   - Per-need efficiency_ratio / work_efficiency_ratio / ai_code_ratio are
//     DECIMAL ratios → formatV2Ratio.
//   - need_actual_work_min / need_actual_calendar_min are MINUTES; the "actual
//     work" KPI shows person-days (÷480).
//   - Contributors are DERIVED client-side from the selected (non-excluded)
//     clean Needs, conservatively aggregated (Σ baseline / Σ actual per scope),
//     NOT averaged. Per-scope outlier Needs are excluded from that scope only.
//   - isZeroTime: backend zero-value timestamps start with "0001-" → render "—".
//
// Mutations (all mock-aware; see core/efficiency/mutations.ts):
//   - useUpdateProject — edit name/description (must echo repos back as-is).
//   - useDeleteProject — delete the project (caller's onDeleted navigates away).
//   - useAddRepoToProject — append a repo source filter (sequentially, not
//     parallel — backend read→append→write has no transaction).
//   - useRemoveRepoFromProject — remove a repo source by array index.
//   - useUpdateProjectNeedSelection — include/exclude a single need.
// Each invalidates projectDetail + projectNeeds + projectList so the
// post-mutation refetch lands the new state.

interface ProjectDetailProps {
  projectId: string;
  /** Optional date window (YYYY-MM-DD). When absent the backend defaults. */
  startDate?: string;
  endDate?: string;
  /** Back navigation — owned by the route page (e.g. router.back()). */
  onBack: () => void;
  /** Invoked after a successful delete — the route page navigates to the list. */
  onDeleted?: () => void;
}

const WORK_MIN_PER_DAY = PERSON_DAY_MINUTES; // 480

function isZeroTime(s: string | null | undefined): boolean {
  return !s || String(s).startsWith("0001-");
}
function fmtDate(s: string | null | undefined): string {
  return isZeroTime(s) ? "—" : String(s).slice(0, 10);
}

interface Contributor {
  user_id: string;
  needCount: number;
  loc: number;
  aiLoc: number;
  baseCal: number;
  actCal: number;
  baseWork: number;
  actWork: number;
  calRatio: number | null;
  workRatio: number | null;
  aiRatio: number | null;
}

export function ProjectDetail({
  projectId,
  startDate,
  endDate,
  onBack,
  onDeleted,
}: ProjectDetailProps) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();

  const detailQ = useQuery(projectDetailOptions(wsId, projectId));
  const needsQ = useQuery(projectNeedsOptions(wsId, projectId));
  const trendQ = useQuery(
    projectTrendOptions(wsId, { projectId, startDate, endDate }),
  );

  const data: ProjectDetailResponse | undefined = detailQ.data;
  const project = data?.project;
  const repos: ProjectRepo[] = useMemo(() => project?.repos ?? [], [project]);
  const projectNeeds: ProjectNeedItem[] = useMemo(
    () => needsQ.data?.data ?? [],
    [needsQ.data?.data],
  );

  // Mutation hooks (mock-aware). Each invalidates the right caches on success.
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const addRepo = useAddRepoToProject();
  const removeRepo = useRemoveRepoFromProject();
  const updateNeedSel = useUpdateProjectNeedSelection();

  // Dialog state.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [removeSource, setRemoveSource] = useState<{
    index: number;
    repo: ProjectRepo;
  } | null>(null);

  // Contributors: client-side conserved derivation from the selected
  // (non-excluded) Needs, per-scope outlier handling (matches source §4).
  const contributors = useMemo<Contributor[]>(() => {
    const m = new Map<string, Contributor>();
    for (const n of projectNeeds) {
      if (n.excluded) continue;
      const uid = n.primary_user_id || "未知";
      let c = m.get(uid);
      if (!c) {
        c = {
          user_id: uid,
          needCount: 0,
          loc: 0,
          aiLoc: 0,
          baseCal: 0,
          actCal: 0,
          baseWork: 0,
          actWork: 0,
          calRatio: null,
          workRatio: null,
          aiRatio: null,
        };
        m.set(uid, c);
      }
      c.needCount += 1;
      if (n.coverage_eligible && !n.calendar_outlier_flag) {
        c.baseCal += n.baseline_calendar_min || 0;
        c.actCal += n.total_calendar_min || 0;
      }
      if (n.coverage_eligible && !n.work_outlier_flag) {
        c.baseWork += n.baseline_fused_work_min || 0;
        c.actWork += n.total_active_work_corrected_min || 0;
      }
      if (n.coverage_eligible && !n.outlier_flag && (n.total_loc_net || 0) > 0) {
        c.loc += n.total_loc_net || 0;
        c.aiLoc += n.ai_covered_loc || 0;
      }
    }
    const rows = Array.from(m.values());
    for (const c of rows) {
      c.calRatio = v2ratio(c.baseCal, c.actCal);
      c.workRatio = v2ratio(c.baseWork, c.actWork);
      c.aiRatio = c.loc > 0 ? c.aiLoc / c.loc : null;
    }
    rows.sort((a, b) => b.needCount - a.needCount || b.loc - a.loc);
    return rows;
  }, [projectNeeds]);

  const calR = data?.need_calendar_efficiency_ratio;
  const workR = data?.need_work_efficiency_ratio;
  const actualPersonDays =
    data?.need_actual_work_min != null ? data.need_actual_work_min / WORK_MIN_PER_DAY : null;
  const calPersonDays =
    data?.need_actual_calendar_min != null
      ? data.need_actual_calendar_min / WORK_MIN_PER_DAY
      : null;

  const dateRange =
    project && !isZeroTime(project.start_time_manual ?? project.start_time)
      ? `${fmtDate(project.start_time_manual ?? project.start_time)} ~ ${
          isZeroTime(project.end_time_manual ?? project.end_time)
            ? "至今"
            : fmtDate(project.end_time_manual ?? project.end_time)
        }`
      : "—";

  // Trend: weekly efficiency% + need count. efficiency_pct is already a
  // percentage (project scope = weekly Σbaseline/Σactual conserved); need_count
  // is a raw weekly count.
  const trendData: MultiTrendPoint[] = useMemo(
    () =>
      (trendQ.data?.data ?? []).map((p: EntityTrendPoint) => ({
        label: p.week_start,
        efficiency: p.efficiency_pct,
        needs: p.need_count,
      })),
    [trendQ.data?.data],
  );
  const trendSeries: MultiTrendSeries[] = [
    { key: "efficiency", name: "提效比", color: "var(--chart-1)" },
    { key: "needs", name: "需求数", color: "var(--chart-2)" },
  ];

  // Per-need include/exclude handler. The checkbox optimistically reflects the
  // new state (React Query will refetch on invalidate); the mutation toggles
  // `excluded`.
  function handleToggleNeed(n: ProjectNeedItem) {
    updateNeedSel.mutate({
      projectId,
      body: {
        repo_addr: n.repo_addr,
        repo_branch: n.repo_branch,
        need_id: n.need_id,
        excluded: !n.excluded,
      },
    });
  }

  return (
    <DetailShell
      onBack={onBack}
      title={project?.name || "项目详情"}
      subtitle={project?.description || projectId}
      headerExtra={
        <>
          <ToneBadge tone="neutral">{dateRange}</ToneBadge>
          <ToneBadge tone="neutral">
            {data?.need_total_count ?? projectNeeds.length} 个需求
          </ToneBadge>
          <ToneBadge tone="neutral">{contributors.length} 位贡献者</ToneBadge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSourceOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            添加来源
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            disabled={!project}
          >
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={!project}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </>
      }
      loading={detailQ.isLoading}
      error={detailQ.error}
      empty={!detailQ.data?.project ? "暂无项目数据。" : undefined}
    >
      {/* KPI grid (Need/branch scope, conserved; clean Needs only). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile
          label="日历提效比"
          value={formatV2Ratio(calR)}
          hint="仅统计干净需求"
        />
        <KpiTile
          label="工作量提效比"
          value={formatV2Ratio(workR)}
          hint="融合基线与实际活跃工时"
        />
        <KpiTile
          label="AI 代码占比"
          value={formatV2Ratio(data?.need_ai_code_ratio)}
        />
        <KpiTile
          label="实际工时"
          value={actualPersonDays != null ? `${actualPersonDays.toFixed(1)} 人天` : "—"}
          hint={calPersonDays != null ? `日历跨度 ${calPersonDays.toFixed(1)} 人天` : undefined}
        />
        <KpiTile
          label="生成代码"
          value={data?.need_total_loc_net != null ? `${data.need_total_loc_net.toLocaleString()} 行` : "—"}
        />
        <KpiTile
          label="合格 / 候选需求"
          value={`${data?.need_eligible_count ?? 0} / ${data?.need_total_count ?? 0}`}
          hint={`自动剔除 ${data?.need_excluded_count ?? 0}`}
        />
        <KpiTile
          label="费用"
          value={data?.need_cost != null && data.need_cost > 0 ? `¥${fmtCost(data.need_cost)}` : "¥0"}
          hint={`Token 上 ${Math.round((data?.need_upstream_tokens ?? 0) / 1000)}k · 下 ${Math.round(
            (data?.need_downstream_tokens ?? 0) / 1000,
          )}k`}
        />
      </section>

      {/* Basic info. */}
      <Panel title="基础信息">
        <KvGrid>
          <Kv label="项目 ID" mono>{projectId}</Kv>
          <Kv label="名称">{project?.name || "-"}</Kv>
          <Kv label="描述" wide>{project?.description || "-"}</Kv>
          <Kv label="日期范围">{dateRange}</Kv>
          <Kv label="创建时间">{fmtDate(project?.created_at)}</Kv>
          <Kv label="更新时间">{fmtDate(project?.updated_at)}</Kv>
          <Kv label="来源仓库">{repos.length || "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Needs composition (main table) with per-need include/exclude. */}
      <Panel
        title="组成 · 需求"
        hint={`候选 ${data?.need_total_count ?? projectNeeds.length} · 合格 ${data?.need_eligible_count ?? 0}`}
        bodyClassName="overflow-x-auto"
      >
        {/* Source-rule chips with remove buttons. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">需求来源：</span>
          {repos.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              未配置（点击"添加来源"按仓库或分支纳入需求）
            </span>
          ) : (
            repos.map((r, i) => (
              <ToneBadge key={`${r.repo_addr}#${r.repo_branch}#${i}`} tone="info">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="font-mono"
                    title={`${r.repo_addr}${r.repo_branch ? ` @ ${r.repo_branch}` : " @ 全部分支"}`}
                  >
                    {shortRepo(r.repo_addr)}
                    {r.repo_branch ? ` @ ${r.repo_branch}` : " @ 全部分支"}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除来源 ${r.repo_addr}`}
                    onClick={() => setRemoveSource({ index: i, repo: r })}
                    className="text-muted-foreground hover:text-destructive focus:outline-none"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </ToneBadge>
            ))
          )}
        </div>

        {(needsQ.data?.stale_count ?? 0) > 0 && (
          <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            配置中有 {needsQ.data?.stale_count} 个需求因重算失效（need_id
            已变化），不再影响聚合。
          </div>
        )}

        {needsQ.error || updateNeedSel.error ? (
          <div className="mb-3">
            <ErrorBanner
              message={
                (needsQ.error as Error | null)?.message ||
                (updateNeedSel.error as Error | null)?.message ||
                "无法更新项目需求"
              }
            />
          </div>
        ) : null}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                纳入
              </th>
              <Th>需求</Th>
              <Th>分支</Th>
              <Th>边界源</Th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                日历提效比
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                工作量提效比
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                AI 占比
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                状态
              </th>
              <ThNum>代码行</ThNum>
            </tr>
          </thead>
          <tbody>
            {needsQ.isLoading ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  加载中...
                </td>
              </tr>
            ) : projectNeeds.length === 0 ? (
              <EmptyRow colSpan={9}>
                候选池内暂无需求，请先添加来源。
              </EmptyRow>
            ) : (
              projectNeeds.map((n) => {
                const busy =
                  updateNeedSel.isPending &&
                  updateNeedSel.variables?.body.need_id === n.need_id;
                return (
                  <tr
                    key={n.need_id}
                    className={`border-b text-card-foreground last:border-0 ${n.excluded ? "opacity-40" : ""}`}
                  >
                    <td className="px-3 py-2 text-center align-middle">
                      <Checkbox
                        checked={!n.excluded}
                        disabled={busy}
                        onCheckedChange={() => handleToggleNeed(n)}
                        aria-label={
                          n.excluded
                            ? `纳入需求 ${n.repo_branch}`
                            : `排除需求 ${n.repo_branch}`
                        }
                      />
                    </td>
                    <Td>
                      <button
                        type="button"
                        className="font-mono break-all text-left text-xs text-primary hover:underline"
                        title={n.need_id}
                        onClick={() => push(paths.metricsNeedDetail(n.need_id))}
                      >
                        {n.need_id.length > 30 ? `${n.need_id.slice(0, 30)}…` : n.need_id}
                      </button>
                    </Td>
                    <Td>{n.repo_branch || "-"}</Td>
                    <Td>
                      <span className="text-xs text-muted-foreground">{n.boundary_source || "-"}</span>
                    </Td>
                    <td className="px-3 py-2 text-center align-middle">
                      <DecimalPill value={n.efficiency_ratio} />
                    </td>
                    <td className="px-3 py-2 text-center align-middle">
                      <DecimalPill value={n.work_efficiency_ratio} />
                    </td>
                    <td className="px-3 py-2 text-center align-middle">
                      <DecimalPill value={n.ai_code_ratio ?? null} />
                    </td>
                    <td className="px-3 py-2 text-center align-middle">
                      <NeedStatusBadge n={n} />
                    </td>
                    <TdNum>{n.total_loc_net != null ? n.total_loc_net.toLocaleString() : "-"}</TdNum>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Panel>

      {/* Contributors (derived from selected clean Needs). */}
      <Panel title="贡献者" hint={`${contributors.length} 人`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <Th>用户</Th>
              <ThNum>需求数</ThNum>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                日历提效比
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                工作量提效比
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                AI 占比
              </th>
              <ThNum>代码行</ThNum>
            </tr>
          </thead>
          <tbody>
            {contributors.length === 0 ? (
              <EmptyRow colSpan={6}>暂无已选需求的贡献者</EmptyRow>
            ) : (
              contributors.map((c) => (
                <tr key={c.user_id} className="border-b text-card-foreground last:border-0">
                  <Td>
                    {c.user_id && c.user_id !== "未知" ? (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        title={c.user_id}
                        onClick={() => push(paths.metricsUserDetail(c.user_id))}
                      >
                        {resolveName(c.user_id)}
                      </button>
                    ) : (
                      <span title={c.user_id}>{resolveName(c.user_id)}</span>
                    )}
                  </Td>
                  <TdNum>{c.needCount}</TdNum>
                  <td className="px-3 py-2 text-center align-middle">
                    <DecimalPill value={c.calRatio} />
                  </td>
                  <td className="px-3 py-2 text-center align-middle">
                    <DecimalPill value={c.workRatio} />
                  </td>
                  <td className="px-3 py-2 text-center align-middle">
                    <DecimalPill value={c.aiRatio} />
                  </td>
                  <TdNum>{c.loc.toLocaleString()}</TdNum>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      {/* Weekly trend (efficiency% + need count). */}
      <Panel title="周趋势" hint="每周提效比 / 需求数">
        {trendData.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            暂无趋势数据
          </div>
        ) : (
          <MultiTrendChart data={trendData} series={trendSeries} />
        )}
      </Panel>

      {/* ---- Dialogs ---- */}
      {project && (
        <EditProjectDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          name={project.name}
          description={project.description}
          pending={updateProject.isPending}
          error={updateProject.error}
          onSubmit={(name, description) =>
            new Promise<void>((resolve, reject) => {
              updateProject.mutate(
                { projectId, body: { name, description, repos } },
                {
                  onSuccess: () => resolve(),
                  onError: reject,
                },
              );
            })
          }
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="确认删除"
        message={`确定要删除项目"${project?.name ?? ""}"吗？此操作不可撤销。`}
        confirmLabel="删除"
        tone="destructive"
        pending={deleteProject.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() =>
          new Promise<void>((resolve, reject) => {
            deleteProject.mutate(projectId, {
              onSuccess: () => {
                resolve();
                setDeleteOpen(false);
                onDeleted?.();
              },
              onError: reject,
            });
          })
        }
      />

      <ConfirmDialog
        open={!!removeSource}
        title="移除来源"
        message={
          removeSource
            ? `确定要移除需求来源"${removeSource.repo.repo_addr}${removeSource.repo.repo_branch ? ` @ ${removeSource.repo.repo_branch}` : ""}"吗？该来源下的需求将不再计入本项目。`
            : ""
        }
        confirmLabel="移除"
        tone="destructive"
        pending={
          removeRepo.isPending &&
          removeRepo.variables?.index === removeSource?.index
        }
        onOpenChange={(open) => !open && setRemoveSource(null)}
        onConfirm={() => {
          if (!removeSource) return Promise.resolve();
          const idx = removeSource.index;
          return new Promise<void>((resolve, reject) => {
            removeRepo.mutate(
              { projectId, index: idx },
              {
                onSuccess: () => {
                  resolve();
                  setRemoveSource(null);
                },
                onError: reject,
              },
            );
          });
        }}
      />

      <AddSourceDialog
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        wsId={wsId}
        existingRepos={repos}
        pending={addRepo.isPending}
        error={addRepo.error}
        onAdd={async (body) => {
          await addRepo.mutateAsync({ projectId, body });
        }}
      />
    </DetailShell>
  );
}

// ====================== Edit project dialog ======================

function EditProjectDialog({
  open,
  onOpenChange,
  name,
  description,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description?: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setFormName(name);
    setFormDesc(description ?? "");
    setFormErr("");
  }, [open, name, description]);

  async function handleSubmit() {
    if (!formName.trim()) {
      setFormErr("请输入项目名称");
      return;
    }
    setFormErr("");
    try {
      await onSubmit(formName.trim(), formDesc.trim());
      onOpenChange(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "无法保存修改");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑项目</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {formErr && <ErrorBanner message={formErr} />}
          <Field label="项目名称">
            <Input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </Field>
          <Field label="描述">
            <Textarea
              rows={3}
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </Field>
          {error ? (
            <ErrorBanner
              message={(error as Error)?.message || "无法保存修改"}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={pending} onClick={handleSubmit}>
            {pending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================== Add source dialog ======================
// Source repo selector: needs-same-origin normalized addresses with their
// feature branches. Multi-select repos; per-repo "all branches" or "specific"
// mode. Submits sequentially (one addRepoToProject per source/branch) because
// the backend's read→append→write has no transaction — concurrent adds lose
// updates.

type BranchMode = "all" | "specific";
interface RepoSelection {
  mode: BranchMode;
  branches: Set<string>;
}

function AddSourceDialog({
  open,
  onOpenChange,
  wsId,
  existingRepos,
  pending,
  error,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  existingRepos: ProjectRepo[];
  pending: boolean;
  error: unknown;
  onAdd: (body: {
    repo_addr: string;
    repo_branch: string;
    start_time: string | null;
    end_time: string | null;
    exclude_commits: string[];
    include_only_commits: string[];
  }) => Promise<void>;
}) {
  const optionsQ = useQuery({
    ...needRepoOptionsOptions(wsId),
    enabled: open && !!wsId,
  });
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Map<string, RepoSelection>>(
    new Map(),
  );
  const [formErr, setFormErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelection(new Map());
    setFormErr("");
  }, [open]);

  const options: NeedRepoOption[] = optionsQ.data?.data ?? [];
  const existingAddrs = useMemo(
    () => new Set(existingRepos.map((r) => r.repo_addr)),
    [existingRepos],
  );
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return options;
    return options.filter((o) => o.repo_addr.toLowerCase().includes(kw));
  }, [options, search]);

  function toggleRepo(addr: string) {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(addr)) next.delete(addr);
      else next.set(addr, { mode: "all", branches: new Set() });
      return next;
    });
  }
  function setMode(addr: string, mode: BranchMode) {
    setSelection((prev) => {
      const next = new Map(prev);
      const cur = next.get(addr) ?? {
        mode: "all" as const,
        branches: new Set<string>(),
      };
      next.set(addr, { ...cur, mode });
      return next;
    });
  }
  function toggleBranch(addr: string, branch: string) {
    setSelection((prev) => {
      const next = new Map(prev);
      const cur = next.get(addr) ?? {
        mode: "specific" as const,
        branches: new Set<string>(),
      };
      const bs = new Set(cur.branches);
      if (bs.has(branch)) bs.delete(branch);
      else bs.add(branch);
      next.set(addr, { mode: "specific", branches: bs });
      return next;
    });
  }

  const selectedCount = selection.size;

  async function handleSubmit() {
    if (selectedCount === 0) {
      setFormErr("请至少选择一个仓库");
      return;
    }
    for (const [addr, sel] of selection) {
      if (sel.mode === "specific" && sel.branches.size === 0) {
        setFormErr(
          `仓库"${repoDisplayName(addr).name}"选择了指定分支，但尚未选择任何分支`,
        );
        return;
      }
    }
    setFormErr("");
    setSubmitting(true);
    try {
      // Sequential: backend read→append→write has no transaction; concurrent
      // adds read the same initial repos and the later write wins. Await each
      // add so the next iteration reads the prior write's result.
      for (const [addr, sel] of selection) {
        const branches = sel.mode === "all" ? [""] : Array.from(sel.branches);
        for (const b of branches) {
          await onAdd({
            repo_addr: addr,
            repo_branch: b,
            start_time: null,
            end_time: null,
            exclude_commits: [],
            include_only_commits: [],
          });
        }
      }
      onOpenChange(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "无法添加来源");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加需求来源</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {formErr && <ErrorBanner message={formErr} />}
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索仓库名"
            aria-label="搜索仓库名"
          />
          <div className="max-h-[360px] space-y-1 overflow-y-auto">
            {optionsQ.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                无可选仓库
              </div>
            ) : (
              filtered.map((o) => {
                const sel = selection.get(o.repo_addr);
                const already = existingAddrs.has(o.repo_addr);
                const disp = repoDisplayName(o.repo_addr);
                return (
                  <div
                    key={o.repo_addr}
                    className="rounded-lg border border-border"
                  >
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                      <Checkbox
                        checked={!!sel}
                        disabled={already}
                        onCheckedChange={() => toggleRepo(o.repo_addr)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-card-foreground">
                          {disp.name}
                        </span>
                        {disp.path && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {disp.path}
                          </span>
                        )}
                        {already && (
                          <span className="ml-1.5 text-xs text-success">
                            已添加
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {o.need_count} 个需求 · {fmtDate(o.last_active)}
                      </span>
                    </label>
                    {sel && (
                      <div className="space-y-1.5 px-3 pb-2.5 pl-9">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <label className="inline-flex cursor-pointer items-center gap-1">
                            <input
                              type="radio"
                              name={`bm-${o.repo_addr}`}
                              checked={sel.mode === "all"}
                              onChange={() => setMode(o.repo_addr, "all")}
                            />
                            全部特性分支
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1">
                            <input
                              type="radio"
                              name={`bm-${o.repo_addr}`}
                              checked={sel.mode === "specific"}
                              onChange={() => setMode(o.repo_addr, "specific")}
                            />
                            指定分支
                          </label>
                        </div>
                        {sel.mode === "specific" && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {o.branches.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                该仓库没有特性分支
                              </span>
                            ) : (
                              o.branches.map((b) => {
                                const on = sel.branches.has(b.repo_branch);
                                return (
                                  <button
                                    type="button"
                                    key={b.repo_branch}
                                    onClick={() =>
                                      toggleBranch(o.repo_addr, b.repo_branch)
                                    }
                                    className={`rounded-full border px-2 py-0.5 text-xs transition-colors focus:outline-none ${
                                      on
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border text-muted-foreground hover:border-primary"
                                    }`}
                                  >
                                    {b.repo_branch}{" "}
                                    <span className={on ? "opacity-70" : ""}>
                                      {b.need_count}
                                    </span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {optionsQ.error || error ? (
            <ErrorBanner
              message={
                (optionsQ.error as Error | null)?.message ||
                (error as Error | null)?.message ||
                "无法加载或添加来源"
              }
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            选择仓库默认纳入全部已交付、非主干的特性分支；可切换到"指定分支"
            缩小范围。添加后可在需求列表中逐个纳入或排除。
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || pending}
            onClick={handleSubmit}
          >
            {submitting || pending
              ? "添加中..."
              : `添加${selectedCount ? ` (${selectedCount})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================== Generic confirm dialog ======================

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone: "destructive" | "default";
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function handle() {
    setErr("");
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || pending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-card-foreground">{message}</p>
          {err && <ErrorBanner message={err} />}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={disabled}
            onClick={handle}
          >
            {disabled ? "处理中..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================== helpers ======================

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

/** Decimal-ratio → percentage gain (2.85 → "285.0%"). */
function v2ratio(baseline: number, actual: number): number | null {
  return actual > 0 ? (baseline - actual) / actual : null;
}

/** Strip protocol/git suffix and keep the tail for compact repo display. */
function shortRepo(addr: string): string {
  const s = addr
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "");
  return s.length > 28 ? `…${s.slice(-28)}` : s;
}

/** Split a repo address into a display name + greyed path (for the selector). */
function repoDisplayName(addr: string): { name: string; path: string } {
  const s = addr
    .replace(/^https?:\/\//, "")
    .replace(/^git@/, "")
    .replace(/\.git$/, "");
  const segs = s.split(/[/:]/).filter(Boolean);
  const name = segs.length ? (segs[segs.length - 1] as string) : s;
  const path = segs.slice(0, -1).join("/");
  return { name, path };
}

/** Cleanliness status badge for a Need (source NeedStatusTag). */
function NeedStatusBadge({ n }: { n: ProjectNeedItem }) {
  if (!n.coverage_eligible) {
    return (
      <ToneBadge tone="info">
        <span title="未交付或置信度较低，不计入提效比">不合格</span>
      </ToneBadge>
    );
  }
  if (n.calendar_outlier_flag) {
    return (
      <ToneBadge tone="warning">
        <span title={n.reason || "日历口径异常"}>日历异常</span>
      </ToneBadge>
    );
  }
  if (n.work_outlier_flag) {
    return (
      <ToneBadge tone="warning">
        <span title={n.reason || "工作量口径异常"}>工作量异常</span>
      </ToneBadge>
    );
  }
  return <ToneBadge tone="success">干净</ToneBadge>;
}

/**
 * Decimal-ratio pill (Need-scope ratios, source RatioPill). Tone-coloured span
 * (semantic tokens only — no hardcoded colours). null/undefined → "-".
 */
function DecimalPill({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">-</span>;
  }
  const tone =
    value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground";
  return <span className={`inline-flex tabular-nums font-medium ${tone}`}>{formatV2Ratio(value)}</span>;
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
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
      const uid = n.primary_user_id || "unknown";
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
            ? "present"
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
    { key: "efficiency", name: "Efficiency %", color: "var(--chart-1)" },
    { key: "needs", name: "Needs", color: "var(--chart-2)" },
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
      title={project?.name || "Project detail"}
      subtitle={project?.description || projectId}
      headerExtra={
        <>
          <ToneBadge tone="neutral">{dateRange}</ToneBadge>
          <ToneBadge tone="neutral">
            {data?.need_total_count ?? projectNeeds.length} Needs
          </ToneBadge>
          <ToneBadge tone="neutral">{contributors.length} contributors</ToneBadge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSourceOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add source
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            disabled={!project}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
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
            Delete
          </Button>
        </>
      }
      loading={detailQ.isLoading}
      error={detailQ.error}
      empty={!detailQ.data?.project ? "No data for this project." : undefined}
    >
      {/* KPI grid (Need/branch scope, conserved; clean Needs only). */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile
          label="Calendar efficiency"
          value={formatV2Ratio(calR)}
          hint="baseline − actual / actual (clean needs)"
        />
        <KpiTile
          label="Work efficiency"
          value={formatV2Ratio(workR)}
          hint="fused baseline − active / active"
        />
        <KpiTile
          label="AI code share"
          value={formatV2Ratio(data?.need_ai_code_ratio)}
        />
        <KpiTile
          label="Actual work"
          value={actualPersonDays != null ? `${actualPersonDays.toFixed(1)} person-days` : "—"}
          hint={calPersonDays != null ? `calendar span ${calPersonDays.toFixed(1)} pd` : undefined}
        />
        <KpiTile
          label="Generated code"
          value={data?.need_total_loc_net != null ? `${data.need_total_loc_net.toLocaleString()} lines` : "—"}
        />
        <KpiTile
          label="Eligible / candidate needs"
          value={`${data?.need_eligible_count ?? 0} / ${data?.need_total_count ?? 0}`}
          hint={`auto-excluded ${data?.need_excluded_count ?? 0}`}
        />
        <KpiTile
          label="Cost"
          value={data?.need_cost != null && data.need_cost > 0 ? `${fmtCost(data.need_cost)}` : "0"}
          hint={`tokens up ${Math.round((data?.need_upstream_tokens ?? 0) / 1000)}k · down ${Math.round(
            (data?.need_downstream_tokens ?? 0) / 1000,
          )}k`}
        />
      </section>

      {/* Basic info. */}
      <Panel title="Basic info">
        <KvGrid>
          <Kv label="Project ID" mono>{projectId}</Kv>
          <Kv label="Name">{project?.name || "-"}</Kv>
          <Kv label="Description" wide>{project?.description || "-"}</Kv>
          <Kv label="Date range">{dateRange}</Kv>
          <Kv label="Created">{fmtDate(project?.created_at)}</Kv>
          <Kv label="Updated">{fmtDate(project?.updated_at)}</Kv>
          <Kv label="Source repos">{repos.length || "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Needs composition (main table) with per-need include/exclude. */}
      <Panel
        title="Needs"
        hint={`candidate ${data?.need_total_count ?? projectNeeds.length} · eligible ${data?.need_eligible_count ?? 0}`}
        bodyClassName="overflow-x-auto"
      >
        {/* Source-rule chips with remove buttons. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Need sources:</span>
          {repos.length === 0 ? (
            <span className="text-xs text-muted-foreground">none configured</span>
          ) : (
            repos.map((r, i) => (
              <ToneBadge key={`${r.repo_addr}#${r.repo_branch}#${i}`} tone="info">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="font-mono"
                    title={`${r.repo_addr}${r.repo_branch ? ` @ ${r.repo_branch}` : " @ all branches"}`}
                  >
                    {shortRepo(r.repo_addr)}
                    {r.repo_branch ? ` @ ${r.repo_branch}` : " @ all"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove source ${r.repo_addr}`}
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
            {needsQ.data?.stale_count} configured need(s) have drifted after a recompute
            (need_id stale) and no longer affect aggregation.
          </div>
        )}

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Include
              </th>
              <Th>Need</Th>
              <Th>Branch</Th>
              <Th>Boundary</Th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Calendar eff.
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Work eff.
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                AI share
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Status
              </th>
              <ThNum>Lines</ThNum>
            </tr>
          </thead>
          <tbody>
            {projectNeeds.length === 0 ? (
              <EmptyRow colSpan={9}>No candidate needs</EmptyRow>
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
                            ? `Include need ${n.repo_branch}`
                            : `Exclude need ${n.repo_branch}`
                        }
                      />
                    </td>
                    <Td>
                      <span className="font-mono break-all text-xs" title={n.need_id}>
                        {n.need_id.length > 30 ? `${n.need_id.slice(0, 30)}…` : n.need_id}
                      </span>
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
      <Panel title="Contributors" hint={`${contributors.length}`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <Th>User</Th>
              <ThNum>Needs</ThNum>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Calendar eff.
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                Work eff.
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">
                AI share
              </th>
              <ThNum>Lines</ThNum>
            </tr>
          </thead>
          <tbody>
            {contributors.length === 0 ? (
              <EmptyRow colSpan={6}>No contributors from selected needs</EmptyRow>
            ) : (
              contributors.map((c) => (
                <tr key={c.user_id} className="border-b text-card-foreground last:border-0">
                  <Td>
                    {/* TODO(names): source used useUserNameMap to resolve
                        display names; that resolver isn't in the data layer.
                        Falls back to the raw user_id. */}
                    <span title={c.user_id}>{c.user_id}</span>
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
      <Panel title="Weekly trend" hint="efficiency % / needs per week">
        {trendData.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No trend data</div>
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
        title="Delete project"
        message={`Delete project "${project?.name ?? ""}"? This cannot be undone.`}
        confirmLabel="Delete"
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
        title="Remove source"
        message={
          removeSource
            ? `Remove need source "${removeSource.repo.repo_addr}${removeSource.repo.repo_branch ? ` @ ${removeSource.repo.repo_branch}` : ""}"? Needs under it will no longer count toward this project.`
            : ""
        }
        confirmLabel="Remove"
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
      setFormErr("Project name is required");
      return;
    }
    setFormErr("");
    try {
      await onSubmit(formName.trim(), formDesc.trim());
      onOpenChange(false);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Failed to save");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {formErr && <ErrorBanner message={formErr} />}
          <Field label="Project name">
            <Input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </Field>
          {error ? (
            <ErrorBanner
              message={(error as Error)?.message || "Failed to save."}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={handleSubmit}>
            {pending ? "Saving..." : "Save"}
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
  const optionsQ = useQuery(needRepoOptionsOptions(wsId));
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
      setFormErr("Select at least one repo");
      return;
    }
    for (const [addr, sel] of selection) {
      if (sel.mode === "specific" && sel.branches.size === 0) {
        setFormErr(
          `Repo "${repoDisplayName(addr).name}" set to "specific" but no branch chosen`,
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
      setFormErr(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add need sources</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {formErr && <ErrorBanner message={formErr} />}
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repo name"
            aria-label="Search repo name"
          />
          <div className="max-h-[360px] space-y-1 overflow-y-auto">
            {optionsQ.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No repos available
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
                            added
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {o.need_count} needs · {fmtDate(o.last_active)}
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
                            All feature branches
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1">
                            <input
                              type="radio"
                              name={`bm-${o.repo_addr}`}
                              checked={sel.mode === "specific"}
                              onChange={() => setMode(o.repo_addr, "specific")}
                            />
                            Specific branches
                          </label>
                        </div>
                        {sel.mode === "specific" && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {o.branches.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                This repo has no feature branches
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
          {error ? (
            <ErrorBanner
              message={(error as Error)?.message || "Failed to add."}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Selecting a repo includes all its feature branches (delivered,
            non-main); switch to "specific" to narrow. After adding, toggle
            needs on/off in the list below.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || pending}
            onClick={handleSubmit}
          >
            {submitting || pending
              ? "Adding..."
              : `Add${selectedCount ? ` (${selectedCount})` : ""}`}
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
      setErr(e instanceof Error ? e.message : "Failed");
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
            Cancel
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            disabled={disabled}
            onClick={handle}
          >
            {disabled ? "Working..." : confirmLabel}
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
        <span title="not delivered or low confidence">ineligible</span>
      </ToneBadge>
    );
  }
  if (n.calendar_outlier_flag) {
    return (
      <ToneBadge tone="warning">
        <span title={n.reason || "calendar-scope outlier"}>calendar outlier</span>
      </ToneBadge>
    );
  }
  if (n.work_outlier_flag) {
    return (
      <ToneBadge tone="warning">
        <span title={n.reason || "workload-scope outlier"}>workload outlier</span>
      </ToneBadge>
    );
  }
  return <ToneBadge tone="success">clean</ToneBadge>;
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
    <div className="rounded-lg border bg-card">
      <KpiCard label={label} value={value} hint={hint} />
    </div>
  );
}

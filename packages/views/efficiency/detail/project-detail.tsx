"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  fmtCost,
  formatV2Ratio,
  projectDetailOptions,
  projectNeedsOptions,
  projectTrendOptions,
  type EntityTrendPoint,
  type ProjectDetailResponse,
  type ProjectNeedItem,
  type ProjectRepo,
  PERSON_DAY_MINUTES,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { MultiTrendChart, type MultiTrendPoint, type MultiTrendSeries } from "../charts";
import { Th, ThNum, Td, TdNum } from "../usage/shared";
import { DetailShell } from "./detail-shell";
import { EmptyRow, Kv, KvGrid, Panel, ToneBadge } from "./shared";

// Project detail page — the second-largest efficiency drill-down. Ports the
// source ProjectDetail (Need/branch scope) to the shared-views layer: KPI grid
// + needs composition table + repo source chips + contributors (conserved
// derivation) + weekly trend. Display-only: the source's create/edit/delete
// project, add/remove repo source, and per-need include/exclude (selection)
// mutations are intentionally dropped here — the route page is read-only.
// Adding mutations later is a pure addition once a mutation hook lands.
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
// Simplifications vs source (per task brief):
//   - No mutations: no EditModal, no SourceModal (add repo), no ConfirmModal
//     (delete/remove), no per-need selection checkbox. The needs table renders
//     the current excluded/included state as a status badge instead.
//   - No router: need_id / user_id render as plain text. The route layer owns
//     cross-entity navigation.
//   - No useUserNameMap: user_id is shown as-is (the resolver isn't in the data
//     layer); TODO noted.

interface ProjectDetailProps {
  projectId: string;
  /** Optional date window (YYYY-MM-DD). When absent the backend defaults. */
  startDate?: string;
  endDate?: string;
  /** Back navigation — owned by the route page (e.g. router.back()). */
  onBack: () => void;
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

export function ProjectDetail({ projectId, startDate, endDate, onBack }: ProjectDetailProps) {
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

      {/* Needs composition (main table). No selection checkbox (read-only). */}
      <Panel
        title="Needs"
        hint={`candidate ${data?.need_total_count ?? projectNeeds.length} · eligible ${data?.need_eligible_count ?? 0}`}
        bodyClassName="overflow-x-auto"
      >
        {/* Source-rule chips (no remove button — read-only). */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Need sources:</span>
          {repos.length === 0 ? (
            <span className="text-xs text-muted-foreground">none configured</span>
          ) : (
            repos.map((r, i) => (
              <ToneBadge key={`${r.repo_addr}#${r.repo_branch}#${i}`} tone="info">
                <span
                  className="font-mono"
                  title={`${r.repo_addr}${r.repo_branch ? ` @ ${r.repo_branch}` : " @ all branches"}`}
                >
                  {shortRepo(r.repo_addr)}
                  {r.repo_branch ? ` @ ${r.repo_branch}` : " @ all"}
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
              <EmptyRow colSpan={8}>No candidate needs</EmptyRow>
            ) : (
              projectNeeds.map((n) => (
                <tr
                  key={n.need_id}
                  className={`border-b text-card-foreground last:border-0 ${n.excluded ? "opacity-40" : ""}`}
                >
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
              ))
            )}
          </tbody>
        </table>

        {/* TODO(mutations): per-need include/exclude checkbox (source
            updateProjectNeedSelection) — needs a mutation hook. Out of scope
            for the read-only route page. */}
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

      {/* TODO(mutations): edit project / add source / delete / remove-source
          dialogs (source §3) — need mutation hooks (updateProject,
          addRepoToProject, removeRepoFromProject, deleteProject). Out of scope
          for the read-only route page. */}
    </DetailShell>
  );
}

// ---- helpers ----

/** Decimal-ratio → percentage gain (2.85 → "285.0%"). Pos/neg tone-coloured. */
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

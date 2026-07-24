"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  formatDuration,
  formatLocalTime,
  formatNumber,
  formatV2Ratio,
  formatVerifyMin,
  needDetailOptions,
  STAGE_ESTIMATE_TIP,
  VERIFY_UNAVAILABLE_TIP,
  useUserNameMap,
  type NeedBaselineComponents,
  type NeedCommit,
  type NeedDetail as NeedDetailModel,
  type NeedSession,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { DetailShell } from "./detail-shell";
import {
  asFileList,
  confidenceTone,
  EmptyRow,
  Fragment,
  Kv,
  KvGrid,
  Panel,
  shortId,
  signalTone,
  statusTone,
  ToneBadge,
} from "./shared";

// Need detail page — the richest of the four (sessions + commits + baseline
// decomposition + quality signals + touched files). Ports the source NeedDetail
// (read-only) to the shared-views layer.
//
// Caliber (matches source; these are footguns the source comments call out):
//   - efficiency_ratio / work_efficiency_ratio are DECIMAL ratios → formatV2Ratio (×100).
//   - Baseline table uses minutes integers (formatNumber), NOT formatDuration.
//   - fmtInt treats only null as "-"; fmtPct treats 0 ALSO as "-".
//   - Verify duration uses formatVerifyMin (0 → "—").
//
// Simplifications vs source (documented per task brief):
//   - No router: ids render as text; cross-entity links are the route layer's job.
//   - Collapsible commits section uses shadcn Collapsible (source had a custom
//     Panel `collapsible` prop).
//   - reasonHints/reasonSummary (LLM reason text helpers) are inlined as-is —
//     the source's reasonText.ts is not in the data layer; we render raw reason.

interface NeedDetailProps {
  needId: string;
  onBack: () => void;
}

const FILE_PREVIEW_N = 24;

export function NeedDetail({ needId, onBack }: NeedDetailProps) {
  const wsId = useWorkspaceId();
  const { resolveName } = useUserNameMap();
  const q = useQuery(needDetailOptions(wsId, needId));

  const need: NeedDetailModel = useMemo(
    () => q.data?.need ?? ({ need_id: needId } as NeedDetailModel),
    [q.data?.need, needId],
  );
  const sessions: NeedSession[] = q.data?.sessions ?? q.data?.stage_metrics ?? [];
  const commits: NeedCommit[] = q.data?.commits ?? [];
  const baseline: NeedBaselineComponents = q.data?.baseline_components ?? {};
  const qualityReason = (q.data?.quality_signals?.reason as string) || "";

  const [needFilesExpanded, setNeedFilesExpanded] = useState(false);
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());

  const needFiles = useMemo(() => asFileList(need.touched_files), [need.touched_files]);
  const visibleNeedFiles = needFilesExpanded ? needFiles : needFiles.slice(0, FILE_PREVIEW_N);
  const contributorCount = Array.isArray(need.contributor_user_ids)
    ? need.contributor_user_ids.length
    : "-";

  const bandHint = useMemo(() => {
    if (need.efficiency_band_low == null && need.efficiency_band_high == null) return "";
    return `band ${formatV2Ratio(need.efficiency_band_low)} ~ ${formatV2Ratio(need.efficiency_band_high)}`;
  }, [need.efficiency_band_low, need.efficiency_band_high]);

  // Baseline decomposition rows. The algo row carries a stage split in its
  // reason; the LLM row only appears when it produced an estimate; the fused
  // row is the weighted combination. Matches source baselineRows.
  const baselineRows = useMemo(() => {
    const rows: { name: string; total: number | null | undefined; reason: string }[] = [
      {
        name: "Algorithm baseline",
        total: baseline.algo_total_min,
        reason:
          baseline.algo_total_min == null
            ? ""
            : `stages: think ${fmtMin(baseline.algo_think_min)} / exec ${fmtMin(baseline.algo_exec_min)} / verify ${fmtMin(baseline.algo_verify_min)}`,
      },
      { name: "Similar-anchor kNN", total: baseline.anchor_knn_min, reason: baseline.anchor_knn_reason || "" },
    ];
    if (baseline.llm_total_min != null) {
      rows.push({
        name: "LLM estimate",
        total: baseline.llm_total_min,
        reason: baseline.llm_reason || baseline.llm_confidence || "",
      });
    }
    rows.push({
      name: "Traditional work estimate (fused)",
      total: baseline.fused_work_min,
      reason: "weighted fusion of the above estimates",
    });
    return rows;
  }, [baseline]);

  function toggleCommitFiles(id: string) {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <DetailShell
      onBack={onBack}
      title="Need detail"
      subtitle={need.need_id || "-"}
      headerExtra={
        <>
          {need.status && (
            <ToneBadge tone={statusTone(need.status)}>{need.status}</ToneBadge>
          )}
          {need.confidence_level && (
            <ToneBadge tone={confidenceTone(need.confidence_level)}>
              eff confidence {need.confidence_level}
            </ToneBadge>
          )}
          <ToneBadge tone={need.coverage_eligible ? "success" : "neutral"}>
            {need.coverage_eligible ? "counted" : "excluded"}
          </ToneBadge>
          {need.calendar_outlier_flag && (
            <ToneBadge tone="error">calendar outlier</ToneBadge>
          )}
          {need.work_outlier_flag && (
            <ToneBadge tone="error">workload outlier</ToneBadge>
          )}
          {need.outlier_flag && !need.calendar_outlier_flag && !need.work_outlier_flag && (
            <ToneBadge tone="error">outlier sample</ToneBadge>
          )}
        </>
      }
      loading={q.isLoading}
      error={q.error}
      empty={!q.data?.need ? "No data for this need." : undefined}
    >
      {/* KPI grid: 6 baseline-vs-actual cards. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile label="Calendar efficiency" value={formatV2Ratio(need.efficiency_ratio)} hint={bandHint || undefined} />
        <KpiTile label="Work efficiency" value={formatV2Ratio(need.work_efficiency_ratio)} />
        <KpiTile label="Actual period" value={formatDuration(need.total_calendar_min)} />
        <KpiTile label="Baseline period" value={formatDuration(need.baseline_calendar_min)} />
        <KpiTile label="Actual work" value={formatDuration(need.total_active_work_corrected_min)} />
        <KpiTile label="Baseline work (fused)" value={formatDuration(need.baseline_fused_work_min)} />
      </section>

      {/* Basic info. */}
      <Panel title="Basic info">
        <KvGrid>
          <Kv label="Boundary source">{need.boundary_source || "-"}</Kv>
          <Kv label="Boundary confidence">
            <ToneBadge tone={confidenceTone(need.boundary_confidence)}>
              {need.boundary_confidence || "-"}
            </ToneBadge>
          </Kv>
          <Kv label="Boundary key" wide mono>{need.boundary_key || "-"}</Kv>
          <Kv label="Repo" wide mono>{need.repo_addr || "-"}</Kv>
          <Kv label="Branch" mono>{need.repo_branch || "-"}</Kv>
          <Kv label="Primary user">{resolveName(need.primary_user_id)}</Kv>
          <Kv label="Contributors">{contributorCount}</Kv>
          <Kv label="Start time">{formatLocalTime(need.dev_start_ts)}</Kv>
          <Kv label="End time">{formatLocalTime(need.dev_end_ts)}</Kv>
          <Kv label="Dev span">{formatDuration(need.dev_duration_min)}</Kv>
        </KvGrid>
      </Panel>

      {/* Baseline decomposition. */}
      <Panel title="Traditional work estimate breakdown (minutes)" bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">Source</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground">Estimate (min)</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">Note</th>
            </tr>
          </thead>
          <tbody>
            {baselineRows.map((r) => (
              <tr key={r.name} className="border-b text-card-foreground last:border-0">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMin(r.total)}</td>
                <td className="px-3 py-2">
                  <span className="block max-w-[480px] truncate" title={r.reason}>
                    {r.reason || "-"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {baseline.calendar_min != null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Baseline period (calendar caliber): {fmtMin(baseline.calendar_min)} min — converted by team cadence; not additive with the work-caliber table above.
          </p>
        )}
      </Panel>

      {/* Stage workload. */}
      <Panel title="Stage workload">
        <KvGrid>
          <Kv label="Think" title={STAGE_ESTIMATE_TIP}>{formatDuration(need.total_think_min)}</Kv>
          <Kv label="Exec" title={STAGE_ESTIMATE_TIP}>{formatDuration(need.total_exec_min)}</Kv>
          <Kv label="Verify" title={VERIFY_UNAVAILABLE_TIP}>{formatVerifyMin(need.total_verify_min)}</Kv>
          <Kv label="Other">{formatDuration(need.total_other_min)}</Kv>
          <Kv label="Session active person-min">{formatDuration(need.total_session_active_person_min)}</Kv>
          <Kv label="Uncovered human estimate">{formatDuration(need.estimate_uncovered_human_min)}</Kv>
        </KvGrid>
        <p className="mt-3 text-xs text-muted-foreground">
          Verify: collection not covered ({VERIFY_UNAVAILABLE_TIP}). Think / exec are rough estimate calibers.
        </p>
      </Panel>

      {/* Code & quality signals. */}
      <Panel
        title="Code & quality signals"
        hint={qualityReason || undefined}
      >
        <KvGrid>
          <Kv label="Net LOC">{fmtInt(need.total_loc_net)}</Kv>
          <Kv label="Files touched">{fmtInt(need.total_files_touched)}</Kv>
          <Kv label="Commit count">{fmtInt(need.commit_count)}</Kv>
          <Kv label="AI code share">{fmtPct(need.ai_code_ratio)}</Kv>
          <Kv label="AI covered LOC">{fmtInt(need.ai_covered_loc)}</Kv>
          <Kv label="Uncovered LOC">{fmtInt(need.uncovered_loc)}</Kv>
          <Kv label="Uncovered work share">{fmtPct(need.uncovered_work_ratio)}</Kv>
        </KvGrid>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <ToneBadge tone={signalTone(need.ai_code_ratio_signal)}>
            AI code share signal: {need.ai_code_ratio_signal || "unknown"}
          </ToneBadge>
          <ToneBadge tone={signalTone(need.uncovered_work_signal)}>
            Uncovered work signal: {need.uncovered_work_signal || "unknown"}
          </ToneBadge>
        </div>
      </Panel>

      {/* Touched files. */}
      <Panel title="Touched files" hint={`${needFiles.length}`}>
        {needFiles.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No touched files</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {visibleNeedFiles.map((f) => (
                <ToneBadge key={f} tone="neutral">
                  <span className="font-mono" title={f}>{f}</span>
                </ToneBadge>
              ))}
            </div>
            {needFiles.length > FILE_PREVIEW_N && (
              <button
                type="button"
                onClick={() => setNeedFilesExpanded((e) => !e)}
                className="mt-2 text-sm text-primary hover:underline focus:outline-none"
              >
                {needFilesExpanded ? "Collapse" : `Show all (${needFiles.length})`}
              </button>
            )}
          </>
        )}
      </Panel>

      {/* Related sessions. */}
      <Panel title="Related sessions" hint={`${sessions.length}`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Session</ThLeft>
              <ThLeft>User</ThLeft>
              <ThLeft>Start</ThLeft>
              <ThLeft>End</ThLeft>
              <ThRight title="Active workload">Active</ThRight>
              <ThRight title={STAGE_ESTIMATE_TIP}>Think</ThRight>
              <ThRight title={STAGE_ESTIMATE_TIP}>Exec</ThRight>
              <ThRight title={VERIFY_UNAVAILABLE_TIP}>Verify</ThRight>
              <ThLeft>Stage conf.</ThLeft>
              <ThLeft>Summary</ThLeft>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <EmptyRow colSpan={10}>No sessions</EmptyRow>
            ) : (
              sessions.map((s) => (
                <tr key={s.session_id} className="border-b text-card-foreground last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{shortId(s.session_id)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={s.user_id ?? ""}>
                    {resolveName(s.user_id)}
                  </td>
                  <td className="px-3 py-2">{formatLocalTime(s.session_start_ts)}</td>
                  <td className="px-3 py-2">{formatLocalTime(s.session_end_ts)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatDuration(s.total_active_min)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatDuration(s.think_active_min)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatDuration(s.exec_active_min)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums" title={VERIFY_UNAVAILABLE_TIP}>{formatVerifyMin(s.verify_active_min)}</td>
                  <td className="px-3 py-2">
                    <ToneBadge tone={confidenceTone(s.stage_confidence)}>{s.stage_confidence || "-"}</ToneBadge>
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2" title={s.summary ?? ""}>{s.summary || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      {/* Related commits — collapsible (richest table, tucked by default). */}
      <Panel title="Related commits" hint={`${commits.length}`} defaultCollapsed bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Commit</ThLeft>
              <ThLeft>Time</ThLeft>
              <ThLeft>User</ThLeft>
              <ThRight>LOC</ThRight>
              <ThRight>AI code share</ThRight>
              <ThLeft>Message</ThLeft>
              <ThLeft>Files</ThLeft>
            </tr>
          </thead>
          <tbody>
            {commits.length === 0 ? (
              <EmptyRow colSpan={7}>No commits</EmptyRow>
            ) : (
              commits.map((c) => {
                const files = asFileList(c.touched_files);
                const expanded = expandedCommits.has(c.commit_id);
                return (
                  <Fragment key={c.commit_id}>
                    <tr className="border-b text-card-foreground last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs" title={c.commit_id}>
                          {shortId(c.commit_id, 10)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatLocalTime(c.commit_time)}</td>
                      <td className="max-w-[180px] truncate px-3 py-2" title={c.user_name ?? ""}>
                        {c.user_name || "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtInt(c.diff_lines)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtPct(c.silica)}</td>
                      <td className="max-w-[280px] truncate px-3 py-2" title={c.comment ?? ""}>{c.comment || "-"}</td>
                      <td className="px-3 py-2">
                        {files.length ? (
                          <button
                            type="button"
                            onClick={() => toggleCommitFiles(c.commit_id)}
                            className="text-primary hover:underline focus:outline-none"
                          >
                            {expanded ? "Collapse" : `${files.length} files`}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                    {files.length > 0 && expanded && (
                      <tr className="border-b text-card-foreground last:border-0">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {files.map((f) => (
                              <ToneBadge key={f} tone="neutral">
                                <span className="font-mono" title={f}>{f}</span>
                              </ToneBadge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </Panel>
    </DetailShell>
  );
}

// ---- caliber helpers (ported from source; these are NOT the shared
//      formatters because they encode need-specific null/zero rules) ----

// Baseline table uses integer minutes (formatNumber), not formatDuration.
function fmtMin(value: number | null | undefined): string {
  if (value == null) return "-";
  return formatNumber(value, 0);
}
// fmtInt treats only null as "-".
function fmtInt(value: number | null | undefined): string {
  if (value == null) return "-";
  return formatNumber(value, 0);
}
// fmtPct treats 0 ALSO as "-" (0 means no signal yet).
function fmtPct(value: number | null | undefined): string {
  if (value == null || value === 0) return "-";
  return formatV2Ratio(value);
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

function ThLeft({ children, title }: { children: React.ReactNode; title?: string }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground" title={title}>{children}</th>;
}
function ThRight({ children, title }: { children: React.ReactNode; title?: string }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground" title={title}>{children}</th>;
}

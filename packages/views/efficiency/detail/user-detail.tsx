"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  formatDuration,
  formatLocalTime,
  formatNumber,
  formatV2Ratio,
  userDetailOptions,
  useUserNameMap,
  type NeedCommit,
  type NeedsV2Summary,
  type UserProductivityV2,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { DetailShell } from "./detail-shell";
import {
  EmptyRow,
  Panel,
  shortId,
  statusTone,
  ToneBadge,
} from "./shared";

// User efficiency detail page. Ports the source UserDetail (read-only) to the
// shared-views layer: DetailShell owns back/title/states, this file owns the
// KPI grid + weekly detail + related needs/commits tables.
//
// Caliber (matches source):
//   - summary.calendar_ratio / work_ratio are DECIMAL ratios → formatV2Ratio (×100).
//   - Durations via formatDuration (adaptive minutes/hours/person-days).
//   - commit_diff_lines via formatNumber.
//
// Design decisions:
//   - No router: navigation is the caller's job (onBack). Needs/commits tables
//     render ids as text (no links) — cross-entity drill-down is wired at the
//     route layer if/when needed.
//   - No ECharts: the weekly trend chart is dropped (source used a combo line
//     + bar). The weekly table carries the same data; a recharts port can be
//     added later without touching this file's data path.

interface UserDetailProps {
  userId: string;
  /** Optional window (YYYYMMDD or YYYY-MM-DD). Omit for the default range. */
  startDate?: string;
  endDate?: string;
  onBack: () => void;
}

export function UserDetail({
  userId,
  startDate,
  endDate,
  onBack,
}: UserDetailProps) {
  const wsId = useWorkspaceId();
  const { resolveName } = useUserNameMap();
  const q = useQuery(userDetailOptions(wsId, userId, startDate, endDate));

  const summary = q.data?.summary;
  const weeks = useMemo<UserProductivityV2[]>(
    () => q.data?.weeks ?? [],
    [q.data?.weeks],
  );
  const needs = useMemo<NeedsV2Summary[]>(
    () => q.data?.needs ?? [],
    [q.data?.needs],
  );
  const commits = useMemo<NeedCommit[]>(
    () => q.data?.commits ?? [],
    [q.data?.commits],
  );

  const titleName = summary?.user_name || resolveName(userId);

  return (
    <DetailShell
      onBack={onBack}
      title="User detail"
      subtitle={titleName}
      loading={q.isLoading}
      error={q.error}
      empty={
        q.data && !summary ? "No data for this user in the selected range." : undefined
      }
    >
      {/* KPI grid — 6 cards mirroring the source. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile label="Merged needs" value={formatNumber(summary?.merged_need_count ?? 0)} />
        <KpiTile label="Calendar efficiency" value={formatV2Ratio(summary?.calendar_ratio)} />
        <KpiTile label="Work efficiency" value={formatV2Ratio(summary?.work_ratio)} />
        <KpiTile label="Actual period" value={formatDuration(summary?.actual_calendar_min)} />
        <KpiTile label="Baseline period" value={formatDuration(summary?.baseline_calendar_min)} />
        <KpiTile
          label="Commits / LOC"
          value={`${summary?.commit_count ?? 0} / ${formatNumber(summary?.commit_diff_lines, 0)}`}
        />
      </section>

      {/* Weekly breakdown — the source's left column. */}
      <Panel title="Weekly breakdown" hint={`${weeks.length} weeks`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Week start</ThLeft>
              <ThRight>Merged</ThRight>
              <ThRight>Active</ThRight>
              <ThLeft>Calendar eff.</ThLeft>
              <ThLeft>Work eff.</ThLeft>
              <ThRight>Commits</ThRight>
              <ThLeft>Confidence</ThLeft>
            </tr>
          </thead>
          <tbody>
            {weeks.length === 0 ? (
              <EmptyRow colSpan={7}>No weekly data</EmptyRow>
            ) : (
              weeks.map((w) => (
                <tr
                  key={w.user_productivity_v2_id || w.week_start}
                  className="border-b text-card-foreground last:border-0"
                >
                  <TdBase>{fmtWeek(w.week_start)}</TdBase>
                  <TdNum>{w.merged_need_count ?? 0}</TdNum>
                  <TdNum>{w.active_need_count ?? 0}</TdNum>
                  <TdBase>{formatV2Ratio(w.efficiency_ratio)}</TdBase>
                  <TdBase>{formatV2Ratio(w.work_efficiency_ratio)}</TdBase>
                  <TdNum>{w.commit_count ?? 0}</TdNum>
                  <TdBase>
                    <ToneBadge tone={w.confidence_limited ? "warning" : "success"}>
                      {w.confidence_limited ? "Limited" : "Normal"}
                    </ToneBadge>
                  </TdBase>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      {/* Related needs. */}
      <Panel title="Related needs" hint={`${needs.length}`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Need</ThLeft>
              <ThLeft>Status</ThLeft>
              <ThLeft>Repo</ThLeft>
              <ThLeft>Branch</ThLeft>
              <ThRight>Actual period</ThRight>
              <ThLeft>Calendar eff.</ThLeft>
              <ThLeft>Work eff.</ThLeft>
            </tr>
          </thead>
          <tbody>
            {needs.length === 0 ? (
              <EmptyRow colSpan={7}>No needs</EmptyRow>
            ) : (
              needs.map((n) => (
                <tr key={n.need_id} className="border-b text-card-foreground last:border-0">
                  <TdBase>
                    <span className="font-mono text-xs" title={n.need_id}>
                      {shortId(n.need_id, 16)}
                    </span>
                  </TdBase>
                  <TdBase>
                    <ToneBadge tone={statusTone(n.status)}>{n.status || "-"}</ToneBadge>
                  </TdBase>
                  <TdBase>
                    <span className="block max-w-[240px] truncate" title={n.repo_addr}>
                      {n.repo_addr || "-"}
                    </span>
                  </TdBase>
                  <TdBase>
                    <span className="block max-w-[160px] truncate" title={n.repo_branch}>
                      {n.repo_branch || "-"}
                    </span>
                  </TdBase>
                  <TdNum>{formatDuration(n.total_calendar_min)}</TdNum>
                  <TdBase>{formatV2Ratio(n.efficiency_ratio)}</TdBase>
                  <TdBase>{formatV2Ratio(n.work_efficiency_ratio)}</TdBase>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      {/* Recent commits. */}
      <Panel title="Recent commits" hint={`${commits.length}`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Commit</ThLeft>
              <ThLeft>Time</ThLeft>
              <ThLeft>Repo</ThLeft>
              <ThRight>LOC</ThRight>
              <ThLeft>Message</ThLeft>
            </tr>
          </thead>
          <tbody>
            {commits.length === 0 ? (
              <EmptyRow colSpan={5}>No commits</EmptyRow>
            ) : (
              commits.map((c) => (
                <tr key={c.commit_id} className="border-b text-card-foreground last:border-0">
                  <TdBase>
                    <span className="font-mono text-xs" title={c.commit_id}>
                      {shortId(c.commit_id, 10)}
                    </span>
                  </TdBase>
                  <TdBase>{formatLocalTime(c.commit_time)}</TdBase>
                  <TdBase>
                    <span className="block max-w-[240px] truncate" title={String(c.repo_addr ?? "")}>
                      {String(c.repo_addr ?? "") || "-"}
                    </span>
                  </TdBase>
                  <TdNum>{formatNumber(c.diff_lines, 0)}</TdNum>
                  <TdBase>
                    <span className="block max-w-[280px] truncate" title={c.comment ?? ""}>
                      {c.comment || "-"}
                    </span>
                  </TdBase>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>
    </DetailShell>
  );
}

// ---- small local table helpers (detail tables don't sort, so lighter than
//      usage/shared SortHeader). Kept here because only the detail pages use
//      them and they share the exact styling. ----

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <KpiCard label={label} value={value} />
    </div>
  );
}

function ThLeft({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">{children}</th>;
}
function ThRight({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground">{children}</th>;
}
function TdBase({ children, title }: { children: React.ReactNode; title?: string }) {
  return <td className="px-3 py-2 align-middle text-card-foreground" title={title}>{children}</td>;
}
function TdNum({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-card-foreground">{children}</td>;
}

/** Week start → "YYYY-MM-DD" (drops time, matches source fmtWeek). */
function fmtWeek(weekStart?: string): string {
  if (!weekStart) return "-";
  const d = new Date(weekStart);
  if (Number.isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

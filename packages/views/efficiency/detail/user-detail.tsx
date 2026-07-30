"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  formatDuration,
  formatLocalTime,
  formatNumber,
  userDetailOptions,
  useUserNameMap,
  type NeedCommit,
  type NeedsV2Summary,
  type UserProductivityV2,
} from "@multica/core/efficiency";
import { KpiCard } from "../../runtimes/components/shared";
import { DetailShell } from "./detail-shell";
import { ComboTrendChart } from "../charts";
import { DRILLDOWN_LINK_CLASS } from "../components/drilldown-styles";
import { RatioPill } from "../components/ratio-pill";
import { useNavigation } from "../../navigation";
import {
  EmptyRow,
  Panel,
  shortId,
  statusTone,
  ToneBadge,
} from "./shared";

// User efficiency detail page. Ports the source UserDetail (read-only) to the
// shared-views layer: DetailShell owns back/title/states, this file owns the
// KPI grid + weekly trend + weekly detail + related needs/commits tables.
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
//   - The source's weekly trend (combo line + bar) is ported to the recharts
//     DualAxisTrendChart: code lines on the left axis (Bar), merged needs +
//     commits on the right axis (Line). Same magnitude problem as the
//     contribution dimension — code lines dwarf the small counts.

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
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
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

  const titleName = resolveName(summary?.user_id || userId);

  return (
    <DetailShell
      onBack={onBack}
      title="用户详情"
      subtitle={titleName}
      loading={q.isLoading}
      error={q.error}
      empty={
        q.data && !summary ? "所选时间范围内暂无该用户数据" : undefined
      }
    >
      {/* KPI grid — 6 cards mirroring the source. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="合并需求" value={formatNumber(summary?.merged_need_count ?? 0)} />
        <KpiTile label="日历提效" value={<RatioPill value={summary?.calendar_ratio} />} />
        <KpiTile label="人力提效" value={<RatioPill value={summary?.work_ratio} />} />
        <KpiTile label="实际周期" value={formatDuration(summary?.actual_calendar_min)} />
        <KpiTile label="传统周期预估" value={formatDuration(summary?.baseline_calendar_min)} />
        <KpiTile
          label="Commit / 代码行"
          value={`${summary?.commit_count ?? 0} / ${formatNumber(summary?.commit_diff_lines, 0)}`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="周明细" hint={`${weeks.length} 周 · Need 关联口径`} bodyClassName="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <ThLeft>周起始</ThLeft>
                <ThRight>合并</ThRight>
                <ThRight>活跃</ThRight>
                <ThLeft>日历提效</ThLeft>
                <ThLeft>人力提效</ThLeft>
                <ThRight>关联 Commit</ThRight>
                <ThLeft>置信</ThLeft>
              </tr>
            </thead>
            <tbody>
              {weeks.length === 0 ? (
                <EmptyRow colSpan={7}>暂无周数据</EmptyRow>
              ) : (
                weeks.map((w) => (
                  <tr
                    key={w.user_productivity_v2_id || w.week_start}
                    className="border-b text-card-foreground last:border-0"
                  >
                    <TdBase>{fmtWeek(w.week_start)}</TdBase>
                    <TdNum>{w.merged_need_count ?? 0}</TdNum>
                    <TdNum>{w.active_need_count ?? 0}</TdNum>
                    <TdBase>
                      <RatioPill value={w.efficiency_ratio} />
                    </TdBase>
                    <TdBase>
                      <RatioPill value={w.work_efficiency_ratio} />
                    </TdBase>
                    <TdNum>{w.commit_count ?? 0}</TdNum>
                    <TdBase>
                      <ToneBadge tone={w.confidence_limited ? "warning" : "success"}>
                        {w.confidence_limited ? "受限" : "正常"}
                      </ToneBadge>
                    </TdBase>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="周趋势" hint="日历提效 / 合并需求">
          {weeks.length === 0 ? (
            <div className="flex min-h-[16rem] items-center justify-center text-sm text-muted-foreground">
              暂无周趋势数据
            </div>
          ) : (
            <ComboTrendChart
              data={[...weeks]
                .sort(
                  (a, b) =>
                    new Date(a.week_start).getTime() -
                    new Date(b.week_start).getTime(),
                )
                .map((w) => ({
                  label: fmtWeek(w.week_start),
                  bar: w.merged_need_count ?? 0,
                  line: (w.efficiency_ratio ?? 0) * 100,
                }))}
              bar={{ name: "合并需求", color: "var(--chart-2)" }}
              line={{ name: "日历提效", color: "var(--chart-1)" }}
              formatLeftY={(v) => formatNumber(v, 0)}
              formatRightY={(v) => `${formatNumber(v, 0)}%`}
            />
          )}
        </Panel>
      </div>

      {/* Related needs. */}
      <Panel title="关联需求" hint={`${needs.length} 个`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>需求</ThLeft>
              <ThLeft>状态</ThLeft>
              <ThLeft>仓库</ThLeft>
              <ThLeft>分支</ThLeft>
              <ThRight>实际周期</ThRight>
              <ThLeft>日历提效</ThLeft>
              <ThLeft>人力提效</ThLeft>
            </tr>
          </thead>
          <tbody>
            {needs.length === 0 ? (
              <EmptyRow colSpan={7}>暂无需求</EmptyRow>
            ) : (
              needs.map((n) => (
                <tr key={n.need_id} className="border-b text-card-foreground last:border-0">
                  <TdBase>
                    <button
                      type="button"
                      onClick={() => push(paths.metricsNeedDetail(n.need_id))}
                      className={`font-mono text-xs ${DRILLDOWN_LINK_CLASS}`}
                      title={n.need_id}
                    >
                      {shortId(n.need_id, 16)}
                    </button>
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
                  <TdBase>
                    <RatioPill value={n.efficiency_ratio} />
                  </TdBase>
                  <TdBase>
                    <RatioPill value={n.work_efficiency_ratio} />
                  </TdBase>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>

      {/* Recent commits. */}
      <Panel title="最近 Commit" hint={`${commits.length} 条`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Commit</ThLeft>
              <ThLeft>提交时间</ThLeft>
              <ThLeft>仓库</ThLeft>
              <ThRight>代码行</ThRight>
              <ThLeft>说明</ThLeft>
            </tr>
          </thead>
          <tbody>
            {commits.length === 0 ? (
              <EmptyRow colSpan={5}>暂无 Commit</EmptyRow>
            ) : (
              commits.map((c) => (
                <tr key={c.commit_id} className="border-b text-card-foreground last:border-0">
                  <TdBase>
                    <button
                      type="button"
                      onClick={() => push(paths.metricsCommitDetail(c.commit_id))}
                      className={`font-mono text-xs ${DRILLDOWN_LINK_CLASS}`}
                      title={c.commit_id}
                    >
                      {shortId(c.commit_id, 10)}
                    </button>
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

function KpiTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
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

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  ACTUAL_CALENDAR_TIP,
  ACTUAL_WORK_TIP,
  BASELINE_CALENDAR_TIP,
  CALENDAR_RATIO_TIP,
  formatDuration,
  formatLocalTime,
  formatNumber,
  formatV2Ratio,
  formatVerifyMin,
  FUSED_BASELINE_WORK_TIP,
  needDetailOptions,
  STAGE_ESTIMATE_TIP,
  VERIFY_UNAVAILABLE_TIP,
  WORK_RATIO_TIP,
  useUserNameMap,
  type NeedBaselineComponents,
  type NeedCommit,
  type NeedDetail as NeedDetailModel,
  type NeedSession,
} from "@multica/core/efficiency";
import { useNavigation } from "../../navigation";
import { DRILLDOWN_LINK_CLASS } from "../components/drilldown-styles";
import { RatioPill } from "../components/ratio-pill";
import { InfoTip } from "../usage/shared";
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
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
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
    return `区间 ${formatV2Ratio(need.efficiency_band_low)} ~ ${formatV2Ratio(need.efficiency_band_high)}`;
  }, [need.efficiency_band_low, need.efficiency_band_high]);

  // Baseline decomposition rows. The algo row carries a stage split in its
  // reason; the LLM row only appears when it produced an estimate; the fused
  // row is the weighted combination. Matches source baselineRows.
  const baselineRows = useMemo(() => {
    const rows: { name: string; total: number | null | undefined; reason: string }[] = [
      {
        name: "算法基线",
        total: baseline.algo_total_min,
        reason:
          baseline.algo_total_min == null
            ? ""
            : `阶段拆分：思考 ${fmtMin(baseline.algo_think_min)} / 执行 ${fmtMin(baseline.algo_exec_min)} / 验证 ${fmtMin(baseline.algo_verify_min)}`,
      },
      { name: "相似锚点 kNN", total: baseline.anchor_knn_min, reason: baseline.anchor_knn_reason || "" },
    ];
    if (baseline.llm_total_min != null) {
      rows.push({
        name: "LLM 估算",
        total: baseline.llm_total_min,
        reason: baseline.llm_reason || baseline.llm_confidence || "",
      });
    }
    rows.push({
      name: "传统人力预估（融合）",
      total: baseline.fused_work_min,
      reason: "上述各路估算加权融合",
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
      title="需求看板"
      subtitle={need.need_id || "-"}
      headerExtra={
        <>
          {need.status && (
            <ToneBadge tone={statusTone(need.status)}>{need.status}</ToneBadge>
          )}
          {need.confidence_level && (
            <ToneBadge tone={confidenceTone(need.confidence_level)}>
              效率置信 {need.confidence_level}
            </ToneBadge>
          )}
          <ToneBadge tone={need.coverage_eligible ? "success" : "neutral"}>
            {need.coverage_eligible ? "可计入" : "未计入"}
          </ToneBadge>
          {need.calendar_outlier_flag && (
            <ToneBadge tone="error">日历异常</ToneBadge>
          )}
          {need.work_outlier_flag && (
            <ToneBadge tone="error">工作量异常</ToneBadge>
          )}
          {need.outlier_flag && !need.calendar_outlier_flag && !need.work_outlier_flag && (
            <ToneBadge tone="error">异常样本</ToneBadge>
          )}
        </>
      }
      loading={q.isLoading}
      error={q.error}
      empty={!q.data?.need ? "暂无该需求数据" : undefined}
    >
      {/* KPI grid: source-style accent cards with ratio pills and caliber tips. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          label="日历提效"
          value={<RatioPill value={need.efficiency_ratio} />}
          hint={bandHint || undefined}
          tip={CALENDAR_RATIO_TIP}
          accent="success"
        />
        <KpiTile
          label="人力提效"
          value={<RatioPill value={need.work_efficiency_ratio} />}
          tip={WORK_RATIO_TIP}
          accent="info"
        />
        <KpiTile
          label="实际周期"
          value={formatDuration(need.total_calendar_min)}
          tip={ACTUAL_CALENDAR_TIP}
          accent="primary"
        />
        <KpiTile
          label="传统周期预估"
          value={formatDuration(need.baseline_calendar_min)}
          tip={BASELINE_CALENDAR_TIP}
          accent="primary"
        />
        <KpiTile
          label="实际人力"
          value={formatDuration(need.total_active_work_corrected_min)}
          tip={ACTUAL_WORK_TIP}
          accent="warning"
        />
        <KpiTile
          label="传统人力预估"
          value={formatDuration(need.baseline_fused_work_min)}
          tip={FUSED_BASELINE_WORK_TIP}
          accent="warning"
        />
      </section>

      {/* Basic info. */}
      <Panel title="基础信息">
        <KvGrid>
          <Kv label="边界来源">{need.boundary_source || "-"}</Kv>
          <Kv label="边界置信">
            <ToneBadge tone={confidenceTone(need.boundary_confidence)}>
              {need.boundary_confidence || "-"}
            </ToneBadge>
          </Kv>
          <Kv label="边界标识" wide mono>{need.boundary_key || "-"}</Kv>
          <Kv label="仓库" wide mono>
            {need.repo_addr ? (
              <button
                type="button"
                onClick={() =>
                  push(paths.metricsRepoDetail(need.repo_addr!, need.repo_branch))
                }
                className={`break-all text-left font-mono ${DRILLDOWN_LINK_CLASS}`}
              >
                {need.repo_addr}
              </button>
            ) : "-"}
          </Kv>
          <Kv label="分支" mono>{need.repo_branch || "-"}</Kv>
          <Kv label="主用户">
            {need.primary_user_id ? (
              <button
                type="button"
                onClick={() => push(paths.metricsUserDetail(need.primary_user_id!))}
                className={DRILLDOWN_LINK_CLASS}
              >
                {resolveName(need.primary_user_id)}
              </button>
            ) : "-"}
          </Kv>
          <Kv label="协作人数">{contributorCount}</Kv>
          <Kv label="开始时间">{formatLocalTime(need.dev_start_ts)}</Kv>
          <Kv label="结束时间">{formatLocalTime(need.dev_end_ts)}</Kv>
          <Kv label="开发跨度">{formatDuration(need.dev_duration_min)}</Kv>
        </KvGrid>
      </Panel>

      {/* Baseline decomposition. */}
      <Panel title="传统人力估算组成（分钟）" bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">来源</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground">估算（分钟）</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">说明</th>
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
            传统周期预估（日历口径）：{fmtMin(baseline.calendar_min)} 分钟 ·
            按团队常规节奏换算，与上表人力口径不可直接相加。
          </p>
        )}
      </Panel>

      {/* Stage workload. */}
      <Panel title="阶段工作量">
        <KvGrid>
          <Kv label="思考" title={STAGE_ESTIMATE_TIP}>{formatDuration(need.total_think_min)}</Kv>
          <Kv label="执行" title={STAGE_ESTIMATE_TIP}>{formatDuration(need.total_exec_min)}</Kv>
          <Kv label="验证" title={VERIFY_UNAVAILABLE_TIP}>{formatVerifyMin(need.total_verify_min)}</Kv>
          <Kv label="其他">{formatDuration(need.total_other_min)}</Kv>
          <Kv label="会话活跃人工">{formatDuration(need.total_session_active_person_min)}</Kv>
          <Kv label="未覆盖人工估算">{formatDuration(need.estimate_uncovered_human_min)}</Kv>
        </KvGrid>
        <p className="mt-3 text-xs text-muted-foreground">
          验证：采集未覆盖（{VERIFY_UNAVAILABLE_TIP}）。思考 / 执行为粗略估算口径。
        </p>
      </Panel>

      {/* Code & quality signals. */}
      <Panel
        title="代码与质量信号"
        hint={qualityReason || undefined}
      >
        <KvGrid>
          <Kv label="净代码行">{fmtInt(need.total_loc_net)}</Kv>
          <Kv label="改动文件">{fmtInt(need.total_files_touched)}</Kv>
          <Kv label="提交数">{fmtInt(need.commit_count)}</Kv>
          <Kv label="AI 代码占比">{fmtPct(need.ai_code_ratio)}</Kv>
          <Kv label="AI 覆盖行">{fmtInt(need.ai_covered_loc)}</Kv>
          <Kv label="未覆盖行">{fmtInt(need.uncovered_loc)}</Kv>
          <Kv label="未覆盖工作占比">{fmtPct(need.uncovered_work_ratio)}</Kv>
        </KvGrid>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <ToneBadge tone={signalTone(need.ai_code_ratio_signal)}>
            AI 代码占比信号：{need.ai_code_ratio_signal || "未知"}
          </ToneBadge>
          <ToneBadge tone={signalTone(need.uncovered_work_signal)}>
            未覆盖工作信号：{need.uncovered_work_signal || "未知"}
          </ToneBadge>
        </div>
      </Panel>

      {/* Touched files. */}
      <Panel title="改动文件" hint={`${needFiles.length} 个`}>
        {needFiles.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">暂无改动文件</div>
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
                className={`mt-2 text-sm ${DRILLDOWN_LINK_CLASS}`}
              >
                {needFilesExpanded ? "收起" : `展开全部（${needFiles.length}）`}
              </button>
            )}
          </>
        )}
      </Panel>

      {/* Related sessions. */}
      <Panel title="关联 Sessions" hint={`${sessions.length} 个`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Session</ThLeft>
              <ThLeft>用户</ThLeft>
              <ThLeft>开始</ThLeft>
              <ThLeft>结束</ThLeft>
              <ThRight title="活跃工作量">活跃工作量</ThRight>
              <ThRight title={STAGE_ESTIMATE_TIP}>思考</ThRight>
              <ThRight title={STAGE_ESTIMATE_TIP}>执行</ThRight>
              <ThRight>
                <span className="inline-flex items-center justify-end gap-1">
                  验证
                  <InfoTip tip={VERIFY_UNAVAILABLE_TIP} />
                </span>
              </ThRight>
              <ThLeft>阶段置信</ThLeft>
              <ThLeft>摘要</ThLeft>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <EmptyRow colSpan={10}>暂无 Session</EmptyRow>
            ) : (
              sessions.map((s) => (
                <tr key={s.session_id} className="border-b text-card-foreground last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{shortId(s.session_id)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2" title={s.user_id ?? ""}>
                    {s.user_id ? (
                      <button
                        type="button"
                        onClick={() => push(paths.metricsUserDetail(s.user_id!))}
                        className={DRILLDOWN_LINK_CLASS}
                      >
                        {resolveName(s.user_id)}
                      </button>
                    ) : "-"}
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
      <Panel title="关联 Commits" hint={`${commits.length} 个`} defaultCollapsed bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Commit</ThLeft>
              <ThLeft>提交时间</ThLeft>
              <ThLeft>用户</ThLeft>
              <ThRight>代码行</ThRight>
              <ThRight>AI 代码占比</ThRight>
              <ThLeft>提交说明</ThLeft>
              <ThLeft>改动文件</ThLeft>
            </tr>
          </thead>
          <tbody>
            {commits.length === 0 ? (
              <EmptyRow colSpan={7}>暂无 Commit</EmptyRow>
            ) : (
              commits.map((c) => {
                const files = asFileList(c.touched_files);
                const expanded = expandedCommits.has(c.commit_id);
                return (
                  <Fragment key={c.commit_id}>
                    <tr className="border-b text-card-foreground last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => push(paths.metricsCommitDetail(c.commit_id))}
                          className={`font-mono text-xs ${DRILLDOWN_LINK_CLASS}`}
                          title={c.commit_id}
                        >
                          {shortId(c.commit_id, 10)}
                        </button>
                      </td>
                      <td className="px-3 py-2">{formatLocalTime(c.commit_time)}</td>
                      <td
                        className="max-w-[180px] truncate px-3 py-2"
                        title={c.user_name ? resolveName(c.user_name) : ""}
                      >
                        {c.user_name ? resolveName(c.user_name) : "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtInt(c.diff_lines)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtPct(c.silica)}</td>
                      <td className="max-w-[280px] truncate px-3 py-2" title={c.comment ?? ""}>{c.comment || "-"}</td>
                      <td className="px-3 py-2">
                        {files.length ? (
                          <button
                            type="button"
                            onClick={() => toggleCommitFiles(c.commit_id)}
                            className={DRILLDOWN_LINK_CLASS}
                          >
                            {expanded ? "收起" : `${files.length} 个文件`}
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
  tip,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tip: string;
  accent: "success" | "info" | "primary" | "warning";
}) {
  const accentClass = {
    success: "border-l-success",
    info: "border-l-info",
    primary: "border-l-brand",
    warning: "border-l-warning",
  }[accent];

  return (
    <div
      className={`rounded-2xl border border-l-[3px] bg-card p-4 shadow-sm transition-transform hover:scale-[1.02] ${accentClass}`}
    >
      <div className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
        <span>{label}</span>
        <InfoTip tip={tip} />
      </div>
      <div className="text-2xl font-bold tabular-nums text-card-foreground">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ThLeft({ children, title }: { children: React.ReactNode; title?: string }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground" title={title}>{children}</th>;
}
function ThRight({ children, title }: { children: React.ReactNode; title?: string }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground" title={title}>{children}</th>;
}

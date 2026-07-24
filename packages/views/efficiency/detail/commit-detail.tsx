"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  commitDetailOptions,
  fmtCost,
  formatDuration,
  formatLocalTime,
  formatV2Ratio,
  type CommitDetail as CommitDetailType,
  type RelatedTask,
} from "@multica/core/efficiency";
import { DetailShell } from "./detail-shell";
import { EmptyRow, Kv, KvGrid, Panel, ToneBadge } from "./shared";

// Commit detail page. Ports the source CommitDetail (read-only) to the shared-
// views layer: basic info + metrics + related tasks table.
//
// Caliber (matches source; footguns the source comments call out):
//   - efficiency_ratio is a PERCENTAGE ratio (300 = 300%). The big number is
//     Math.round() + "%", NOT ×100. Rendered via formatPercent, NEVER
//     formatV2Ratio. Coloured by sign (positive=success, negative=destructive).
//   - silica (AI code share) is a 0~1 DECIMAL ratio → formatV2Ratio (×100).
//
// Simplifications vs source (documented per task brief):
//   - No manual-adjustment Modal: the data layer only exposes read queries
//     (no updateCommitManualV2 endpoint). Manual-override VALUES are still
//     rendered (ManualValue) — only the edit affordance is dropped.
//   - No router: user/repo render as text.

interface CommitDetailProps {
  commitId: string;
  onBack: () => void;
}

export function CommitDetail({ commitId, onBack }: CommitDetailProps) {
  const wsId = useWorkspaceId();
  const q = useQuery(commitDetailOptions(wsId, commitId));

  // Top-level efficiency_ratio overrides the commit's own (source §1.2).
  const commit: CommitDetailType = useMemo(() => {
    const c = q.data?.commit ?? ({ commit_id: commitId } as CommitDetailType);
    if (q.data?.efficiency_ratio != null) {
      return { ...c, efficiency_ratio: q.data.efficiency_ratio };
    }
    return c;
  }, [q.data, commitId]);

  const relatedTasks: RelatedTask[] = q.data?.related_tasks ?? [];
  const totalCost = q.data?.total_cost ?? 0;
  const upstream = q.data?.upstream_tokens ?? 0;
  const downstream = q.data?.downstream_tokens ?? 0;
  const totalTokens = upstream + downstream;
  const silica = q.data?.silica ?? commit.silica;
  const ratio = commit.efficiency_ratio;

  // realMinutesExplain (source §1.2): prefer the explicit reason; else if
  // there are related tasks show the Σ(real × AI share) formula; else note
  // there are no related tasks.
  const realMinutesExplain = useMemo(() => {
    if (commit.commit_real_minutes_reason) return commit.commit_real_minutes_reason;
    if (relatedTasks.length > 0) {
      const parts = relatedTasks.map(
        (t) => `${formatDuration(t.task_real_minutes)} × ${((t.silica ?? 0) * 100).toFixed(0)}%`,
      );
      return `computed: Σ(task actual × AI code share)\n${parts.join(" + ")}`;
    }
    return "no related task";
  }, [commit.commit_real_minutes_reason, relatedTasks]);

  return (
    <DetailShell
      onBack={onBack}
      title="Commit detail"
      subtitle={commit.commit_id || "-"}
      loading={q.isLoading}
      error={q.error}
      empty={!q.data?.commit ? "No data for this commit." : undefined}
    >
      {/* Basic info. */}
      <Panel title="Basic info">
        <KvGrid>
          <Kv label="Commit ID" mono>{commit.commit_id || "-"}</Kv>
          <Kv label="User">{commit.user_name || commit.user_id || "-"}</Kv>
          <Kv label="Git user">
            {commit.git_user_name
              ? `${commit.git_user_name}${commit.git_user_email ? ` <${commit.git_user_email}>` : ""}`
              : "-"}
          </Kv>
          <Kv label="Repo">
            {commit.repo_addr
              ? `${commit.repo_addr}#${commit.repo_branch || ""}`
              : "-"}
          </Kv>
          <Kv label="Branch">{commit.repo_branch || "-"}</Kv>
          <Kv label="Commit time">{formatLocalTime(commit.commit_time)}</Kv>
          <Kv label="Message" wide>{commit.comment || "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Metrics. */}
      <Panel title="Metrics">
        <KvGrid>
          <Kv label="Generated code">{commit.diff_lines ?? "-"} lines</Kv>
          <Kv label="Actual time">
            <ManualValue
              manual={commit.commit_real_minutes_manual}
              manualReason={commit.commit_real_minutes_reason_manual}
              original={commit.commit_real_minutes}
              originalReason={realMinutesExplain}
            />
          </Kv>
          <Kv label="Baseline estimate">
            <ManualValue
              manual={commit.commit_ancient_minutes_manual}
              manualReason={commit.commit_ancient_minutes_reason_manual}
              original={commit.commit_ancient_minutes}
              originalReason={commit.commit_ancient_minutes_reason}
            />
          </Kv>
          <Kv label="Efficiency ratio">
            {/* 0 = no-baseline fallback (e.g. governance zeroing); show "-" not a misleading value. */}
            <span className={`text-xl font-bold tabular-nums ${ratioTextClass(ratio)}`}>
              {ratio != null && ratio !== 0 ? `${Math.round(ratio)}%` : "-"}
            </span>
          </Kv>
          <Kv
            label="AI code share"
            title="share of commit code generated by AI tasks, weighted by related-task diff lines"
          >
            {silica != null ? (
              <span className="text-base font-bold tabular-nums text-success">{formatV2Ratio(silica)}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </Kv>
          <Kv label="Total tokens" title={`upstream ${upstream} / downstream ${downstream}`}>
            {totalTokens > 0 ? totalTokens.toLocaleString() : "-"}
          </Kv>
          <Kv label="Cost">{totalCost > 0 ? fmtCost(totalCost) : "-"}</Kv>
        </KvGrid>
      </Panel>

      {/* Related tasks. */}
      <Panel title="Related tasks" hint={`${relatedTasks.length}`} bodyClassName="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <ThLeft>Task ID</ThLeft>
              <ThLeft>User</ThLeft>
              <ThLeft>Start</ThLeft>
              <ThRight>LOC</ThRight>
              <ThRight>Actual time</ThRight>
              <ThCenter>AI code share</ThCenter>
              <ThRight>Cost</ThRight>
            </tr>
          </thead>
          <tbody>
            {relatedTasks.length === 0 ? (
              <EmptyRow colSpan={7}>No related tasks</EmptyRow>
            ) : (
              relatedTasks.map((t) => (
                <tr
                  key={t.task_id}
                  className="border-b text-card-foreground transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-3 py-2">
                    <span className="block max-w-[200px] truncate font-mono text-xs" title={t.task_id}>
                      {t.task_id}
                    </span>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2" title={t.user_name ?? ""}>
                    {t.user_name || "-"}
                  </td>
                  <td className="px-3 py-2">{formatLocalTime(t.start_time)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{t.diff_lines ?? "-"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatDuration(t.task_real_minutes)}</td>
                  <td className="px-3 py-2 text-center">
                    {t.silica != null ? (
                      <ToneBadge tone={relatedSilicaTone(t.silica)}>{formatV2Ratio(t.silica)}</ToneBadge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {t.cost != null && t.cost > 0 ? t.cost.toFixed(2) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Panel>
    </DetailShell>
  );
}

// ---- helpers ----

/** Related-task AI code share tone (0~1 decimal caliber). */
function relatedSilicaTone(v: number): "success" | "primary" | "info" {
  if (v >= 0.8) return "success";
  if (v >= 0.5) return "primary";
  return "info";
}

/** Efficiency ratio colour: positive=success, negative=destructive, else muted. */
function ratioTextClass(ratio: number | null | undefined): string {
  if (ratio == null || ratio === 0) return "text-muted-foreground";
  return ratio > 0 ? "text-success" : "text-destructive";
}

// Manual-override display (shared shape with task-detail; duplicated because
// the two pages live in separate files and the component is tiny — pulling it
// into shared.tsx would couple the two pages' reason-tooltip UX).
function ManualValue({
  manual,
  manualReason,
  original,
  originalReason,
}: {
  manual?: number | null;
  manualReason?: string;
  original?: number | null;
  originalReason?: string;
}) {
  if (manual != null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span title={manualReason}>{formatDuration(manual)}</span>
        <span className="line-through text-muted-foreground" title={originalReason}>
          {original != null ? formatDuration(original) : "(no AI value)"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" title={originalReason}>
      {formatDuration(original)}
    </span>
  );
}

function ThLeft({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">{children}</th>;
}
function ThRight({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-muted-foreground">{children}</th>;
}
function ThCenter({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-center font-semibold text-muted-foreground">{children}</th>;
}

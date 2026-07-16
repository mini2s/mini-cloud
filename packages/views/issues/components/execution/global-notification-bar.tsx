"use client";

import { useMemo } from "react";
import type { WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";

export interface GlobalNotificationBarProps {
  nodeRunMap: Map<string, WorkflowNodeRun>;
  onScrollToNode: (nodeId: string) => void;
}

interface RunProgressSummary {
  total: number;
  done: number;
  running: number;
  blocked: number;
  waiting: number;
  firstRunningNodeId: string | null;
  firstBlockedNodeId: string | null;
  firstWaitingNodeId: string | null;
  currentNodeTitle: string | null;
  elapsedLabel: string;
}

function isDoneStatus(status: string): boolean {
  return status === "completed" || status === "critic_approved" || status === "format_ok";
}

function isBlockedStatus(status: string): boolean {
  return status === "blocked" ||
    status === "failed" ||
    status === "format_failed" ||
    status === "critic_rework";
}

function isRunningStatus(status: string): boolean {
  return status === "working" ||
    status === "worker_assigned" ||
    status === "critic_reviewing" ||
    status === "format_checking" ||
    status === "awaiting_critic" ||
    status === "awaiting_input" ||
    status === "awaiting_split_review" ||
    status === "splitting" ||
    status === "split_active";
}

function runActionPriority(status: string): number {
  if (isBlockedStatus(status)) return 50;
  if (status === "awaiting_critic" || status === "awaiting_split_review") return 40;
  if (status === "awaiting_input") return 35;
  if (isRunningStatus(status)) return 30;
  if (!isDoneStatus(status)) return 10;
  return 0;
}

function formatElapsed(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return "--";
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return "--";
  const seconds = Math.max(0, Math.floor((now - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function deriveRunProgress(nodeRunMap: Map<string, WorkflowNodeRun>): RunProgressSummary {
  const entries = [...nodeRunMap.entries()];
  const runs = entries.map(([, run]) => run);
  const prioritizedEntries = entries
    .map(([nodeId, run], index) => ({
      nodeId,
      run,
      index,
      priority: runActionPriority(run.status),
    }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const done = runs.filter((run) => isDoneStatus(run.status)).length;
  const blocked = runs.filter((run) => isBlockedStatus(run.status)).length;
  const running = runs.filter((run) => isRunningStatus(run.status)).length;
  const waiting = Math.max(0, runs.length - done - blocked - running);
  const firstRunningNodeId = prioritizedEntries.find(({ run }) => isRunningStatus(run.status))?.nodeId ?? null;
  const firstBlockedNodeId = prioritizedEntries.find(({ run }) => isBlockedStatus(run.status))?.nodeId ?? null;
  const firstWaitingNodeId = prioritizedEntries.find(({ run }) =>
    !isDoneStatus(run.status) && !isBlockedStatus(run.status) && !isRunningStatus(run.status)
  )?.nodeId ?? null;
  const currentRun = prioritizedEntries.find(({ priority }) => priority > 0)?.run;
  const earliestStart = runs
    .map((run) => run.started_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return {
    total: runs.length,
    done,
    running,
    blocked,
    waiting,
    firstRunningNodeId,
    firstBlockedNodeId,
    firstWaitingNodeId,
    currentNodeTitle: currentRun?.node_title ?? null,
    elapsedLabel: formatElapsed(earliestStart),
  };
}

function ProgressChip({
  testId,
  label,
  nodeId,
  tone,
  onScrollToNode,
}: {
  testId: string;
  label: string;
  nodeId: string | null;
  tone: "running" | "blocked" | "waiting";
  onScrollToNode: (nodeId: string) => void;
}) {
  const toneClassName = {
    running: "border-blue-200/70 bg-blue-50/70 text-blue-700 hover:border-blue-300 hover:bg-blue-100/70",
    blocked: "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/40 hover:bg-destructive/15",
    waiting: "border-slate-200 bg-muted/25 text-muted-foreground hover:border-slate-300 hover:bg-muted/50",
  }[tone];

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={!nodeId}
      onClick={() => {
        if (nodeId) onScrollToNode(nodeId);
      }}
      className={cn(
        "rounded-md border px-2 py-1 tabular-nums transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        toneClassName,
        !nodeId && "cursor-default opacity-60 hover:bg-muted/25",
      )}
    >
      {label}
    </button>
  );
}

type ProgressChipTone = "running" | "blocked" | "waiting";

interface ProgressChipItem {
  key: ProgressChipTone;
  testId: string;
  label: string;
  nodeId: string | null;
  tone: ProgressChipTone;
  count: number;
  priority: number;
}

export function GlobalNotificationBar({
  nodeRunMap,
  onScrollToNode,
}: GlobalNotificationBarProps) {
  const { t } = useT("issues");

  const progress = useMemo(
    () => deriveRunProgress(nodeRunMap),
    [nodeRunMap],
  );

  if (progress.total === 0) return null;

  const hasActionableNodes = progress.running > 0 || progress.blocked > 0 || progress.waiting > 0;
  const progressChips: ProgressChipItem[] = [
    {
      key: "blocked",
      testId: "progress-chip-blocked",
      label: t(($) => $.execution.notification.blocked_count, { count: progress.blocked }),
      nodeId: progress.firstBlockedNodeId,
      tone: "blocked",
      count: progress.blocked,
      priority: 30,
    },
    {
      key: "running",
      testId: "progress-chip-running",
      label: t(($) => $.execution.notification.running_count, { count: progress.running }),
      nodeId: progress.firstRunningNodeId,
      tone: "running",
      count: progress.running,
      priority: 20,
    },
    {
      key: "waiting",
      testId: "progress-chip-waiting",
      label: t(($) => $.execution.notification.waiting_count, { count: progress.waiting }),
      nodeId: progress.firstWaitingNodeId,
      tone: "waiting",
      count: progress.waiting,
      priority: 10,
    },
  ].sort((a, b) => {
    const activeDelta = Number(b.count > 0) - Number(a.count > 0);
    if (activeDelta !== 0) return activeDelta;
    return b.priority - a.priority;
  });

  return (
    <div
      data-testid="global-notification-bar"
      className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <div className="flex min-h-11 flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
        <div
          data-testid="notification-summary"
          className="flex min-w-0 shrink-0 items-center gap-2"
        >
          <span
            className={cn(
              "relative grid h-6 w-6 shrink-0 place-items-center rounded-md border",
              progress.blocked > 0
                ? "border-destructive/25 bg-destructive/10 text-destructive"
                : hasActionableNodes
                  ? "border-blue-200/70 bg-blue-50/70 text-blue-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
            )}
          >
            {progress.blocked > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
              />
            ) : null}
            {progress.blocked > 0 ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {t(($) => $.execution.notification.progress_title)}
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {t(($) => $.execution.notification.progress_done, { done: progress.done, total: progress.total })}
              </span>
            </div>
            <div className="hidden truncate text-[11px] leading-4 text-muted-foreground sm:block">
              {progress.currentNodeTitle
                ? t(($) => $.execution.notification.current_node, { title: progress.currentNodeTitle })
                : t(($) => $.execution.notification.no_current_node)}
            </div>
          </div>
        </div>

        <div
          data-testid="run-progress-counts"
          className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          {progressChips.map((chip) => (
            <ProgressChip
              key={chip.key}
              testId={chip.testId}
              label={chip.label}
              nodeId={chip.nodeId}
              tone={chip.tone}
              onScrollToNode={onScrollToNode}
            />
          ))}
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/20 px-2 py-1 tabular-nums">
            <Clock3 className="size-3" />
            {t(($) => $.execution.notification.elapsed, { elapsed: progress.elapsedLabel })}
          </span>
        </div>

        <div
          data-testid="notification-rail"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end"
        >
          {!hasActionableNodes ? (
            <span className="inline-flex h-7 items-center rounded-md border border-border/70 bg-muted/25 px-2.5 text-xs font-medium text-muted-foreground">
              {t(($) => $.execution.notification.no_action_needed)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

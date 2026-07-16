"use client";

import { useMemo } from "react";
import type { WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, MessageSquare, UserCheck } from "lucide-react";

export interface NotificationItem {
  type: "awaiting_critic" | "blocked_failed" | "awaiting_input";
  count: number;
  firstNodeRunId: string;
  firstNodeId: string;
}

export interface GlobalNotificationBarProps {
  nodeRunMap: Map<string, WorkflowNodeRun>;
  onScrollToNode: (nodeId: string) => void;
}

const NOTIFICATION_PRIORITY: NotificationItem["type"][] = [
  "blocked_failed",
  "awaiting_critic",
  "awaiting_input",
];

/**
 * Derives notification items from the node-run map, ordered by priority:
 * 1. blocked / failed (highest)
 * 2. awaiting_critic
 * 3. awaiting_input (lowest)
 */
function deriveNotifications(
  nodeRunMap: Map<string, WorkflowNodeRun>,
): NotificationItem[] {
  const entries = [...nodeRunMap.entries()];
  const grouped: Record<NotificationItem["type"], Array<[string, WorkflowNodeRun]>> = {
    blocked_failed: entries.filter(
      ([, nr]) => nr.status === "blocked" || nr.status === "failed",
    ),
    awaiting_critic: entries.filter(
      ([, nr]) => nr.status === "awaiting_critic",
    ),
    awaiting_input: entries.filter(
      ([, nr]) => nr.status === "awaiting_input",
    ),
  };

  return NOTIFICATION_PRIORITY.flatMap((type) => {
    const matches = grouped[type];
    if (matches.length === 0) return [];
    return [{
      type,
      count: matches.length,
      firstNodeRunId: matches[0]![1].id,
      firstNodeId: matches[0]![0],
    }];
  });
}

interface RunProgressSummary {
  total: number;
  done: number;
  running: number;
  blocked: number;
  waiting: number;
  currentNodeTitle: string | null;
  elapsedLabel: string;
}

function isDoneStatus(status: string): boolean {
  return status === "completed" || status === "critic_approved" || status === "format_ok";
}

function isBlockedStatus(status: string): boolean {
  return status === "blocked" || status === "failed" || status === "format_failed";
}

function isRunningStatus(status: string): boolean {
  return status === "working" ||
    status === "worker_assigned" ||
    status === "critic_reviewing" ||
    status === "awaiting_critic" ||
    status === "awaiting_input" ||
    status === "splitting" ||
    status === "split_active";
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
  const runs = [...nodeRunMap.values()];
  const done = runs.filter((run) => isDoneStatus(run.status)).length;
  const blocked = runs.filter((run) => isBlockedStatus(run.status)).length;
  const running = runs.filter((run) => isRunningStatus(run.status)).length;
  const waiting = Math.max(0, runs.length - done - blocked - running);
  const currentRun = runs.find((run) => isRunningStatus(run.status)) ??
    runs.find((run) => isBlockedStatus(run.status)) ??
    runs.find((run) => !isDoneStatus(run.status));
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
    currentNodeTitle: currentRun?.node_title ?? null,
    elapsedLabel: formatElapsed(earliestStart),
  };
}

/** Priority-ordered icon + color config per notification type. */
const NOTIFICATION_CONFIG: Record<
  NotificationItem["type"],
  {
    icon: typeof AlertCircle;
    iconClass: string;
    countClass: string;
    dotClass: string;
  }
> = {
  awaiting_critic: {
    icon: MessageSquare,
    iconClass: "text-brand",
    countClass: "border-brand/20 bg-brand/10 text-brand",
    dotClass: "bg-brand",
  },
  blocked_failed: {
    icon: AlertCircle,
    iconClass: "text-destructive",
    countClass: "border-destructive/25 bg-destructive/10 text-destructive",
    dotClass: "bg-destructive animate-pulse",
  },
  awaiting_input: {
    icon: UserCheck,
    iconClass: "text-warning",
    countClass: "border-warning/25 bg-warning/10 text-warning",
    dotClass: "bg-warning",
  },
};

export function GlobalNotificationBar({
  nodeRunMap,
  onScrollToNode,
}: GlobalNotificationBarProps) {
  const { t } = useT("issues");

  const items = useMemo(
    () => deriveNotifications(nodeRunMap),
    [nodeRunMap],
  );
  const progress = useMemo(
    () => deriveRunProgress(nodeRunMap),
    [nodeRunMap],
  );

  if (progress.total === 0) return null;

  const primaryItem = items[0];
  const primaryConfig = primaryItem ? NOTIFICATION_CONFIG[primaryItem.type] : null;
  const PrimaryIcon = primaryConfig?.icon;

  const getLabel = (type: NotificationItem["type"]) => {
    switch (type) {
      case "awaiting_critic":
        return t(($) => $.execution.notification.awaiting_critic);
      case "blocked_failed":
        return t(($) => $.execution.notification.blocked_failed);
      case "awaiting_input":
        return t(($) => $.execution.notification.awaiting_input);
    }
  };

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
              primaryConfig?.countClass ?? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
            )}
          >
            {primaryConfig ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                  primaryConfig.dotClass,
                )}
              />
            ) : null}
            {PrimaryIcon ? <PrimaryIcon className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
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
          <span className="rounded-md border bg-muted/20 px-2 py-1 tabular-nums">
            {t(($) => $.execution.notification.running_count, { count: progress.running })}
          </span>
          <span className="rounded-md border bg-muted/20 px-2 py-1 tabular-nums">
            {t(($) => $.execution.notification.blocked_count, { count: progress.blocked })}
          </span>
          <span className="rounded-md border bg-muted/20 px-2 py-1 tabular-nums">
            {t(($) => $.execution.notification.waiting_count, { count: progress.waiting })}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/20 px-2 py-1 tabular-nums">
            <Clock3 className="size-3" />
            {t(($) => $.execution.notification.elapsed, { elapsed: progress.elapsedLabel })}
          </span>
        </div>

        <div
          data-testid="notification-rail"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end"
        >
          {items.length === 0 ? (
            <span className="inline-flex h-7 items-center rounded-md border border-border/70 bg-muted/25 px-2.5 text-xs font-medium text-muted-foreground">
              {t(($) => $.execution.notification.no_action_needed)}
            </span>
          ) : items.map((item) => {
            const config = NOTIFICATION_CONFIG[item.type];
            const Icon = config.icon;
            const label = getLabel(item.type);

            return (
              <button
                key={item.type}
                type="button"
                data-testid={`notification-item-${item.type}`}
                aria-label={`${label} ${item.count}`}
                onClick={() => onScrollToNode(item.firstNodeId)}
                className={cn(
                  "group inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5",
                  "bg-muted/25 text-xs font-medium text-foreground transition-colors hover:bg-muted/60",
                  "border-border/70",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", config.iconClass)} />
                <span className="min-w-0 truncate">{label}</span>
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm border px-1 text-[10px] leading-none tabular-nums",
                    config.countClass,
                  )}
                >
                  {item.count}
                </span>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-80" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

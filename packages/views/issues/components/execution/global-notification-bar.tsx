"use client";

import { useMemo } from "react";
import type { WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AlertCircle, ChevronRight, MessageSquare, UserCheck } from "lucide-react";

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

/**
 * Derives notification items from the node-run map, ordered by priority:
 * 1. awaiting_critic (highest)
 * 2. blocked / failed
 * 3. awaiting_input (lowest)
 */
function deriveNotifications(
  nodeRunMap: Map<string, WorkflowNodeRun>,
): NotificationItem[] {
  const items: NotificationItem[] = [];
  const entries = [...nodeRunMap.entries()];

  const awaitingCritic = entries.filter(
    ([, nr]) => nr.status === "awaiting_critic",
  );
  const blockedFailed = entries.filter(
    ([, nr]) => nr.status === "blocked" || nr.status === "failed",
  );
  const awaitingInput = entries.filter(
    ([, nr]) => nr.status === "awaiting_input",
  );

  if (awaitingCritic.length > 0) {
    items.push({
      type: "awaiting_critic",
      count: awaitingCritic.length,
      firstNodeRunId: awaitingCritic[0]![1].id,
      firstNodeId: awaitingCritic[0]![0],
    });
  }

  if (blockedFailed.length > 0) {
    items.push({
      type: "blocked_failed",
      count: blockedFailed.length,
      firstNodeRunId: blockedFailed[0]![1].id,
      firstNodeId: blockedFailed[0]![0],
    });
  }

  if (awaitingInput.length > 0) {
    items.push({
      type: "awaiting_input",
      count: awaitingInput.length,
      firstNodeRunId: awaitingInput[0]![1].id,
      firstNodeId: awaitingInput[0]![0],
    });
  }

  return items;
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

  if (items.length === 0) return null;

  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const primaryItem = items[0]!;
  const primaryConfig = NOTIFICATION_CONFIG[primaryItem.type];
  const PrimaryIcon = primaryConfig.icon;

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
              primaryConfig.countClass,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                primaryConfig.dotClass,
              )}
            />
            <PrimaryIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {getLabel(primaryItem.type)}
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {totalCount}
              </span>
            </div>
            <div className="hidden truncate text-[11px] leading-4 text-muted-foreground sm:block">
              {t(($) => $.execution.notification.summary_label, { count: items.length })}
            </div>
          </div>
        </div>

        <div
          data-testid="notification-rail"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:justify-end"
        >
          {items.map((item) => {
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

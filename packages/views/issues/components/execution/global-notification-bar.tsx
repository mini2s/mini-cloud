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
    chipClass: string;
    dotClass: string;
  }
> = {
  awaiting_critic: {
    icon: MessageSquare,
    chipClass:
      "border-violet-200 bg-violet-50/60 text-violet-700 hover:bg-violet-100 hover:border-violet-300 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50",
    dotClass: "bg-violet-500",
  },
  blocked_failed: {
    icon: AlertCircle,
    chipClass:
      "border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100 hover:border-red-300 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60",
    dotClass: "bg-red-500 animate-ping",
  },
  awaiting_input: {
    icon: UserCheck,
    chipClass:
      "border-amber-200 bg-amber-50/60 text-amber-700 hover:bg-amber-100 hover:border-amber-300 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
    dotClass: "bg-amber-500",
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

  return (
    <div
      data-testid="global-notification-bar"
      className="shrink-0 border-b bg-background"
    >
      <div className="flex items-center gap-3 px-5 h-10">
        {/* Status indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {items[0] && (
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  NOTIFICATION_CONFIG[items[0].type].dotClass,
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  NOTIFICATION_CONFIG[items[0].type].dotClass.replace("animate-ping", ""),
                )}
              />
            </span>
          )}
        </div>

        {/* Notification chips */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0 flex-wrap">
          {items.map((item) => {
            const config = NOTIFICATION_CONFIG[item.type];
            const Icon = config.icon;

            const label =
              item.type === "awaiting_critic"
                ? `${t(($) => $.execution.notification.awaiting_critic)} ${item.count}`
                : item.type === "blocked_failed"
                  ? `${t(($) => $.execution.notification.blocked_failed)} ${item.count}`
                  : `${t(($) => $.execution.notification.awaiting_input)} ${item.count}`;

            return (
              <button
                key={item.type}
                type="button"
                data-testid={`notification-item-${item.type}`}
                onClick={() => onScrollToNode(item.firstNodeId)}
                className={cn(
                  "group inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
                  "text-[11px] leading-5 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  config.chipClass,
                )}
              >
                <Icon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="font-medium tracking-tight">{label}</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

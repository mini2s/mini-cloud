"use client";

import type { WorkflowNodeRun, NodeRunStatus } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { AlertCircle, Clock, Eye, AlertTriangle } from "lucide-react";

export interface NotificationItem {
  nodeId: string;
  type: "awaiting_critic" | "blocked" | "failed" | "awaiting_input";
  priority: "high" | "medium";
  message: string;
}

const HIGH_PRIORITY_STATUSES: NodeRunStatus[] = ["awaiting_critic"];
const MEDIUM_PRIORITY_STATUSES: NodeRunStatus[] = ["blocked", "failed", "awaiting_input"];

const NOTIF_ICONS: Record<NotificationItem["type"], React.ReactNode> = {
  awaiting_critic: <Eye className="h-3.5 w-3.5" />,
  blocked: <AlertCircle className="h-3.5 w-3.5" />,
  failed: <AlertTriangle className="h-3.5 w-3.5" />,
  awaiting_input: <Clock className="h-3.5 w-3.5" />,
};

export function aggregateNotifications(nodeRuns: Map<string, WorkflowNodeRun>): NotificationItem[] {
  const items: NotificationItem[] = [];

  for (const [nodeId, run] of nodeRuns) {
    if (HIGH_PRIORITY_STATUSES.includes(run.status)) {
      items.push({
        nodeId,
        type: run.status as NotificationItem["type"],
        priority: "high",
        message: `"${run.node_title}" is waiting for critic review`,
      });
    } else if (MEDIUM_PRIORITY_STATUSES.includes(run.status)) {
      items.push({
        nodeId,
        type: run.status as NotificationItem["type"],
        priority: "medium",
        message: `"${run.node_title}" ${run.status === "failed" ? "has failed" : run.status === "blocked" ? "is blocked" : "needs input"}`,
      });
    }
  }

  // Sort: high priority first, then medium
  return items.sort((a, b) => (a.priority === "high" ? -1 : 1) - (b.priority === "high" ? -1 : 1));
}

export interface GlobalNotificationBarProps {
  nodeRuns: Map<string, WorkflowNodeRun>;
  onNotificationClick?: (nodeId: string) => void;
  className?: string;
}

export function GlobalNotificationBar({ nodeRuns, onNotificationClick, className }: GlobalNotificationBarProps) {
  const notifications = aggregateNotifications(nodeRuns);
  if (notifications.length === 0) return null;

  return (
    <div
      data-testid="global-notification-bar"
      className={cn("flex items-center gap-3 px-4 py-2 bg-muted/60 border-b text-xs", className)}
    >
      <span className="font-medium text-muted-foreground">
        {notifications.length} {notifications.length === 1 ? "issue" : "issues"} need{notifications.length === 1 ? "s" : ""} attention
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {notifications.map((notif) => (
          <button
            key={notif.nodeId}
            type="button"
            onClick={() => onNotificationClick?.(notif.nodeId)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded hover:underline cursor-pointer",
              notif.priority === "high" ? "text-brand bg-brand/5" : "text-muted-foreground",
            )}
          >
            {NOTIF_ICONS[notif.type]}
            <span className="truncate max-w-[200px]">{notif.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

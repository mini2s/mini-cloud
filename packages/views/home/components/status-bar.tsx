"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, Bot, ListTodo } from "lucide-react";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { useWorkspaceId } from "@multica/core/hooks";
import { useInboxUnreadCount } from "@multica/core/inbox/queries";
import { agentTaskSnapshotOptions } from "@multica/core/agents/queries";
import { issueListOptions } from "@multica/core/issues/queries";
import { useT } from "../../i18n";

/**
 * One-line workspace posture summary pinned to the top of the home page:
 * in-flight issues · working agents · unread notifications. A blocked-issue
 * count is appended in destructive when non-zero so problems surface
 * without scanning the sections below.
 */
export function StatusBar() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();

  const issuesQuery = useQuery(issueListOptions(wsId));
  const snapshotQuery = useQuery(agentTaskSnapshotOptions(wsId));
  const unreadCount = useInboxUnreadCount(wsId);

  const stats = useMemo(() => {
    let inProgress = 0;
    let blocked = 0;
    for (const issue of issuesQuery.data ?? []) {
      if (issue.status === "in_progress" || issue.status === "in_review") {
        inProgress += 1;
      } else if (issue.status === "blocked") {
        blocked += 1;
      }
    }
    const workingAgents = new Set<string>();
    for (const task of snapshotQuery.data ?? []) {
      if (task.status === "running") workingAgents.add(task.agent_id);
    }
    return { inProgress, blocked, workingAgents: workingAgents.size };
  }, [issuesQuery.data, snapshotQuery.data]);

  if (issuesQuery.isLoading || snapshotQuery.isLoading) {
    return <Skeleton className="h-9 w-full rounded-lg" />;
  }

  const hasAttention = stats.blocked > 0 || unreadCount > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2 text-xs",
        stats.blocked > 0
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted/40",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <ListTodo className="size-3.5" />
        {t(($) => $.status_bar.in_progress, { count: stats.inProgress })}
      </span>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Bot className="size-3.5" />
        {t(($) => $.status_bar.agents_working, { count: stats.workingAgents })}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        <Bell className="size-3.5" />
        {t(($) => $.status_bar.unread, { count: unreadCount })}
      </span>
      {stats.blocked > 0 && (
        <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
          <AlertTriangle className="size-3.5" />
          {t(($) => $.status_bar.blocked, { count: stats.blocked })}
        </span>
      )}
      {!hasAttention && (
        <span className="ml-auto text-success">{t(($) => $.status_bar.all_clear)}</span>
      )}
    </div>
  );
}

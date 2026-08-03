"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { issueListOptions } from "@multica/core/issues/queries";
import { agentActivity30dOptions } from "@multica/core/agents/queries";
import { dashboardAgentRunTimeOptions } from "@multica/core/dashboard/queries";
import { AppLink } from "../../navigation";
import { useViewingTimezone } from "../../common/use-viewing-timezone";
import { useT } from "../../i18n";
import { aggregateActivity } from "./utils";

function StatCard({
  label,
  value,
  hint,
  href,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
  loading: boolean;
}) {
  return (
    <AppLink href={href} className="block">
      <Card size="sm" className="h-full transition-colors hover:bg-accent/50">
        <CardContent className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <>
              <span className="text-2xl font-semibold tabular-nums">{value}</span>
              {hint && (
                <span className="text-xs text-muted-foreground">{hint}</span>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </AppLink>
  );
}

/**
 * Four headline numbers, all computed from the same caches the rest of the
 * app uses (issue list, agent activity rollup, dashboard run-time):
 *
 *   - Completion rate: done / total. `issueListOptions` already excludes
 *     cancelled (board statuses only), so the denominator needs no
 *     adjustment. First-page-per-status caps each bucket at 50, which is
 *     acceptable for a headline percentage.
 *   - Active tasks: in_progress + in_review from the same list.
 *   - Done this week: completed agent tasks over the trailing 7 local days.
 *   - Failure rate: Σfailed / Σtasks from the 7-day agent run-time rollup.
 */
export function StatsSection() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const viewTZ = useViewingTimezone();

  const issuesQuery = useQuery(issueListOptions(wsId));
  const activityQuery = useQuery(agentActivity30dOptions(wsId));
  const runTimeQuery = useQuery(
    dashboardAgentRunTimeOptions(wsId, 7, null, viewTZ),
  );

  const issueStats = useMemo(() => {
    const issues = issuesQuery.data ?? [];
    let done = 0;
    let active = 0;
    for (const issue of issues) {
      if (issue.status === "done") done += 1;
      else if (issue.status === "in_progress" || issue.status === "in_review")
        active += 1;
    }
    const completionRate =
      issues.length > 0 ? Math.round((done / issues.length) * 100) : null;
    return { done, active, completionRate, total: issues.length };
  }, [issuesQuery.data]);

  const weeklyDone = useMemo(
    () => aggregateActivity(activityQuery.data ?? [], 7).totalRuns,
    [activityQuery.data],
  );

  const failureRate = useMemo(() => {
    const rows = runTimeQuery.data ?? [];
    let tasks = 0;
    let failed = 0;
    for (const row of rows) {
      tasks += row.task_count;
      failed += row.failed_count;
    }
    if (tasks === 0) return null;
    return Math.round((failed / tasks) * 100);
  }, [runTimeQuery.data]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t(($) => $.stats.section)}</h2>
        <span className="text-xs text-muted-foreground">
          {t(($) => $.stats.period)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t(($) => $.stats.completion_rate)}
          value={
            issueStats.completionRate === null
              ? "—"
              : `${issueStats.completionRate}%`
          }
          hint={t(($) => $.stats.completion_hint, {
            done: issueStats.done,
            total: issueStats.total,
          })}
          href={paths.issues()}
          loading={issuesQuery.isLoading}
        />
        <StatCard
          label={t(($) => $.stats.active_tasks)}
          value={String(issueStats.active)}
          href={paths.issues()}
          loading={issuesQuery.isLoading}
        />
        <StatCard
          label={t(($) => $.stats.done_this_week)}
          value={String(weeklyDone)}
          href={paths.metricsOverview()}
          loading={activityQuery.isLoading}
        />
        <StatCard
          label={t(($) => $.stats.failure_rate)}
          value={failureRate === null ? "—" : `${failureRate}%`}
          href={paths.metricsOverview()}
          loading={runTimeQuery.isLoading}
        />
      </div>
    </section>
  );
}

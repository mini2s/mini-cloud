"use client";

import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@multica/ui/components/ui/card";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths, type WorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import {
  agentActivity30dOptions,
  agentTaskSnapshotOptions,
  useWorkspacePresenceMap,
} from "@multica/core/agents";
import { issueListOptions } from "@multica/core/issues/queries";
import type { Agent, AgentTask, Issue } from "@multica/core/types";
import { AppLink } from "../../navigation";
import { Sparkline } from "../../agents/components/sparkline";
import { useT } from "../../i18n";
import { aggregateActivity, runDuration } from "./utils";

const RUNNING_PREVIEW_COUNT = 6;
const TREND_DAYS = 7;

interface PresenceCounts {
  working: number;
  queued: number;
  stuck: number;
  idle: number;
  offline: number;
}

/**
 * Fold the workspace presence map into five mutually exclusive buckets.
 * "stuck" is the highlight case: work queued but the runtime can't take it
 * (offline / unstable) — the agent equivalent of a blocked issue.
 */
function countPresence(
  agents: readonly Agent[],
  byAgent: Map<string, { availability: string; workload: string }>,
): PresenceCounts {
  const counts: PresenceCounts = { working: 0, queued: 0, stuck: 0, idle: 0, offline: 0 };
  for (const agent of agents) {
    const p = byAgent.get(agent.id);
    if (!p) {
      counts.offline += 1;
      continue;
    }
    if (p.workload === "working") counts.working += 1;
    else if (p.workload === "queued") {
      if (p.availability === "online") counts.queued += 1;
      else counts.stuck += 1;
    } else if (p.availability === "offline") counts.offline += 1;
    else counts.idle += 1;
  }
  return counts;
}

const RunningTaskRow = memo(function RunningTaskRow({
  task,
  agentName,
  issue,
  paths,
  durationLabel,
}: {
  task: AgentTask;
  agentName: string;
  issue: Issue | undefined;
  paths: WorkspacePaths;
  durationLabel: string;
}) {
  const label = issue
    ? `${issue.identifier} ${issue.title}`
    : task.trigger_summary || task.id.slice(0, 8);
  const href = issue ? paths.issueDetail(issue.id) : paths.agents();
  return (
    <li>
      <AppLink
        href={href}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
      >
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand" />
        <span className="shrink-0 text-sm font-medium">{agentName}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {label}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {durationLabel}
        </span>
      </AppLink>
    </li>
  );
});

/**
 * "AI colleagues" — left card is the fleet-wide presence distribution plus
 * the trailing-7-day completion sparkline; right card lists the tasks
 * agents are executing right now (agent × issue × elapsed time).
 */
export function AgentActivitySection() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();

  const { data: agents = [], isLoading: agentsLoading } = useQuery(
    agentListOptions(wsId),
  );
  const { byAgent: presenceById, loading: presenceLoading } =
    useWorkspacePresenceMap(wsId);
  const { data: snapshot = [], isLoading: snapshotLoading } = useQuery(
    agentTaskSnapshotOptions(wsId),
  );
  const activityQuery = useQuery(agentActivity30dOptions(wsId));
  const { data: issues = [] } = useQuery(issueListOptions(wsId));

  const counts = useMemo(
    () => countPresence(agents, presenceById),
    [agents, presenceById],
  );

  const trend = useMemo(
    () => aggregateActivity(activityQuery.data ?? [], TREND_DAYS),
    [activityQuery.data],
  );

  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const issueById = useMemo(
    () => new Map(issues.map((i) => [i.id, i])),
    [issues],
  );

  const runningTasks = useMemo(
    () =>
      snapshot
        .filter((task) => task.status === "running")
        .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""))
        .slice(0, RUNNING_PREVIEW_COUNT),
    [snapshot],
  );

  const distribution: {
    key: keyof PresenceCounts;
    label: string;
    dot: string;
    highlight?: boolean;
  }[] = [
    { key: "working", label: t(($) => $.agents.working), dot: "bg-brand" },
    { key: "queued", label: t(($) => $.agents.queued), dot: "bg-warning" },
    {
      key: "stuck",
      label: t(($) => $.agents.stuck),
      dot: "bg-destructive",
      highlight: counts.stuck > 0,
    },
    { key: "idle", label: t(($) => $.agents.idle), dot: "bg-success" },
    {
      key: "offline",
      label: t(($) => $.agents.offline),
      dot: "bg-muted-foreground/40",
    },
  ];

  const distributionLoading = agentsLoading || presenceLoading;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t(($) => $.agents.section)}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Presence distribution + 7d trend */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">
              {t(($) => $.agents.distribution_title)}
            </CardTitle>
            <CardAction>
              <AppLink
                href={paths.agents()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <span>{t(($) => $.action_required.view_all)}</span>
                <ArrowRight className="size-3" />
              </AppLink>
            </CardAction>
          </CardHeader>
          <CardContent className="gap-3">
            {distributionLoading ? (
              <>
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </>
            ) : (
              <ul className="space-y-1.5">
                {distribution.map((row) => (
                  <li
                    key={row.key}
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      row.highlight && "font-medium text-destructive",
                    )}
                  >
                    <span className={cn("size-2 rounded-full", row.dot)} />
                    <span
                      className={cn(
                        "flex-1",
                        row.highlight ? "" : "text-muted-foreground",
                      )}
                    >
                      {row.label}
                    </span>
                    <span className="tabular-nums">{counts[row.key]}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {t(($) => $.agents.trend_title)}
                </p>
                <p className="text-sm font-medium tabular-nums">
                  {t(($) => $.agents.tasks_completed, { count: trend.totalRuns })}
                </p>
              </div>
              {activityQuery.isLoading ? (
                <Skeleton className="h-7 w-[140px]" />
              ) : (
                <Sparkline buckets={trend.buckets} width={140} height={28} />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Running tasks */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">
              {t(($) => $.agents.running_title)}
            </CardTitle>
          </CardHeader>
          {snapshotLoading ? (
            <CardContent className="gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </CardContent>
          ) : runningTasks.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              {t(($) => $.agents.running_empty)}
            </p>
          ) : (
            <CardContent className="gap-0">
              <ul className="divide-y divide-border/60">
                {runningTasks.map((task) => {
                  const duration = runDuration(task.started_at);
                  const durationLabel =
                    duration.unit === "now"
                      ? t(($) => $.agents.duration_now)
                      : duration.unit === "minutes"
                        ? t(($) => $.agents.duration_minutes, {
                            count: duration.value,
                          })
                        : t(($) => $.agents.duration_hours, {
                            count: duration.value,
                          });
                  return (
                    <RunningTaskRow
                      key={task.id}
                      task={task}
                      agentName={agentNameById.get(task.agent_id) ?? "—"}
                      issue={issueById.get(task.issue_id)}
                      paths={paths}
                      durationLabel={durationLabel}
                    />
                  );
                })}
              </ul>
            </CardContent>
          )}
        </Card>
      </div>
    </section>
  );
}

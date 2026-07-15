"use client";

import { useQuery } from "@tanstack/react-query";
import type { Issue, SplitTask, SplitTaskStatus } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { workflowRunCanvasSummaryOptions } from "@multica/core/workflows/queries";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { AppLink } from "../../../navigation";

interface SplitDraftLedgerProps {
  tasks: SplitTask[];
  taskIssueBySourceId?: ReadonlyMap<string, Issue>;
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function taskStatusLabel(status: SplitTaskStatus): string {
  if (status === "approved") return "ready";
  return status;
}

function assigneeLabel(task: SplitTask): string {
  if (!task.suggested_assignee_type || !task.suggested_assignee_id) return "--";
  return `${task.suggested_assignee_type}:${task.suggested_assignee_id}`;
}

function SplitTaskChildIssueMeta({
  task,
  linkedIssue,
}: {
  task: SplitTask;
  linkedIssue: Issue;
}) {
  const paths = useWorkspacePaths();
  const shouldLoadError =
    task.status === "failed" &&
    !!linkedIssue.workflow_id &&
    !!linkedIssue.workflow_run_id;
  const { data: childSummary } = useQuery({
    ...workflowRunCanvasSummaryOptions(
      linkedIssue.workspace_id,
      linkedIssue.workflow_id ?? "",
      linkedIssue.workflow_run_id ?? "",
    ),
    enabled: shouldLoadError,
  });
  const errorMessage = childSummary?.node_runtime_summaries.find(
    (summary) => summary.has_error === true && summary.error_message.trim().length > 0,
  )?.error_message;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Child issue</span>
      <AppLink
        href={paths.issueDetail(linkedIssue.id)}
        className="font-medium text-primary hover:underline"
      >
        {linkedIssue.identifier}
      </AppLink>
      <Badge variant="outline">{linkedIssue.status}</Badge>
      {errorMessage ? <span className="text-destructive">Error: {errorMessage}</span> : null}
    </div>
  );
}

function SplitTaskIssueFallback({ task }: { task: SplitTask }) {
  const paths = useWorkspacePaths();
  if (!task.issue_id) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Child issue</span>
      <AppLink
        href={paths.issueDetail(task.issue_id)}
        className="font-medium text-primary hover:underline"
      >
        Open child issue
      </AppLink>
      <Badge variant="outline">{task.status}</Badge>
    </div>
  );
}

export function SplitDraftLedger({ tasks, taskIssueBySourceId }: SplitDraftLedgerProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
        还没有生成子 issue 草案。
      </div>
    );
  }

  const numberByTaskId = new Map(tasks.map((task, index) => [task.id, taskNumber(index)]));

  return (
    <div className="space-y-2">
      {tasks.map((task, index) => {
        const linkedIssue = taskIssueBySourceId?.get(task.id) ?? null;
        const dependsOn = task.depends_on
          .map((dependencyId) => numberByTaskId.get(dependencyId) ?? dependencyId)
          .join(", ");

        return (
          <article
            key={task.id}
            data-testid={`split-draft-row-${task.id}`}
            className={cn(
              "rounded-md border bg-background px-3 py-2.5",
              task.status === "discarded" && "opacity-70",
            )}
          >
            <div
              data-testid={`split-draft-meta-${task.id}`}
              className="grid min-w-0 gap-2"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {taskNumber(index)}
                  </span>
                  <h4 className="min-w-0 truncate text-sm font-medium" title={task.title}>
                    {task.title || "Untitled task"}
                  </h4>
                </div>
                {task.description.trim().length > 0 ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {task.description}
                  </p>
                ) : null}
                {linkedIssue ? (
                  <SplitTaskChildIssueMeta task={task} linkedIssue={linkedIssue} />
                ) : (
                  <SplitTaskIssueFallback task={task} />
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{taskStatusLabel(task.status)}</Badge>
                <Badge variant="outline" className="max-w-[12rem] truncate" title={assigneeLabel(task)}>
                  {assigneeLabel(task)}
                </Badge>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span>依赖：{dependsOn || "无"}</span>
              {!task.suggested_assignee_id ? <span className="text-destructive">缺负责人</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

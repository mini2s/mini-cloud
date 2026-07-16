"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, SplitTask, SplitTaskStatus, Workflow } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { workflowRunCanvasSummaryOptions } from "@multica/core/workflows/queries";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AppLink } from "../../../navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

interface SplitDraftLedgerProps {
  tasks: SplitTask[];
  workflows?: Workflow[];
  taskIssueBySourceId?: ReadonlyMap<string, Issue>;
  readOnly?: boolean;
  onWorkflowChange?: (task: SplitTask, workflowId: string) => void;
  onDiscardChange?: (task: SplitTask, discarded: boolean) => void;
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function taskStatusLabel(status: SplitTaskStatus): string {
  if (status === "approved") return "ready";
  return status;
}

function workflowLabel(t: ReturnType<typeof useT<"workflows">>["t"], task: SplitTask, workflows: Workflow[]): string {
  const workflow = workflows.find((item) => item.id === task.workflow_id);
  return workflow?.title ?? task.workflow_id ?? t(($) => $.detail_panel.split_draft_missing_execution_workflow);
}

function SplitTaskChildIssueMeta({
  task,
  linkedIssue,
  t,
}: {
  task: SplitTask;
  linkedIssue: Issue;
  t: ReturnType<typeof useT<"workflows">>["t"];
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
      <span className="text-muted-foreground">{t(($) => $.detail_panel.split_draft_child_issue_label)}</span>
      <AppLink
        href={paths.issueDetail(linkedIssue.id)}
        className="font-medium text-primary hover:underline"
      >
        {linkedIssue.identifier}
      </AppLink>
      <Badge variant="outline">{linkedIssue.status}</Badge>
      {errorMessage ? <span className="text-destructive">{t(($) => $.detail_panel.split_draft_error_prefix, { message: errorMessage })}</span> : null}
    </div>
  );
}

function SplitTaskIssueFallback({ task, t }: { task: SplitTask; t: ReturnType<typeof useT<"workflows">>["t"] }) {
  const paths = useWorkspacePaths();
  if (!task.issue_id) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{t(($) => $.detail_panel.split_draft_child_issue_label)}</span>
      <AppLink
        href={paths.issueDetail(task.issue_id)}
        className="font-medium text-primary hover:underline"
      >
        {t(($) => $.detail_panel.split_draft_open_child_issue)}
      </AppLink>
      <Badge variant="outline">{task.status}</Badge>
    </div>
  );
}

export function SplitDraftLedger({
  tasks,
  workflows = [],
  taskIssueBySourceId,
  readOnly = false,
  onWorkflowChange,
}: SplitDraftLedgerProps) {
  const { t } = useT("workflows");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());

  const toggleTaskDetails = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
        {t(($) => $.detail_panel.split_draft_empty)}
      </div>
    );
  }

  const numberByTaskId = new Map(tasks.map((task, index) => [task.id, taskNumber(index)]));

  return (
    <div className="space-y-2">
      {tasks.map((task, index) => {
        const linkedIssue = taskIssueBySourceId?.get(task.id) ?? null;
        const isExpanded = expandedTaskIds.has(task.id);
        const summaryId = `split-draft-summary-${task.id}`;
        const dependsOn = task.depends_on
          .map((dependencyId) => numberByTaskId.get(dependencyId) ?? dependencyId)
          .join(", ");

        return (
          <article
            key={task.id}
            data-testid={`split-draft-row-${task.id}`}
            className={cn(
              "rounded-md border bg-background px-3 py-2.5",
              !task.workflow_id && "border-destructive/30 bg-destructive/5",
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
                    {task.title || t(($) => $.detail_panel.split_draft_untitled_task)}
                  </h4>
                </div>
                {task.description.trim().length > 0 ? (
                  <div className="mt-1">
                    <p
                      id={summaryId}
                      data-testid={summaryId}
                      className={cn(
                        "text-xs leading-snug text-muted-foreground",
                        isExpanded ? "whitespace-pre-wrap" : "line-clamp-2",
                      )}
                    >
                      {task.description}
                    </p>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-expanded={isExpanded}
                      aria-controls={summaryId}
                      onClick={() => toggleTaskDetails(task.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      {isExpanded
                        ? t(($) => $.detail_panel.split_draft_collapse_details)
                        : t(($) => $.detail_panel.split_draft_expand_details)}
                    </button>
                  </div>
                ) : null}
                {linkedIssue ? (
                  <SplitTaskChildIssueMeta task={task} linkedIssue={linkedIssue} t={t} />
                ) : (
                  <SplitTaskIssueFallback task={task} t={t} />
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{taskStatusLabel(task.status)}</Badge>
                <select
                  aria-label={t(($) => $.detail_panel.split_draft_execution_workflow_for, { title: task.title })}
                  className="h-8 min-w-[12rem] rounded-md border border-input bg-background px-2 text-xs"
                  value={task.workflow_id ?? ""}
                  disabled={readOnly || task.status !== "draft"}
                  onChange={(event) => onWorkflowChange?.(task, event.target.value)}
                >
                  <option value="">{t(($) => $.detail_panel.split_draft_select_workflow_placeholder)}</option>
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.title}
                    </option>
                  ))}
                </select>
                {readOnly || task.status !== "draft" ? (
                  <Badge variant="outline" className="max-w-[12rem] truncate" title={workflowLabel(t, task, workflows)}>
                    {workflowLabel(t, task, workflows)}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span>{dependsOn ? t(($) => $.detail_panel.split_draft_dependencies_label, { deps: dependsOn }) : t(($) => $.detail_panel.split_draft_dependencies_none)}</span>
              {!task.workflow_id ? (
                <span
                  data-testid={`split-draft-risk-${task.id}`}
                  className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive"
                >
                  {t(($) => $.detail_panel.split_draft_missing_execution_workflow)}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

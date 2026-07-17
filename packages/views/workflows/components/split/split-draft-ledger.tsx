"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, SplitTask, SplitTaskStatus, Workflow } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { workflowRunCanvasSummaryOptions } from "@multica/core/workflows/queries";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AppLink } from "../../../navigation";
import { ChevronDown, ChevronUp, Pencil, RotateCcw, Save, Trash2, X } from "lucide-react";

interface SplitDraftLedgerProps {
  tasks: SplitTask[];
  workflows?: Workflow[];
  taskIssueBySourceId?: ReadonlyMap<string, Issue>;
  readOnly?: boolean;
  onWorkflowChange?: (task: SplitTask, workflowId: string) => void;
  onDraftSave?: (task: SplitTask, updates: { title: string; description: string }) => void | Promise<void>;
  onDiscardChange?: (task: SplitTask, discarded: boolean) => void;
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function taskStatusLabel(status: SplitTaskStatus): string {
  if (status === "approved") return "Ready";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function workflowLabel(t: ReturnType<typeof useT<"workflows">>["t"], task: SplitTask, workflows: Workflow[]): string {
  const workflow = workflows.find((item) => item.id === task.workflow_id);
  return workflow?.title ?? task.workflow_id ?? t(($) => $.detail_panel.split_draft_missing_execution_workflow);
}

function MetaValue({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        tone === "danger"
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : "border-border bg-muted/35 text-foreground",
      )}
      title={`${label}: ${value}`}
    >
      <span className="min-w-0 truncate font-medium">{label}: {value}</span>
    </span>
  );
}

function SplitTaskChildIssueMeta({
  task,
  linkedIssue,
  t,
  className,
}: {
  task: SplitTask;
  linkedIssue: Issue;
  t: ReturnType<typeof useT<"workflows">>["t"];
  className?: string;
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
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">{t(($) => $.detail_panel.split_draft_child_issue_label)}</span>
      <AppLink
        href={paths.issueDetail(linkedIssue.id)}
        className="font-medium text-primary hover:underline"
      >
        {linkedIssue.identifier}
      </AppLink>
      <MetaValue
        label={t(($) => $.detail_panel.split_draft_issue_status_label)}
        value={linkedIssue.status}
      />
      {task.status === "failed" ? (
        <MetaValue
          label={t(($) => $.detail_panel.split_draft_run_status_label)}
          value={taskStatusLabel(task.status)}
          tone="danger"
        />
      ) : null}
      {errorMessage ? <span className="text-destructive">{t(($) => $.detail_panel.split_draft_error_prefix, { message: errorMessage })}</span> : null}
    </div>
  );
}

function SplitTaskIssueFallback({
  task,
  t,
  className,
}: {
  task: SplitTask;
  t: ReturnType<typeof useT<"workflows">>["t"];
  className?: string;
}) {
  const paths = useWorkspacePaths();
  if (!task.issue_id) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">{t(($) => $.detail_panel.split_draft_child_issue_label)}</span>
      <AppLink
        href={paths.issueDetail(task.issue_id)}
        className="font-medium text-primary hover:underline"
      >
        {t(($) => $.detail_panel.split_draft_open_child_issue)}
      </AppLink>
      <MetaValue
        label={t(($) => $.detail_panel.split_draft_run_status_label)}
        value={taskStatusLabel(task.status)}
        tone={task.status === "failed" ? "danger" : "neutral"}
      />
    </div>
  );
}

export function SplitDraftLedger({
  tasks,
  workflows = [],
  taskIssueBySourceId,
  readOnly = false,
  onWorkflowChange,
  onDraftSave,
  onDiscardChange,
}: SplitDraftLedgerProps) {
  const { t } = useT("workflows");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [editErrorTaskId, setEditErrorTaskId] = useState<string | null>(null);
  const [showDiscardedTasks, setShowDiscardedTasks] = useState(false);

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

  const startEdit = (task: SplitTask) => {
    setEditingTaskId(task.id);
    setDraftTitle(task.title);
    setDraftDescription(task.description);
    setEditErrorTaskId(null);
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setDraftTitle("");
    setDraftDescription("");
    setEditErrorTaskId(null);
  };

  const saveEdit = async (task: SplitTask) => {
    const title = draftTitle.trim();
    if (!title) {
      setEditErrorTaskId(task.id);
      return;
    }
    try {
      await onDraftSave?.(task, {
        title,
        description: draftDescription,
      });
      cancelEdit();
    } catch {
      setEditErrorTaskId(task.id);
    }
  };

  const activeTasks = tasks.filter((task) => task.status !== "discarded");
  const discardedTasks = tasks.filter((task) => task.status === "discarded");

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
        {t(($) => $.detail_panel.split_draft_empty)}
      </div>
    );
  }

  const activeNumberByTaskId = new Map(activeTasks.map((task, index) => [task.id, taskNumber(index)]));
  const discardedNumberByTaskId = new Map(discardedTasks.map((task, index) => [task.id, taskNumber(index)]));

  const renderTaskRow = (
    task: SplitTask,
    index: number,
    numberByTaskId: ReadonlyMap<string, string>,
  ) => {
        const linkedIssue = taskIssueBySourceId?.get(task.id) ?? null;
        const isExpanded = expandedTaskIds.has(task.id);
        const isEditing = editingTaskId === task.id;
        const isActiveTask = task.status !== "discarded";
        const isMissingWorkflow = isActiveTask && !task.workflow_id;
        const canEditDraft = !readOnly && task.status === "draft";
        const canRestoreDraft = !readOnly && task.status === "discarded";
        const showWorkflowSelect = canEditDraft && !isEditing;
        const showActions = isEditing || canEditDraft || canRestoreDraft;
        const summaryId = `split-draft-summary-${task.id}`;
        const dependsOn = task.depends_on
          .map((dependencyId) => numberByTaskId.get(dependencyId) ?? dependencyId)
          .join(", ");

        return (
          <article
            key={task.id}
            data-testid={`split-draft-row-${task.id}`}
            className={cn(
              "rounded-md border border-border/70 bg-background px-3 py-3 shadow-sm shadow-foreground/[0.02] transition-colors",
              isActiveTask && "hover:border-border",
              isMissingWorkflow && "border-destructive/40 bg-destructive/[0.04]",
              task.status === "discarded" && "bg-muted/20 opacity-70",
            )}
          >
            <div
              data-testid={`split-draft-meta-${task.id}`}
              className="grid min-w-0 gap-2.5"
            >
              <div className="min-w-0">
                {isEditing ? (
                  <div className="grid gap-2">
                    <label className="sr-only" htmlFor={`split-draft-title-${task.id}`}>
                      {t(($) => $.detail_panel.split_draft_title_label)}
                    </label>
                    <Input
                      id={`split-draft-title-${task.id}`}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      aria-label={t(($) => $.detail_panel.split_draft_title_label)}
                      className="h-8 text-sm"
                    />
                    <label className="sr-only" htmlFor={`split-draft-description-${task.id}`}>
                      {t(($) => $.detail_panel.split_draft_description_label)}
                    </label>
                    <Textarea
                      id={`split-draft-description-${task.id}`}
                      value={draftDescription}
                      onChange={(event) => setDraftDescription(event.target.value)}
                      aria-label={t(($) => $.detail_panel.split_draft_description_label)}
                      className="min-h-20 text-sm"
                    />
                    {editErrorTaskId === task.id ? (
                      <p className="text-xs text-destructive">{t(($) => $.detail_panel.split_draft_edit_failed)}</p>
                    ) : null}
                  </div>
                ) : (
                  <>
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
                  </>
                )}
                <div
                  data-testid={`split-draft-metadata-${task.id}`}
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5"
                >
                  {linkedIssue ? (
                    <SplitTaskChildIssueMeta task={task} linkedIssue={linkedIssue} t={t} />
                  ) : (
                    <SplitTaskIssueFallback task={task} t={t} />
                  )}
                  {!linkedIssue && !task.issue_id ? (
                    <Badge variant="secondary">{taskStatusLabel(task.status)}</Badge>
                  ) : null}
                  {showWorkflowSelect ? (
                    <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">{t(($) => $.detail_panel.split_draft_workflow_label)}</span>
                      <select
                        aria-label={t(($) => $.detail_panel.split_draft_execution_workflow_for, { title: task.title })}
                        className="h-8 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                        value={task.workflow_id ?? ""}
                        onChange={(event) => onWorkflowChange?.(task, event.target.value)}
                      >
                        <option value="">{t(($) => $.detail_panel.split_draft_select_workflow_placeholder)}</option>
                        {workflows.map((workflow) => (
                          <option key={workflow.id} value={workflow.id}>
                            {workflow.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn(
                        "max-w-full truncate bg-background px-2 py-0.5 font-medium",
                        isMissingWorkflow && "border-destructive/30 text-destructive",
                      )}
                      title={workflowLabel(t, task, workflows)}
                    >
                      {workflowLabel(t, task, workflows)}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{dependsOn ? t(($) => $.detail_panel.split_draft_dependencies_label, { deps: dependsOn }) : t(($) => $.detail_panel.split_draft_dependencies_none)}</span>
                  {isMissingWorkflow ? (
                    <span
                      data-testid={`split-draft-risk-${task.id}`}
                      className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive"
                    >
                      {t(($) => $.detail_panel.split_draft_missing_execution_workflow)}
                    </span>
                  ) : null}
                </div>
                {showActions ? (
                  <div
                    data-testid={`split-draft-actions-${task.id}`}
                    className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end"
                  >
                    {isEditing ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={t(($) => $.detail_panel.split_draft_save)}
                          onClick={() => void saveEdit(task)}
                        >
                          <Save className="size-3.5" />
                          {t(($) => $.detail_panel.split_draft_save)}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={t(($) => $.detail_panel.split_draft_cancel_edit)}
                          onClick={cancelEdit}
                        >
                          <X className="size-3.5" />
                          {t(($) => $.detail_panel.split_draft_cancel_edit)}
                        </Button>
                      </>
                    ) : canEditDraft ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={t(($) => $.detail_panel.split_draft_edit)}
                          onClick={() => startEdit(task)}
                        >
                          <Pencil className="size-3.5" />
                          {t(($) => $.detail_panel.split_draft_edit)}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={t(($) => $.detail_panel.split_draft_discard)}
                          onClick={() => onDiscardChange?.(task, true)}
                        >
                          <Trash2 className="size-3.5" />
                          {t(($) => $.detail_panel.split_draft_discard)}
                        </Button>
                      </>
                    ) : canRestoreDraft ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={t(($) => $.detail_panel.split_draft_restore)}
                        onClick={() => onDiscardChange?.(task, false)}
                      >
                        <RotateCcw className="size-3.5" />
                        {t(($) => $.detail_panel.split_draft_restore)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      };

  return (
    <div className="space-y-2">
      {activeTasks.length > 0 ? (
        activeTasks.map((task, index) => renderTaskRow(task, index, activeNumberByTaskId))
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          {t(($) => $.detail_panel.split_draft_empty)}
        </div>
      )}
      {discardedTasks.length > 0 ? (
        <div className="rounded-md border border-dashed bg-muted/10">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={showDiscardedTasks}
            aria-label={
              showDiscardedTasks
                ? t(($) => $.detail_panel.split_draft_hide_discarded)
                : t(($) => $.detail_panel.split_draft_show_discarded)
            }
            onClick={() => setShowDiscardedTasks((value) => !value)}
          >
            <span>
              {t(($) => $.detail_panel.split_draft_discarded_group, { count: discardedTasks.length })}
            </span>
            <span className="inline-flex items-center gap-1 text-primary">
              {showDiscardedTasks
                ? t(($) => $.detail_panel.split_draft_hide_discarded)
                : t(($) => $.detail_panel.split_draft_show_discarded)}
              {showDiscardedTasks ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          </button>
          {showDiscardedTasks ? (
            <div className="space-y-2 border-t border-border/60 p-2">
              {discardedTasks.map((task, index) => renderTaskRow(task, index, discardedNumberByTaskId))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

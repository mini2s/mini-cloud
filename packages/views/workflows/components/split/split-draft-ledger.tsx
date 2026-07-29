"use client";

import { useState, type ReactNode } from "react";
import type { Issue, SplitTask, SplitTaskAssigneeType } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { useActorName } from "@multica/core/workspace/hooks";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { AppLink } from "../../../navigation";
import { ActorAvatar } from "../../../common/actor-avatar";
import { AssigneePicker } from "../../../issues/components/pickers/assignee-picker";
import { ChevronDown, ChevronUp, Pencil, RotateCcw, Save, Trash2, X } from "lucide-react";

interface SplitDraftLedgerProps {
  tasks: SplitTask[];
  taskIssueBySourceId?: ReadonlyMap<string, Issue>;
  readOnly?: boolean;
  onAssigneeChange?: (task: SplitTask, assignee: { assignee_type: SplitTaskAssigneeType; assignee_id: string }) => void;
  onDraftSave?: (task: SplitTask, updates: { title: string; description: string }) => void | Promise<void>;
  onDiscardChange?: (task: SplitTask, discarded: boolean) => void;
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function taskStatusLabel(status: string): string {
  if (status === "approved") return "Ready";
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
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

function DraftFact({
  testId,
  label,
  children,
  tone = "neutral",
}: {
  testId: string;
  label: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-md border bg-muted/20 px-2.5 py-2",
        tone === "danger" && "border-destructive/25 bg-destructive/10",
      )}
    >
      <div className="text-[10px] font-semibold uppercase leading-3 text-muted-foreground">{label}</div>
      <div className={cn("mt-1 min-w-0 break-words text-xs font-medium leading-4", tone === "danger" && "text-destructive")}>
        {children}
      </div>
    </div>
  );
}

function SplitTaskChildIssueMeta({
  task,
  linkedIssue,
  t,
  assigneeName,
  className,
}: {
  task: SplitTask;
  linkedIssue: Issue;
  t: ReturnType<typeof useT<"workflows">>["t"];
  assigneeName: string;
  className?: string;
}) {
  const paths = useWorkspacePaths();

  return (
    <div
      data-testid={`split-draft-child-facts-${task.id}`}
      className={cn(
        "grid min-w-0 w-full gap-2",
        "sm:grid-cols-3",
        className,
      )}
    >
      <DraftFact
        testId={`split-draft-child-issue-${task.id}`}
        label={t(($) => $.detail_panel.split_draft_created_issue_label)}
      >
        <AppLink
          href={paths.issueDetail(linkedIssue.id)}
          className="text-primary hover:underline"
        >
          {linkedIssue.identifier}
        </AppLink>
      </DraftFact>
      <DraftFact
        testId={`split-draft-child-status-${task.id}`}
        label={t(($) => $.detail_panel.split_draft_issue_status_label)}
      >
        {taskStatusLabel(linkedIssue.status)}
      </DraftFact>
      <DraftFact
        testId={`split-draft-child-assignee-${task.id}`}
        label={t(($) => $.detail_panel.split_assignee_for, { title: task.title })}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {linkedIssue.assignee_type && linkedIssue.assignee_id ? (
            <ActorAvatar actorType={linkedIssue.assignee_type} actorId={linkedIssue.assignee_id} size={18} />
          ) : null}
          <span className="truncate">{assigneeName}</span>
        </span>
      </DraftFact>
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
      <MetaValue label={t(($) => $.detail_panel.split_draft_issue_status_label)} value={taskStatusLabel(task.status)} />
    </div>
  );
}

export function SplitDraftLedger({
  tasks,
  taskIssueBySourceId,
  readOnly = false,
  onAssigneeChange,
  onDraftSave,
  onDiscardChange,
}: SplitDraftLedgerProps) {
  const { t } = useT("workflows");
  const { getActorName } = useActorName();
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
        const assigneeType = linkedIssue?.assignee_type ?? task.assignee_type;
        const assigneeId = linkedIssue?.assignee_id ?? task.assignee_id;
        const assigneeName = assigneeType && assigneeId
          ? getActorName(assigneeType, assigneeId) ?? assigneeId
          : t(($) => $.detail_panel.split_unassigned);
        const canEditDraft = !readOnly && task.status === "draft";
        const canRestoreDraft = !readOnly && task.status === "discarded";
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
                    <SplitTaskChildIssueMeta
                      task={task}
                      linkedIssue={linkedIssue}
                      t={t}
                      assigneeName={assigneeName}
                    />
                  ) : (
                    <SplitTaskIssueFallback task={task} t={t} />
                  )}
                  {!linkedIssue && !task.issue_id ? (
                    <Badge variant="secondary">{taskStatusLabel(task.status)}</Badge>
                  ) : null}
									{task.draft_source === "recovered" ? (
										<Badge variant="outline">{t(($) => $.detail_panel.split_draft_recovered)}</Badge>
									) : null}
                  {!linkedIssue && canEditDraft && !isEditing ? (
                    <AssigneePicker
                      assigneeType={task.assignee_type}
                      assigneeId={task.assignee_id}
                      allowedTypes={["member", "agent", "squad", "workflow"]}
                      allowUnassigned={false}
                      ariaLabel={t(($) => $.detail_panel.split_assignee_for, { title: task.title })}
                      triggerRender={(
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 min-w-40 max-w-full justify-start"
                        />
                      )}
                      trigger={(
                        <>
                          {assigneeType && assigneeId ? (
                            <ActorAvatar actorType={assigneeType} actorId={assigneeId} size={18} />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate text-left">{assigneeName}</span>
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        </>
                      )}
                      onUpdate={(update) => {
                        if (update.assignee_type && update.assignee_id) {
                          onAssigneeChange?.(task, {
                            assignee_type: update.assignee_type,
                            assignee_id: update.assignee_id,
                          });
                        }
                      }}
                    />
                  ) : !linkedIssue ? (
                    <Badge variant="outline" className="max-w-full gap-1.5 bg-background px-2 py-0.5 font-medium">
                      {assigneeType && assigneeId ? (
                        <ActorAvatar actorType={assigneeType} actorId={assigneeId} size={18} />
                      ) : null}
                      <span className="truncate">{assigneeName}</span>
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{dependsOn ? t(($) => $.detail_panel.split_draft_dependencies_label, { deps: dependsOn }) : t(($) => $.detail_panel.split_draft_dependencies_none)}</span>
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

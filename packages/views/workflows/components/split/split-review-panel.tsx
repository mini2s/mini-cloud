"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApproveSplitRequest, SplitTask } from "@multica/core/types";
import { Activity, CheckCheck, GitBranch, ListTree, Plus, RefreshCcw, SquareX } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import {
  splitTasksOptions,
  useApproveSplitTasks,
  useCancelSplitNode,
  useGenerateSplitTasks,
} from "@multica/core/workflows/queries";
import { childIssuesOptions } from "@multica/core/issues/queries";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../../common/workflow-node-detail-panel-shell";
import { SplitProgressBadge } from "./split-progress-badge";
import { SplitTaskDag } from "./split-task-dag";
import { SplitTaskList, type SplitTaskDraft } from "./split-task-list";

interface SplitReviewPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  wsId: string;
  workflowId?: string;
  runId?: string;
  parentIssueId?: string;
  onClose: () => void;
}

const TERMINAL_NODE_STATUSES = new Set(["completed", "failed", "cancelled", "skipped"]);

function isNodeRunCancellable(status: string | null | undefined): boolean {
  if (!status) return false;
  return !TERMINAL_NODE_STATUSES.has(status);
}

function buildSplitTaskDraft(task: SplitTask): SplitTaskDraft {
  return {
    id: task.id,
    sourceTaskId: task.id,
    title: task.title,
    description: task.description,
    dependsOn: task.depends_on,
    suggestedAssigneeType: task.suggested_assignee_type,
    suggestedAssigneeId: task.suggested_assignee_id,
    status: task.status,
    approved: task.status !== "discarded",
    deleted: false,
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function buildApproveRequest(tasks: SplitTaskDraft[], originalTasks: SplitTask[]): ApproveSplitRequest {
  const originalTaskMap = new Map(originalTasks.map((task) => [task.id, task]));
  const approvedTaskIds: string[] = [];
  const modifications: ApproveSplitRequest["modifications"] = [];

  for (const task of tasks) {
    if (task.deleted) {
      if (task.sourceTaskId) {
        modifications.push({
          action: "delete",
          id: task.sourceTaskId,
        });
      }
      continue;
    }

    if (task.sourceTaskId) {
      if (task.approved) {
        approvedTaskIds.push(task.sourceTaskId);
      }

      const originalTask = originalTaskMap.get(task.sourceTaskId);
      if (!originalTask) {
        continue;
      }

      const changedTitle = task.title !== originalTask.title;
      const changedDescription = task.description !== originalTask.description;
      const changedDependsOn = !arraysEqual(task.dependsOn, originalTask.depends_on);
      const changedAssigneeType = task.suggestedAssigneeType !== originalTask.suggested_assignee_type;
      const changedAssigneeId = task.suggestedAssigneeId !== originalTask.suggested_assignee_id;

      if (
        changedTitle ||
        changedDescription ||
        changedDependsOn ||
        changedAssigneeType ||
        changedAssigneeId
      ) {
        modifications.push({
          id: task.sourceTaskId,
          ...(changedTitle ? { title: task.title } : {}),
          ...(changedDescription ? { description: task.description } : {}),
          ...(changedDependsOn ? { depends_on: task.dependsOn } : {}),
          ...(changedAssigneeType ? { suggested_assignee_type: task.suggestedAssigneeType } : {}),
          ...(changedAssigneeId ? { suggested_assignee_id: task.suggestedAssigneeId } : {}),
        });
      }
      continue;
    }

    modifications.push({
      action: "add",
      title: task.title,
      description: task.description,
      depends_on: task.dependsOn,
      suggested_assignee_type: task.suggestedAssigneeType,
      suggested_assignee_id: task.suggestedAssigneeId,
    });
  }

  return {
    approved_task_ids: approvedTaskIds,
    modifications,
  };
}

export function SplitReviewPanel({
  node,
  nodeRun,
  wsId,
  workflowId,
  runId,
  parentIssueId,
  onClose,
}: SplitReviewPanelProps) {
  const nodeRunId = nodeRun?.id ?? null;
  const { data, isLoading } = useQuery(splitTasksOptions(nodeRunId));
  const { data: childIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
  });
  const generateMutation = useGenerateSplitTasks(wsId);
  const approveMutation = useApproveSplitTasks(wsId);
  const cancelMutation = useCancelSplitNode(wsId);
  const [draftTasks, setDraftTasks] = useState<SplitTaskDraft[]>([]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const nextNewTaskIndexRef = useRef(1);

  const tasks = data?.tasks ?? [];
  const progress = data?.progress ?? {
    total: 0,
    created: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  };

  const splitConfig =
    node.format_schema &&
    typeof node.format_schema === "object" &&
    !Array.isArray(node.format_schema) &&
    "split_config" in node.format_schema
      ? (node.format_schema as { split_config?: {
          mode?: string;
          max_concurrency?: number;
          max_failures?: number;
          sub_template_id?: string;
        } }).split_config
      : undefined;

  useEffect(() => {
    setDraftTasks(tasks.map(buildSplitTaskDraft));
    nextNewTaskIndexRef.current = 1;
  }, [tasks]);

  const canApprove = nodeRun?.status === "awaiting_split_review" && tasks.length > 0;
  const canEditReview = nodeRun?.status === "awaiting_split_review";
  const canCancel = isNodeRunCancellable(nodeRun?.status);
  const generateLabel = tasks.length > 0 ? "Regenerate tasks" : "Generate tasks";
  const selectedCount = useMemo(
    () =>
      draftTasks.reduce((count, task) => {
        if (task.deleted) return count;
        if (!task.sourceTaskId) return count + 1;
        return task.approved ? count + 1 : count;
      }, 0),
    [draftTasks],
  );
  const childIssueBySplitTaskId = useMemo(() => {
    const mapping = new Map<string, (typeof childIssues)[number]>();
    for (const childIssue of childIssues) {
      if (childIssue.origin_type === "workflow_split" && childIssue.origin_id) {
        mapping.set(childIssue.origin_id, childIssue);
      }
    }
    return mapping;
  }, [childIssues]);

  const handleGenerate = async () => {
    if (!nodeRunId) return;
    await generateMutation.mutateAsync({ nodeRunId, workflowId, runId });
  };

  const handleApproveAll = async () => {
    if (!nodeRunId) return;
    await approveMutation.mutateAsync({
      nodeRunId,
      workflowId,
      runId,
      request: buildApproveRequest(draftTasks, tasks),
    });
  };

  const handleCancel = async () => {
    if (!nodeRunId) return;
    await cancelMutation.mutateAsync({ nodeRunId, workflowId, runId });
    setCancelDialogOpen(false);
  };

  const handleTaskChange = (taskId: string, patch: Partial<SplitTaskDraft>) => {
    setDraftTasks((current) => current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
  };

  const handleToggleDependency = (taskId: string, dependencyTaskId: string, checked: boolean) => {
    setDraftTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const nextDependsOn = checked
          ? [...task.dependsOn, dependencyTaskId]
          : task.dependsOn.filter((value) => value !== dependencyTaskId);
        return {
          ...task,
          dependsOn: Array.from(new Set(nextDependsOn)),
        };
      }),
    );
  };

  const handleDeleteTask = (taskId: string) => {
    setDraftTasks((current) =>
      current
        .map((task) => {
          if (task.id !== taskId) return task;
          if (!task.sourceTaskId) return { ...task, deleted: true };
          return { ...task, deleted: true, approved: false };
        })
        .map((task) => ({
          ...task,
          dependsOn: task.dependsOn.filter((dependencyId) => dependencyId !== taskId),
        })),
    );
  };

  const handleAddTask = () => {
    const newTaskId = `new-task-${nextNewTaskIndexRef.current}`;
    nextNewTaskIndexRef.current += 1;
    setDraftTasks((current) => [
      ...current,
      {
        id: newTaskId,
        sourceTaskId: null,
        title: "",
        description: "",
        dependsOn: [],
        suggestedAssigneeType: null,
        suggestedAssigneeId: null,
        status: "draft",
        approved: true,
        deleted: false,
      },
    ]);
  };

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      variant="overlay"
      title={node.title}
      eyebrow="Split review"
      closeLabel="Close"
      onClose={onClose}
      badges={(
        <>
          <Badge variant="secondary">{nodeRun?.status ?? "pending"}</Badge>
          <SplitProgressBadge progress={progress} />
        </>
      )}
    >
      <NodeDetailSection
        sectionId="primary"
        icon={<GitBranch className="size-4" />}
        title="Split execution"
        subtitle="Review, generate, and launch child tasks for this split node."
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Mode: {splitConfig?.mode ?? "barrier"}</Badge>
            <Badge variant="outline">Concurrency: {splitConfig?.max_concurrency ?? 5}</Badge>
            <Badge variant="outline">Max failures: {splitConfig?.max_failures ?? 0}</Badge>
          </div>
          <p>
            {tasks.length > 0
              ? `${tasks.length} split tasks are currently tracked for this node.`
              : "No split tasks have been generated for this node yet."}
          </p>
        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="actions"
        icon={<Activity className="size-4" />}
        title="Actions"
        subtitle="Generate a fresh plan, approve the current draft, or cancel the split node."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleGenerate()}
            disabled={!nodeRunId || generateMutation.isPending}
          >
            <RefreshCcw className="mr-1.5 size-3.5" />
            {generateMutation.isPending ? "Generating..." : generateLabel}
          </Button>
          {canApprove ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleApproveAll()}
              disabled={approveMutation.isPending || selectedCount === 0}
            >
              <CheckCheck className="mr-1.5 size-3.5" />
              {approveMutation.isPending ? "Approving..." : `Approve selected (${selectedCount})`}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setCancelDialogOpen(true)}
              disabled={cancelMutation.isPending}
            >
              <SquareX className="mr-1.5 size-3.5" />
              {cancelMutation.isPending ? "Cancelling..." : "Cancel split"}
            </Button>
          ) : null}
        </div>
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime"
        icon={<ListTree className="size-4" />}
        title="Split tasks"
        subtitle="Current draft or active child task list for this split node."
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading split tasks...</p>
        ) : (
          <div className="space-y-3">
            <SplitTaskList
              tasks={draftTasks}
              editable={canEditReview}
              taskIssueBySourceId={childIssueBySplitTaskId}
              onTaskChange={handleTaskChange}
              onToggleDependency={handleToggleDependency}
              onDeleteTask={handleDeleteTask}
            />
            {canEditReview ? (
              <Button type="button" size="sm" variant="outline" onClick={handleAddTask}>
                <Plus className="mr-1.5 size-3.5" />
                Add task
              </Button>
            ) : null}
          </div>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="connections"
        icon={<GitBranch className="size-4" />}
        title="Task graph"
        subtitle="Dependency structure for the current split draft."
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading task graph...</p>
        ) : (
          <SplitTaskDag tasks={draftTasks} />
        )}
      </NodeDetailSection>

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          if (!cancelMutation.isPending) {
            setCancelDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel split execution?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop unfinished child tasks and cancel their child issues.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => void handleCancel()}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Confirm cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkflowNodeDetailPanelShell>
  );
}

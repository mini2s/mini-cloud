"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApproveSplitRequest, SplitProgress, SplitTask, WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { ApiError } from "@multica/core/api";
import { Activity, CheckCheck, GitBranch, ListTree, RefreshCcw, SquareX, Undo2 } from "lucide-react";
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
import {
  splitTasksOptions,
  splitIssueWorkflowOptions,
  useApproveSplitTasks,
  usePatchSplitDraftTask,
  useCancelSplitNode,
  useGenerateSplitTasks,
  useRecoverSplitTasks,
  useResetSplitTasksToOriginal,
  useSubmitSplitReviewChat,
} from "@multica/core/workflows/queries";
import { pendingChatTaskOptions } from "@multica/core/chat/queries";
import { childIssuesOptions } from "@multica/core/issues/queries";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../../common/workflow-node-detail-panel-shell";
import { SplitProgressBadge } from "./split-progress-badge";
import { SplitDraftLedger } from "./split-draft-ledger";
import { SplitDependencyNote } from "./split-dependency-note";
import { SplitChatReview } from "./split-chat-review";
import { useT } from "../../../i18n";

interface SplitReviewPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  wsId: string;
  workflowId?: string;
  runId?: string;
  parentIssueId?: string;
  onClose: () => void;
	plannerName?: string;
}

const TERMINAL_NODE_STATUSES = new Set(["completed", "failed", "cancelled", "skipped"]);

const EMPTY_PROGRESS: SplitProgress = {
  total: 0,
  created: 0,
  running: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
  skipped: 0,
};
const EMPTY_SPLIT_TASKS: SplitTask[] = [];

function useElapsedSeconds(startedAt: string | null | undefined, active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active || !startedAt) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [active, startedAt]);
	if (!startedAt) return 0;
	return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
}

function formatElapsed(seconds: number): string {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function isNodeRunCancellable(status: string | null | undefined): boolean {
  if (!status) return false;
  return !TERMINAL_NODE_STATUSES.has(status);
}

function isSplitGenerateActionStatus(status: string | null | undefined): boolean {
  return status === "awaiting_split_review" || status === "failed";
}

function splitFailureMessage(nodeRun: WorkflowNodeRun | null): string | null {
  if (!nodeRun || nodeRun.status !== "failed") return null;
  const outputs = [nodeRun.worker_output, nodeRun.critic_output];
  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const record = output as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim().length > 0) {
      return record.error;
    }
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }
  }
  return null;
}

function splitConfigFromNode(node: WorkflowNode) {
  if (
    node.format_schema &&
    typeof node.format_schema === "object" &&
    !Array.isArray(node.format_schema) &&
    "split_config" in node.format_schema
  ) {
    return (node.format_schema as {
      split_config?: {
        mode?: string;
        max_concurrency?: number;
        max_failures?: number;
        default_issue_workflow_id?: string;
      };
    }).split_config;
  }
  return undefined;
}

function creatableTasks(tasks: SplitTask[]): SplitTask[] {
  return tasks.filter((task) => task.status !== "discarded");
}

function taskNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function buildApproveRequest(tasks: SplitTask[], confirmEmpty = false): ApproveSplitRequest {
  return {
    approved_task_ids: creatableTasks(tasks).map((task) => task.id),
    ...(confirmEmpty ? { confirm_empty: true } : {}),
  };
}

type WorkflowTranslator = ReturnType<typeof useT<"workflows">>["t"];

function verdictTitle(t: WorkflowTranslator, status: string | null | undefined, tasks: SplitTask[]): string {
  if (status === "failed") return t(($) => $.detail_panel.split_failed);
  if (status === "split_active") return t(($) => $.detail_panel.split_running_children);
  if (status === "completed") return t(($) => $.detail_panel.split_completed);
  if (status === "splitting") return t(($) => $.detail_panel.split_generating_draft);
  if (creatableTasks(tasks).length > 0) return t(($) => $.detail_panel.split_ready_to_create);
  return t(($) => $.detail_panel.split_needs_adjustment);
}

function splitRiskCount(tasks: SplitTask[]): number {
  return creatableTasks(tasks).filter((task) => !task.workflow_id).length;
}

function SplitVerdictSummary({
  nodeRun,
  tasks,
  progress,
  splitConfig,
  isChatPending,
	plannerName,
	elapsedSeconds,
  t,
}: {
  nodeRun: WorkflowNodeRun | null;
  tasks: SplitTask[];
  progress: SplitProgress;
  splitConfig?: ReturnType<typeof splitConfigFromNode>;
  isChatPending: boolean;
	plannerName?: string;
	elapsedSeconds: number;
  t: WorkflowTranslator;
}) {
  const riskCount = splitRiskCount(tasks);
  const dependencyCount = creatableTasks(tasks).filter((task) => task.depends_on.length > 0).length;
  const assigneeCount = new Set(
    creatableTasks(tasks)
      .map((task) => task.workflow_id)
      .filter(Boolean),
  ).size;
  const title = isChatPending ? t(($) => $.detail_panel.split_generating_draft) : verdictTitle(t, nodeRun?.status, tasks);
  const isGenerating = isChatPending || nodeRun?.status === "splitting";
	const isCompleted = nodeRun?.status === "completed";
  const explanation = isGenerating
    ? t(($) => $.detail_panel.split_generating)
    : riskCount === 0
      ? t(($) => $.detail_panel.split_no_blocking_risk)
      : t(($) => $.detail_panel.split_missing_assignees, { count: riskCount });

  return (
    <div
      data-testid="split-review-summary"
      className="overflow-hidden rounded-md border border-border/70 bg-background px-3 py-3 shadow-sm shadow-foreground/[0.03]"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
				{isCompleted ? (
					<p className="mt-1 text-xs text-muted-foreground">
						{t(($) => $.detail_panel.split_completed_summary, {
							total: progress.total,
							done: progress.done,
							failed: progress.failed,
							cancelled: progress.cancelled,
						})}
					</p>
				) : <p className="mt-1 text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_verdict_summary, {
            tasks: creatableTasks(tasks).length,
            assignees: assigneeCount,
            dependencies: dependencyCount,
          })}
				</p>}
      </div>
			{isGenerating ? (
				<div className="mt-2 space-y-1 text-xs text-muted-foreground">
					<p>{t(($) => $.detail_panel.split_planner_label, { planner: plannerName ?? nodeRun?.worker_id ?? "-" })}</p>
					<p>{t(($) => $.detail_panel.split_elapsed, { elapsed: formatElapsed(elapsedSeconds) })}</p>
					{elapsedSeconds >= 60 ? <p>{t(($) => $.detail_panel.split_generation_slow)}</p> : null}
				</div>
			) : null}
      <p className={riskCount > 0 ? "mt-2 text-xs text-destructive" : "mt-2 text-xs text-muted-foreground"}>
        {explanation}
      </p>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer text-primary">{t(($) => $.detail_panel.split_settings_summary)}</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline">{t(($) => $.detail_panel.split_settings_mode_label, { mode: splitConfig?.mode ?? "barrier" })}</Badge>
          <Badge variant="outline">{t(($) => $.detail_panel.split_settings_concurrency_label, { concurrency: splitConfig?.max_concurrency ?? 5 })}</Badge>
          <Badge variant="outline">{t(($) => $.detail_panel.split_settings_max_failures_label, { max: splitConfig?.max_failures ?? 0 })}</Badge>
        </div>
      </details>
      <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-md border bg-border/70 text-xs">
        {[
          [t(($) => $.detail_panel.split_stat_total), progress.total],
          [t(($) => $.detail_panel.split_stat_running), progress.running],
          [t(($) => $.detail_panel.split_stat_done), progress.done],
          [t(($) => $.detail_panel.split_stat_failed), progress.failed],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-background px-2 py-1.5">
            <p className="truncate text-[10px] uppercase text-muted-foreground">{label}</p>
            <p
              data-testid={`split-progress-${String(label).toLowerCase()}`}
              className="text-sm font-medium tabular-nums"
            >
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SplitReviewPanel({
  node,
  nodeRun,
  wsId,
  workflowId,
  runId,
  parentIssueId,
  onClose,
	plannerName,
}: SplitReviewPanelProps) {
  const { t } = useT("workflows");
  const nodeRunId = nodeRun?.id ?? null;
  const generateMutation = useGenerateSplitTasks(wsId);
  const recoverMutation = useRecoverSplitTasks(wsId);
  const resetOriginalMutation = useResetSplitTasksToOriginal(wsId);
  const approveMutation = useApproveSplitTasks(wsId);
  const patchDraftMutation = usePatchSplitDraftTask(wsId);
  const chatMutation = useSubmitSplitReviewChat(wsId);
  const cancelMutation = useCancelSplitNode(wsId);
  const [chatSessionId, setChatSessionId] = useState<string | null>(
    nodeRun?.split_review_chat_session_id ?? null,
  );
  useEffect(() => {
    if (nodeRun?.split_review_chat_session_id) {
      setChatSessionId(nodeRun.split_review_chat_session_id);
    }
  }, [nodeRun?.split_review_chat_session_id]);
  const { data: pendingChatTask } = useQuery(pendingChatTaskOptions(chatSessionId ?? ""));
  const isSplitChatRunning = chatMutation.isPending || !!pendingChatTask?.task_id;
	const elapsedSeconds = useElapsedSeconds(nodeRun?.started_at, nodeRun?.status === "splitting" || isSplitChatRunning);
  const splitTasksQuery = useQuery({
    ...splitTasksOptions(wsId, nodeRunId),
    refetchInterval: isSplitChatRunning ? 2000 : false,
  });
  const { data, isLoading, refetch: refetchSplitTasks } = splitTasksQuery;
  const {
    data: workflowOptions = [],
    refetch: refetchWorkflowOptions,
  } = useQuery(splitIssueWorkflowOptions(wsId, workflowId ?? null));
  const { data: childIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
  });
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const wasSplitChatRunningRef = useRef(false);

  useEffect(() => {
    if (isSplitChatRunning) {
      wasSplitChatRunningRef.current = true;
      return;
    }
    if (!wasSplitChatRunningRef.current) return;
    wasSplitChatRunningRef.current = false;
    void refetchSplitTasks();
  }, [isSplitChatRunning, refetchSplitTasks]);

  const tasks = data?.tasks ?? EMPTY_SPLIT_TASKS;
  const activeTasks = useMemo(() => creatableTasks(tasks), [tasks]);
  const taskNumberById = useMemo(() => new Map(activeTasks.map((task, index) => [task.id, taskNumber(index)])), [activeTasks]);
  const progress = data?.progress ?? EMPTY_PROGRESS;
  const splitConfig = splitConfigFromNode(node);
  const creatableCount = activeTasks.length;
  const workflowBlockers = activeTasks
    .map((task) => task.workflow_id ? null : t(($) => $.detail_panel.split_blocker_missing_workflow, { index: taskNumberById.get(task.id) ?? task.id }))
    .filter((message): message is string => Boolean(message));
  const canApprove = nodeRun?.status === "awaiting_split_review" && creatableCount > 0 && workflowBlockers.length === 0;
  const canChat = nodeRun?.status === "awaiting_split_review";
  const canCancel = isNodeRunCancellable(nodeRun?.status);
  const canRecover = nodeRun?.status === "failed";
  const canResetOriginal = nodeRun?.status === "awaiting_split_review";
  const canGenerate = !!nodeRunId && isSplitGenerateActionStatus(nodeRun?.status) && (activeTasks.length === 0 || nodeRun?.status === "failed");
	const affectedTaskCount = tasks.filter((task) => !["done", "failed", "cancelled", "skipped", "discarded"].includes(task.status)).length;
  const hasDraftCommands = canGenerate || canRecover;
  const failureMessage = splitFailureMessage(nodeRun);
  const generateLabel = tasks.length > 0
    ? t(($) => $.detail_panel.split_regenerate_draft)
    : t(($) => $.detail_panel.split_generate_draft);
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

  const handleRecover = async () => {
    if (!nodeRunId) return;
    await recoverMutation.mutateAsync({ nodeRunId, workflowId, runId });
  };

  const handleResetOriginal = async () => {
    if (!nodeRunId) return;
    await resetOriginalMutation.mutateAsync({ nodeRunId, workflowId, runId });
  };

  const handleApprove = async () => {
    if (!nodeRunId) return;
    await approveMutation.mutateAsync({
      nodeRunId,
      workflowId,
      runId,
      request: buildApproveRequest(tasks, creatableCount === 0),
    });
    setApproveDialogOpen(false);
  };

  const handleWorkflowChange = async (task: SplitTask, nextWorkflowId: string) => {
    if (!nodeRunId || !nextWorkflowId) return;
    try {
      await patchDraftMutation.mutateAsync({
        nodeRunId,
        workflowId,
        runId,
        taskId: task.id,
        request: {
          workflow_id: nextWorkflowId,
          expected_version: task.version,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        await refetchWorkflowOptions();
        await refetchSplitTasks();
      }
      throw error;
    }
  };

  const handleDraftSave = async (task: SplitTask, updates: { title: string; description: string }) => {
    if (!nodeRunId) return;
    try {
      await patchDraftMutation.mutateAsync({
        nodeRunId,
        workflowId,
        runId,
        taskId: task.id,
        request: {
          title: updates.title,
          description: updates.description,
          expected_version: task.version,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        await refetchWorkflowOptions();
        await refetchSplitTasks();
      }
      throw error;
    }
  };

  const handleDiscardChange = async (task: SplitTask, discarded: boolean) => {
    if (!nodeRunId) return;
    try {
      await patchDraftMutation.mutateAsync({
        nodeRunId,
        workflowId,
        runId,
        taskId: task.id,
        request: {
          discarded,
          expected_version: task.version,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        await refetchWorkflowOptions();
        await refetchSplitTasks();
      }
      throw error;
    }
  };

  const handleChatSubmit = async (content: string, attachmentIds?: string[]) => {
    if (!nodeRunId) return;
    const result = await chatMutation.mutateAsync({
      nodeRunId,
      workflowId,
      runId,
      content,
      attachmentIds,
    });
    // Capture the session id so SplitChatReview can immediately subscribe
    // to messages + pendingTask without waiting for a nodeRun refetch.
    if (result?.chat_session_id) {
      setChatSessionId(result.chat_session_id);
    }
  };

  const handleCancel = async () => {
    if (!nodeRunId) return;
    await cancelMutation.mutateAsync({ nodeRunId, workflowId, runId });
    setCancelDialogOpen(false);
  };

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      variant="overlay"
      title={node.title}
      eyebrow={nodeRun?.status === "split_active" ? t(($) => $.detail_panel.split_progress_eyebrow) : t(($) => $.detail_panel.split_review_eyebrow)}
      closeLabel={t(($) => $.detail_panel.close_label)}
      onClose={onClose}
      contentClassName="pb-0"
      badges={(
        <>
          <SplitProgressBadge progress={progress} />
          <Badge variant="outline">{t(($) => $.detail_panel.split_settings_mode_label, { mode: splitConfig?.mode ?? "barrier" })}</Badge>
        </>
      )}
    >
      <NodeDetailSection
        sectionId="primary"
        icon={<GitBranch className="size-4" />}
        title={t(($) => $.detail_panel.split_verdict_title)}
      >
        <SplitVerdictSummary
          nodeRun={nodeRun}
          tasks={activeTasks}
          progress={progress}
          splitConfig={splitConfig}
          isChatPending={chatMutation.isPending}
					plannerName={plannerName}
					elapsedSeconds={elapsedSeconds}
          t={t}
        />
        {failureMessage ? (
          <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {failureMessage}
          </p>
        ) : null}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime"
        icon={<ListTree className="size-4" />}
        title={t(($) => $.detail_panel.split_draft_plan)}
        status={canResetOriginal ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void handleResetOriginal()}
            disabled={!nodeRunId || resetOriginalMutation.isPending}
            className="shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="mr-1.5 size-3.5" />
            {resetOriginalMutation.isPending
              ? t(($) => $.detail_panel.split_resetting_original)
              : t(($) => $.detail_panel.split_reset_original)}
          </Button>
        ) : null}
      >
        {hasDraftCommands ? (
          <div
            data-testid="split-draft-command-bar"
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2"
          >
            {canGenerate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleGenerate()}
                disabled={!nodeRunId || generateMutation.isPending || nodeRun?.status === "splitting"}
              >
                <RefreshCcw className="mr-1.5 size-3.5" />
                {generateMutation.isPending ? t(($) => $.detail_panel.split_generating) : generateLabel}
              </Button>
            ) : null}
            {canRecover ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleRecover()}
                disabled={!nodeRunId || recoverMutation.isPending}
              >
                <ListTree className="mr-1.5 size-3.5" />
                {recoverMutation.isPending ? t(($) => $.detail_panel.split_recovering) : t(($) => $.detail_panel.split_recover_outputs)}
              </Button>
            ) : null}
          </div>
        ) : null}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t(($) => $.detail_panel.split_loading_draft)}</p>
        ) : (
          <SplitDraftLedger
            tasks={tasks}
            workflows={workflowOptions}
            taskIssueBySourceId={childIssueBySplitTaskId}
            readOnly={nodeRun?.status !== "awaiting_split_review"}
            onWorkflowChange={(task, nextWorkflowId) => void handleWorkflowChange(task, nextWorkflowId)}
            onDraftSave={(task, updates) => handleDraftSave(task, updates)}
            onDiscardChange={(task, discarded) => void handleDiscardChange(task, discarded)}
          />
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="connections"
        icon={<GitBranch className="size-4" />}
        title={t(($) => $.detail_panel.split_dependencies)}
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t(($) => $.detail_panel.split_loading_dependencies)}</p>
        ) : (
          <SplitDependencyNote tasks={tasks} />
        )}
      </NodeDetailSection>

      {canChat ? (
        <NodeDetailSection
          sectionId="agent-operations"
          icon={<Activity className="size-4" />}
          title={t(($) => $.detail_panel.split_ask_agent)}
        >
          <SplitChatReview
            issueId={parentIssueId}
            chatSessionId={chatSessionId}
            disabled={isSplitChatRunning}
            onSubmit={handleChatSubmit}
          />
        </NodeDetailSection>
      ) : null}

      <div
        data-testid="split-review-action-bar"
        className="sticky bottom-0 -mx-4 mt-3 border-t bg-background/95 px-4 py-3 shadow-[0_-12px_24px_-20px_hsl(var(--foreground))] backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            {canCancel ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setCancelDialogOpen(true)}
                disabled={cancelMutation.isPending}
              >
                <SquareX className="mr-1.5 size-3.5" />
                {cancelMutation.isPending ? t(($) => $.detail_panel.split_cancelling) : t(($) => $.detail_panel.split_cancel)}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {workflowBlockers.length > 0 ? (
              <span className="text-xs text-destructive">{workflowBlockers[0]}</span>
            ) : !canApprove && nodeRun?.status === "awaiting_split_review" && creatableCount > 0 ? (
              <span className="text-xs text-muted-foreground">{t(($) => $.detail_panel.split_no_creatable_tasks)}</span>
            ) : null}
            {nodeRun?.status === "awaiting_split_review" && creatableCount === 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setApproveDialogOpen(true)}
                disabled={approveMutation.isPending}
              >
                {t(($) => $.detail_panel.split_confirm_empty)}
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setApproveDialogOpen(true)}
                disabled={approveMutation.isPending}
              >
                <CheckCheck className="mr-1.5 size-3.5" />
                {approveMutation.isPending
                  ? t(($) => $.detail_panel.split_creating)
                  : t(($) => $.detail_panel.split_confirm_create, { count: creatableCount })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <AlertDialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          if (!approveMutation.isPending) {
            setApproveDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.detail_panel.split_approve_dialog_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.detail_panel.split_approve_dialog_description, { count: creatableCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveMutation.isPending}>
              {t(($) => $.detail_panel.split_approve_dialog_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={approveMutation.isPending}
              onClick={() => void handleApprove()}
            >
              {approveMutation.isPending ? t(($) => $.detail_panel.split_creating) : t(($) => $.detail_panel.split_confirm_create_short)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <AlertDialogTitle>{t(($) => $.detail_panel.split_cancel_dialog_title)}</AlertDialogTitle>
            <AlertDialogDescription>
						{t(($) => $.detail_panel.split_cancel_affected_count, { count: affectedTaskCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              {t(($) => $.detail_panel.split_keep_running)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => void handleCancel()}
            >
              {cancelMutation.isPending ? t(($) => $.detail_panel.split_cancelling) : t(($) => $.detail_panel.split_confirm_cancel)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkflowNodeDetailPanelShell>
  );
}

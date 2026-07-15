"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApproveSplitRequest, SplitProgress, SplitTask, WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { Activity, CheckCheck, GitBranch, ListTree, RefreshCcw, SquareX } from "lucide-react";
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
  useApproveSplitTasks,
  useCancelSplitNode,
  useGenerateSplitTasks,
  useRecoverSplitTasks,
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

const EMPTY_PROGRESS: SplitProgress = {
  total: 0,
  created: 0,
  running: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
  skipped: 0,
};

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
        child_workflow_id?: string;
      };
    }).split_config;
  }
  return undefined;
}

function creatableTasks(tasks: SplitTask[]): SplitTask[] {
  return tasks.filter((task) => task.status !== "discarded");
}

function buildApproveRequest(tasks: SplitTask[]): ApproveSplitRequest {
  return {
    approved_task_ids: creatableTasks(tasks).map((task) => task.id),
  };
}

function verdictTitle(status: string | null | undefined, tasks: SplitTask[]): string {
  if (status === "failed") return "Split failed";
  if (status === "split_active") return "Running child issues";
  if (status === "completed") return "Completed";
  if (status === "splitting") return "Generating draft";
  if (creatableTasks(tasks).length > 0) return "Ready to create";
  return "Needs adjustment";
}

function splitRiskCount(tasks: SplitTask[]): number {
  return creatableTasks(tasks).filter((task) => !task.suggested_assignee_id).length;
}

function SplitVerdictSummary({
  nodeRun,
  tasks,
  progress,
  splitConfig,
  isChatPending,
}: {
  nodeRun: WorkflowNodeRun | null;
  tasks: SplitTask[];
  progress: SplitProgress;
  splitConfig?: ReturnType<typeof splitConfigFromNode>;
  isChatPending: boolean;
}) {
  const riskCount = splitRiskCount(tasks);
  const dependencyCount = creatableTasks(tasks).filter((task) => task.depends_on.length > 0).length;
  const assigneeCount = new Set(
    creatableTasks(tasks)
      .map((task) => task.suggested_assignee_id)
      .filter(Boolean),
  ).size;
  const title = isChatPending ? "Generating draft" : verdictTitle(nodeRun?.status, tasks);
  const isGenerating = isChatPending || nodeRun?.status === "splitting";
  const explanation = isGenerating
    ? "Agent 正在生成草案…"
    : riskCount === 0 ? "No blocking risk" : `${riskCount} 个 issue 缺少负责人`;

  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{creatableTasks(tasks).length}</span> 个子 issue ·{" "}
            <span className="tabular-nums">{assigneeCount}</span> 个负责人 ·{" "}
            <span className="tabular-nums">{dependencyCount}</span> 条依赖链
          </p>
        </div>
        <Badge variant={nodeRun?.status === "failed" || riskCount > 0 ? "destructive" : "secondary"}>
          {nodeRun?.status ?? "pending"}
        </Badge>
      </div>
      <p className={riskCount > 0 ? "mt-2 text-xs text-destructive" : "mt-2 text-xs text-muted-foreground"}>
        {explanation}
      </p>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer text-primary">查看运行设置</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="outline">Mode: {splitConfig?.mode ?? "barrier"}</Badge>
          <Badge variant="outline">Concurrency: {splitConfig?.max_concurrency ?? 5}</Badge>
          <Badge variant="outline">Max failures: {splitConfig?.max_failures ?? 0}</Badge>
        </div>
      </details>
      <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
        {[
          ["Total", progress.total],
          ["Running", progress.running],
          ["Done", progress.done],
          ["Failed", progress.failed],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border bg-background px-2 py-1.5">
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
}: SplitReviewPanelProps) {
  const nodeRunId = nodeRun?.id ?? null;
  const generateMutation = useGenerateSplitTasks(wsId);
  const recoverMutation = useRecoverSplitTasks(wsId);
  const approveMutation = useApproveSplitTasks(wsId);
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
  const splitTasksQuery = useQuery({
    ...splitTasksOptions(wsId, nodeRunId),
    refetchInterval: isSplitChatRunning ? 2000 : false,
  });
  const { data, isLoading, refetch: refetchSplitTasks } = splitTasksQuery;
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

  const tasks = data?.tasks ?? [];
  const progress = data?.progress ?? EMPTY_PROGRESS;
  const splitConfig = splitConfigFromNode(node);
  const creatableCount = creatableTasks(tasks).length;
  const canApprove = nodeRun?.status === "awaiting_split_review" && creatableCount > 0;
  const canChat = nodeRun?.status === "awaiting_split_review";
  const canCancel = isNodeRunCancellable(nodeRun?.status);
  const canRecover = nodeRun?.status === "failed";
  const canGenerate = !!nodeRunId && isSplitGenerateActionStatus(nodeRun?.status) && (tasks.length === 0 || nodeRun?.status === "failed");
  const failureMessage = splitFailureMessage(nodeRun);
  const generateLabel = tasks.length > 0 ? "重新生成" : "生成草案";
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

  const handleApprove = async () => {
    if (!nodeRunId) return;
    await approveMutation.mutateAsync({
      nodeRunId,
      workflowId,
      runId,
      request: buildApproveRequest(tasks),
    });
    setApproveDialogOpen(false);
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
      eyebrow={nodeRun?.status === "split_active" ? "Split progress" : "Split review"}
      closeLabel="Close"
      onClose={onClose}
      contentClassName="pb-0"
      badges={(
        <>
          <Badge variant={nodeRun?.status === "failed" ? "destructive" : "secondary"}>
            <span data-testid="split-node-status">{nodeRun?.status ?? "pending"}</span>
          </Badge>
          <SplitProgressBadge progress={progress} />
          <Badge variant="outline">Mode: {splitConfig?.mode ?? "barrier"}</Badge>
        </>
      )}
    >
      <NodeDetailSection
        sectionId="primary"
        icon={<GitBranch className="size-4" />}
        title="Verdict"
      >
        <SplitVerdictSummary
          nodeRun={nodeRun}
          tasks={tasks}
          progress={progress}
          splitConfig={splitConfig}
          isChatPending={chatMutation.isPending}
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
        title="Draft plan"
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">加载子 issue 草案…</p>
        ) : (
          <SplitDraftLedger tasks={tasks} taskIssueBySourceId={childIssueBySplitTaskId} />
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="connections"
        icon={<GitBranch className="size-4" />}
        title="Dependencies"
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">加载依赖关系…</p>
        ) : (
          <SplitDependencyNote tasks={tasks} />
        )}
      </NodeDetailSection>

      {canChat ? (
        <NodeDetailSection
          sectionId="agent-operations"
          icon={<Activity className="size-4" />}
          title="Ask agent to adjust"
        >
          <SplitChatReview
            issueId={parentIssueId}
            chatSessionId={chatSessionId}
            disabled={chatMutation.isPending}
            onSubmit={handleChatSubmit}
          />
        </NodeDetailSection>
      ) : null}

      {canGenerate || canRecover ? (
        <NodeDetailSection
          sectionId="actions"
          icon={<Activity className="size-4" />}
          title="Actions"
        >
          <div className="flex flex-wrap gap-2">
            {canGenerate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleGenerate()}
                disabled={!nodeRunId || generateMutation.isPending || nodeRun?.status === "splitting"}
              >
                <RefreshCcw className="mr-1.5 size-3.5" />
                {generateMutation.isPending ? "生成中…" : generateLabel}
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
                {recoverMutation.isPending ? "恢复中…" : "恢复已有输出"}
              </Button>
            ) : null}
          </div>
        </NodeDetailSection>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
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
                {cancelMutation.isPending ? "取消中…" : "取消拆分"}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {!canApprove && nodeRun?.status === "awaiting_split_review" ? (
              <span className="text-xs text-muted-foreground">还没有可创建的子 issue</span>
            ) : null}
            {canApprove ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setApproveDialogOpen(true)}
                disabled={approveMutation.isPending}
              >
                <CheckCheck className="mr-1.5 size-3.5" />
                {approveMutation.isPending ? "创建中…" : `确认创建 ${creatableCount}`}
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
            <AlertDialogTitle>确认创建子 issue？</AlertDialogTitle>
            <AlertDialogDescription>
              这会创建 {creatableCount} 个子 issue，并启动对应 workflow。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={approveMutation.isPending}
              onClick={() => void handleApprove()}
            >
              {approveMutation.isPending ? "创建中…" : "确认创建"}
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
            <AlertDialogTitle>取消拆分？</AlertDialogTitle>
            <AlertDialogDescription>
              这会停止未完成的子 task，并取消对应的子 issue。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              继续运行
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => void handleCancel()}
            >
              {cancelMutation.isPending ? "取消中…" : "确认取消"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkflowNodeDetailPanelShell>
  );
}

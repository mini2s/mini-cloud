"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  CornerDownRight,
  GitFork,
  GitMerge,
  ExternalLink,
  Loader2,
  MessageSquare,
  RotateCcw,
  Unlock,
  User,
} from "lucide-react";
import { api } from "@multica/core/api";
import { useChatStore } from "@multica/core/chat";
import { chatSessionsOptions } from "@multica/core/chat/queries";
import {
  isEmbeddedInCostrict,
  postCostrictNavigateToSession,
} from "@multica/core/platform";
import {
  parseNodeFormat,
  toWorkflowRuntimeDisplayStatus,
  type WorkflowNode,
  type WorkflowNodeRun,
  type WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import type { AgentTask } from "@multica/core/types/agent";
import { useT } from "@multica/views/i18n";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../../common/workflow-node-detail-panel-shell";
import {
  AgentTranscriptDialog,
  buildTimeline,
  type TimelineItem,
} from "../../../common/task-transcript";
import { RuntimeDisplayStatusIcon } from "./node-run-status-icon";
import { resolveChatSessionId } from "../../../chat/lib/resolve-chat-session-id";

export interface ExecutionDetailPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  workerName: string | null;
  criticName: string | null;
  onClose: () => void;
  wsId: string;
  issueId?: string;
  runtimeSummary?: WorkflowNodeRuntimeSummary | null;
  onOpenIssue?: () => void;
  onTakeoverSession?: () => void;
  onUnblock?: () => void;
  onRetry?: () => void;
  isChildIssue?: boolean;
  parentSplitTitle?: string | null;
  childWorkflowName?: string | null;
}

function gatewayLabel(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Join gateway";
  if (kind === "fork") return "Fork gateway";
  return "Gateway";
}

function gatewayDescription(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Waits for all upstream nodes to finish, then automatically completes and continues downstream.";
  if (kind === "fork") return "Automatically completes and fans out to all downstream nodes.";
  return "Gateway kind is invalid. Choose Fork or Join before publishing.";
}

function formatJson(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function isRetryableNodeRunStatus(status: string | undefined): boolean {
  return status === "failed" || status === "format_failed" || status === "blocked" || status === "critic_rework";
}

function taskStatusFromNodeRun(status: WorkflowNodeRun["status"]): AgentTask["status"] {
  switch (status) {
    case "completed":
    case "critic_approved":
      return "completed";
    case "failed":
    case "format_failed":
    case "blocked":
    case "critic_rework":
      return "failed";
    case "cancelled":
    case "skipped":
      return "cancelled";
    case "pending":
      return "queued";
    case "worker_assigned":
      return "dispatched";
    default:
      return "running";
  }
}

function readWorkDir(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;
  const value = (output as Record<string, unknown>).work_dir;
  return typeof value === "string" && value.trim() ? value : undefined;
}

type IssueTranslator = ReturnType<typeof useT<"issues">>["t"];

function runtimeDisplayStatusText(
  t: IssueTranslator,
  status: ReturnType<typeof toWorkflowRuntimeDisplayStatus>,
  gatewayKind: "fork" | "join" | null,
): string {
  if (gatewayKind === "fork" && status === "completed") {
    return t(($) => $.execution.display_status.dispatched);
  }
  if (gatewayKind === "join" && status === "completed") {
    return t(($) => $.execution.display_status.joined);
  }
  if (gatewayKind === "join" && (status === "pending" || status === "todo")) {
    return t(($) => $.execution.display_status.waiting_upstream);
  }
  switch (status) {
    case "pending":
      return t(($) => $.execution.display_status.pending);
    case "todo":
      return t(($) => $.execution.display_status.todo);
    case "in_progress":
      return t(($) => $.execution.display_status.in_progress);
    case "reviewing":
      return t(($) => $.execution.display_status.reviewing);
    case "completed":
      return t(($) => $.execution.display_status.completed);
    case "blocked":
      return t(($) => $.execution.display_status.blocked);
    case "cancelled":
      return t(($) => $.execution.display_status.cancelled);
  }
}

function formatDurationLabel(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function ExecutionDetailPanel({
  node,
  nodeRun,
  workerName,
  criticName,
  onClose,
  wsId,
  issueId,
  runtimeSummary,
  onOpenIssue,
  onTakeoverSession,
  onUnblock,
  onRetry,
  isChildIssue = false,
  parentSplitTitle,
  childWorkflowName,
}: ExecutionDetailPanelProps) {
  const { t } = useT("issues");
  const [showEvidence, setShowEvidence] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptItems, setTranscriptItems] = useState<TimelineItem[]>([]);
  const nodeFormat = parseNodeFormat(node.format_schema);
  const isGateway = nodeFormat.kind === "gateway";
  const displayStatus = runtimeSummary?.display_status ?? (nodeRun ? toWorkflowRuntimeDisplayStatus(nodeRun.status) : "pending");
  const displayStatusLabel = runtimeDisplayStatusText(t, displayStatus, isGateway ? nodeFormat.gateway_kind : null);
  const GatewayIcon = nodeFormat.gateway_kind === "join" ? GitMerge : GitFork;
  const setChatSession = useChatStore((s) => s.setActiveSession);
  const setChatOpen = useChatStore((s) => s.setOpen);
  const { data: chatSessions = [] } = useQuery(chatSessionsOptions(wsId));

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const status = nodeRun?.status;
  const duration =
    nodeRun?.started_at && nodeRun?.completed_at
      ? Math.round(
          (new Date(nodeRun.completed_at).getTime() -
            new Date(nodeRun.started_at).getTime()) /
            1000,
        )
      : null;

  const durationLabel = useMemo(() => {
    if (duration == null) return null;
    return formatDurationLabel(duration);
  }, [duration]);

  const errorMessage = useMemo(() => {
    if (!nodeRun || (status !== "failed" && status !== "blocked" && status !== "format_failed")) return null;
    const wo = nodeRun.worker_output as Record<string, unknown> | null;
    const co = nodeRun.critic_output as Record<string, unknown> | null;
    if (wo && typeof wo.error === "string") return wo.error;
    if (wo && typeof wo.message === "string") return wo.message;
    if (co && typeof co.error === "string") return co.error;
    if (co && typeof co.message === "string") return co.message;
    return null;
  }, [nodeRun, status]);

  const sessionId = nodeRun?.session_id ?? runtimeSummary?.session_id ?? null;
  const transcriptTaskId =
    nodeRun?.worker_agent_task_id ??
    nodeRun?.agent_task_id ??
    nodeRun?.critic_agent_task_id ??
    null;
  const transcriptAgentName =
    transcriptTaskId && nodeRun?.critic_agent_task_id === transcriptTaskId
      ? criticName
      : workerName;
  const transcriptAgentId =
    transcriptTaskId && nodeRun?.critic_agent_task_id === transcriptTaskId
      ? nodeRun?.critic_id
      : nodeRun?.worker_id;
  const transcriptTask = useMemo<AgentTask | null>(() => {
    if (!nodeRun || !transcriptTaskId) return null;
    return {
      id: transcriptTaskId,
      agent_id: transcriptAgentId ?? "",
      runtime_id: nodeRun.runtime_id ?? "",
      issue_id: issueId ?? "",
      status: taskStatusFromNodeRun(nodeRun.status),
      priority: 0,
      dispatched_at: null,
      started_at: nodeRun.started_at,
      completed_at: nodeRun.completed_at,
      result: nodeRun.worker_output ?? nodeRun.critic_output ?? null,
      error: errorMessage,
      created_at: nodeRun.created_at,
      chat_session_id: sessionId ?? undefined,
      work_dir: readWorkDir(nodeRun.worker_output),
      session_id: sessionId ?? undefined,
    };
  }, [errorMessage, issueId, nodeRun, sessionId, transcriptAgentId, transcriptTaskId]);
  const canOpenSession = !isGateway && (!!sessionId || !!transcriptTask);
  const canUnblock = !isGateway && status === "blocked" && !!onUnblock;
  const canRetry = !isGateway && isRetryableNodeRunStatus(status) && !!onRetry;

  const handleOpenSession = async () => {
    if (transcriptLoading) return;
    if (isEmbeddedInCostrict()) {
      if (sessionId) {
        const posted = postCostrictNavigateToSession({ sessionId });
        if (posted) return;
      }
    }
    if (sessionId) {
      const chatSessionId = resolveChatSessionId(chatSessions, sessionId);
      if (chatSessionId) {
        setChatSession(chatSessionId);
        setChatOpen(true);
        return;
      }
    }
    if (!transcriptTask) return;
    setTranscriptLoading(true);
    try {
      const msgs = await api.listTaskMessages(transcriptTask.id);
      setTranscriptItems(buildTimeline(msgs));
    } catch (err) {
      console.error(err);
      setTranscriptItems([]);
    } finally {
      setTranscriptLoading(false);
      setTranscriptOpen(true);
    }
  };

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      variant="overlay"
      title={node.title}
      eyebrow="Node runtime"
      closeLabel="Close"
      onClose={onClose}
      statusIcon={(
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-[11px] font-medium text-muted-foreground">
          <RuntimeDisplayStatusIcon
            status={displayStatus}
            gatewayKind={isGateway ? nodeFormat.gateway_kind : null}
            className="h-3.5 w-3.5"
          />
          <span>{displayStatusLabel}</span>
        </span>
      )}
    >
      <NodeDetailSection
        sectionId="status-next-step"
        icon={<Activity className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_status_next_step)}
      >
        <div
          data-testid="runtime-diagnostic-summary"
          className="space-y-3 rounded-lg border bg-muted/20 p-3"
        >
          <div className="flex items-start gap-2">
            <RuntimeDisplayStatusIcon
              status={displayStatus}
              gatewayKind={isGateway ? nodeFormat.gateway_kind : null}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{displayStatusLabel}</p>
              {errorMessage ? <p className="mt-1 text-sm text-destructive">{errorMessage}</p> : null}
            </div>
          </div>
          {isGateway ? (
            <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 p-3">
              <GatewayIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{gatewayLabel(nodeFormat.gateway_kind)}</p>
                <p className="text-xs text-muted-foreground">{gatewayDescription(nodeFormat.gateway_kind)}</p>
              </div>
            </div>
          ) : null}
          <div data-testid="runtime-primary-actions" className="flex flex-wrap gap-2">
            {canOpenSession ? (
              <button
                type="button"
                onClick={handleOpenSession}
                disabled={transcriptLoading}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                {transcriptLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" />
                )}
                {t(($) => $.execution.detail_panel.open_session)}
              </button>
            ) : null}
            {canOpenSession && onTakeoverSession ? (
              <button
                type="button"
                onClick={onTakeoverSession}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                {t(($) => $.execution.detail_panel.take_over_session)}
              </button>
            ) : null}
            {onOpenIssue ? (
              <button
                type="button"
                onClick={onOpenIssue}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {isChildIssue
                  ? t(($) => $.execution.detail_panel.open_child_issue)
                  : t(($) => $.execution.detail_panel.view_full_issue)}
              </button>
            ) : null}
            {canUnblock ? (
              <button
                type="button"
                onClick={onUnblock}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
              >
                <Unlock className="h-3.5 w-3.5" />
                {t(($) => $.execution.detail_panel.unblock)}
              </button>
            ) : null}
            {canRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t(($) => $.execution.detail_panel.retry)}
              </button>
            ) : null}
          </div>
        </div>
      </NodeDetailSection>

      {isChildIssue ? (
        <NodeDetailSection
          sectionId="child-progress"
          icon={<GitFork className="size-4" />}
          title={t(($) => $.execution.detail_panel.section_child_progress)}
        >
          <dl className="space-y-1 text-xs">
            {parentSplitTitle ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.parent_split)}</dt>
                <dd>{parentSplitTitle}</dd>
              </div>
            ) : null}
            {childWorkflowName ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.child_workflow)}</dt>
                <dd>{childWorkflowName}</dd>
              </div>
            ) : null}
            {errorMessage ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.reason)}</dt>
                <dd className="text-destructive">{errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        </NodeDetailSection>
      ) : null}

      <NodeDetailSection
        sectionId="worker-critic"
        icon={<Bot className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_worker_critic)}
      >
        {!isGateway ? (
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2">
              {node.worker_type === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              <span className="text-muted-foreground">{t(($) => $.execution.detail_panel.worker)}</span>
              <span className="font-medium">{workerName ?? "--"}</span>
            </div>
            <div className="flex items-center gap-2">
              {nodeRun?.critic_type === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              <span className="text-muted-foreground">{t(($) => $.execution.detail_panel.critic)}</span>
              <span className="font-medium">
                {node.critic_type || node.critic_id
                  ? criticName ?? "--"
                  : t(($) => $.execution.detail_panel.not_configured)}
              </span>
            </div>
            {nodeRun?.critic_comment ? (
              <p className="text-xs italic text-muted-foreground">&ldquo;{nodeRun.critic_comment}&rdquo;</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t(($) => $.execution.detail_panel.gateway_no_worker)}</p>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="evidence-preview"
        icon={<MessageSquare className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_evidence_preview)}
      >
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => setShowEvidence((value) => !value)}
        >
          {t(($) => $.execution.detail_panel.view_evidence)}
        </button>
        {showEvidence ? (
          <div className="mt-2 space-y-2">
            {nodeRun?.worker_output != null ? (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                {formatJson(nodeRun.worker_output)}
              </pre>
            ) : null}
            {nodeRun?.critic_output != null ? (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                {formatJson(nodeRun.critic_output)}
              </pre>
            ) : null}
            {nodeRun?.worker_output == null && nodeRun?.critic_output == null ? (
              <p className="text-xs text-muted-foreground">{t(($) => $.execution.detail_panel.no_output)}</p>
            ) : null}
          </div>
        ) : null}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime-facts"
        icon={<Activity className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_runtime_facts)}
      >
        {nodeRun ? (
          <dl className="space-y-1 text-xs">
            {nodeRun.started_at ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.started_at)}</dt>
                <dd>{new Date(nodeRun.started_at).toLocaleString()}</dd>
              </div>
            ) : null}
            {nodeRun.completed_at ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.completed_at)}</dt>
                <dd>{new Date(nodeRun.completed_at).toLocaleString()}</dd>
              </div>
            ) : null}
            {durationLabel != null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.duration)}</dt>
                <dd>{durationLabel}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.retry_count)}</dt>
              <dd>{nodeRun.retry_count}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t(($) => $.execution.detail_panel.no_runtime_data)}</p>
        )}
      </NodeDetailSection>

      {transcriptTask && transcriptOpen ? (
        <AgentTranscriptDialog
          open={transcriptOpen}
          onOpenChange={setTranscriptOpen}
          task={transcriptTask}
          items={transcriptItems}
          agentName={transcriptAgentName ?? "Agent"}
        />
      ) : null}

    </WorkflowNodeDetailPanelShell>
  );
}

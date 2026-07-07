"use client";

import { useEffect, useMemo } from "react";
import {
  Activity,
  Bot,
  FileCheck2,
  GitFork,
  GitMerge,
  MessageSquare,
  RotateCcw,
  Unlock,
  User,
} from "lucide-react";
import { useChatStore } from "@multica/core/chat";
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
import { useT } from "@multica/views/i18n";
import { cn } from "@multica/ui/lib/utils";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "../../../common/workflow-node-detail-panel-shell";
import { ArtifactList } from "./artifact-list";
import { NodeRunStatusIcon, RuntimeDisplayStatusIcon } from "./node-run-status-icon";

export interface ExecutionDetailPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  workerName: string | null;
  criticName: string | null;
  onClose: () => void;
  wsId: string;
  issueId?: string;
  runtimeSummary?: WorkflowNodeRuntimeSummary | null;
  onUnblock?: () => void;
  onRetry?: () => void;
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

export function ExecutionDetailPanel({
  node,
  nodeRun,
  workerName,
  criticName,
  onClose,
  runtimeSummary,
  onUnblock,
  onRetry,
}: ExecutionDetailPanelProps) {
  const { t } = useT("issues");
  const nodeFormat = parseNodeFormat(node.format_schema);
  const isGateway = nodeFormat.kind === "gateway";
  const displayStatus = runtimeSummary?.display_status ?? (nodeRun ? toWorkflowRuntimeDisplayStatus(nodeRun.status) : "pending");
  const displayStatusLabel = runtimeDisplayStatusText(t, displayStatus, isGateway ? nodeFormat.gateway_kind : null);
  const GatewayIcon = nodeFormat.gateway_kind === "join" ? GitMerge : GitFork;
  const setChatSession = useChatStore((s) => s.setActiveSession);
  const setChatOpen = useChatStore((s) => s.setOpen);

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
    if (duration < 60) return `${duration}s`;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
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
  const canOpenSession = !isGateway && !!sessionId;
  const canUnblock = !isGateway && status === "blocked" && !!onUnblock;
  const canRetry = !isGateway && isRetryableNodeRunStatus(status) && !!onRetry;
  const hasAgentOperations = canOpenSession || canUnblock || canRetry;

  const handleOpenSession = () => {
    if (!sessionId) return;
    if (isEmbeddedInCostrict()) {
      postCostrictNavigateToSession({ sessionId });
      return;
    }
    setChatSession(sessionId);
    setChatOpen(true);
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
        sectionId="primary"
        icon={<Activity className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_primary)}
        subtitle={t(($) => $.execution.detail_panel.section_primary_desc)}
      >
        {node.description ? (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.detail.desc_label)}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {node.description}
            </p>
          </div>
        ) : null}

        {isGateway ? (
          <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/30 p-3">
            <GatewayIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{gatewayLabel(nodeFormat.gateway_kind)}</p>
              <p className="text-xs text-muted-foreground">
                {gatewayDescription(nodeFormat.gateway_kind)}
              </p>
            </div>
          </div>
        ) : null}

        {status && !isGateway ? (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.execution.detail_panel.status_path)}
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "rounded px-2 py-0.5",
                  status === "format_checking" || status === "format_ok"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-muted/50",
                )}
              >
                Format
              </span>
              <span className="text-muted-foreground">-&gt;</span>
              <span
                className={cn(
                  "rounded px-2 py-0.5",
                  status === "working" ? "bg-blue-50 text-blue-700" : "bg-muted/50",
                )}
              >
                Worker
              </span>
              <span className="text-muted-foreground">-&gt;</span>
              <span
                className={cn(
                  "rounded px-2 py-0.5",
                  status === "critic_reviewing" || status === "critic_approved"
                    ? "bg-green-50 text-green-700"
                    : "bg-muted/50",
                )}
              >
                Critic
              </span>
            </div>
          </div>
        ) : null}

        {!isGateway ? (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.execution.detail_panel.worker)}
            </h3>
            <div className="flex items-center gap-2 text-sm">
              {node.worker_type === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              <span className="font-medium">{workerName ?? "--"}</span>
              {nodeRun ? <NodeRunStatusIcon status={nodeRun.status} className="h-3.5 w-3.5" /> : null}
            </div>
          </div>
        ) : null}

        {!isGateway ? (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.execution.detail_panel.critic)}
            </h3>
            {node.critic_type || node.critic_id ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {nodeRun?.critic_type === "agent" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                  <span className="font-medium">{criticName ?? "--"}</span>
                </div>
                {nodeRun?.critic_comment ? (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    &ldquo;{nodeRun.critic_comment}&rdquo;
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                {t(($) => $.execution.detail_panel.not_configured)}
              </p>
            )}
          </div>
        ) : null}
      </NodeDetailSection>

      {hasAgentOperations ? (
        <NodeDetailSection
          sectionId="agent-operations"
          icon={<Bot className="size-4" />}
          title={t(($) => $.execution.detail_panel.section_agent_operations)}
          subtitle={t(($) => $.execution.detail_panel.section_agent_operations_desc)}
        >
          <div className="flex flex-wrap items-center gap-2">
            {canOpenSession ? (
              <button
                type="button"
                onClick={handleOpenSession}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t(($) => $.execution.detail_panel.open_session)}
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
        </NodeDetailSection>
      ) : null}

      <NodeDetailSection
        sectionId="deliverables"
        icon={<FileCheck2 className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_deliverables)}
        subtitle={t(($) => $.execution.detail_panel.section_deliverables_desc)}
      >
        {nodeRun && !isGateway ? (
          <ArtifactList nodeRun={nodeRun} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {isGateway ? "Gateway nodes do not produce deliverables." : "No run data for deliverables yet."}
          </p>
        )}
      </NodeDetailSection>

      <NodeDetailSection
        sectionId="runtime"
        icon={<Activity className="size-4" />}
        title={t(($) => $.execution.detail_panel.section_runtime)}
        subtitle={t(($) => $.execution.detail_panel.section_runtime_desc)}
      >
        {nodeRun && !isGateway ? (
          <div className="space-y-3">
            {nodeRun.worker_output != null || nodeRun.critic_output != null ? (
              <div className="space-y-2">
                {nodeRun.worker_output != null ? (
                  <div>
                    <h4 className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {t(($) => $.execution.detail_panel.worker_output)}
                    </h4>
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                      {formatJson(nodeRun.worker_output)}
                    </pre>
                  </div>
                ) : null}
                {nodeRun.critic_output != null ? (
                  <div>
                    <h4 className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {t(($) => $.execution.detail_panel.critic_output)}
                    </h4>
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                      {formatJson(nodeRun.critic_output)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(($) => $.execution.detail_panel.metadata)}
              </h3>
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
                {errorMessage ? (
                  <div className="mt-2 flex flex-col gap-1 border-t border-border/50 pt-2">
                    <dt className="font-medium text-red-600 dark:text-red-400">
                      {t(($) => $.execution.detail_panel.error)}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words text-red-600 dark:text-red-400">
                      {errorMessage}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isGateway ? "Gateway runtime is automatic and has no worker output." : "No runtime data yet."}
          </p>
        )}
      </NodeDetailSection>

    </WorkflowNodeDetailPanelShell>
  );
}

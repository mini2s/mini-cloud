"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignLeft,
  Ban,
  Bot,
  Check,
  ExternalLink,
  FileCheck2,
  FileText,
  GitBranch,
  Inbox,
  Link,
  Loader2,
  RefreshCcw,
  Send,
  Upload,
  User,
  X,
} from "lucide-react";
import { api } from "@multica/core/api";
import { isEmbeddedInCostrict, postCostrictNavigateToSession } from "@multica/core/platform";
import type {
  WorkflowNode,
  WorkflowNodeDeliverable,
  WorkflowNodeDeliverableSubmission,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import { toWorkflowRuntimeDisplayStatus } from "@multica/core/types";
import {
  nodeRunDeliverableSubmissionsOptions,
  useSessionPermission,
  workflowKeys,
} from "@multica/core/workflows/queries";
import { useT } from "@multica/views/i18n";
import { NativeSelect, NativeSelectOption } from "@multica/ui/components/ui/native-select";
import { WorkflowNodeDetailPanelShell } from "../../../common/workflow-node-detail-panel-shell";
import {
  DrawerBadge,
  DrawerMoreInformation,
  DrawerSection,
  IssueDescriptionCard,
  PreviousDeliverableCard,
  drawerButtonClass,
  drawerSmallButtonClass,
  formatPullRequestLabel,
  formatDeliverableTime,
  submissionDisplayTitle,
  type DeliverableDrawerItem,
} from "../../../common/node-deliverable-drawer-ui";
import { formatRuntimeDuration } from "./runtime-node-duration";
import { resolveEnterSessionId } from "./runtime-session";
import { RuntimeDisplayStatusIcon } from "./node-run-status-icon";
import {
  runtimeDisplayStatusText,
  runtimeDisplayStatusTone,
} from "./runtime-display-status";
import type { HumanActionMember } from "./node-run-action-access";
import { getHumanNodeRunActionAccess } from "./node-run-action-access";
import { NodeRunActionPanel } from "./node-run-action-panel";
import {
  useNodeRunDelivery,
  type NodeRunDeliveryController,
} from "./node-run-delivery-form";

interface TaskNodeDetailPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  previousNodeRun?: WorkflowNodeRun | null;
  workerName: string | null;
  criticName: string | null;
  onClose: () => void;
  wsId: string;
  issueId?: string;
  issueDescription?: string | null;
  runtimeSummary?: WorkflowNodeRuntimeSummary | null;
  onOpenIssue?: () => void;
  onRetry?: () => void;
  isChildIssue?: boolean;
  parentSplitTitle?: string | null;
  childAssigneeName?: string | null;
  workflowId?: string;
  runId?: string | null;
  currentUserId?: string | null;
  currentMember?: HumanActionMember | null;
  mayReview?: boolean;
}

function formatOutput(output: unknown, empty: string): string {
  if (output == null) return empty;
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function outputError(nodeRun: WorkflowNodeRun | null, runtimeError?: string | null): string | null {
  if (runtimeError?.trim()) return runtimeError;
  if (!nodeRun) return null;
  for (const output of [nodeRun.worker_output, nodeRun.critic_output]) {
    if (output == null || typeof output !== "object") continue;
    const record = output as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  return nodeRun.failure_reason?.trim() || null;
}

interface TaskSubmissionItem {
  submission: WorkflowNodeDeliverableSubmission;
  name: string;
  kind: "doc" | "pr";
}

function TaskSubmissionCard({
  items,
  completed,
  actions,
  t,
}: {
  items: TaskSubmissionItem[];
  completed: boolean;
  actions?: ReactNode;
  t: ReturnType<typeof useT<"issues">>["t"];
}) {
  return (
    <div className="rounded-[10px] border border-blue-500/25 bg-background px-[14px] py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(37,99,235,0.3)]">
      {items.length === 0 ? (
        <div className="px-0.5 py-1.5 text-xs leading-[1.6] text-muted-foreground">
          {t(($) => $.execution.detail_panel.task_drawer_empty)}
        </div>
      ) : items.map((item, index) => {
        const ItemIcon = item.kind === "pr" ? GitBranch : FileText;
        const status = completed && item.submission.status === "submitted"
          ? "approved"
          : item.submission.status;
        return (
          <div key={item.submission.id} className={index > 0 ? "mt-3 border-t pt-3" : undefined}>
            <div className="flex min-w-0 items-center gap-[9px]">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/45 dark:text-blue-400">
                <ItemIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[7px] text-sm leading-[20.8px]">
                  <span className="truncate font-mono text-[13px] font-semibold">{item.name}</span>
                  <span className="rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none text-muted-foreground">
                    {item.kind === "pr"
                      ? t(($) => $.execution.detail_panel.task_drawer_pr)
                      : t(($) => $.execution.detail_panel.task_drawer_document)}
                  </span>
                  <span className={`rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none ${
                    status === "rejected"
                      ? "text-destructive"
                      : status === "approved"
                        ? "text-emerald-600"
                        : "text-blue-600 dark:text-blue-400"
                  }`}>
                    {status === "rejected"
                      ? t(($) => $.execution.detail_panel.task_drawer_rejected)
                      : status === "approved"
                        ? t(($) => $.execution.detail_panel.task_drawer_approved)
                        : t(($) => $.execution.detail_panel.task_drawer_submitted)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex min-h-[18.59375px] items-center gap-2.5">
              {item.kind === "pr" ? (
                <a
                  href={item.submission.pull_request_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-[3px] text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink className="size-3" />
                  {formatPullRequestLabel(
                    item.submission.pull_request_url,
                    t(($) => $.execution.detail_panel.task_drawer_pull_request),
                  )}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none text-emerald-600">
                  <FileCheck2 className="size-[11px]" />
                  {t(($) => $.execution.detail_panel.task_drawer_uploaded)}
                </span>
              )}
              <span className="text-[11px] leading-[1.45] text-muted-foreground">
                {status === "approved"
                  ? t(($) => $.execution.detail_panel.task_drawer_review_passed)
                  : status === "rejected"
                    ? t(($) => $.execution.detail_panel.task_drawer_review_rejected)
                  : item.kind === "pr"
                    ? t(($) => $.execution.detail_panel.task_drawer_review_in_gitea)
                    : t(($) => $.execution.detail_panel.task_drawer_wait_critic)}
              </span>
              <span className="text-[11px] leading-[17.6px] text-muted-foreground">
                {t(($) => $.execution.detail_panel.task_drawer_submitted_at)} {formatDeliverableTime(item.submission.submitted_at)}
              </span>
            </div>
            {item.submission.review_comment ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{item.submission.review_comment}</p>
            ) : null}
          </div>
        );
      })}
      {actions ? (
        <div className={`${items.length > 0 ? "mt-3" : "mt-2"} border-t border-dashed pt-3`}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function TaskDeliveryActions({
  delivery,
  deliverables,
  t,
  tw,
}: {
  delivery: NodeRunDeliveryController;
  deliverables: WorkflowNodeDeliverable[];
  t: ReturnType<typeof useT<"issues">>["t"];
  tw: ReturnType<typeof useT<"workflows">>["t"];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div data-testid="task-delivery-actions" className="space-y-2.5">
      {deliverables.length > 1 ? (
        <NativeSelect
          size="sm"
          aria-label={tw(($) => $.node_run.deliverables.deliverables_section)}
          value={delivery.selectedDeliverableIDResolved}
          disabled={delivery.submitMutation.isPending}
          onChange={(event) => delivery.setSelectedDeliverableID(event.target.value)}
        >
          {deliverables.map((deliverable) => (
            <NativeSelectOption key={deliverable.id} value={deliverable.id}>
              {deliverable.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${drawerSmallButtonClass} border-border bg-background px-2.5 hover:bg-muted`}
          disabled={delivery.submitMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3" />
          {t(($) => $.execution.detail_panel.task_drawer_submit_document)}
        </button>
        <input
          ref={fileInputRef}
          key={delivery.fileInputKey}
          data-testid="task-delivery-file-input"
          type="file"
          multiple
          className="hidden"
          disabled={delivery.submitMutation.isPending}
          onChange={(event) => {
            if (event.target.files) {
              delivery.setStagedFiles((current) => [
                ...current,
                ...Array.from(event.target.files ?? []),
              ]);
            }
            delivery.setFileInputKey((key) => key + 1);
          }}
        />
        <button
          type="button"
          className={`${drawerSmallButtonClass} border-border bg-background px-2.5 hover:bg-muted`}
          disabled={delivery.submitMutation.isPending}
          onClick={() => delivery.setIsLinkEditorOpen(true)}
        >
          <Link className="size-3" />
          {t(($) => $.execution.detail_panel.task_drawer_submit_link)}
        </button>
        <span className="text-[11px] leading-[1.45] text-muted-foreground">
          {t(($) => $.execution.detail_panel.task_drawer_submit_hint)}
        </span>
      </div>

      {delivery.stagedFiles.length > 0 ? (
        <ul className="space-y-1">
          {delivery.stagedFiles.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-1.5 text-xs">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={delivery.submitMutation.isPending}
                onClick={() => delivery.setStagedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {delivery.links.length > 0 ? (
        <ul className="space-y-1">
          {delivery.links.map((url) => (
            <li key={url} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link className="size-3.5 shrink-0" />
              <span className="truncate">{url}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {delivery.isLinkEditorOpen ? (
        <div className="flex items-center gap-2">
          <input
            type="url"
            autoFocus
            value={delivery.linkDraft}
            aria-label={t(($) => $.execution.detail_panel.task_drawer_submit_link)}
            placeholder={t(($) => $.execution.detail_panel.task_drawer_link_placeholder)}
            disabled={delivery.submitMutation.isPending}
            onChange={(event) => delivery.setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                delivery.confirmLinkDraft();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-xs outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="button"
            className={`${drawerSmallButtonClass} border-primary bg-primary px-2.5 text-primary-foreground hover:bg-primary/85`}
            aria-label={t(($) => $.execution.detail_panel.task_drawer_confirm_link)}
            disabled={delivery.submitMutation.isPending || delivery.linkDraftLines.length === 0 || delivery.linkDraftInvalid}
            onClick={delivery.confirmLinkDraft}
          >
            <Check className="size-3" />
            {t(($) => $.execution.detail_panel.task_drawer_confirm_link)}
          </button>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={tw(($) => $.node_run.deliverables.cancel)}
            disabled={delivery.submitMutation.isPending}
            onClick={() => {
              delivery.setLinkDraft("");
              delivery.setIsLinkEditorOpen(false);
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {delivery.isLinkEditorOpen && delivery.linkDraftInvalid ? (
        <p className="text-xs text-destructive">
          {tw(($) => $.node_run.deliverables.upload_pr_invalid)}
        </p>
      ) : null}
    </div>
  );
}

function TaskDeliveryFooter({
  delivery,
  t,
  tw,
}: {
  delivery: NodeRunDeliveryController;
  t: ReturnType<typeof useT<"issues">>["t"];
  tw: ReturnType<typeof useT<"workflows">>["t"];
}) {
  return (
    <div data-testid="node-run-delivery-form">
      <textarea
        value={delivery.summary}
        onChange={(event) => delivery.setSummary(event.target.value)}
        placeholder={t(($) => $.execution.detail_panel.execution_summary_placeholder)}
        aria-label={t(($) => $.execution.detail_panel.execution_summary)}
        rows={3}
        disabled={delivery.submitMutation.isPending}
        className="min-h-20 w-full resize-none rounded-md border bg-background px-2.5 py-2 text-sm"
      />
      {delivery.submitMutation.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {delivery.submitMutation.error instanceof Error
            ? delivery.submitMutation.error.message
            : t(($) => $.execution.detail_panel.task_drawer_submit_failed)}
        </p>
      ) : null}
      {delivery.summaryOnlyBlocked ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(($) => $.execution.detail_panel.deliverables_required_first)}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          className={`${drawerButtonClass} border-border bg-background hover:bg-muted`}
          disabled={delivery.submitMutation.isPending || !delivery.dirty}
          onClick={delivery.reset}
        >
          {tw(($) => $.node_run.deliverables.cancel)}
        </button>
        <button
          type="button"
          className={`${drawerButtonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/85`}
          disabled={delivery.submitMutation.isPending || !delivery.dirty || delivery.linksInvalid || delivery.summaryOnlyBlocked}
          onClick={() => delivery.submitMutation.mutate()}
        >
          {delivery.submitMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          {delivery.submitMutation.isPending
            ? t(($) => $.execution.detail_panel.submitting_result)
            : t(($) => $.execution.detail_panel.submit_result)}
        </button>
      </div>
    </div>
  );
}

export function TaskNodeDetailPanel({
  node,
  nodeRun,
  previousNodeRun,
  workerName,
  criticName,
  onClose,
  wsId,
  issueId,
  issueDescription,
  runtimeSummary,
  onOpenIssue,
  onRetry,
  isChildIssue = false,
  parentSplitTitle,
  childAssigneeName,
  workflowId,
  runId,
  currentUserId,
  currentMember,
  mayReview,
}: TaskNodeDetailPanelProps) {
  const { t } = useT("issues");
  const { t: tw } = useT("workflows");
  const queryClient = useQueryClient();
  const [reviewComment, setReviewComment] = useState("");
  const { data: currentData } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRun?.id ?? ""),
    enabled: !!nodeRun?.id,
  });
  const { data: previousData } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, previousNodeRun?.id ?? ""),
    enabled: !!previousNodeRun?.id,
  });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const items = useMemo<TaskSubmissionItem[]>(() => {
    const definitions = new Map(
      (currentData?.deliverables ?? []).map((deliverable) => [deliverable.id, deliverable]),
    );
    return (currentData?.submissions ?? [])
      .filter((submission) => submission.status !== "missing")
      .map((submission) => {
        const deliverable = definitions.get(submission.deliverable_id);
        const kind = submission.pull_request_url ? "pr" as const : "doc" as const;
        return {
          submission,
          kind,
          name: submissionDisplayTitle(
            submission,
            deliverable?.title || (kind === "pr" ? submission.pull_request_url : t(($) => $.execution.detail_panel.task_drawer_document)),
          ),
        };
      });
  }, [currentData, t]);

  const previousItem = useMemo<DeliverableDrawerItem | null>(() => {
    const deliverable = [...(previousData?.deliverables ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)[0];
    if (!deliverable) return null;
    return {
      deliverable,
      submission: (previousData?.submissions ?? [])
        .find((candidate) => candidate.deliverable_id === deliverable.id) ?? null,
    };
  }, [previousData]);

  const submissions = currentData?.submissions ?? [];
  const delivery = useNodeRunDelivery({
    wsId,
    issueId: issueId ?? "",
    nodeRunId: nodeRun?.id ?? "",
    deliverables: currentData?.deliverables ?? [],
    submissions,
    workflowId,
    runId,
  });
  const displayStatus = nodeRun?.status === "failed"
    ? "failed"
    : runtimeSummary?.display_status ?? (nodeRun ? toWorkflowRuntimeDisplayStatus(nodeRun.status) : "pending");
  const reviewState = displayStatus === "reviewing";
  const baseAccess = nodeRun
    ? getHumanNodeRunActionAccess({ nodeRun, userId: currentUserId ?? null, member: currentMember ?? null })
    : null;
  const isHumanReview = reviewState && (nodeRun?.critic_type === "human" || node.critic_type === "human");
  const canReview = isHumanReview && (mayReview ?? baseAccess?.canReview) === true;
  const canUpload = !!nodeRun
    && !!issueId
    && baseAccess?.canSubmit === true
    && (currentData?.deliverables.length ?? 0) > 0;
  const errorMessage = outputError(nodeRun, runtimeSummary?.error_message);
  const statusLine = displayStatus === "pending" || displayStatus === "todo"
    ? t(($) => $.execution.detail_panel.task_drawer_line_todo)
    : displayStatus === "in_progress"
      ? t(($) => $.execution.detail_panel.task_drawer_line_running)
      : displayStatus === "reviewing"
        ? t(($) => $.execution.detail_panel.task_drawer_line_review)
        : displayStatus === "completed"
          ? t(($) => $.execution.detail_panel.task_drawer_line_completed)
          : displayStatus === "failed" || displayStatus === "blocked"
            ? errorMessage || t(($) => $.execution.detail_panel.task_drawer_line_failed)
            : t(($) => $.execution.detail_panel.task_drawer_line_cancelled);
  const statusMeta = {
    tone: runtimeDisplayStatusTone(displayStatus),
    label: runtimeDisplayStatusText(t, displayStatus),
    line: statusLine,
  };

  const currentSubtitle = displayStatus === "pending" || displayStatus === "todo"
    ? items.length > 0
      ? t(($) => $.execution.detail_panel.task_drawer_deliverables_todo_submitted, { count: items.length })
      : t(($) => $.execution.detail_panel.task_drawer_deliverables_todo)
    : displayStatus === "reviewing"
      ? t(($) => $.execution.detail_panel.task_drawer_deliverables_review, { count: items.length })
      : displayStatus === "completed"
        ? t(($) => $.execution.detail_panel.task_drawer_deliverables_completed, { count: items.length })
        : displayStatus === "failed" || displayStatus === "blocked" || displayStatus === "cancelled"
          ? items.length > 0
            ? t(($) => $.execution.detail_panel.task_drawer_deliverables_stopped, { count: items.length })
            : t(($) => $.execution.detail_panel.task_drawer_deliverables_stopped_empty)
        : items.length > 0
          ? t(($) => $.execution.detail_panel.task_drawer_deliverables_running, { count: items.length })
          : t(($) => $.execution.detail_panel.task_drawer_deliverables_running_empty);

  const reviewMutation = useMutation({
    mutationFn: async (approved: boolean) => {
      if (!nodeRun) return;
      const reviewStatus = approved ? "approved" : "rejected";
      await Promise.all(
        submissions
          .filter((submission) => submission.status !== reviewStatus)
          .map((submission) => api.reviewNodeRunDeliverable(nodeRun.id, submission.id, {
            status: reviewStatus,
            review_comment: reviewComment,
          })),
      );
      await api.reviewNodeRun(nodeRun.id, approved, reviewComment);
    },
    onSuccess: async () => {
      if (!nodeRun) return;
      await queryClient.invalidateQueries({ queryKey: workflowKeys.nodeRunDeliverables(nodeRun.id) });
      if (workflowId && runId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: workflowKeys.nodeRuns(wsId, workflowId, runId) }),
          queryClient.invalidateQueries({ queryKey: workflowKeys.runCanvasSummary(wsId, workflowId, runId) }),
        ]);
      }
      setReviewComment("");
    },
  });

  const duration = nodeRun?.started_at
    ? Math.max(0, Math.round(((nodeRun.completed_at ? Date.parse(nodeRun.completed_at) : Date.now()) - Date.parse(nodeRun.started_at)) / 1000))
    : null;
  const sessionId = resolveEnterSessionId(nodeRun, runtimeSummary);
  const { data: sessionPermission } = useSessionPermission(sessionId);
  const canOpenSession = !!sessionId
    && sessionPermission?.can_observe === true
    && isEmbeddedInCostrict();
  const openSession = () => {
    if (!sessionId || !canOpenSession) return;
    postCostrictNavigateToSession({ sessionId, newTab: true });
  };
  const actionAccess = baseAccess
    ? {
        ...baseAccess,
        canReview: false,
        canSubmit: baseAccess.canSubmit && (currentData?.deliverables.length ?? 0) === 0,
      }
    : null;
  const footerKeyActions = (
    <>
      {canOpenSession ? (
        <button type="button" className={`${drawerSmallButtonClass} shrink-0 border-border bg-background hover:bg-muted`} onClick={openSession}>
          {t(($) => $.execution.detail_panel.open_session)}
        </button>
      ) : null}
      {onOpenIssue ? (
        <button type="button" className={`${drawerSmallButtonClass} shrink-0 border-border bg-background hover:bg-muted`} onClick={onOpenIssue}>
          <ExternalLink className="size-3" />
          {isChildIssue ? t(($) => $.execution.detail_panel.open_child_issue) : t(($) => $.execution.detail_panel.view_full_issue)}
        </button>
      ) : null}
      {onRetry ? (
        <button type="button" className={`${drawerSmallButtonClass} shrink-0 border-border bg-background hover:bg-muted`} onClick={onRetry}>
          <RefreshCcw className="size-3" />
          {t(($) => $.execution.detail_panel.task_drawer_retry)}
        </button>
      ) : null}
    </>
  );
  const hasFooterKeyActions = canOpenSession || !!onOpenIssue || !!onRetry;
  const hasRuntimeControls = nodeRun?.runtime_id != null && (
    nodeRun.status === "working" ||
    (nodeRun.status === "blocked" && nodeRun.completed_at == null)
  );
  const hasPrimaryNodeActions = !!nodeRun && !!actionAccess && (
    actionAccess.canSubmit || actionAccess.canSkip || hasRuntimeControls || hasFooterKeyActions
  );
  const nodeActionPanel = nodeRun && actionAccess ? (
    <NodeRunActionPanel
      nodeRun={nodeRun}
      access={actionAccess}
      wsId={wsId}
      workflowId={workflowId}
      runId={runId ?? undefined}
      additionalActions={hasFooterKeyActions ? footerKeyActions : undefined}
      singleRow
    />
  ) : null;
  const footerPrimary = canReview ? (
    <div>
      <textarea
        value={reviewComment}
        onChange={(event) => setReviewComment(event.target.value)}
        placeholder={t(($) => $.execution.detail_panel.task_drawer_review_placeholder)}
        className="min-h-16 w-full resize-y rounded-lg border bg-background px-2.5 py-2 text-[12.5px] leading-[1.55] outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/40"
      />
      {reviewMutation.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {reviewMutation.error instanceof Error ? reviewMutation.error.message : t(($) => $.execution.detail_panel.task_drawer_review_failed)}
        </p>
      ) : null}
      <div className="mt-[9px] flex justify-end gap-2">
        <button
          type="button"
          className={`${drawerButtonClass} border-border bg-background hover:bg-muted`}
          disabled={reviewMutation.isPending || !reviewComment.trim()}
          onClick={() => reviewMutation.mutate(false)}
        >
          <Ban className="size-3.5" />
          {t(($) => $.execution.card.actions.reject)}
        </button>
        <button
          type="button"
          className={`${drawerButtonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/85`}
          disabled={reviewMutation.isPending}
          onClick={() => reviewMutation.mutate(true)}
        >
          {reviewMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {t(($) => $.execution.card.actions.approve)}
        </button>
      </div>
    </div>
  ) : canUpload ? (
    <TaskDeliveryFooter delivery={delivery} t={t} tw={tw} />
  ) : hasPrimaryNodeActions ? (
    nodeActionPanel
  ) : null;
  const footerSupplementaryActions = (canUpload || canReview)
    && (actionAccess?.canSkip || hasRuntimeControls || hasFooterKeyActions)
    ? nodeActionPanel
    : null;
  const keyActionsNeedStandaloneRow = hasFooterKeyActions && !nodeActionPanel;
  const footer = footerPrimary || footerSupplementaryActions || keyActionsNeedStandaloneRow ? (
    <div className="space-y-3">
      {footerPrimary}
      {footerSupplementaryActions}
      {keyActionsNeedStandaloneRow ? (
        <div className="flex flex-nowrap items-center justify-end gap-2 overflow-x-auto">
          {footerKeyActions}
        </div>
      ) : null}
    </div>
  ) : undefined;
  const moreInformation = (
    <DrawerMoreInformation title={t(($) => $.execution.detail_panel.task_drawer_more)}>
      <div className="space-y-3.5">
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t(($) => $.execution.detail_panel.task_drawer_runtime_info)}
          </div>
          <dl className="grid gap-1 text-xs">
            {parentSplitTitle ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.parent_split)}</dt><dd>{parentSplitTitle}</dd></div> : null}
            {childAssigneeName ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.child_assignee)}</dt><dd>{childAssigneeName}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.started_at)}</dt><dd>{nodeRun?.started_at ? new Date(nodeRun.started_at).toLocaleString() : "—"}</dd></div>
            {nodeRun?.completed_at ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.completed_at)}</dt><dd>{new Date(nodeRun.completed_at).toLocaleString()}</dd></div> : null}
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.duration)}</dt><dd>{duration == null ? "—" : formatRuntimeDuration(duration)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(($) => $.execution.detail_panel.retry_count)}</dt><dd>{nodeRun?.retry_count ?? 0}</dd></div>
          </dl>
        </div>
        {errorMessage ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-destructive">
              {t(($) => $.execution.detail_panel.error)}
            </div>
            <p className="rounded-lg bg-destructive/5 px-2.5 py-2 text-xs text-destructive">{errorMessage}</p>
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t(($) => $.execution.detail_panel.task_drawer_output_summary)}
          </div>
          <div className="space-y-2">
            {nodeRun?.worker_output != null ? (
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t(($) => $.execution.detail_panel.worker_output)}</div>
                <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-2 font-mono text-[11.5px]">
                  {formatOutput(nodeRun.worker_output, t(($) => $.execution.detail_panel.no_output))}
                </pre>
              </div>
            ) : null}
            {nodeRun?.critic_output != null ? (
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t(($) => $.execution.detail_panel.critic_output)}</div>
                <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-2 font-mono text-[11.5px]">
                  {formatOutput(nodeRun.critic_output, t(($) => $.execution.detail_panel.no_output))}
                </pre>
              </div>
            ) : null}
            {nodeRun?.worker_output == null && nodeRun?.critic_output == null ? (
              <p className="rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                {t(($) => $.execution.detail_panel.no_output)}
              </p>
            ) : null}
          </div>
        </div>
        {nodeRun?.critic_comment ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t(($) => $.execution.detail_panel.critic_comment)}
            </div>
            <p className="rounded-lg bg-muted px-2.5 py-2 text-xs text-muted-foreground">{nodeRun.critic_comment}</p>
          </div>
        ) : null}
      </div>
    </DrawerMoreInformation>
  );

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      variant="overlay"
      title={node.title}
      eyebrow={t(($) => $.execution.detail_panel.task_drawer_eyebrow)}
      closeLabel={t(($) => $.execution.detail_panel.task_drawer_close)}
      onClose={onClose}
      badges={(
        <>
          <DrawerBadge tone={statusMeta.tone}>
            <RuntimeDisplayStatusIcon status={displayStatus} className="size-[11px]" />
            {statusMeta.label}
          </DrawerBadge>
          <span className="text-[11px] leading-[1.6] text-muted-foreground">{statusMeta.line}</span>
        </>
      )}
      badgeActions={moreInformation}
      headerExtra={(
        <div className="mt-2 flex items-center gap-1.5 text-[11px] leading-[1.6] text-muted-foreground">
          <User className="size-3" />
          <span>{workerName ?? "—"}</span>
          <span>·</span>
          <Bot className="size-3" />
          <span>{t(($) => $.execution.detail_panel.task_drawer_critic, { name: criticName ?? t(($) => $.execution.detail_panel.not_configured) })}</span>
        </div>
      )}
      footer={footer}
      contentClassName="py-3.5"
    >
      <div className="space-y-3.5">
        <DrawerSection icon={<AlignLeft className="size-[13px]" />} title={t(($) => $.execution.detail_panel.task_drawer_issue_description)}>
          <IssueDescriptionCard
            description={issueDescription}
            emptyText={t(($) => $.execution.detail_panel.task_drawer_issue_description_empty)}
          />
        </DrawerSection>

        {previousNodeRun && previousItem ? (
          <DrawerSection icon={<Inbox className="size-[13px]" />} title={t(($) => $.execution.detail_panel.task_drawer_previous)}>
            <PreviousDeliverableCard
              nodeTitle={previousNodeRun.node_title}
              item={previousItem}
              emptyText={t(($) => $.execution.detail_panel.task_drawer_previous_empty)}
              pullRequestLabel={t(($) => $.execution.detail_panel.task_drawer_pull_request)}
              mergedLabel={t(($) => $.execution.detail_panel.task_drawer_merged)}
              hint={t(($) => $.execution.detail_panel.task_drawer_previous_hint)}
            />
          </DrawerSection>
        ) : null}

        <DrawerSection
          icon={<FileText className="size-[13px]" />}
          title={items.length > 0
            ? t(($) => $.execution.detail_panel.task_drawer_current, { count: items.length })
            : t(($) => $.execution.detail_panel.task_drawer_current_plain)}
          subtitle={currentSubtitle}
        >
          <TaskSubmissionCard
            items={items}
            completed={displayStatus === "completed"}
            actions={canUpload ? (
              <TaskDeliveryActions
                delivery={delivery}
                deliverables={currentData?.deliverables ?? []}
                t={t}
                tw={tw}
              />
            ) : undefined}
            t={t}
          />
        </DrawerSection>

      </div>
    </WorkflowNodeDetailPanelShell>
  );
}

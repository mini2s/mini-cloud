"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { ApiError } from "@multica/core/api";
import {
  nodeRunDeliverableSubmissionsOptions,
  splitTasksOptions,
  useApproveSplitTasks,
  useCancelSplitNode,
  useGenerateSplitTasks,
  useRejectSplitTasks,
  useRetrySplitTask,
} from "@multica/core/workflows/queries";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  FileText,
  GitBranch,
  Inbox,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@multica/views/i18n";
import { WorkflowNodeDetailPanelShell } from "../../../common/workflow-node-detail-panel-shell";
import {
  CurrentDeliverablesCard,
  DrawerBadge,
  DrawerMoreOperations,
  DrawerSection,
  PreviousDeliverableCard,
  drawerButtonClass,
  drawerSmallButtonClass,
  type DeliverableDrawerItem,
  type DrawerTone,
  formatDeliverableTime,
} from "../../../common/node-deliverable-drawer-ui";

interface SplitReviewPanelProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  previousNodeRun?: WorkflowNodeRun | null;
  wsId: string;
  workflowId?: string;
  runId?: string;
  parentIssueId?: string;
  onClose: () => void;
  onViewChildren?: () => void;
  plannerName?: string;
}

type ValidationDetail = { line?: number; field?: string; message?: string };

function errorDetails(error: unknown): ValidationDetail[] {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return [];
  const details = (error.body as { details?: unknown }).details;
  return Array.isArray(details)
    ? details.filter((item): item is ValidationDetail => !!item && typeof item === "object")
    : [];
}

export function SplitReviewPanel({
  node,
  nodeRun,
  previousNodeRun,
  wsId,
  workflowId,
  runId,
  onClose,
  onViewChildren,
}: SplitReviewPanelProps) {
  const { t } = useT("workflows");
  const nodeRunId = nodeRun?.id;
  const { data, isLoading } = useQuery(splitTasksOptions(wsId, nodeRunId));
  const { data: currentDeliverableData } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, nodeRunId ?? ""),
    enabled: !!nodeRunId,
  });
  const { data: previousDeliverableData } = useQuery({
    ...nodeRunDeliverableSubmissionsOptions(wsId, previousNodeRun?.id ?? ""),
    enabled: !!previousNodeRun?.id,
  });
  const approve = useApproveSplitTasks(wsId);
  const reject = useRejectSplitTasks(wsId);
  const generate = useGenerateSplitTasks(wsId);
  const retry = useRetrySplitTask(wsId);
  const cancel = useCancelSplitNode(wsId);
  const [reviewComment, setReviewComment] = useState("");
  const [validation, setValidation] = useState<ValidationDetail[]>([]);

  const generation = data?.split_plan_generation ?? 0;
  const submissionId = data?.submission_id;
  const progress = data?.progress;
  const mutationContext = { nodeRunId: nodeRunId ?? "", workflowId, runId };
  const busy = approve.isPending || reject.isPending || generate.isPending || retry.isPending || cancel.isPending;
  const status = nodeRun?.status ?? "splitting";
  const awaitingReview = status === "awaiting_split_review" && generation > 0 && !!submissionId;
  const materializing = status === "materializing";
  const active = status === "split_active";

  const statusMeta = status === "awaiting_split_review"
    ? { tone: "amber" as DrawerTone, label: t(($) => $.detail_panel.split_drawer_status_review), line: t(($) => $.detail_panel.split_drawer_line_review), spin: false }
    : materializing
      ? { tone: "violet" as DrawerTone, label: t(($) => $.detail_panel.split_drawer_status_materializing), line: t(($) => $.detail_panel.split_drawer_line_materializing), spin: true }
      : active
        ? { tone: "emerald" as DrawerTone, label: t(($) => $.detail_panel.split_drawer_status_active), line: t(($) => $.detail_panel.split_drawer_line_active), spin: false }
        : { tone: "blue" as DrawerTone, label: t(($) => $.detail_panel.split_drawer_status_generating), line: t(($) => $.detail_panel.split_drawer_line_generating), spin: true };

  const currentItems = useMemo<DeliverableDrawerItem[]>(() => {
    const definitions = [...(currentDeliverableData?.deliverables ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order);
    const submissions = new Map(
      (currentDeliverableData?.submissions ?? []).map((submission) => [submission.deliverable_id, submission]),
    );
    return definitions.map((deliverable) => ({ deliverable, submission: submissions.get(deliverable.id) ?? null }));
  }, [currentDeliverableData]);

  const previousItem = useMemo<DeliverableDrawerItem | null>(() => {
    const deliverable = [...(previousDeliverableData?.deliverables ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)[0];
    if (!deliverable) return null;
    const submission = (previousDeliverableData?.submissions ?? [])
      .find((candidate) => candidate.deliverable_id === deliverable.id) ?? null;
    return { deliverable, submission };
  }, [previousDeliverableData]);

  const handleError = (error: unknown) => {
    setValidation(errorDetails(error));
    toast.error(error instanceof Error ? error.message : t(($) => $.detail_panel.split_action_failed));
  };

  const regenerate = () => {
    const hasMaterializedChildren = (progress?.materialized ?? 0) > 0;
    const confirmed = !hasMaterializedChildren || window.confirm(t(($) => $.detail_panel.split_supersede_confirm));
    if (!confirmed) return;
    generate.mutate({
      ...mutationContext,
      request: { expected_split_generation: generation, confirm_supersede: hasMaterializedChildren },
    }, { onError: handleError });
  };

  const cancelSplit = () => {
    cancel.mutate(
      { ...mutationContext, expectedSplitGeneration: generation },
      { onError: handleError },
    );
  };

  const total = progress?.total ?? 0;
  const done = active ? total : progress?.materialized ?? 0;
  const progressNote = active
    ? t(($) => $.detail_panel.split_drawer_children_active)
    : t(($) => $.detail_panel.split_drawer_materializing_note, {
        retry: progress?.retry_waiting ?? 0,
        next: progress?.next_retry_at ? formatDeliverableTime(progress.next_retry_at) : "—",
        exhausted: progress?.exhausted ?? 0,
      });

  const footer = awaitingReview ? (
    <div>
      <textarea
        value={reviewComment}
        onChange={(event) => setReviewComment(event.target.value)}
        placeholder={t(($) => $.detail_panel.split_drawer_review_placeholder)}
        className="min-h-16 w-full resize-y rounded-lg border bg-background px-2.5 py-2 text-[12.5px] leading-[1.55] outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/40"
        disabled={busy}
      />
      <div className="mt-[9px] flex justify-end gap-2">
        <button
          type="button"
          className={`${drawerButtonClass} border-border bg-background hover:bg-muted`}
          disabled={busy || !reviewComment.trim()}
          onClick={() => reject.mutate({
            ...mutationContext,
            request: {
              expected_split_generation: generation,
              expected_submission_id: submissionId!,
              review_comment: reviewComment.trim(),
            },
          }, { onSuccess: () => setReviewComment(""), onError: handleError })}
        >
          <XCircle className="size-3.5" />
          {t(($) => $.detail_panel.split_reject)}
        </button>
        <button
          type="button"
          className={`${drawerButtonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/85`}
          disabled={busy}
          onClick={() => approve.mutate({
            ...mutationContext,
            request: {
              expected_split_generation: generation,
              expected_submission_id: submissionId!,
              review_comment: reviewComment.trim() || undefined,
            },
          }, { onError: handleError })}
        >
          <Check className="size-3.5" />
          {t(($) => $.detail_panel.split_drawer_approve)}
        </button>
      </div>
    </div>
  ) : status === "splitting" ? (
    <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {t(($) => $.detail_panel.split_drawer_footer_generating)}
    </div>
  ) : materializing ? (
    <div className="flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-violet-600" />
        {t(($) => $.detail_panel.split_drawer_footer_materializing)}
      </div>
      <button type="button" className={`${drawerSmallButtonClass} border-border bg-background hover:bg-muted`} onClick={cancelSplit} disabled={busy}>
        <Ban className="size-3" />
        {t(($) => $.detail_panel.split_drawer_cancel)}
      </button>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2 text-[12.5px] text-emerald-600">
        <CheckCircle2 className="size-3.5" />
        {t(($) => $.detail_panel.split_drawer_footer_active, { count: total })}
      </div>
      <button type="button" className={`${drawerSmallButtonClass} border-border bg-background hover:bg-muted`} onClick={onViewChildren}>
        {t(($) => $.detail_panel.split_drawer_view_children)}
      </button>
    </div>
  );

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      variant="overlay"
      title={node.title}
      eyebrow={t(($) => $.detail_panel.split_plan_eyebrow)}
      closeLabel={t(($) => $.detail_panel.split_plan_close)}
      onClose={onClose}
      badges={(
        <>
          <DrawerBadge tone={statusMeta.tone}>
            {statusMeta.spin || isLoading ? <Loader2 className="size-[11px] animate-spin" /> : null}
            {statusMeta.label}
          </DrawerBadge>
          <span className="text-[11px] text-muted-foreground">{statusMeta.line}</span>
        </>
      )}
      footer={footer}
      contentClassName="py-3.5"
    >
      <div className="space-y-3.5">
        <DrawerSection icon={<Inbox className="size-[13px]" />} title={t(($) => $.detail_panel.split_drawer_previous)}>
          <PreviousDeliverableCard
            nodeTitle={previousNodeRun?.node_title}
            item={previousItem}
            emptyText={t(($) => $.detail_panel.split_drawer_previous_empty)}
            pullRequestLabel={t(($) => $.detail_panel.split_drawer_pull_request)}
            mergedLabel={t(($) => $.detail_panel.split_drawer_merged)}
            hint={t(($) => $.detail_panel.split_drawer_previous_hint)}
          />
        </DrawerSection>

        <DrawerSection
          icon={<FileText className="size-[13px]" />}
          title={t(($) => $.detail_panel.split_drawer_current)}
          subtitle={status === "splitting" || awaitingReview ? t(($) => $.detail_panel.split_drawer_current_subtitle) : undefined}
        >
          <CurrentDeliverablesCard
            items={currentItems}
            generating={status === "splitting"}
            generatedTitle="task.md"
            generatedMeta={t(($) => $.detail_panel.split_drawer_task_meta)}
            generatingText={t(($) => $.detail_panel.split_drawer_generating_task)}
            pendingLabel={t(($) => $.detail_panel.split_drawer_pending)}
            approvedLabel={t(($) => $.detail_panel.split_drawer_approved)}
            pullRequestLabel={t(($) => $.detail_panel.split_drawer_pull_request)}
            pendingHint={t(($) => $.detail_panel.split_drawer_wait_submission)}
            submittedHint={t(($) => $.detail_panel.split_drawer_review_in_gitea)}
            approvedHint={t(($) => $.detail_panel.split_drawer_snapshot_hint)}
            submittedPrefix={t(($) => $.detail_panel.split_drawer_submitted_at)}
            forceState={materializing || active ? "approved" : awaitingReview ? "submitted" : undefined}
            progress={materializing || active ? { done, total, active, note: progressNote } : undefined}
            approvedBadgePlacement="meta"
          />
        </DrawerSection>

        <DrawerMoreOperations
          title={t(($) => $.detail_panel.split_drawer_more)}
          defaultOpen={validation.length > 0}
          badge={validation.length > 0 ? <DrawerBadge tone="red">{validation.length}</DrawerBadge> : undefined}
        >
          {validation.length > 0 ? (
            <div className="mb-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                <AlertTriangle className="size-3 text-destructive" />
                {t(($) => $.detail_panel.split_drawer_validation_count, { count: validation.length })}
              </div>
              <ul className="space-y-1 rounded-lg border border-destructive/25 bg-destructive/5 px-[11px] py-[9px] font-mono text-[11.5px] leading-[1.5] text-destructive">
                {validation.map((detail, index) => (
                  <li key={`${detail.line ?? 0}-${detail.field ?? "document"}-${index}`}>
                    {t(($) => $.detail_panel.split_validation_detail, {
                      line: detail.line ?? 0,
                      field: detail.field ?? "document",
                      message: detail.message ?? t(($) => $.detail_panel.split_invalid_value),
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-muted-foreground">{t(($) => $.detail_panel.split_drawer_validation_hint)}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {materializing && (progress?.exhausted ?? 0) > 0 ? (
              <button
                type="button"
                className={`${drawerSmallButtonClass} border-border bg-background hover:bg-muted`}
                disabled={busy}
                onClick={() => data?.tasks.filter((task) => !task.issue_id && task.status === "failed").forEach((task) => {
                  retry.mutate({ ...mutationContext, taskId: task.id, request: { expected_split_generation: generation } }, { onError: handleError });
                })}
              >
                <RefreshCcw className="size-3" />
                {t(($) => $.detail_panel.split_drawer_retry_failed)}
              </button>
            ) : null}
            <button type="button" className={`${drawerSmallButtonClass} border-border bg-background hover:bg-muted`} disabled={busy || !nodeRunId || generation <= 0} onClick={regenerate}>
              <GitBranch className="size-3" />
              {t(($) => $.detail_panel.split_drawer_regenerate)}
            </button>
            <button type="button" className={`${drawerSmallButtonClass} border-destructive/30 bg-background text-destructive hover:bg-destructive/5`} disabled={busy || !nodeRunId || generation <= 0} onClick={cancelSplit}>
              <Ban className="size-3" />
              {t(($) => $.detail_panel.split_drawer_cancel)}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t(($) => $.detail_panel.split_drawer_supersede_note)}</p>
        </DrawerMoreOperations>
      </div>
    </WorkflowNodeDetailPanelShell>
  );
}

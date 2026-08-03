"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { ApiError } from "@multica/core/api";
import {
  splitTasksOptions,
  useApproveSplitTasks,
  useCancelSplitNode,
  useGenerateSplitTasks,
  useRejectSplitTasks,
  useRetrySplitTask,
} from "@multica/core/workflows/queries";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { AlertCircle, Check, FileText, GitBranch, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@multica/views/i18n";
import { NodeDetailSection, WorkflowNodeDetailPanelShell } from "../../../common/workflow-node-detail-panel-shell";
import { NodeRunDeliverables } from "../node-run-deliverables";

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

type ValidationDetail = { line?: number; field?: string; message?: string };

function errorDetails(error: unknown): ValidationDetail[] {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return [];
  const details = (error.body as { details?: unknown }).details;
  return Array.isArray(details) ? details.filter((item): item is ValidationDetail => !!item && typeof item === "object") : [];
}

export function SplitReviewPanel({ node, nodeRun, wsId, workflowId, runId, onClose, plannerName }: SplitReviewPanelProps) {
  const { t } = useT("workflows");
  const nodeRunId = nodeRun?.id;
  const { data, isLoading } = useQuery(splitTasksOptions(wsId, nodeRunId));
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
  const awaitingReview = nodeRun?.status === "awaiting_split_review" && generation > 0 && !!submissionId;
  const materializing = nodeRun?.status === "materializing";
  const showMaterialization = materializing || (progress?.exhausted ?? 0) > 0;

  const handleError = (error: unknown) => {
    setValidation(errorDetails(error));
    toast.error(error instanceof Error ? error.message : t(($) => $.detail_panel.split_action_failed));
  };

  return (
    <WorkflowNodeDetailPanelShell
      mode="run"
      title={node.title}
      eyebrow={t(($) => $.detail_panel.split_plan_eyebrow)}
      closeLabel={t(($) => $.detail_panel.split_plan_close)}
      onClose={onClose}
      badges={<><Badge variant="outline">{t(($) => $.detail_panel.split_generation_label, { generation: generation || "—" })}</Badge><Badge variant="secondary">{nodeRun?.status ?? t(($) => $.detail_panel.split_status_fallback)}</Badge></>}
      footer={nodeRunId && generation > 0 ? (
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => cancel.mutate({ ...mutationContext, expectedSplitGeneration: generation }, { onError: handleError })}
          >
            <XCircle className="size-4" /> {t(($) => $.detail_panel.split_cancel)}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              const hasMaterializedChildren = (progress?.materialized ?? 0) > 0;
              const confirmSupersede = !hasMaterializedChildren || window.confirm(
                t(($) => $.detail_panel.split_supersede_confirm),
              );
              if (!confirmSupersede) return;
              generate.mutate({
                ...mutationContext,
                request: { expected_split_generation: generation, confirm_supersede: hasMaterializedChildren },
              }, { onError: handleError });
            }}
          >
            <RefreshCcw className="size-4" /> {t(($) => $.detail_panel.split_generate_new_plan)}
          </Button>
        </div>
      ) : null}
    >
      <NodeDetailSection sectionId="status-next-step" title={t(($) => $.detail_panel.split_plan_status)} icon={busy || isLoading ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}>
        <p className="text-sm text-muted-foreground">
          {plannerName ? `${plannerName} · ` : ""}
          {awaitingReview
            ? t(($) => $.detail_panel.split_review_instruction)
            : materializing
              ? t(($) => $.detail_panel.split_materializing_summary, { materialized: progress?.materialized ?? 0, total: progress?.total ?? 0 })
              : t(($) => $.detail_panel.split_plan_explanation)}
        </p>
        {nodeRunId ? <NodeRunDeliverables wsId={wsId} nodeRunId={nodeRunId} /> : null}
        {data?.archive_status && !["not_started", "pending", "merged"].includes(data.archive_status) ? (
          <div className="rounded-md border border-border bg-muted p-2 text-xs text-foreground">
            {t(($) => $.detail_panel.split_review_archive, { status: data.archive_status })}{data.archive_error ? ` — ${data.archive_error}` : ""}
          </div>
        ) : null}
      </NodeDetailSection>

      {awaitingReview ? (
        <NodeDetailSection sectionId="actions" title={t(($) => $.detail_panel.split_review_decision)} icon={<FileText className="size-4" />}>
          <textarea
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
            placeholder={t(($) => $.detail_panel.split_review_comment_placeholder)}
            className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy || !reviewComment.trim()}
              onClick={() => reject.mutate({ ...mutationContext, request: { expected_split_generation: generation, expected_submission_id: submissionId!, review_comment: reviewComment.trim() } }, { onSuccess: () => setReviewComment(""), onError: handleError })}
            >
              <XCircle className="size-4" /> {t(($) => $.detail_panel.split_reject)}
            </Button>
            <Button
              disabled={busy}
              onClick={() => approve.mutate({ ...mutationContext, request: { expected_split_generation: generation, expected_submission_id: submissionId!, review_comment: reviewComment.trim() || undefined } }, { onError: handleError })}
            >
              <Check className="size-4" /> {t(($) => $.detail_panel.split_approve_snapshot)}
            </Button>
          </div>
        </NodeDetailSection>
      ) : null}

      {validation.length > 0 ? (
        <NodeDetailSection sectionId="evidence-preview" title={t(($) => $.detail_panel.split_validation_title)} icon={<AlertCircle className="size-4" />}>
          <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            {validation.map((detail, index) => (
              <li key={`${detail.line ?? 0}-${detail.field ?? "document"}-${index}`}>
                {t(($) => $.detail_panel.split_validation_detail, { line: detail.line ?? 0, field: detail.field ?? "document", message: detail.message ?? t(($) => $.detail_panel.split_invalid_value) })}
              </li>
            ))}
          </ul>
        </NodeDetailSection>
      ) : null}

      {showMaterialization && data ? (
        <NodeDetailSection sectionId="child-progress" title={t(($) => $.detail_panel.split_materialization_progress)} icon={materializing ? <Loader2 className="size-4 animate-spin" /> : <AlertCircle className="size-4" />}>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-muted p-2"><strong className="block text-base">{progress?.materialized ?? 0}</strong>{t(($) => $.detail_panel.split_materialized)}</div>
            <div className="rounded-md bg-muted p-2"><strong className="block text-base">{progress?.retry_waiting ?? 0}</strong>{t(($) => $.detail_panel.split_retry_waiting)}</div>
            <div className="rounded-md bg-muted p-2"><strong className="block text-base">{progress?.exhausted ?? 0}</strong>{t(($) => $.detail_panel.split_manual_retry)}</div>
          </div>
          <ul className="space-y-2">
            {data.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                <div className="min-w-0"><div className="truncate font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.issue_id ? t(($) => $.detail_panel.split_issue_created) : task.last_error?.message ?? t(($) => $.detail_panel.split_pending)}</div></div>
                {!task.issue_id && task.status === "failed" ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => retry.mutate({ ...mutationContext, taskId: task.id, request: { expected_split_generation: generation } }, { onError: handleError })}>
                    <RefreshCcw className="size-3.5" /> {t(($) => $.detail_panel.split_retry)}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </NodeDetailSection>
      ) : null}
    </WorkflowNodeDetailPanelShell>
  );
}

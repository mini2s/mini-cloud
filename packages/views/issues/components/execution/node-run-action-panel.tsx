"use client";

import { useState, type ReactNode } from "react";
import { Send, SkipForward } from "lucide-react";
import type { WorkflowNodeRun } from "@multica/core/types";
import { useSkipNodeRun, useSubmitNodeRun } from "@multica/core/workflows/queries";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Label } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { NodeRunControlActions } from "../../../workflows/components/node-run-control-actions";
import { useT } from "../../../i18n";
import type { HumanNodeRunActionAccess } from "./node-run-action-access";

interface NodeRunActionPanelProps {
  nodeRun: WorkflowNodeRun;
  access: HumanNodeRunActionAccess;
  wsId: string;
  workflowId?: string;
  runId?: string;
  reviewEditor?: ReactNode;
  reviewActions?: ReactNode;
}

export function NodeRunActionPanel({
  nodeRun,
  access,
  wsId,
  workflowId,
  runId,
  reviewEditor,
  reviewActions,
}: NodeRunActionPanelProps) {
  const { t } = useT("issues");
  const [workerSummary, setWorkerSummary] = useState("");
  const submitMutation = useSubmitNodeRun(wsId);
  const skipMutation = useSkipNodeRun(wsId);

  const handleSubmit = () => {
    const summary = workerSummary.trim();
    submitMutation.mutate({
      nodeRunId: nodeRun.id,
      workflowId,
      runId,
      output: summary ? { summary } : {},
    });
  };

  const handleSkip = () => {
    skipMutation.mutate({ nodeRunId: nodeRun.id, workflowId, runId });
  };

  const mutationError = submitMutation.isError
    ? submitMutation.error
    : skipMutation.isError
      ? skipMutation.error
      : null;
  const hasHumanActions = access.canSubmit || access.canSkip || reviewActions != null;
  const hasRuntimeControls = nodeRun.runtime_id != null && (
    nodeRun.status === "working" ||
    (nodeRun.status === "blocked" && nodeRun.completed_at == null)
  );

  if (!hasHumanActions && !hasRuntimeControls && reviewEditor == null) return null;

  return (
    <div className="space-y-3">
      {reviewEditor}
      {access.canSubmit ? (
        <div className="space-y-1.5">
          <Label htmlFor={`node-run-summary-${nodeRun.id}`}>
            {t(($) => $.execution.detail_panel.execution_summary)}
          </Label>
          <Textarea
            id={`node-run-summary-${nodeRun.id}`}
            value={workerSummary}
            onChange={(event) => setWorkerSummary(event.target.value)}
            placeholder={t(($) => $.execution.detail_panel.execution_summary_placeholder)}
            rows={3}
            className="min-h-20 resize-y"
          />
        </div>
      ) : null}

      {hasHumanActions || hasRuntimeControls ? (
        <div data-testid="node-run-action-toolbar" className="flex min-h-8 flex-wrap items-center gap-2">
          {reviewActions}
          {access.canSubmit ? (
            <Button size="default" onClick={handleSubmit} disabled={submitMutation.isPending}>
              <Send data-icon="inline-start" />
              {submitMutation.isPending
                ? t(($) => $.execution.detail_panel.submitting_result)
                : t(($) => $.execution.detail_panel.submit_result)}
            </Button>
          ) : null}

          {access.canSkip ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={(
                  <Button size="default" variant="outline" disabled={skipMutation.isPending}>
                    <SkipForward data-icon="inline-start" />
                    {t(($) => $.execution.detail_panel.skip_node)}
                  </Button>
                )}
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t(($) => $.execution.detail_panel.skip_dialog_title)}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(($) => $.execution.detail_panel.skip_dialog_description)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t(($) => $.execution.detail_panel.skip_dialog_cancel)}
                  </AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleSkip}>
                    {t(($) => $.execution.detail_panel.skip_dialog_confirm)}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <NodeRunControlActions
            nodeRun={nodeRun}
            workflowId={workflowId}
            runId={runId}
            wsId={wsId}
            size="default"
            showOpenSession={false}
          />
        </div>
      ) : null}

      {mutationError ? (
        <p role="alert" className="text-sm text-destructive">
          {mutationError instanceof Error ? mutationError.message : String(mutationError)}
        </p>
      ) : null}
    </div>
  );
}

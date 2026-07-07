"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { WorkflowNode, WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { NodeRunStatusIcon } from "./node-run-status-icon";
import { Bot, User, Building2, Paperclip, Check } from "lucide-react";
import { useT } from "@multica/views/i18n";
import { Button } from "@multica/ui/components/ui/button";
import { Loader2 } from "lucide-react";

export type NodeRunActionType =
  | "approve"
  | "reject"
  | "submit"
  | "handback"
  | "retry"
  | "skip"
  | "complete";

export type DeliverableSignal = "red" | "yellow" | "green" | "none";

/** Derive a traffic-light signal from deliverable submission statuses. */
export function deriveDeliverableSignal(
  items: Array<{ required: boolean; status: string }> | null | undefined,
): DeliverableSignal {
  if (!items || items.length === 0) return "none";
  const required = items.filter((item) => item.required);
  if (required.length === 0) return "none";
  if (required.some((item) => item.status === "rejected" || item.status === "missing")) return "red";
  if (required.some((item) => item.status === "submitted")) return "yellow";
  return "green";
}

export interface RuntimeNodeCardProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  workerName: string | null;
  criticName: string | null;
  onClick: (nodeId: string) => void;
  isSelected?: boolean;
  elementRef?: (el: HTMLButtonElement | null) => void;
  onAction?: (nodeRunId: string, action: NodeRunActionType) => void;
  isActionLoading?: Partial<Record<NodeRunActionType, boolean>>;
  /** Traffic-light indicator derived from deliverable submission statuses. */
  deliverableSignal?: DeliverableSignal;
}

/** Maps worker/critic type to its Lucide icon component. */
function typeIcon(t: string) {
  if (t === "agent") return Bot;
  if (t === "squad") return Building2;
  return User;
}

/** Actionable status → button layout mapping. */
const ACTIONABLE_STATUSES = new Set([
  "awaiting_critic",
  "awaiting_input",
  "blocked",
  "failed",
]);

interface ActionButtonDef {
  action: NodeRunActionType;
  label: string;
}

interface ActionButtonsProps {
  status: string;
  nodeRunId: string;
  onAction: (nodeRunId: string, action: NodeRunActionType) => void;
  isActionLoading?: Partial<Record<NodeRunActionType, boolean>>;
  buttons: ActionButtonDef[];
}

/**
 * Single action button with loading → success → idle lifecycle.
 * When loading, shows spinner. When mutation settles (loading→false),
 * flashes a checkmark briefly before the card refreshes with new status.
 */
function ActionButton({
  action,
  label,
  nodeRunId,
  onAction,
  loading,
}: {
  action: NodeRunActionType;
  label: string;
  nodeRunId: string;
  onAction: (nodeRunId: string, action: NodeRunActionType) => void;
  loading: boolean;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const prevLoading = useRef(loading);

  useEffect(() => {
    if (prevLoading.current && !loading) {
      // Mutation just settled successfully — flash checkmark
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 1200);
      return () => clearTimeout(timer);
    }
    prevLoading.current = loading;
    return undefined;
  }, [loading]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!loading && !justCompleted) onAction(nodeRunId, action);
    },
    [loading, justCompleted, onAction, nodeRunId, action],
  );

  const disabled = loading || justCompleted;

  return (
    <Button
      variant="outline"
      size="sm"
      data-testid={`runtime-node-action-${action}`}
      disabled={disabled}
      className="h-6 px-1.5 text-[10px] gap-0.5 min-w-0 transition-all duration-150"
      onClick={handleClick}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      ) : justCompleted ? (
        <Check className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : null}
      <span className={loading ? "opacity-50" : ""}>{label}</span>
    </Button>
  );
}

function ActionButtons({
  status,
  nodeRunId,
  onAction,
  isActionLoading,
  buttons,
}: ActionButtonsProps) {
  if (!ACTIONABLE_STATUSES.has(status)) return null;
  if (buttons.length === 0) return null;

  const loading = (action: NodeRunActionType) =>
    isActionLoading?.[action] ?? false;

  return (
    <div className="flex items-center gap-1 border-t border-border/50 pt-1.5">
      {buttons.map(({ action, label }) => (
        <ActionButton
          key={action}
          action={action}
          label={label}
          nodeRunId={nodeRunId}
          onAction={onAction}
          loading={loading(action)}
        />
      ))}
    </div>
  );
}

export function RuntimeNodeCard({
  node,
  nodeRun,
  workerName,
  criticName,
  onClick,
  isSelected = false,
  elementRef,
  onAction,
  isActionLoading,
  deliverableSignal,
}: RuntimeNodeCardProps) {
  const { t } = useT("issues");
  const hasWorkerOutput = nodeRun?.worker_output != null;
  const hasCriticOutput = nodeRun?.critic_output != null;

  const artifactNames: string[] = [];
  if (hasWorkerOutput) {
    artifactNames.push(t(($) => $.execution.detail_panel.worker_output));
  }
  if (hasCriticOutput) {
    artifactNames.push(t(($) => $.execution.detail_panel.critic_output));
  }

  const WorkerIcon = typeIcon(node.worker_type);

  const actionButtons: ActionButtonDef[] = nodeRun
    ? (() => {
        switch (nodeRun.status) {
          case "awaiting_critic":
            return [
              { action: "approve" as const, label: t(($) => $.execution.card.actions.approve) },
              { action: "reject" as const, label: t(($) => $.execution.card.actions.reject) },
            ];
          case "awaiting_input":
            return [
              { action: "submit" as const, label: t(($) => $.execution.card.actions.submit_input) },
              { action: "handback" as const, label: t(($) => $.execution.card.actions.handback) },
            ];
          case "blocked":
          case "failed":
            return [
              { action: "retry" as const, label: t(($) => $.execution.card.actions.retry) },
              { action: "skip" as const, label: t(($) => $.execution.card.actions.skip) },
              { action: "complete" as const, label: t(($) => $.execution.card.actions.complete) },
            ];
          default:
            return [];
        }
      })()
    : [];

  return (
    <button
      type="button"
      data-testid={`runtime-node-card-${node.id}`}
      ref={elementRef}
      aria-pressed={isSelected}
      onClick={() => onClick(node.id)}
      className={cn(
        "flex min-w-[240px] min-h-[104px] flex-col gap-2 rounded-lg border border-border/80 bg-background p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
        "transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md",
        isSelected &&
          "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08),0_2px_12px_rgba(15,23,42,0.06)]",
      )}
    >
      {/* Row 1: node title + deliverable signal + status icon */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {deliverableSignal && deliverableSignal !== "none" && (
            <span
              aria-label={`Deliverables ${deliverableSignal}`}
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                deliverableSignal === "green" && "bg-emerald-500",
                deliverableSignal === "yellow" && "bg-amber-500",
                deliverableSignal === "red" && "bg-red-500",
              )}
            />
          )}
          <span className="text-sm font-medium truncate">{node.title}</span>
        </div>
        {nodeRun ? (
          <NodeRunStatusIcon status={nodeRun.status} className="h-4 w-4" />
        ) : (
          <NodeRunStatusIcon status="pending" className="h-4 w-4" />
        )}
      </div>

      {/* Row 2: Worker (type icon + label + name — no duplicate status icon) */}
      <div className="flex items-center gap-2 h-6 text-[11px] text-muted-foreground">
        <WorkerIcon className="h-3 w-3 shrink-0" />
        <span className="font-medium">{t(($) => $.execution.card.worker_label)}:</span>
        <span className={cn(!workerName && "italic")}>
          {workerName ?? "--"}
        </span>
      </div>

      {/* Row 3: Critic (only when configured) */}
      {(node.critic_type || node.critic_id) && (
        <div className="flex items-center gap-2 h-6 text-[11px] text-muted-foreground">
          {node.critic_type === "agent" ? (
            <Bot className="h-3 w-3 shrink-0" />
          ) : node.critic_type === "squad" ? (
            <Building2 className="h-3 w-3 shrink-0" />
          ) : (
            <User className="h-3 w-3 shrink-0" />
          )}
          <span className="font-medium">{t(($) => $.execution.card.critic_label)}:</span>
          <span className={cn(!criticName && "italic")}>
            {criticName ?? "--"}
          </span>
        </div>
      )}

      {/* Row 4: Artifact names */}
      {artifactNames.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {t(($) => $.execution.card.artifacts_label)}: {artifactNames.join(", ")}
          </span>
        </div>
      )}

      {/* Action buttons */}
      {onAction && actionButtons.length > 0 && (
        <ActionButtons
          status={nodeRun!.status}
          nodeRunId={nodeRun!.id}
          onAction={onAction}
          isActionLoading={isActionLoading}
          buttons={actionButtons}
        />
      )}
    </button>
  );
}

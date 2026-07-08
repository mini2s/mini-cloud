"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  parseNodeFormat,
  toWorkflowRuntimeDisplayStatus,
  type WorkflowNode,
  type WorkflowNodeRun,
  type WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { RuntimeDisplayStatusIcon } from "./node-run-status-icon";
import { Bot, User, Building2, Check, CircleAlert, CircleCheck, Clock3, FileCheck2, GitFork, GitMerge } from "lucide-react";
import { useT } from "@multica/views/i18n";
import { Button } from "@multica/ui/components/ui/button";
import { Loader2 } from "lucide-react";
import { workflowNodeInfoAreaClassName, workflowNodeShapeGlyphClassName } from "../../../common/workflow-node-shape";
import {
  WorkflowCanvasNodeShell,
  type WorkflowCanvasNodeHandle,
} from "../../../workflows/components/canvas/workflow-canvas-node-shell";
import { WORKER_WIDTH } from "../../../workflows/components/overview/constants";

export const RUNTIME_NODE_HEIGHT = 120;

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
  runtimeSummary?: WorkflowNodeRuntimeSummary | null;
  handles?: WorkflowCanvasNodeHandle[];
  lateralHandleTop?: number;
}

/** Maps worker/critic type to its Lucide icon component. */
function typeIcon(t: string) {
  if (t === "agent") return Bot;
  if (t === "squad") return Building2;
  return User;
}

function gatewayLabel(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Join gateway";
  if (kind === "fork") return "Fork gateway";
  return "Gateway";
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

function deliverableSignalText(
  t: IssueTranslator,
  signal: WorkflowNodeRuntimeSummary["deliverable_signal"],
): string {
  if (signal === "green") return t(($) => $.execution.card.deliverable_green);
  if (signal === "yellow") return t(($) => $.execution.card.deliverable_yellow);
  if (signal === "red") return t(($) => $.execution.card.deliverable_red);
  return t(($) => $.execution.card.deliverable_none);
}

function deliverableProgressText(
  t: IssueTranslator,
  submitted: number,
  total: number,
  approved: number,
): string {
  return t(($) => $.execution.card.deliverable_progress)
    .replaceAll("{{submitted}}", String(submitted))
    .replaceAll("{{total}}", String(total))
    .replaceAll("{{approved}}", String(approved));
}

function deliverableSignalIcon(signal: WorkflowNodeRuntimeSummary["deliverable_signal"]) {
  if (signal === "green") return { Icon: CircleCheck, className: "text-emerald-600" };
  if (signal === "yellow") return { Icon: Clock3, className: "text-amber-600" };
  if (signal === "red") return { Icon: CircleAlert, className: "text-destructive" };
  return { Icon: FileCheck2, className: "text-muted-foreground" };
}

/** Actionable status → button layout mapping. */
const ACTIONABLE_STATUSES = new Set([
  "awaiting_critic",
  "awaiting_input",
  "blocked",
  "failed",
  "format_failed",
  "critic_rework",
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
    <div className="flex items-center gap-1 border-t border-border/45 pt-1.5">
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

function DeliverableSlot({
  t,
  signal,
  submitted,
  total,
  approved,
}: {
  t: IssueTranslator;
  signal: WorkflowNodeRuntimeSummary["deliverable_signal"];
  submitted: number;
  total: number;
  approved: number;
}) {
  const { Icon, className } = deliverableSignalIcon(signal);

  return (
    <div
      className="col-span-full flex h-4 min-w-0 items-center gap-1.5 text-[10px] leading-none text-muted-foreground"
      data-testid="runtime-node-deliverables"
    >
      <Icon className={cn("h-3 w-3 shrink-0", className)} />
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/75">
          {deliverableSignalText(t, signal)}
        </span>
      </div>
      <span className="shrink-0 tabular-nums">
        {deliverableProgressText(t, submitted, total, approved)}
      </span>
    </div>
  );
}

function ActorSlot({
  icon: Icon,
  label,
  name,
}: {
  icon: ReturnType<typeof typeIcon>;
  label: string;
  name: string | null;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted/55 text-muted-foreground ring-1 ring-border/60">
          <Icon className="h-3 w-3" />
        </span>
        <span
          className={cn(
            "min-w-0 truncate font-medium text-foreground/85",
            !name && "italic text-muted-foreground",
          )}
        >
          {name ?? "--"}
        </span>
      </div>
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
  runtimeSummary,
  handles,
  lateralHandleTop,
}: RuntimeNodeCardProps) {
  const { t } = useT("issues");
  const nodeFormat = parseNodeFormat(node.format_schema);
  const isGateway = nodeFormat.kind === "gateway";
  const nodeShape = nodeFormat.shape;
  const displayStatus = runtimeSummary?.display_status ?? (nodeRun ? toWorkflowRuntimeDisplayStatus(nodeRun.status) : "pending");
  const displayStatusLabel = runtimeDisplayStatusText(t, displayStatus, isGateway ? nodeFormat.gateway_kind : null);
  const hasCritic = !isGateway && (node.critic_type || node.critic_id);
  const deliverableSignal = runtimeSummary?.deliverable_signal ?? "none";
  const deliverableTotal = runtimeSummary?.required_deliverables_total ?? 0;
  const deliverableSubmitted = runtimeSummary?.required_deliverables_submitted ?? 0;
  const deliverableApproved = runtimeSummary?.required_deliverables_approved ?? 0;
  const showDeliverableSummary = !isGateway && deliverableTotal > 0;

  const WorkerIcon = typeIcon(node.worker_type);
  const CriticIcon = node.critic_type === "agent" ? Bot : node.critic_type === "squad" ? Building2 : User;
  const GatewayIcon = nodeFormat.gateway_kind === "join" ? GitMerge : GitFork;

  const actionButtons: ActionButtonDef[] = nodeRun
    ? isGateway
      ? []
      : (() => {
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
          case "format_failed":
          case "critic_rework":
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
    <WorkflowCanvasNodeShell
      as="button"
      testId={`runtime-node-card-${node.id}`}
      nodeShape={nodeShape}
      selected={isSelected}
      width={WORKER_WIDTH}
      height={RUNTIME_NODE_HEIGHT}
      title={node.title}
      onClick={() => onClick(node.id)}
      className="h-[120px]"
      contentClassName={cn("h-full justify-between gap-2", workflowNodeInfoAreaClassName(nodeShape))}
      handles={handles}
      lateralHandleTop={lateralHandleTop}
      elementRef={elementRef}
    >
      {/* Row 1: node title + status icon */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {nodeShape !== "rectangle" ? (
            <span
              aria-hidden="true"
              data-node-shape-glyph={nodeShape}
              className={cn(
                "size-2.5 shrink-0 border border-primary/45 bg-primary/10",
                workflowNodeShapeGlyphClassName(nodeShape),
              )}
            />
          ) : null}
          <span className="text-sm font-medium truncate">{node.title}</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/35 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <RuntimeDisplayStatusIcon
            status={displayStatus}
            gatewayKind={isGateway ? nodeFormat.gateway_kind : null}
            className="h-3.5 w-3.5"
          />
          <span>{displayStatusLabel}</span>
        </span>
      </div>

      {isGateway ? (
        <div className="border-t border-border/45 py-2" data-testid="runtime-node-content">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/55 text-muted-foreground ring-1 ring-border/60">
              <GatewayIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Gateway
              </p>
              <p className="truncate font-medium text-foreground/85">
                {gatewayLabel(nodeFormat.gateway_kind)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          data-testid="runtime-node-content"
          className={cn(
            "grid gap-1.5 border-t border-border/45 py-1.5",
            hasCritic ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          <ActorSlot
            icon={WorkerIcon}
            label={t(($) => $.execution.card.worker_label)}
            name={workerName}
          />
          {hasCritic ? (
            <ActorSlot
              icon={CriticIcon}
              label={t(($) => $.execution.card.critic_label)}
              name={criticName}
            />
          ) : null}
          {showDeliverableSummary ? (
            <DeliverableSlot
              t={t}
              signal={deliverableSignal}
              submitted={deliverableSubmitted}
              total={deliverableTotal}
              approved={deliverableApproved}
            />
          ) : null}
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
    </WorkflowCanvasNodeShell>
  );
}

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
import { Bot, User, Building2, Check, ChevronDown, ChevronRight, GitBranch, GitFork, GitMerge } from "lucide-react";
import { useT } from "@multica/views/i18n";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
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

export interface RuntimeNodeCardProps {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  workerName: string | null;
  criticName: string | null;
  onClick: (nodeId: string) => void;
  isSelected?: boolean;
  isRuntimeFocus?: boolean;
  elementRef?: (el: HTMLButtonElement | null) => void;
  onAction?: (nodeRunId: string, action: NodeRunActionType) => void;
  isActionLoading?: Partial<Record<NodeRunActionType, boolean>>;
  runtimeSummary?: WorkflowNodeRuntimeSummary | null;
  handles?: WorkflowCanvasNodeHandle[];
  lateralHandleTop?: number;
  isSplitExpanded?: boolean;
  splitChildCount?: number;
  onSplitNodeToggle?: (nodeId: string) => void;
}

/** Maps worker/critic type to its Lucide icon component. */
function typeIcon(t: string) {
  if (t === "agent") return Bot;
  if (t === "squad") return Building2;
  return User;
}

function gatewayLabel(t: IssueTranslator, kind: "fork" | "join" | null): string {
  if (kind === "join") return t(($) => $.execution.card.gateway_label_join);
  if (kind === "fork") return t(($) => $.execution.card.gateway_label_fork);
  return t(($) => $.execution.card.gateway_label);
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

function splitChildCountLabel(t: IssueTranslator, count: number): string {
  return t(($) => $.execution.card.split_child_count, { count });
}

function splitProgressSummaryParts(
  t: IssueTranslator,
  progress: NonNullable<WorkflowNodeRuntimeSummary["split_progress"]>,
): string[] {
  return [
    progress.done > 0 ? t(($) => $.execution.card.split_child_done, { count: progress.done }) : null,
    progress.failed > 0 ? t(($) => $.execution.card.split_child_failed, { count: progress.failed }) : null,
    progress.running > 0 ? t(($) => $.execution.card.split_child_running, { count: progress.running }) : null,
    progress.created > 0 ? t(($) => $.execution.card.split_child_ready, { count: progress.created }) : null,
    progress.skipped > 0 ? t(($) => $.execution.card.split_child_skipped, { count: progress.skipped }) : null,
    progress.cancelled > 0 ? t(($) => $.execution.card.split_child_cancelled, { count: progress.cancelled }) : null,
  ].filter((part): part is string => Boolean(part));
}

/** Actionable status → button layout mapping. */
function runtimeFocusSurfaceClassName(
  isRuntimeFocus: boolean,
  status: ReturnType<typeof toWorkflowRuntimeDisplayStatus>,
): string {
  if (!isRuntimeFocus) return "";
  switch (status) {
    case "blocked":
      return "border-red-200/90 from-red-50/90 via-white to-red-100/70 ring-2 ring-red-300/80 shadow-[0_20px_48px_rgba(239,68,68,0.24)] group-hover:ring-red-400/80";
    case "reviewing":
      return "border-violet-200/90 from-violet-50/90 via-white to-violet-100/70 ring-2 ring-violet-300/75 shadow-[0_18px_42px_rgba(139,92,246,0.18)] group-hover:ring-violet-400/75";
    case "completed":
      return "border-emerald-200/80 from-emerald-50/80 via-white to-emerald-100/55 ring-2 ring-emerald-300/70 shadow-[0_14px_32px_rgba(16,185,129,0.14)] group-hover:ring-emerald-400/65";
    case "todo":
      return "border-amber-200/70 from-amber-50/70 via-white to-amber-100/45 ring-2 ring-amber-300/60 shadow-[0_14px_34px_rgba(245,158,11,0.14)] group-hover:ring-amber-400/70";
    case "in_progress":
      return "border-blue-200/90 from-blue-50/90 via-white to-blue-100/70 ring-2 ring-blue-300/80 shadow-[0_20px_48px_rgba(59,130,246,0.22)] group-hover:ring-blue-400/80";
    case "pending":
    case "cancelled":
    default:
      return "border-slate-200/80 from-slate-50/85 via-white to-slate-100/65 ring-2 ring-slate-300/75 shadow-[0_16px_38px_rgba(15,23,42,0.16)]";
  }
}

function RuntimeStatusPill({
  status,
  gatewayKind,
  label,
  className,
}: {
  status: ReturnType<typeof toWorkflowRuntimeDisplayStatus>;
  gatewayKind?: "fork" | "join" | null;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/35 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      <RuntimeDisplayStatusIcon
        status={status}
        gatewayKind={gatewayKind}
        className="h-3.5 w-3.5"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

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

function SplitProgressSummary({
  label,
  summary,
}: {
  label: string;
  summary: string;
}) {
  return (
    <div
      data-testid="runtime-node-split-progress"
      className="flex min-w-0 items-center gap-2 border-t border-border/45 py-1.5"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/55 text-muted-foreground ring-1 ring-border/60">
        <GitBranch className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold leading-4 text-foreground/90">
          {label}
        </p>
        <p className="truncate text-[10px] font-medium leading-3 text-muted-foreground">
          {summary}
        </p>
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
  isRuntimeFocus = false,
  elementRef,
  onAction,
  isActionLoading,
  runtimeSummary,
  handles,
  lateralHandleTop,
  isSplitExpanded = false,
  splitChildCount = 0,
  onSplitNodeToggle,
}: RuntimeNodeCardProps) {
  const { t } = useT("issues");
  const nodeFormat = parseNodeFormat(node.format_schema);
  const isGateway = nodeFormat.kind === "gateway";
  const isSplit = nodeFormat.kind === "split";
	const splitMode = nodeFormat.split_config?.mode ?? "barrier";
  const nodeShape = nodeFormat.shape;
  const displayStatus = runtimeSummary?.display_status ?? (nodeRun ? toWorkflowRuntimeDisplayStatus(nodeRun.status) : "pending");
  const displayStatusLabel = runtimeDisplayStatusText(t, displayStatus, isGateway ? nodeFormat.gateway_kind : null);
  const hasCritic = !isGateway && !isSplit && (node.critic_type || node.critic_id);

  const WorkerIcon = typeIcon(node.worker_type);
  const CriticIcon = node.critic_type === "agent" ? Bot : node.critic_type === "squad" ? Building2 : User;
  const GatewayIcon = nodeFormat.gateway_kind === "join" ? GitMerge : GitFork;
  const splitProgress = runtimeSummary?.split_progress ?? null;
  const hasSplitProgress = isSplit && !!splitProgress && splitProgress.total > 0;
  const canToggleSplitChildren = isSplit && splitChildCount > 0 && !!onSplitNodeToggle;
  const splitChildLabel = splitChildCountLabel(t, splitChildCount || (splitProgress?.total ?? 0));
  const splitChildSummaryParts = splitProgress ? splitProgressSummaryParts(t, splitProgress) : [];
  const splitChildSummaryLabel = splitChildSummaryParts.length > 0
    ? splitChildSummaryParts.join(" · ")
    : t(($) => $.execution.panorama.not_started);
  const handleShellKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick(node.id);
  }, [node.id, onClick]);
  const handleSplitToggleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSplitNodeToggle?.(node.id);
  }, [node.id, onSplitNodeToggle]);

  const actionButtons: ActionButtonDef[] = nodeRun
    ? isGateway || isSplit
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
      as={canToggleSplitChildren ? "div" : "button"}
      testId={`runtime-node-card-${node.id}`}
      nodeShape={nodeShape}
      selected={isSelected}
      width={WORKER_WIDTH}
      height={RUNTIME_NODE_HEIGHT}
      title={node.title}
      dataRuntimeDisplayStatus={displayStatus}
      dataRuntimeFocus={isRuntimeFocus}
      tabIndex={canToggleSplitChildren ? 0 : undefined}
      onClick={() => onClick(node.id)}
      onKeyDown={canToggleSplitChildren ? handleShellKeyDown : undefined}
      className="h-[120px]"
      surfaceClassName={runtimeFocusSurfaceClassName(isRuntimeFocus, displayStatus)}
      contentClassName={cn("h-full justify-between gap-2", workflowNodeInfoAreaClassName(nodeShape))}
      handles={handles}
      lateralHandleTop={lateralHandleTop}
      elementRef={elementRef}
    >
      {isSplit ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{node.title}</span>
            </div>
						<div className="flex h-5 shrink-0 items-center gap-1">
							<Badge variant="outline" className="h-5 px-1.5 text-[10px]">
								{splitMode === "pipeline"
									? t(($) => $.execution.card.split_mode_pipeline)
									: t(($) => $.execution.card.split_mode_barrier)}
							</Badge>
							<RuntimeStatusPill status={displayStatus} label={displayStatusLabel} />
						</div>
          </div>

          {canToggleSplitChildren ? (
            <button
              type="button"
              data-testid="runtime-node-split-child-toggle"
              className={cn(
                "nodrag nopan flex min-h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left",
                "bg-background transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSplitExpanded
                  ? "border-primary/45 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)] hover:border-primary/60 hover:bg-muted/35"
                  : "border-border/80 hover:border-primary/35 hover:bg-muted/45",
              )}
              aria-label={
                isSplitExpanded
                  ? t(($) => $.execution.card.split_child_collapse)
                  : t(($) => $.execution.card.split_child_expand)
              }
              aria-expanded={isSplitExpanded}
              onClick={handleSplitToggleClick}
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold leading-4 text-foreground">
                  {splitChildLabel}
                </span>
                <span className="block truncate text-[10px] font-medium leading-3 text-muted-foreground">
                  {splitChildSummaryLabel}
                </span>
              </span>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isSplitExpanded
                    ? "border-primary/35 bg-primary/10 text-primary"
                    : "border-border/80 bg-muted/55 text-muted-foreground",
                )}
                aria-hidden
              >
                {isSplitExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </span>
            </button>
          ) : hasSplitProgress ? (
            <SplitProgressSummary
              label={splitChildLabel}
              summary={splitChildSummaryLabel}
            />
          ) : (
            <div
              data-testid="runtime-node-content"
              className={cn(
                "grid gap-1.5 border-t border-border/45 py-1.5",
                node.critic_type || node.critic_id ? "grid-cols-2" : "grid-cols-1",
              )}
            >
              <ActorSlot
                icon={WorkerIcon}
                label={t(($) => $.execution.card.worker_label)}
                name={workerName}
              />
              {node.critic_type || node.critic_id ? (
                <ActorSlot
                  icon={CriticIcon}
                  label={t(($) => $.execution.card.critic_label)}
                  name={criticName}
                />
              ) : null}
            </div>
          )}
        </>
      ) : (
        <>
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
        <RuntimeStatusPill
          status={displayStatus}
          gatewayKind={isGateway ? nodeFormat.gateway_kind : null}
          label={displayStatusLabel}
        />
      </div>

      {isGateway ? (
        <div className="border-t border-border/45 py-2" data-testid="runtime-node-content">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/55 text-muted-foreground ring-1 ring-border/60">
              <GatewayIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(($) => $.execution.card.gateway_label)}
              </p>
              <p className="truncate font-medium text-foreground/85">
                {gatewayLabel(t, nodeFormat.gateway_kind)}
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
        </>
      )}
    </WorkflowCanvasNodeShell>
  );
}

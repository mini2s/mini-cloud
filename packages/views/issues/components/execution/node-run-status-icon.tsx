"use client";

import { AlertCircle, CheckCircle2, Circle, CircleOff, Clock, Loader2, MinusCircle, RotateCcw, UserCheck } from "lucide-react";
import type { GatewayKind, NodeRunStatus, WorkflowRuntimeDisplayStatus } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";

const STATUS_MAP: Record<NodeRunStatus, {
  icon: typeof Circle;
  className: string;
  spin?: boolean;
}> = {
  pending:             { icon: Circle,        className: "text-muted-foreground/40" },
  format_checking:     { icon: Loader2,       className: "text-blue-500", spin: true },
  format_ok:           { icon: CheckCircle2,  className: "text-amber-500" },
  format_failed:       { icon: AlertCircle,   className: "text-red-500" },
  worker_assigned:     { icon: UserCheck,     className: "text-amber-500" },
  working:             { icon: Loader2,       className: "text-blue-500", spin: true },
  awaiting_input:      { icon: Clock,         className: "text-amber-500" },
  awaiting_critic:     { icon: Clock,         className: "text-amber-500" },
  critic_reviewing:    { icon: Loader2,       className: "text-blue-500", spin: true },
  critic_approved:     { icon: CheckCircle2,  className: "text-green-500" },
  critic_rework:       { icon: RotateCcw,     className: "text-orange-500" },
  splitting:           { icon: Loader2,       className: "text-blue-500", spin: true },
  awaiting_split_review: { icon: UserCheck,   className: "text-amber-500" },
  split_active:        { icon: Loader2,       className: "text-blue-500", spin: true },
  completed:           { icon: CheckCircle2,  className: "text-green-500" },
  failed:              { icon: AlertCircle,   className: "text-red-500" },
  blocked:             { icon: AlertCircle,   className: "text-red-500" },
  skipped:             { icon: MinusCircle,   className: "text-muted-foreground" },
  cancelled:           { icon: MinusCircle,   className: "text-muted-foreground" },
};

export interface NodeRunStatusIconProps {
  status: NodeRunStatus;
  className?: string;
}

export function NodeRunStatusIcon({ status, className }: NodeRunStatusIconProps) {
  const config = STATUS_MAP[status];

  if (!config) {
    return (
      <CircleOff
        data-testid="status-icon-fallback"
        className={cn("h-4 w-4 text-muted-foreground", className)}
      />
    );
  }

  const Icon = config.icon;
  return (
    <Icon
      data-testid={status === "pending" ? `status-icon-${status}` : "status-icon"}
      className={cn(
        "h-4 w-4 shrink-0",
        config.className,
        config.spin && "animate-spin",
        className,
      )}
    />
  );
}

const DISPLAY_STATUS_MAP: Record<WorkflowRuntimeDisplayStatus, {
  icon: typeof Circle;
  className: string;
  label: string;
  spin?: boolean;
}> = {
  pending: { icon: Circle, className: "text-muted-foreground/40", label: "Pending" },
  todo: { icon: Clock, className: "text-amber-500", label: "Todo" },
  in_progress: { icon: Loader2, className: "text-blue-500", label: "In progress", spin: true },
  reviewing: { icon: UserCheck, className: "text-violet-500", label: "Reviewing" },
  completed: { icon: CheckCircle2, className: "text-green-500", label: "Completed" },
  failed: { icon: AlertCircle, className: "text-destructive", label: "Failed" },
  blocked: { icon: AlertCircle, className: "text-red-500", label: "Blocked" },
  cancelled: { icon: MinusCircle, className: "text-muted-foreground", label: "Cancelled" },
};

function gatewayDisplayLabel(status: WorkflowRuntimeDisplayStatus, gatewayKind?: GatewayKind | null): string | null {
  if (!gatewayKind) return null;
  if (status === "cancelled") return "Cancelled";
  if (gatewayKind === "fork" && status === "completed") return "Dispatched";
  if (gatewayKind === "join" && status === "completed") return "Joined";
  if (gatewayKind === "join" && (status === "pending" || status === "todo")) return "Waiting for upstream";
  return null;
}

export function getRuntimeDisplayStatusLabel(
  status: WorkflowRuntimeDisplayStatus,
  gatewayKind?: GatewayKind | null,
): string {
  return gatewayDisplayLabel(status, gatewayKind) ?? (DISPLAY_STATUS_MAP[status] ?? DISPLAY_STATUS_MAP.pending).label;
}

export interface RuntimeDisplayStatusIconProps {
  status: WorkflowRuntimeDisplayStatus;
  gatewayKind?: GatewayKind | null;
  className?: string;
}

export function RuntimeDisplayStatusIcon({
  status,
  gatewayKind,
  className,
}: RuntimeDisplayStatusIconProps) {
  const config = DISPLAY_STATUS_MAP[status] ?? DISPLAY_STATUS_MAP.pending;
  const Icon = config.icon;
  const label = getRuntimeDisplayStatusLabel(status, gatewayKind);

  return (
    <Icon
      aria-label={label}
      data-testid="runtime-display-status-icon"
      className={cn(
        "h-4 w-4 shrink-0",
        config.className,
        config.spin && "animate-spin",
        className,
      )}
    />
  );
}

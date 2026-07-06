"use client";

import type { WorkflowNode, WorkflowNodeRun, NodeRunStatus } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";

// Runtime status → border color mapping
const STATUS_BORDER: Partial<Record<NodeRunStatus, string>> = {
  pending: "border-muted-foreground/30 border-dashed",
  format_checking: "border-workflow-info animate-pulse",
  format_ok: "border-workflow-success",
  format_failed: "border-workflow-danger",
  worker_assigned: "border-workflow-info",
  working: "border-workflow-info [box-shadow:0_0_8px_hsl(var(--info)/0.4)]",
  awaiting_input: "border-workflow-warning",
  awaiting_critic: "border-brand",
  critic_reviewing: "border-brand animate-pulse",
  critic_approved: "border-workflow-success",
  critic_rework: "border-workflow-warning",
  blocked: "border-workflow-danger",
  failed: "border-workflow-danger border-2",
  completed: "border-workflow-success",
  skipped: "border-muted-foreground/30",
  cancelled: "border-muted-foreground/30 line-through",
};

// Runtime status → icon mapping (simplified — expanded in Task 12)
const STATUS_ICON: Partial<Record<NodeRunStatus, string>> = {
  completed: "✓",
  failed: "✗",
  blocked: "🔒",
  awaiting_input: "?",
  awaiting_critic: "👁",
  working: "●",
};

export interface WorkflowNodeCardProps {
  node: WorkflowNode;
  variant: "definition" | "runtime";
  nodeRun?: WorkflowNodeRun | null;
  density?: "compact" | "full";
  selected?: boolean;
  onClick?: (nodeId: string) => void;
  className?: string;
}

/** Unified node card used by both ReactFlowSurface and StageLaneSurface. */
export function WorkflowNodeCard({
  node,
  variant,
  nodeRun,
  density = "full",
  selected = false,
  onClick,
  className,
}: WorkflowNodeCardProps) {
  const isCompact = density === "compact";
  const status = nodeRun?.status;
  const statusBorder = status ? STATUS_BORDER[status] : undefined;
  const statusIcon = status ? STATUS_ICON[status] : undefined;

  return (
    <button
      type="button"
      data-testid={`workflow-node-card-${node.id}`}
      onClick={() => onClick?.(node.id)}
      className={cn(
        "group flex flex-col gap-1 rounded-[14px] border bg-card p-3 text-left transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isCompact ? "w-40" : "w-44",
        variant === "definition" && !selected && "border-border",
        variant === "definition" && selected && "border-workflow-accent ring-2 ring-workflow-accent/30",
        variant === "runtime" && statusBorder,
        variant === "runtime" && !statusBorder && "border-border",
        className,
      )}
      aria-pressed={selected}
    >
      {/* Title row */}
      <div className="flex items-center gap-1.5 min-w-0">
        {variant === "runtime" && statusIcon && (
          <span className="shrink-0 text-xs">{statusIcon}</span>
        )}
        <span className={cn(
          "truncate font-medium",
          isCompact ? "text-xs" : "text-sm",
          nodeRun?.status === "cancelled" && "line-through text-muted-foreground",
        )}>
          {node.title}
        </span>
      </div>

      {/* Subtitle / worker info */}
      {variant === "definition" && !isCompact && node.worker_type && (
        <span className="text-[11px] text-muted-foreground truncate">
          {node.worker_type === "agent" ? "Agent" : node.worker_type === "squad" ? "Squad" : "Human"}
        </span>
      )}

      {/* Runtime status label */}
      {variant === "runtime" && status && !isCompact && (
        <span className="text-[10px] text-muted-foreground truncate">
          {status.replace(/_/g, " ")}
        </span>
      )}
    </button>
  );
}

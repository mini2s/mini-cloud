"use client";

import type { CanvasNode } from "@multica/core/workflows/canvas";
import { getRuntimeNodePresentation, type RuntimeNodeAction } from "@multica/core/workflows/canvas";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";

export interface WorkflowNodeCardProps {
  node: CanvasNode;
  variant: "definition" | "runtime";
  selected: boolean;
  onSelect?: (nodeId: string) => void;
  onRuntimeAction?: (nodeRunId: string, action: RuntimeNodeAction) => void;
}

const ACTION_LABELS: Record<RuntimeNodeAction, string> = {
  approve: "Approve",
  reject: "Reject",
  retry: "Retry",
  skip: "Skip",
  takeover: "Take over",
  handback: "Hand back",
  complete: "Complete",
};

export function WorkflowNodeCard({ node, variant, selected, onSelect, onRuntimeAction }: WorkflowNodeCardProps) {
  const runtime = getRuntimeNodePresentation(node.runtime);
  const toneClass =
    runtime.tone === "success"
      ? "border-emerald-300 bg-emerald-50"
      : runtime.tone === "danger"
        ? "border-red-300 bg-red-50"
        : runtime.tone === "attention"
          ? "border-amber-300 bg-amber-50"
          : runtime.tone === "blocked"
            ? "border-violet-300 bg-violet-50"
            : runtime.tone === "active"
              ? "border-blue-300 bg-blue-50"
              : "border-border bg-card";

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={node.title}
      onClick={() => onSelect?.(node.id)}
      className={cn(
        "flex min-h-[76px] w-[168px] flex-col items-start justify-between rounded-lg border p-3 text-left text-sm transition-colors",
        variant === "runtime" ? toneClass : "border-border bg-card",
        selected && "ring-2 ring-ring",
      )}
    >
      <span className="max-w-full truncate font-medium">{node.title}</span>
      {variant === "definition" ? (
        <span className="text-xs text-muted-foreground">
          {node.workerType} worker · {node.criticType} critic
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{runtime.label}</span>
      )}
      {variant === "runtime" && node.runtime && runtime.actions.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {runtime.actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                onRuntimeAction?.(node.runtime!.nodeRunId, action);
              }}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </span>
      )}
    </button>
  );
}

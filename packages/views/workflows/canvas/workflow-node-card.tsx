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

const TONE_STYLES: Record<string, { border: string; bg: string }> = {
  success: { border: "var(--color-success)", bg: "color-mix(in srgb, var(--color-success) 10%, transparent)" },
  danger: { border: "var(--color-destructive)", bg: "color-mix(in srgb, var(--color-destructive) 10%, transparent)" },
  attention: { border: "var(--color-warning)", bg: "color-mix(in srgb, var(--color-warning) 10%, transparent)" },
  blocked: { border: "hsl(262 83% 58%)", bg: "color-mix(in srgb, hsl(262 83% 58%) 10%, transparent)" },
  active: { border: "var(--color-info)", bg: "color-mix(in srgb, var(--color-info) 10%, transparent)" },
};

export function WorkflowNodeCard({ node, variant, selected, onSelect, onRuntimeAction }: WorkflowNodeCardProps) {
  const runtime = getRuntimeNodePresentation(node.runtime);
  const tones = TONE_STYLES[runtime.tone];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={node.title}
      onClick={() => onSelect?.(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(node.id);
        }
      }}
      className={cn(
        "flex min-h-[76px] w-[168px] flex-col items-start justify-between rounded-lg border p-3 text-left text-sm transition-colors",
        variant === "runtime" && tones ? "" : "border-border bg-card",
        selected && "ring-2 ring-ring",
      )}
      style={
        variant === "runtime" && tones
          ? { borderColor: tones.border, backgroundColor: tones.bg }
          : undefined
      }
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
    </div>
  );
}

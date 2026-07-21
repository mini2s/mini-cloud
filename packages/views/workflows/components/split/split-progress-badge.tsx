"use client";

import type { SplitProgress } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";

export interface SplitProgressBadgeProps {
  progress: SplitProgress;
  className?: string;
}

export function SplitProgressBadge({ progress, className }: SplitProgressBadgeProps) {
  const parts = [
    progress.done > 0 ? `${progress.done} done` : null,
    progress.failed > 0 ? `${progress.failed} failed` : null,
    progress.running > 0 ? `${progress.running} running` : null,
    progress.created > 0 ? `${progress.created} ready` : null,
    progress.skipped > 0 ? `${progress.skipped} skipped` : null,
    progress.cancelled > 0 ? `${progress.cancelled} cancelled` : null,
  ].filter(Boolean);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        progress.failed > 0 && "border-destructive/30 text-destructive",
        className,
      )}
      title={parts.join(" · ") || `${progress.total} tasks`}
    >
      <span className="truncate">{parts.join(" · ") || `${progress.total} tasks`}</span>
    </span>
  );
}

"use client";

import { GitBranch } from "lucide-react";
import type { SplitConfig, SplitProgress } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { SplitProgressBadge } from "./split-progress-badge";

export interface SplitNodeCardProps {
  title: string;
  config?: SplitConfig | null;
  progress?: SplitProgress | null;
  status?: "editing" | "awaiting_review" | "active" | "idle";
  taskCount?: number;
  subTemplateName?: string | null;
  className?: string;
  onClick?: () => void;
}

export function SplitNodeCard({
  title,
  config,
  progress,
  status = "idle",
  taskCount = 0,
  subTemplateName,
  className,
  onClick,
}: SplitNodeCardProps) {
  const mode = config?.mode ?? "barrier";
  const maxConcurrency = config?.max_concurrency ?? 5;
  const label =
    status === "awaiting_review"
      ? `Review ${taskCount} tasks`
      : status === "active" && progress
        ? null
        : `${mode} · concurrency ${maxConcurrency}`;

  const content = (
    <div
      className={cn(
        "flex h-full min-h-20 w-60 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left text-card-foreground shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        onClick && "cursor-pointer transition-colors hover:bg-accent/40",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="truncate text-sm font-semibold">{title}</span>
      </div>

      {subTemplateName && (
        <span className="truncate text-xs text-muted-foreground">
          {subTemplateName}
        </span>
      )}

      {status === "active" && progress ? (
        <SplitProgressBadge progress={progress} />
      ) : (
        <span className={cn(
          "truncate text-xs text-muted-foreground",
          status === "awaiting_review" && "font-medium text-amber-600",
        )}>
          {label}
        </span>
      )}
    </div>
  );

  if (!onClick) return content;

  return (
    <button type="button" onClick={onClick} className="block text-left">
      {content}
    </button>
  );
}

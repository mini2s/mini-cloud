"use client";

import type { ReactNode } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import type { SplitConfig, SplitProgress } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "@multica/views/i18n";
import { SplitProgressBadge } from "./split-progress-badge";

export interface SplitNodeCardProps {
  title: string;
  config?: SplitConfig | null;
  progress?: SplitProgress | null;
  status?: "editing" | "generating" | "awaiting_review" | "active" | "completed" | "idle";
  taskCount?: number;
  className?: string;
  headerAction?: ReactNode;
  progressAction?: ReactNode;
  onClick?: () => void;
}

export function SplitNodeCard({
  title,
  config,
  progress,
  status = "idle",
  taskCount = 0,
  className,
  headerAction,
  progressAction,
  onClick,
}: SplitNodeCardProps) {
  const { t } = useT("workflows");
  const mode = config?.mode ?? "barrier";
  const maxConcurrency = config?.max_concurrency ?? 5;
  const maxFailures = config?.max_failures ?? 0;
  const showProgress = (status === "active" || status === "completed") && (progress || progressAction);
  const label =
    status === "generating"
      ? t(($) => $.detail_panel.split_node_generating_draft_tasks)
      : status === "awaiting_review"
        ? t(($) => $.detail_panel.split_node_review_tasks, { count: taskCount })
        : showProgress
          ? null
          : null;

  const content = (
    <div
      className={cn(
        "flex h-full min-h-20 w-60 flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-left text-card-foreground shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        onClick && "cursor-pointer transition-colors hover:bg-accent/40",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {status === "generating" ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-amber-500" aria-hidden />
        ) : (
          <GitBranch className="size-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        {headerAction ? <span className="shrink-0">{headerAction}</span> : null}
      </div>

      {showProgress ? (
        progressAction ?? <SplitProgressBadge progress={progress!} />
      ) : label ? (
        <span className={cn(
          "truncate text-xs text-muted-foreground",
          status === "generating" && "font-medium text-amber-600",
          status === "awaiting_review" && "font-medium text-amber-600",
        )}>
          {label}
        </span>
      ) : (
        <div className={cn("grid min-w-0 gap-1.5", mode === "barrier" ? "grid-cols-3" : "grid-cols-2")}>
          <span className="min-w-0 truncate rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-center text-[11px] font-semibold leading-4 text-primary">
            {t(($) => $.detail_panel.split_node_mode_label, { mode })}
          </span>
          <span className="min-w-0 truncate rounded-md border border-border/70 bg-muted/35 px-2 py-1 text-center text-[11px] font-medium leading-4 text-muted-foreground">
            {t(($) => $.detail_panel.split_node_concurrency_label, { concurrency: maxConcurrency })}
          </span>
          {mode === "barrier" ? (
            <span className="min-w-0 truncate rounded-md border border-border/70 bg-muted/35 px-2 py-1 text-center text-[11px] font-medium leading-4 text-muted-foreground">
              {t(($) => $.detail_panel.split_node_failure_label, { max: maxFailures })}
            </span>
          ) : null}
        </div>
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

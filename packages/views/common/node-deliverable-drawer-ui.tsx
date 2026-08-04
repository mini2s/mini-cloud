"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import type {
  WorkflowNodeDeliverable,
  WorkflowNodeDeliverableSubmission,
} from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";

export const drawerButtonClass =
  "inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg border px-[13px] text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";
export const drawerSmallButtonClass =
  "inline-flex h-7 items-center justify-center gap-1 rounded-[7px] border px-[9px] text-xs font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";

export type DrawerTone = "amber" | "violet" | "emerald" | "blue" | "red" | "zinc";

const toneClasses: Record<DrawerTone, string> = {
  amber: "border-amber-500/25 bg-amber-50 text-amber-700 dark:bg-amber-950/45 dark:text-amber-400",
  violet: "border-violet-500/20 bg-violet-50 text-violet-700 dark:bg-violet-950/45 dark:text-violet-400",
  emerald: "border-emerald-500/20 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-400",
  blue: "border-blue-500/20 bg-blue-50 text-blue-700 dark:bg-blue-950/45 dark:text-blue-400",
  red: "border-destructive/20 bg-destructive/5 text-destructive",
  zinc: "border-transparent bg-muted text-foreground",
};

export function DrawerBadge({
  tone = "zinc",
  children,
}: {
  tone?: DrawerTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-medium leading-none",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function DrawerSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-[9px] flex items-center gap-[9px]">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold leading-none">{title}</h3>
          {subtitle ? (
            <div className="mt-[3px] text-[11px] leading-[17.6px] text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function IssueDescriptionCard({
  description,
  emptyText,
}: {
  description?: string | null;
  emptyText: string;
}) {
  return (
    <div
      data-testid="node-issue-description"
      className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-foreground"
    >
      {description?.trim() ? description : <span className="text-muted-foreground">{emptyText}</span>}
    </div>
  );
}

export interface DeliverableDrawerItem {
  deliverable: WorkflowNodeDeliverable;
  submission: WorkflowNodeDeliverableSubmission | null;
}

function openPullRequest(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function formatPullRequestLabel(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/(?:pull|pulls|pull-requests|merge_requests)\/(\d+)\/?$/);
    return match ? `PR#${match[1]}` : fallback;
  } catch {
    return fallback;
  }
}

export function formatDeliverableTime(value: string | null | undefined): string {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "—";
  const documentLocale = typeof document === "undefined" ? "" : document.documentElement.lang.trim();
  const locale = documentLocale || undefined;
  const now = new Date();
  const diffMinutes = Math.round((time.getTime() - now.getTime()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(diffMinutes, "minute");
  }
  const sameDay = time.getFullYear() === now.getFullYear()
    && time.getMonth() === now.getMonth()
    && time.getDate() === now.getDate();
  const clock = time.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) {
    return `${locale?.startsWith("zh") ? "今天" : "Today"} ${clock}`;
  }
  return time.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PreviousDeliverableCard({
  nodeTitle,
  item,
  emptyText,
  pullRequestLabel,
  mergedLabel,
  hint,
}: {
  nodeTitle?: string | null;
  item?: DeliverableDrawerItem | null;
  emptyText: string;
  pullRequestLabel: string;
  mergedLabel: string;
  hint: string;
}) {
  if (!item) {
    return (
      <div className="rounded-[10px] border bg-muted/40 px-[14px] py-3 text-[12.5px] text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {emptyText}
      </div>
    );
  }
  const submission = item.submission;
  return (
    <div className="rounded-[10px] border bg-muted/40 px-[14px] py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[12.5px] font-semibold leading-5">{nodeTitle || "—"}</span>
        <span className="inline-flex rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none text-muted-foreground">
          {item.deliverable.title}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {formatDeliverableTime(submission?.submitted_at)}
        </span>
      </div>
      <div className="mt-2 flex min-h-[17px] items-center gap-2.5">
        {submission?.pull_request_url ? (
          <button
            type="button"
            className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => openPullRequest(submission.pull_request_url)}
          >
            <ExternalLink className="size-3" />
            {formatPullRequestLabel(submission.pull_request_url, pullRequestLabel)} · {mergedLabel}
          </button>
        ) : null}
        <span className="text-[11px] leading-[1.45] text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

function DeliverableFileHeader({
  title,
  meta,
  state,
  pendingLabel,
  approvedLabel,
  showApprovedBadge,
}: {
  title: string;
  meta: string;
  state: "pending" | "submitted" | "approved";
  pendingLabel: string;
  approvedLabel: string;
  showApprovedBadge: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-[9px]">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/45 dark:text-blue-400">
        <FileText className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[7px] text-sm leading-[20.8px]">
          <span className="truncate font-mono text-[13px] font-semibold">{title}</span>
          {state === "pending" ? (
            <span className="rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none text-muted-foreground">
              {pendingLabel}
            </span>
          ) : null}
          {state === "approved" && showApprovedBadge ? (
            <span className="rounded-[5px] bg-muted px-1.5 py-[3px] font-mono text-[10.5px] leading-none text-emerald-600">
              {approvedLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-px text-[11px] leading-[17.6px] text-muted-foreground">{meta}</div>
      </div>
    </div>
  );
}

export function CurrentDeliverablesCard({
  items,
  generating = false,
  generatedTitle,
  generatedMeta,
  generatingText,
  pendingLabel,
  approvedLabel,
  pullRequestLabel,
  pendingHint,
  submittedHint,
  approvedHint,
  submittedPrefix,
  forceState,
  progress,
  approvedBadgePlacement = "header",
}: {
  items: DeliverableDrawerItem[];
  generating?: boolean;
  generatedTitle?: string;
  generatedMeta?: string;
  generatingText: string;
  pendingLabel: string;
  approvedLabel: string;
  pullRequestLabel: string;
  pendingHint: string;
  submittedHint: string;
  approvedHint: string;
  submittedPrefix: string;
  forceState?: "submitted" | "approved";
  progress?: { done: number; total: number; active: boolean; note: string };
  approvedBadgePlacement?: "header" | "meta";
}) {
  const effectiveItems = items.length > 0
    ? items
    : generatedTitle
      ? [{
          deliverable: {
            id: "generated",
            workflow_node_id: "generated",
            title: generatedTitle,
            description: generatedMeta ?? "",
            required: true,
            sort_order: 0,
            created_at: "",
            updated_at: "",
          },
          submission: null,
        }]
      : [];

  return (
    <div className="rounded-[10px] border border-blue-500/25 bg-background px-[14px] py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(37,99,235,0.3)]">
      {effectiveItems.map((item, index) => {
        const submission = item.submission;
        const state = forceState ?? (
          submission?.status === "approved"
            ? "approved"
            : submission
              ? "submitted"
              : "pending"
        );
        return (
          <div key={item.deliverable.id} className={cn(index > 0 && "mt-3 border-t pt-3")}>
            <DeliverableFileHeader
              title={item.deliverable.title}
              meta={item.deliverable.description || generatedMeta || ""}
              state={state}
              pendingLabel={pendingLabel}
              approvedLabel={approvedLabel}
              showApprovedBadge={approvedBadgePlacement === "header"}
            />
            {generating && index === 0 ? (
              <div className="mt-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Loader2 className="size-[13px] animate-spin" />
                  {generatingText}
                </div>
                <div className="h-3.5 w-[72%] animate-pulse rounded-md bg-muted" />
                <div className="mt-2 h-3.5 w-[58%] animate-pulse rounded-md bg-muted" />
              </div>
            ) : (
              <div className="mt-2.5 flex min-h-[18.59375px] items-center gap-2.5">
                {state === "pending" ? (
                  <span className="text-[11px] leading-[1.45] text-muted-foreground">{pendingHint}</span>
                ) : (
                  <>
                    {state === "approved" && approvedBadgePlacement === "meta" ? <DrawerBadge tone="emerald">{approvedLabel}</DrawerBadge> : null}
                    {submission?.pull_request_url ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                        onClick={() => openPullRequest(submission.pull_request_url)}
                      >
                        <ExternalLink className="size-3" />
                        {formatPullRequestLabel(submission.pull_request_url, pullRequestLabel)}
                      </button>
                    ) : null}
                    <span className="text-[11px] leading-[1.45] text-muted-foreground">
                      {state === "approved" ? approvedHint : submittedHint}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {submittedPrefix} {formatDeliverableTime(submission?.submitted_at)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {progress ? (
        <>
          <div className="mt-3 flex items-center gap-2.5">
            {progress.active ? (
              <span className="size-[13px] rounded-full bg-emerald-500" />
            ) : (
              <Loader2 className="size-[13px] animate-spin text-violet-600" />
            )}
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", progress.active ? "bg-emerald-500" : "bg-violet-600")}
                style={{ width: `${progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[11.5px] font-semibold tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          </div>
          <p className="mt-[7px] text-xs text-muted-foreground">{progress.note}</p>
        </>
      ) : null}
    </div>
  );
}

export function DrawerMoreOperations({
  badge,
  defaultOpen = false,
  title,
  children,
}: {
  badge?: ReactNode;
  defaultOpen?: boolean;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-[10px] border bg-background px-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 border-0 bg-transparent px-0.5 py-[11px] text-left text-[12.5px] font-medium leading-[19px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <SlidersHorizontal className="size-[13px]" />
        <span>{title}</span>
        {badge}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="px-0.5 pb-3">{children}</div> : null}
    </section>
  );
}

"use client";

import { useCallback } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@multica/ui/components/ui/popover";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../../i18n";
import type { PreflightResult, PreflightIssue } from "@multica/core/workflows/preflight-checks";
import type { WorkflowStatus } from "@multica/core/types";

export interface PreflightBarProps {
  result: PreflightResult;
  onNavigateToNode: (nodeId: string) => void;
  onActivate: () => void;
  onDismiss: () => void;
  isActivating?: boolean;
  hasUnsavedEdits?: boolean;
  workflowStatus?: WorkflowStatus;
}

const INLINE_ISSUE_LIMIT = 4;

function checkLabel(checkId: PreflightIssue["checkId"], t: ReturnType<typeof useT<"workflows">>["t"]): string {
  switch (checkId) {
    case "dag-cycle":                              return t(($) => $.preflight.check_dag_cycle);
    case "orphan-node":                            return t(($) => $.preflight.check_orphan_node);
    case "unreachable-node":                       return t(($) => $.preflight.check_unreachable_node);
    case "worker-missing":                         return t(($) => $.preflight.check_worker_missing);
    case "invalid-critic-ref":                     return t(($) => $.preflight.check_invalid_critic);
    case "stage-missing":                          return t(($) => $.preflight.check_stage_missing);
    case "split-planner-missing":                  return t(($) => $.preflight.check_split_planner_missing);
    case "split-reviewer-invalid":                 return t(($) => $.preflight.check_split_reviewer_invalid);
    case "split-max-concurrency-invalid":          return t(($) => $.preflight.check_split_max_concurrency_invalid);
    case "gateway-fork-outgoing":                  return t(($) => $.preflight.check_gateway_fork_outgoing);
    case "gateway-join-incoming":                  return t(($) => $.preflight.check_gateway_join_incoming);
    case "gateway-kind-invalid":                   return t(($) => $.preflight.check_gateway_kind_invalid);
    case "gateway-join-multiple-outgoing":         return t(($) => $.preflight.check_gateway_join_multiple_outgoing);
    case "boundary-start-outgoing":                return t(($) => $.preflight.check_boundary_start_outgoing);
    case "boundary-end-incoming":                  return t(($) => $.preflight.check_boundary_end_incoming);
    case "boundary-edge-direction":                return t(($) => $.preflight.check_boundary_edge_direction);
    default:                                       return checkId;
  }
}

export function checkDetailLabel(issue: PreflightIssue, t: ReturnType<typeof useT<"workflows">>["t"]): string {
  switch (issue.checkId) {
    case "dag-cycle":                              return t(($) => $.preflight.detail_dag_cycle, { path: issue.detail ?? "" });
    case "orphan-node":                            return t(($) => $.preflight.detail_orphan_node);
    case "unreachable-node":                       return t(($) => $.preflight.detail_unreachable_node);
    case "worker-missing":                         return t(($) => $.preflight.detail_worker_missing);
    case "invalid-critic-ref":                     return t(($) => $.preflight.detail_invalid_critic);
    case "stage-missing":                          return t(($) => $.preflight.detail_stage_missing);
    case "split-planner-missing":                  return t(($) => $.preflight.detail_split_planner_missing);
    case "split-reviewer-invalid":                 return t(($) => $.preflight.detail_split_reviewer_invalid);
    case "split-max-concurrency-invalid":          return t(($) => $.preflight.detail_split_max_concurrency_invalid);
    case "gateway-fork-outgoing":                  return t(($) => $.preflight.detail_gateway_fork_outgoing);
    case "gateway-join-incoming":                  return t(($) => $.preflight.detail_gateway_join_incoming);
    case "gateway-kind-invalid":                   return t(($) => $.preflight.detail_gateway_kind_invalid);
    case "gateway-join-multiple-outgoing":         return t(($) => $.preflight.detail_gateway_join_multiple_outgoing);
    case "boundary-start-outgoing":                return t(($) => $.preflight.detail_boundary_start_outgoing);
    case "boundary-end-incoming":                  return t(($) => $.preflight.detail_boundary_end_incoming);
    case "boundary-edge-direction":                return t(($) => $.preflight.detail_boundary_edge_direction);
    default:                                       return issue.message;
  }
}

export function PreflightBar({
  result,
  onNavigateToNode,
  onActivate,
  onDismiss,
  isActivating = false,
  hasUnsavedEdits = false,
  workflowStatus = "draft",
}: PreflightBarProps) {
  const { t } = useT("workflows");
  const issues = result.issues;
  const hasIssues = issues.length > 0;
  const hasBlocking = result.blockingCount > 0;
  const hasWarnings = result.warningCount > 0;
  const visibleIssues = issues.slice(0, INLINE_ISSUE_LIMIT);
  const hiddenIssueCount = Math.max(0, issues.length - visibleIssues.length);
  const isActive = workflowStatus === "active";
  const activateDisabled = hasBlocking || hasUnsavedEdits || isActivating || isActive;
  const activateLabel = isActive
    ? t(($) => $.preflight.bar_active_button)
    : hasUnsavedEdits
      ? t(($) => $.preflight.bar_activate_disabled_unsaved)
      : isActivating
        ? t(($) => $.preflight.bar_activating)
        : t(($) => $.preflight.bar_activate);
  const allClearLabel = workflowStatus === "active"
    ? t(($) => $.preflight.bar_active)
    : hasUnsavedEdits
      ? t(($) => $.preflight.bar_unsaved_all_clear)
      : t(($) => $.preflight.bar_saved_all_clear);

  const handleActivate = useCallback(() => {
    if (!activateDisabled) onActivate();
  }, [onActivate, activateDisabled]);

  const renderIssueButton = (issue: PreflightIssue, idx: number, testId: string) => {
    const isBlocking = issue.blocking;
    return (
      <button
        key={`${issue.checkId}-${issue.nodeId}-${idx}`}
        type="button"
        onClick={() => onNavigateToNode(issue.nodeId)}
        className={cn(
          "group inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-0.5",
          "text-[11px] leading-5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          isBlocking
            ? "border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100 hover:border-red-300 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
            : "border-amber-200 bg-amber-50/60 text-amber-700 hover:bg-amber-100 hover:border-amber-300 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
        )}
        data-testid={testId}
      >
        {isBlocking ? (
          <AlertCircle className="h-3 w-3 shrink-0 opacity-70" />
        ) : (
          <AlertTriangle className="h-3 w-3 shrink-0 opacity-70" />
        )}
        <span className="shrink-0 font-medium tracking-tight">
          {checkLabel(issue.checkId, t)}
        </span>
        {issue.nodeTitle && (
          <>
            <span className="shrink-0 opacity-40 font-normal">&middot;</span>
            <span className="truncate max-w-[120px] opacity-80 font-normal">
              {issue.nodeTitle}
            </span>
          </>
        )}
        <ChevronRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
      </button>
    );
  };

  return (
    <div
      data-testid="preflight-bar"
      className={cn(
        "h-12 shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85",
        hasIssues
          ? "border-orange-200/70 dark:border-orange-900/30"
          : "border-emerald-200/70 dark:border-emerald-900/30",
      )}
    >
      <div
        className="flex h-full items-center gap-3 py-0 pl-5 pr-16 sm:pr-20"
        data-testid="preflight-bar-content"
      >

        {/* ── Status indicator ── */}
        <div className="flex items-center gap-2 shrink-0">
          {hasIssues ? (
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium tracking-tight",
                hasBlocking ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full opacity-75",
                    hasBlocking ? "bg-red-500 animate-ping" : "bg-amber-500",
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    hasBlocking ? "bg-red-500" : "bg-amber-500",
                  )}
                />
              </span>
              {hasBlocking && (
                <span className="tabular-nums">{result.blockingCount}</span>
              )}
              {hasBlocking && hasWarnings && <span className="opacity-40">/</span>}
              {hasWarnings && (
                <span className="tabular-nums opacity-80">{result.warningCount}</span>
              )}
            </span>
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
        </div>

        {/* ── Issue summary ── */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0 overflow-hidden">
          {visibleIssues.map((issue, idx) => renderIssueButton(issue, idx, "preflight-issue-item"))}

          {hiddenIssueCount > 0 && (
            <Popover>
              <PopoverTrigger
                render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 border-border/70 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="preflight-review-btn"
                >
                  {t(($) => $.preflight.bar_expand)}
                  <span className="ml-1 tabular-nums text-[11px] opacity-70">
                    +{hiddenIssueCount}
                  </span>
                </Button>
                }
              />
              <PopoverContent
                align="start"
                side="top"
                sideOffset={8}
                className="w-[min(640px,calc(100vw-2rem))] gap-0 p-0"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-xs font-medium text-foreground">
                    {t(($) => $.preflight.bar_expand)}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {result.blockingCount} / {result.warningCount}
                  </span>
                </div>
                <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2" data-testid="preflight-review-list">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {issues.map((issue, idx) => renderIssueButton(issue, idx, "preflight-review-issue-item"))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {!hasIssues && (
            <span className="text-xs text-muted-foreground font-medium">
              {allClearLabel}
            </span>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex items-center gap-1.5 shrink-0">
          {hasIssues && !result.passed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-7 text-xs text-muted-foreground hover:text-foreground px-2.5"
              data-testid="preflight-dismiss-btn"
            >
              {t(($) => $.preflight.bar_dismiss)}
            </Button>
          )}
          <Button
            variant={hasBlocking ? "outline" : "default"}
            size="sm"
            disabled={activateDisabled}
            onClick={handleActivate}
            className="h-7 text-xs px-3"
            data-testid="preflight-activate-btn"
          >
            {activateLabel}
          </Button>
        </div>

      </div>
    </div>
  );
}

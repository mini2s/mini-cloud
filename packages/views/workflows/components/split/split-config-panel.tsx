"use client";

import { ShieldCheck } from "lucide-react";
import type { SplitConfig, Workflow } from "@multica/core/types";
import { Label } from "@multica/ui/components/ui/label";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../../i18n";

interface SplitConfigPanelProps {
  config: SplitConfig;
  childWorkflows: Workflow[];
  currentWorkflowId?: string | null;
  disabled?: boolean;
  onChange: (next: SplitConfig) => void;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function SplitConfigPanel({
  config,
  childWorkflows,
  currentWorkflowId,
  disabled = false,
  onChange,
}: SplitConfigPanelProps) {
  const { t } = useT("workflows");
  const activeChildWorkflows = childWorkflows.filter((workflow) => workflow.status === "active" && workflow.id !== currentWorkflowId);

  return (
    <div className="space-y-3" data-testid="split-config-panel">
      <div className="space-y-1.5">
        <Label htmlFor="split-default-issue-workflow" className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_default_issue_workflow_label)}
        </Label>
        <select
          id="split-default-issue-workflow"
          aria-label={t(($) => $.detail_panel.split_default_issue_workflow_label)}
          disabled={disabled}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={config.default_issue_workflow_id ?? ""}
          onChange={(event) => onChange({
            ...config,
            default_issue_workflow_id: event.target.value || null,
          })}
        >
          <option value="">{t(($) => $.detail_panel.split_default_issue_workflow_placeholder)}</option>
          {activeChildWorkflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-none">
            {t(($) => $.detail_panel.split_review_required_title)}
          </p>
          <p className="mt-1 text-[11px] leading-snug opacity-85">
            {t(($) => $.detail_panel.split_review_required_hint)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_release_mode_label)}
        </Label>
        <div className="inline-flex rounded-lg border bg-muted/40 p-1">
          {([
            {
              value: "barrier",
              label: t(($) => $.detail_panel.split_release_after_finish),
              description: t(($) => $.detail_panel.split_mode_barrier_description),
            },
            {
              value: "pipeline",
              label: t(($) => $.detail_panel.split_release_after_created),
              description: t(($) => $.detail_panel.split_mode_pipeline_description),
            },
          ] as const).map((option) => {
            const active = config.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "grid min-h-11 w-36 content-center rounded-md px-2.5 py-1 text-left transition-colors",
                  active
                    ? "border border-border bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
                onClick={() => onChange({
                  ...config,
                  mode: option.value,
                })}
              >
                <span className="text-[11px] font-semibold leading-4">{option.label}</span>
                <span className="text-[10px] font-medium leading-3 text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="split-max-concurrency" className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_concurrency_question)}
        </Label>
        <input
          id="split-max-concurrency"
          aria-label={t(($) => $.detail_panel.split_concurrency_question)}
          type="number"
          min={1}
          max={20}
          disabled={disabled}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={config.max_concurrency}
          onChange={(event) => onChange({
            ...config,
            max_concurrency: clampInt(Number(event.target.value), 1, 20),
          })}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t(($) => $.detail_panel.split_concurrency_hint)}
        </p>
      </div>

      {config.mode === "barrier" ? (
        <div className="space-y-1.5">
          <Label htmlFor="split-max-failures" className="text-xs text-muted-foreground">
            {t(($) => $.detail_panel.split_failure_tolerance_label)}
          </Label>
          <input
            id="split-max-failures"
            aria-label={t(($) => $.detail_panel.split_failure_tolerance_label)}
            type="number"
            min={0}
            disabled={disabled}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={config.max_failures}
            onChange={(event) => onChange({
              ...config,
              max_failures: Math.max(0, Math.round(Number(event.target.value) || 0)),
            })}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t(($) => $.detail_panel.split_max_failures_hint)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

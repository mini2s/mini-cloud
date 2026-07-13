"use client";

import { GitBranch } from "lucide-react";
import type { SplitConfig, Workflow } from "@multica/core/types";
import { Label } from "@multica/ui/components/ui/label";
import { useT } from "../../../i18n";

interface SplitConfigPanelProps {
  config: SplitConfig;
  templates: Workflow[];
  disabled?: boolean;
  onChange: (next: SplitConfig) => void;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function SplitConfigPanel({
  config,
  templates,
  disabled = false,
  onChange,
}: SplitConfigPanelProps) {
  const { t } = useT("workflows");
  const activeTemplates = templates.filter((template) => template.status === "active" && template.is_template);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3" data-testid="split-config-panel">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <GitBranch className="size-4" />
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{t(($) => $.detail_panel.split_title)}</h4>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {t(($) => $.detail_panel.split_subtitle)}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="split-child-template" className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_child_template_label)}
        </Label>
        <select
          id="split-child-template"
          aria-label={t(($) => $.detail_panel.split_child_template_label)}
          disabled={disabled}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={config.sub_template_id ?? ""}
          onChange={(event) => onChange({
            ...config,
            sub_template_id: event.target.value || null,
          })}
        >
          <option value="">{t(($) => $.detail_panel.split_child_template_placeholder)}</option>
          {activeTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_mode_label)}
        </Label>
        <div className="inline-flex rounded-lg border bg-muted/40 p-1">
          {([
            { value: "barrier", label: t(($) => $.detail_panel.split_mode_barrier) },
            { value: "pipeline", label: t(($) => $.detail_panel.split_mode_pipeline) },
          ] as const).map((option) => {
            const active = config.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                className={
                  active
                    ? "h-7 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground shadow-sm"
                    : "h-7 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
                }
                onClick={() => onChange({
                  ...config,
                  mode: option.value,
                })}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t(($) => $.detail_panel.split_mode_hint)}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="split-max-concurrency" className="text-xs text-muted-foreground">
          {t(($) => $.detail_panel.split_concurrency_label)}
        </Label>
        <input
          id="split-max-concurrency"
          aria-label={t(($) => $.detail_panel.split_concurrency_label)}
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
            {t(($) => $.detail_panel.split_max_failures_label)}
          </Label>
          <input
            id="split-max-failures"
            aria-label={t(($) => $.detail_panel.split_max_failures_label)}
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

"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";

export type WorkflowNodeDetailPanelMode = "edit" | "run";
export type NodeDetailSectionId =
  | "primary"
  | "deliverables"
  | "runtime"
  | "connections"
  | "actions"
  | "agent-operations";

interface WorkflowNodeDetailPanelShellProps {
  mode: WorkflowNodeDetailPanelMode;
  variant?: "inline" | "overlay";
  title: ReactNode;
  eyebrow?: ReactNode;
  badges?: ReactNode;
  statusIcon?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  widthClassName?: string;
}

export function WorkflowNodeDetailPanelShell({
  mode,
  variant = "inline",
  title,
  eyebrow,
  badges,
  statusIcon,
  closeLabel,
  onClose,
  children,
  className,
  contentClassName,
  widthClassName = "w-[520px]",
}: WorkflowNodeDetailPanelShellProps) {
  const panel = (
    <aside
      data-testid="workflow-node-detail-panel-shell"
      data-mode={mode}
      className={cn(
        "flex h-full flex-col border-l bg-card",
        variant === "overlay" &&
          "fixed right-0 top-0 bottom-0 z-50 h-auto bg-background/98 shadow-xl backdrop-blur",
        variant === "overlay" && widthClassName,
        className,
      )}
    >
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              {statusIcon}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </button>
        </div>
        {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
      </div>

      <div
        data-testid="node-detail-section-stack"
        className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", contentClassName)}
      >
        <div className="space-y-3">{children}</div>
      </div>
    </aside>
  );

  if (variant !== "overlay") return panel;

  return (
    <>
      <div
        data-testid="detail-panel-mask"
        className="fixed inset-0 z-40 bg-slate-950/18 backdrop-blur-[1px]"
        onClick={onClose}
      />
      {panel}
    </>
  );
}

interface NodeDetailSectionProps {
  sectionId: NodeDetailSectionId;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function NodeDetailSection({
  sectionId,
  title,
  subtitle,
  icon,
  status,
  children,
  className,
  contentClassName,
}: NodeDetailSectionProps) {
  return (
    <section
      data-testid="node-detail-section"
      data-section={sectionId}
      className={cn("relative grid grid-cols-[14px_minmax(0,1fr)] gap-3", className)}
    >
      <div className="relative flex justify-center">
        {sectionId !== "actions" && sectionId !== "agent-operations" ? (
          <span
            aria-hidden="true"
            className="absolute top-8 bottom-[-18px] w-px bg-muted-foreground/20"
          />
        ) : null}
        <span className="relative z-10 mt-3 size-2 rounded-full border border-muted-foreground/30 bg-background" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex items-start justify-between gap-3 border-b bg-muted/20 px-3 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon ? (
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              <h3 className="text-sm font-medium leading-none">{title}</h3>
              {subtitle ? (
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>
          {status}
        </div>
        {children ? <div className={cn("space-y-3 p-3", contentClassName)}>{children}</div> : null}
      </div>
    </section>
  );
}

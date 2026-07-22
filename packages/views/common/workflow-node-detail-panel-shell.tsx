"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";

export type WorkflowNodeDetailPanelMode = "edit" | "run";
export type NodeDetailSectionId =
  | "readiness"
  | "primary"
  | "worker-critic"
  | "split-behavior"
  | "status-next-step"
  | "deliverables"
  | "runtime-facts"
  | "evidence-preview"
  | "child-progress"
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
  footer?: ReactNode;
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
  footer,
  className,
  contentClassName,
  widthClassName = "w-[620px]",
}: WorkflowNodeDetailPanelShellProps) {
  const panel = (
    <aside
      data-testid="workflow-node-detail-panel-shell"
      data-mode={mode}
      className={cn(
        "flex h-full flex-col border-l border-border/80 bg-background shadow-[-10px_0_28px_rgba(15,23,42,0.06)]",
        widthClassName,
        variant === "overlay" &&
          "fixed right-0 top-0 bottom-0 z-50 h-auto shadow-2xl shadow-foreground/10 ring-1 ring-border/70 backdrop-blur",
        className,
      )}
    >
      <div className="shrink-0 border-b border-border/60 bg-muted/15 px-4 py-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {eyebrow}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold leading-5">{title}</h2>
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
        data-testid="node-detail-panel-content"
        className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3.5", contentClassName)}
      >
        <div data-testid="node-detail-section-stack" className="space-y-4">{children}</div>
      </div>
      {footer ? (
        <div
          data-testid="node-detail-panel-footer"
          className="shrink-0 border-t border-border/60 bg-background px-4 py-3"
        >
          {footer}
        </div>
      ) : null}
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
      className={cn(
        "relative space-y-2.5 border-t border-border/60 pt-4 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className={cn("flex min-w-0 gap-2.5", subtitle ? "items-start" : "items-center")}>
            {icon ? (
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground",
                  subtitle && "mt-0.5",
                )}
              >
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
        {children ? <div className={cn("space-y-3", contentClassName)}>{children}</div> : null}
      </div>
    </section>
  );
}

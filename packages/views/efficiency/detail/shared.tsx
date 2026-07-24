"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { Badge } from "@multica/ui/components/ui/badge";

// Shared layout primitives + tone helpers for the four efficiency detail
// pages. Kept here (not in usage/shared) because detail pages use a
// section-card + KV-grid + collapsible pattern that the kanban views don't
// share; the usage Th/Td/SortHeader primitives are display-only shorthands for
// a different (sortable table) layout.
//
// Everything uses semantic tokens (text/border/bg-*-*) — no hardcoded colours.

// ============================ Section card ============================

interface PanelProps {
  title: string;
  /** Right-aligned small hint (count / caption). */
  hint?: ReactNode;
  /** Optional right-side slot (takes precedence over `hint`). */
  rightSlot?: ReactNode;
  /** Collapsible — starts collapsed when true. */
  defaultCollapsed?: boolean;
  /** Extra body classes (e.g. "overflow-x-auto" for wide tables). */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Section card with a header (title + hint/rightSlot). Optionally collapsible
 * via shadcn Collapsible — used by NeedDetail to tuck the rich commits table
 * behind a toggle. Body always has consistent padding; wide tables override
 * with bodyClassName="overflow-x-auto".
 */
export function Panel({
  title,
  hint,
  rightSlot,
  defaultCollapsed,
  bodyClassName,
  children,
}: PanelProps) {
  const [open, setOpen] = useState(!defaultCollapsed);

  if (defaultCollapsed !== undefined) {
    return (
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="overflow-hidden rounded-lg border bg-card"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between border-b px-4 py-3 text-left focus:outline-none data-[state=closed]:border-0">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
            <ChevronRight
              className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-90"
              data-state={open ? "open" : "closed"}
            />
            {title}
          </span>
          {rightSlot ?? (hint != null ? <HintText>{hint}</HintText> : null)}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={`p-4 ${bodyClassName ?? ""}`}>{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold text-card-foreground">
          {title}
        </span>
        {rightSlot ?? (hint != null ? <HintText>{hint}</HintText> : null)}
      </div>
      <div className={`p-4 ${bodyClassName ?? ""}`}>{children}</div>
    </section>
  );
}

function HintText({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-xs text-muted-foreground">{children}</span>
  );
}

// ============================ KV grid ============================

/**
 * 4-column (responsive down to 2/1) key/value grid for the "基础信息" /
 * "度量信息" blocks. Mirrors the source NeedDetail/TaskDetail/CommitDetail Kv
 * pattern without re-deriving the responsive breakpoints per page.
 */
export function KvGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

/** One labelled value. `wide` spans the whole row; `mono` uses mono font. */
export function Kv({
  label,
  children,
  wide,
  mono,
  title,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 ${wide ? "col-span-2 md:col-span-3 lg:col-span-4" : ""}`}
    >
      <span className="text-xs text-muted-foreground" title={title}>
        {label}
      </span>
      <span
        className={`break-words text-sm text-card-foreground ${mono ? "font-mono" : ""}`}
        title={typeof children === "string" ? children : undefined}
      >
        {children}
      </span>
    </div>
  );
}

// ============================ Tone badges ============================

// The source used a Tag component with a `tone` prop (success/warning/error/
// info/primary/neutral). shadcn's Badge has variants, not tones, so we map a
// small semantic-tone vocabulary to badge variants + semantic colour classes.
// Centralized here so all four pages share one mapping.

export type BadgeTone =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "primary"
  | "neutral";

const TONE_VARIANT: Record<BadgeTone, React.ComponentProps<typeof Badge>["variant"]> = {
  success: "secondary",
  warning: "secondary",
  error: "destructive",
  info: "secondary",
  primary: "default",
  neutral: "outline",
};

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  primary: "",
  neutral: "",
};

/** Semantic tone badge (status / confidence / signal chips). */
export function ToneBadge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: ReactNode;
}) {
  const variant = TONE_VARIANT[tone];
  const cls = TONE_CLASS[tone];
  return (
    <Badge variant={variant} className={cls}>
      {children}
    </Badge>
  );
}

/** Map a status string to a tone (merged status→ / active→primary / else neutral). */
export function statusTone(status?: string | null): BadgeTone {
  if (status === "merged") return "success";
  if (status === "active") return "primary";
  return "neutral";
}

/** Map a confidence level string to a tone. */
export function confidenceTone(level?: string | null): BadgeTone {
  if (level === "high") return "success";
  if (level === "medium") return "warning";
  if (level === "low") return "info";
  if (level === "very_low") return "error";
  return "neutral";
}

/** Map a quality/risk signal string to a tone. */
export function signalTone(signal?: string | null): BadgeTone {
  const s = String(signal || "").toLowerCase();
  if (s === "ok" || s === "low") return "success";
  if (s === "medium" || s === "warn" || s === "warning") return "warning";
  if (s === "high" || s === "risk" || s === "bad") return "error";
  return "neutral";
}

// ============================ Misc helpers ============================

/** Short id preview (first N chars), "-" when empty. */
export function shortId(value?: string | null, size = 8): string {
  if (!value) return "-";
  return String(value).slice(0, size);
}

/**
 * Parse a touched_files value that may be a string[] / JSON string / null into
 * a clean string[] (ported from source NeedDetail.asFileList). The backend
 * sometimes serializes arrays as JSON strings.
 */
export function asFileList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean) as string[];
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s === "[]" || s === "null") return [];
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Render an empty-state row spanning all columns of a table. */
export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center">
        <span className="text-sm text-muted-foreground">{children}</span>
      </td>
    </tr>
  );
}

/** <Fragment> re-export so pages don't pull react just for keyed row groups. */
export { Fragment };

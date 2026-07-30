// Shared helpers + presentational primitives for the usage views. Kept here
// (not in core/efficiency utils) because these are display-only shorthands
// ported verbatim from the source's platformShared — they format values and
// render table cells, not data. Pure helpers (PCT/shortToken/...) live
// alongside the small JSX primitives (Th/Td/SortHeader) so the 4 view files
// share one source of truth instead of copy-pasting ~80 lines.

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";

// ============================ Value formatters ============================
/** Percent formatter: null/NaN/Infinity → "-", otherwise "12.3%". */
export function PCT(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v.toFixed(digits)}%`;
}

/**
 * Short token formatter — collapses large counts to a compact form (1.2k /
 * 3.4M / 5.6B). Mirrors the source's shortToken so cards/tables read the same
 * at a glance; the full number is shown via the `title` attribute upstream.
 */
export function shortToken(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs < 1000) return String(Math.round(v));
  if (abs < 1_000_000) return `${(v / 1000).toFixed(1)}k`;
  if (abs < 1_000_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return `${(v / 1_000_000_000).toFixed(1)}B`;
}

/** Format a duration in milliseconds as "1.2s" or "340 ms" (under 1s). */
export function fmtMs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

/** "YYYY-MM-DD" → "MM-DD" (drops the year for compact trend x-axis labels). */
export function shortDate(s: string): string {
  return s && s.length >= 10 ? s.slice(5, 10) : s;
}

/**
 * Hide zero-request rows by default. The source's hook toggled between two
 * views; we keep the same UX (default-hide, switch to show). Items with a
 * falsy value (0/null/undefined) are hidden when `showZero` is false.
 */
export function filterZeroRequests<T>(items: T[] | undefined, pick: (it: T) => number) {
  const all = items ?? [];
  const visible = all.filter((it) => pick(it) > 0);
  return {
    visible,
    hiddenCount: all.length - visible.length,
  };
}

/**
 * Chart color CSS var for the i-th series/datum. Cycles through the 5 chart
 * palette tokens (var(--chart-1) .. var(--chart-5)). Centralized so the donut
 * dots / series share one source of truth instead of inline `var(--chart-…)`
 * literals drifting across files.
 */
export function chartColorFor(i: number): string {
  return `var(--chart-${(i % 5) + 1})`;
}

/**
 * Fixed 10-color pie palette ported from the source's PIE_COLORS
 * (platformShared). Gives each model a visually distinct slice; the model
 * table dots reuse the same palette so pie ↔ table colors stay in sync.
 */
export const PIE_COLORS = [
  "#0071e3",
  "#34c759",
  "#ff9500",
  "#ff3b30",
  "#af52de",
  "#5856d6",
  "#5ac8fa",
  "#ff2d55",
  "#8e8e93",
  "#ffd60a",
];

/**
 * Small "ⓘ" affordance for card titles: hover reveals the metric definition
 * (口径). Ported from the source's title info icon; whitespace-pre-line keeps
 * multi-line help text readable.
 */
export function InfoTip({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={tip}
            className="inline-flex cursor-help items-center align-middle text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        }
      />
      <TooltipContent className="whitespace-pre-line text-left normal-case tracking-normal">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

// ============================ Table primitives ============================
// The usage tables (model breakdown, mode usage, members, dept compare, per-day
// detail) all share the same cell styling. These four primitives + SortHeader
// are the single definition; previously they were copy-pasted in 4 files.

export function Th({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{children}</th>;
}
export function ThNum({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">{children}</th>;
}
export function Td({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 align-middle text-card-foreground" title={title}>
      {children}
    </td>
  );
}
export function TdNum({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <td
      className="whitespace-nowrap px-3 py-2 text-right align-middle tabular-nums text-card-foreground"
      title={title}
    >
      {children}
    </td>
  );
}

/** Sortable column header — pure button with an arrow indicator. */
export function SortHeader({
  label,
  active,
  desc,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-semibold text-inherit hover:text-foreground focus:outline-none"
    >
      {label}
      <span aria-hidden="true" className="text-xs">
        {active ? (desc ? "▼" : "▲") : "↕"}
      </span>
    </button>
  );
}

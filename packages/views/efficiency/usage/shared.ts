// Local helpers shared across the usage views. Kept here (not in core/efficiency
// utils) because these are display-only shorthands ported verbatim from the
// source's platformShared — they format values for cards/tables, not data.

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

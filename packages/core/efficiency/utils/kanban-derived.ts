// Kanban-derived aggregations — pure helpers that turn the per-need summary
// rows into weekly buckets for the executive "efficiency trend" view.
//
// Ported from the source TrendCard (originally inlined there) so the card and
// any future caller share one implementation. The function is pure: it only
// reads the input rows and the already-pure isoWeekOf/weekLabel date helpers
// (no DOM, no network, no I/O), which is what lets it be unit-tested and
// reused server-side.

import type { NeedsV2Summary } from "../types";
import { isoWeekOf, weekLabel } from "./week";

/** One aggregated week point on the efficiency trend. */
export interface WeekPoint {
  /** ISO week key, e.g. '2026-W21' */
  key: string;
  /** Display label for the x-axis (MM/DD of the week's Monday) */
  label: string;
  /** Epoch ms of the week's Monday (used only for sorting) */
  monday: number;
  /** Mean efficiency ratio for the week, as a percentage (ratio * 100) */
  avgPct: number;
  /** Number of eligible needs that fell into this week */
  count: number;
}

/**
 * Bucket eligible needs into ISO weeks and compute the mean efficiency ratio
 * per week. Only needs where coverage_eligible is true AND efficiency_ratio is
 * a non-null number contribute; everything else is skipped (matches the
 * source caliber — only countable, non-outlier needs drive the trend). Output
 * is sorted ascending by the week's Monday so the chart reads left-to-right.
 */
export function aggregateByWeek(rows: NeedsV2Summary[]): WeekPoint[] {
  const buckets = new Map<
    string,
    { sum: number; count: number; label: string; monday: number }
  >();
  for (const r of rows) {
    if (!r.coverage_eligible || r.efficiency_ratio == null) continue;
    const ts = r.dev_end_ts;
    const wk = isoWeekOf(ts);
    if (!wk) continue;
    const cur = buckets.get(wk.key) || {
      sum: 0,
      count: 0,
      label: weekLabel(wk.monday),
      monday: wk.monday.getTime(),
    };
    cur.sum += r.efficiency_ratio;
    cur.count += 1;
    buckets.set(wk.key, cur);
  }
  return Array.from(buckets.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      monday: v.monday,
      avgPct: (v.sum / v.count) * 100,
      count: v.count,
    }))
    .sort((a, b) => a.monday - b.monday);
}

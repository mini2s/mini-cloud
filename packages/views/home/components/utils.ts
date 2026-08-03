import type { AgentActivityBucket } from "@multica/core/types";

/** One day's tally for the home-page mini trend chart. */
export interface TrendBucket {
  total: number;
  failed: number;
}

export interface ActivityTrend {
  /** Buckets in display order (oldest → newest), zero-filled. */
  buckets: TrendBucket[];
  totalRuns: number;
  totalFailed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors deriveAgentActivity's anchoring: local-time day boundaries, so
// "today" matches the viewer's mental model rather than UTC midnight.
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Roll the workspace-wide 30-day activity buckets up into a single
 * trailing-N-day series (all agents summed). The backend only returns
 * days that had at least one completion; missing days are zero-filled.
 */
export function aggregateActivity(
  buckets: readonly AgentActivityBucket[],
  days: number,
  now: number = Date.now(),
): ActivityTrend {
  const series: TrendBucket[] = Array.from({ length: days }, () => ({
    total: 0,
    failed: 0,
  }));
  const today = startOfDay(now);

  for (const b of buckets) {
    const ts = new Date(b.bucket_at).getTime();
    if (Number.isNaN(ts)) continue;
    const daysAgo = Math.floor((today - startOfDay(ts)) / DAY_MS);
    if (daysAgo < 0 || daysAgo >= days) continue;
    const slot = days - 1 - daysAgo;
    series[slot]!.total += b.task_count;
    series[slot]!.failed += b.failed_count;
  }

  let totalRuns = 0;
  let totalFailed = 0;
  for (const b of series) {
    totalRuns += b.total;
    totalFailed += b.failed;
  }
  return { buckets: series, totalRuns, totalFailed };
}

export type DurationUnit = "now" | "minutes" | "hours";

/**
 * Elapsed time since `startedAt`, bucketed for the compact i18n labels:
 * <1min → "now", <60min → whole minutes, otherwise whole hours.
 */
export function runDuration(
  startedAt: string | null | undefined,
  now: number = Date.now(),
): { value: number; unit: DurationUnit } {
  if (!startedAt) return { value: 0, unit: "now" };
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return { value: 0, unit: "now" };
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  if (minutes < 1) return { value: 0, unit: "now" };
  if (minutes < 60) return { value: minutes, unit: "minutes" };
  return { value: Math.floor(minutes / 60), unit: "hours" };
}

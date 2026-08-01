export type DistributionCaliber = "calendar" | "work";

export interface DistributionInput {
  efficiency_ratio: number | null;
  work_efficiency_ratio: number | null;
  calendar_outlier_flag?: boolean;
  work_outlier_flag?: boolean;
  outlier_flag: boolean;
  coverage_eligible: boolean;
  reason?: string;
  total_loc_net?: number | null;
  total_calendar_min?: number | null;
}

export interface DistributionBucket {
  kind: "negative" | "range" | "overflow";
  lo: number;
  hi: number;
  kept: number;
  excluded: number;
}

export interface DistributionQuantiles {
  p25: number | null;
  median: number | null;
  p75: number | null;
  count: number;
}

export interface DistributionResult {
  caliber: DistributionCaliber;
  binCount: number;
  keptCount: number;
  excludedCount: number;
  histogram: DistributionBucket[];
  quantiles: DistributionQuantiles;
}

export type DistributionDiagnosticKey =
  | "impossible_loc_rate"
  | "efficiency_ratio"
  | "actual_to_baseline"
  | "human_reachable"
  | "accelerated"
  | "high"
  | "bulk";

export interface DistributionDiagnostic {
  key: DistributionDiagnosticKey;
  count: number;
}

export const DISTRIBUTION_GRANULARITIES = [
  { key: "coarse", bins: 6 },
  { key: "medium", bins: 12 },
  { key: "fine", bins: 24 },
] as const;

const MAIN_RANGE_HIGH = 6;
const MIN_BINS = 4;
const MAX_BINS = 50;

function pickRatio(
  row: DistributionInput,
  caliber: DistributionCaliber,
): { ratio: number | null; outlier: boolean } {
  if (caliber === "calendar") {
    return {
      ratio: row.efficiency_ratio,
      outlier: row.calendar_outlier_flag ?? row.outlier_flag,
    };
  }
  return {
    ratio: row.work_efficiency_ratio,
    outlier: row.work_outlier_flag ?? row.outlier_flag,
  };
}

function normalizeBinCount(binCount: number): number {
  return Math.max(MIN_BINS, Math.min(MAX_BINS, Math.round(binCount)));
}

function createBuckets(binCount: number): DistributionBucket[] {
  const step = MAIN_RANGE_HIGH / binCount;
  const buckets: DistributionBucket[] = [
    {
      kind: "negative",
      lo: Number.NEGATIVE_INFINITY,
      hi: 0,
      kept: 0,
      excluded: 0,
    },
  ];

  for (let index = 0; index < binCount; index += 1) {
    const lo = index * step;
    const hi = (index + 1) * step;
    buckets.push({
      kind: "range",
      lo,
      hi,
      kept: 0,
      excluded: 0,
    });
  }

  buckets.push({
    kind: "overflow",
    lo: MAIN_RANGE_HIGH,
    hi: Number.POSITIVE_INFINITY,
    kept: 0,
    excluded: 0,
  });
  return buckets;
}

function getBucketIndex(ratio: number, binCount: number): number {
  if (ratio < 0) return 0;
  if (ratio >= MAIN_RANGE_HIGH) return binCount + 1;
  return 1 + Math.floor(ratio / (MAIN_RANGE_HIGH / binCount));
}

function quantile(sorted: number[], target: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;

  const position = (sorted.length - 1) * target;
  const base = Math.floor(position);
  const remainder = position - base;
  const lo = sorted[base];
  const hi = sorted[base + 1];
  if (lo === undefined) return null;
  return hi === undefined ? lo : lo + remainder * (hi - lo);
}

export function computeDistributionQuantiles(
  rows: DistributionInput[],
  caliber: DistributionCaliber,
): DistributionQuantiles {
  const kept: number[] = [];
  for (const row of rows) {
    if (!row.coverage_eligible) continue;
    const { ratio, outlier } = pickRatio(row, caliber);
    if (ratio == null || !Number.isFinite(ratio) || outlier) continue;
    kept.push(ratio);
  }
  kept.sort((a, b) => a - b);
  return {
    p25: quantile(kept, 0.25),
    median: quantile(kept, 0.5),
    p75: quantile(kept, 0.75),
    count: kept.length,
  };
}

export function computeDistribution(
  rows: DistributionInput[],
  caliber: DistributionCaliber,
  binCount: number,
): DistributionResult {
  const normalizedBinCount = normalizeBinCount(binCount);
  const histogram = createBuckets(normalizedBinCount);
  const keptRatios: number[] = [];
  let keptCount = 0;
  let excludedCount = 0;

  for (const row of rows) {
    if (!row.coverage_eligible) continue;
    const { ratio, outlier } = pickRatio(row, caliber);
    if (ratio == null || !Number.isFinite(ratio)) continue;
    const bucket = histogram[getBucketIndex(ratio, normalizedBinCount)];
    if (!bucket) continue;

    if (outlier) {
      bucket.excluded += 1;
      excludedCount += 1;
    } else {
      bucket.kept += 1;
      keptCount += 1;
      keptRatios.push(ratio);
    }
  }

  keptRatios.sort((a, b) => a - b);
  return {
    caliber,
    binCount: normalizedBinCount,
    keptCount,
    excludedCount,
    histogram,
    quantiles: {
      p25: quantile(keptRatios, 0.25),
      median: quantile(keptRatios, 0.5),
      p75: quantile(keptRatios, 0.75),
      count: keptCount,
    },
  };
}

const EXCLUSION_REASONS = [
  "impossible_loc_rate",
  "efficiency_ratio",
  "actual_to_baseline",
] as const;

export function computeDistributionExclusionReasons(
  rows: DistributionInput[],
): DistributionDiagnostic[] {
  const counts = EXCLUSION_REASONS.map((key) => ({
    key,
    count: 0,
  }));

  for (const row of rows) {
    if (!row.coverage_eligible || !row.outlier_flag) continue;
    const reason = row.reason ?? "";
    for (const item of counts) {
      if (reason.includes(item.key)) item.count += 1;
    }
  }

  return counts;
}

export function computeDistributionLocBands(
  rows: DistributionInput[],
): DistributionDiagnostic[] {
  const bands: DistributionDiagnostic[] = [
    { key: "human_reachable", count: 0 },
    { key: "accelerated", count: 0 },
    { key: "high", count: 0 },
    { key: "bulk", count: 0 },
  ];

  for (const row of rows) {
    if (
      !row.coverage_eligible ||
      row.total_loc_net == null ||
      row.total_calendar_min == null ||
      row.total_calendar_min <= 0
    ) {
      continue;
    }
    const rate = row.total_loc_net / row.total_calendar_min;
    if (rate <= 7) bands[0]!.count += 1;
    else if (rate <= 21) bands[1]!.count += 1;
    else if (rate <= 50) bands[2]!.count += 1;
    else bands[3]!.count += 1;
  }

  return bands;
}

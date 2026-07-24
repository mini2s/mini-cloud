// Mock samples for the all-needs list (Overview page needs ranking + the
// per-need table that feeds several cards). Returns a bare NeedsV2Summary[]
// (the source getAllNeedsV2 paginates internally and returns a flat array,
// not an ApiList envelope). ~8 rows with plausible decimal-ratio values.

import type { NeedsV2Summary } from "../types";

// Builds a single NeedsV2Summary row. efficiency/work ratios are decimal
// multipliers (2.8 => ~2.8x baseline). All required fields are filled so the
// literal satisfies the interface without `as`.
function makeNeed(i: number): NeedsV2Summary {
  const devStartTs = `2026-07-${String(1 + i).padStart(2, "0")}T09:00:00Z`;
  const devEndTs = `2026-07-${String(10 + i).padStart(2, "0")}T18:30:00Z`;
  const totalCalendarMin = 1800 + i * 90;
  const baselineCalendarMin = 5200 + i * 150;
  const activeWorkMin = 700 + i * 35;
  const baselineWorkMin = 2000 + i * 60;
  const isOutlier = i % 6 === 0;
  return {
    need_id: `n-${1000 + i}`,
    boundary_source: i % 2 === 0 ? "git_branch" : "kanban",
    boundary_confidence: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
    status: i % 4 === 0 ? "open" : "merged",
    repo_addr: `git@github.com:costrict/repo-${(i % 5) + 1}.git`,
    repo_branch: "main",
    primary_user_id: `u-${200 + (i % 8)}`,
    dev_start_ts: devStartTs,
    dev_end_ts: devEndTs,
    total_calendar_min: totalCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    total_active_work_corrected_min: activeWorkMin,
    baseline_fused_work_min: baselineWorkMin,
    efficiency_ratio: baselineCalendarMin > 0 ? totalCalendarMin / baselineCalendarMin : null,
    efficiency_band_low: 1.5,
    efficiency_band_high: 3.5,
    work_efficiency_ratio: baselineWorkMin > 0 ? activeWorkMin / baselineWorkMin : null,
    total_loc_net: 420 + i * 12,
    ai_covered_loc: Math.round((420 + i * 12) * 0.31),
    ai_code_ratio: 0.28 + (i % 5) * 0.02,
    confidence_level: i % 4 === 0 ? "low" : "high",
    outlier_flag: isOutlier,
    calendar_outlier_flag: isOutlier,
    work_outlier_flag: false,
    coverage_eligible: i % 5 !== 0,
    total_think_min: 240 + i * 6,
    total_exec_min: 380 + i * 9,
    total_verify_min: 80 + i * 2,
    reason: "",
  };
}

export function getMockAllNeeds(_p: {
  startDate?: string;
  endDate?: string;
}): NeedsV2Summary[] {
  return Array.from({ length: 8 }, (_, i) => makeNeed(i));
}

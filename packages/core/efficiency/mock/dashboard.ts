// Mock samples for the efficiency executive dashboard (pre-backend phase).
// These return illustrative numbers shaped EXACTLY like the real backend
// /v2/dashboard/summary and /v2/dashboard/trends responses so the UI can be
// built and demoed before the Go endpoints are live. Once the backend is up,
// set EFFICIENCY_MOCK=0 and the queryOptions layer will stop calling these.
// Numbers are synthetic but kept in plausible ranges so cards/sparklines render.

import type {
  DashboardSummary,
  DashboardTrendDelta,
  DashboardTrendPoint,
  DashboardTrends,
  GlobalConfig,
} from "../types";

// startDate/endDate are accepted for signature parity with the real query
// (so the dispatcher can forward the same params). The samples are static, so
// the range is currently ignored; later mocks may slice by window.
export function getMockDashboardSummary(_p: {
  startDate?: string;
  endDate?: string;
}): DashboardSummary {
  return {
    total_tasks: 1280,
    total_users: 42,
    total_repos: 36,
    total_commits: 5240,
    total_branchs: 118,
    total_work_dirs: 214,
    total_cost: 8420.5,
    total_tokens: 184_500_000,
    total_task_lines: 312_400,
    total_commit_lines: 486_900,
    total_diff_lines: 799_300,
    total_real_minutes: 170_600,
    avg_efficiency_ratio: 2.84,
    total_task_ancient_minutes: 286_500,
    total_task_real_minutes: 96_400,
    task_efficiency_ratio: 2.97,
    total_commit_ancient_minutes: 198_300,
    total_commit_real_minutes: 74_200,
    commit_efficiency_ratio: 2.67,
    total_users_v2: 38,
    total_needs: 612,
    merged_needs: 489,
    eligible_needs: 421,
    need_actual_calendar_min: 124_800,
    need_baseline_calendar_min: 358_600,
    need_calendar_ratio: 2.87,
    need_work_ratio: 2.54,
    // AI penetration card (decimal ratios / shares).
    ai_code_ratio: 0.31,
    ai_coverage_rate: 0.28,
    ai_penetration_rate: 0.72,
  };
}

export function getMockDashboardTrends(_p: {
  startDate?: string;
  endDate?: string;
}): DashboardTrends {
  // ~8 weekly points — enough for a sparkline. week_start is the Monday of
  // each week (YYYY-MM-DD). efficiency_ratio is a decimal ratio (null when
  // actual<=0); active_users / merged_need_count / cost / commit_diff_lines
  // mirror the DashboardTrendPoint fields.
  const points: DashboardTrendPoint[] = [
    { week_start: "2026-06-01", efficiency_ratio: 2.41, active_users: 18, merged_need_count: 42, cost: 820.4, commit_diff_lines: 84_200 },
    { week_start: "2026-06-08", efficiency_ratio: 2.58, active_users: 22, merged_need_count: 51, cost: 910.2, commit_diff_lines: 92_700 },
    { week_start: "2026-06-15", efficiency_ratio: 2.72, active_users: 25, merged_need_count: 58, cost: 1024.8, commit_diff_lines: 101_400 },
    { week_start: "2026-06-22", efficiency_ratio: 2.69, active_users: 24, merged_need_count: 55, cost: 998.1, commit_diff_lines: 98_300 },
    { week_start: "2026-06-29", efficiency_ratio: 2.85, active_users: 27, merged_need_count: 63, cost: 1142.6, commit_diff_lines: 108_900 },
    { week_start: "2026-07-06", efficiency_ratio: 2.93, active_users: 29, merged_need_count: 67, cost: 1218.4, commit_diff_lines: 115_200 },
    { week_start: "2026-07-13", efficiency_ratio: 2.88, active_users: 28, merged_need_count: 64, cost: 1186.7, commit_diff_lines: 112_500 },
    { week_start: "2026-07-20", efficiency_ratio: 3.04, active_users: 31, merged_need_count: 72, cost: 1310.9, commit_diff_lines: 124_800 },
  ];

  const efficiency: DashboardTrendDelta = {
    current: 3.04,
    previous: 2.41,
    delta_pct: 26.14, // (current-previous)/previous*100
  };
  const usage: DashboardTrendDelta = {
    current: 31,
    previous: 18,
    delta_pct: 72.22,
  };
  const cost: DashboardTrendDelta = {
    current: 1310.9,
    previous: 820.4,
    delta_pct: 59.79,
  };
  const contribution: DashboardTrendDelta = {
    current: 72,
    previous: 42,
    delta_pct: 71.43,
  };

  return {
    granularity: "week",
    points,
    compare: { efficiency, usage, cost, contribution },
  };
}

// Global platform config sample. Mirrors the /v2/config response used by the
// executive dashboard (person-day rates, title prefix, chat-stats gate).
export function getMockGlobalConfig(): GlobalConfig {
  return {
    traditional_dev_lines_per_day: 500,
    cost_per_person_day: 2000,
    dashboard_title_prefix: "",
    chat_stats_enabled: false,
  };
}

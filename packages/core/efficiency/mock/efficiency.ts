// Mock samples for the efficiency dimension (aggregate + the non-paginated
// "fetch everything" variants used by the efficiency dimension for client-side
// ranking/distribution). These return bare arrays / aggregate envelopes shaped
// EXACTLY like the real backend /v2/efficiency, /v2/users/all, /v2/repos/all
// and /v2/projects responses so the UI can be built before the Go endpoints
// are live. Once the backend is up, set EFFICIENCY_MOCK=0 and the queryOptions
// layer will stop calling these.

import type {
  EfficiencyV2AggregateResponse,
  ProjectListItem,
  RepoListItem,
  UserProductivityV2,
  UserV2Row,
} from "../types";

const USER_NAMES = [
  "Alice Wang",
  "Bob Li",
  "Carol Zhang",
  "David Chen",
  "Emma Liu",
  "Frank Zhao",
  "Grace Sun",
  "Henry Wu",
  "Ivy Yang",
  "Jack Ma",
];

// startDate/endDate/userId are accepted for signature parity with the real
// query (so the dispatcher can forward the same params). The samples are
// static, so the range/userId are currently ignored; later mocks may slice
// by window. Returns the {total, data} envelope with ~10 user×week rows.
export function getMockEfficiencyAggregate(_p: {
  startDate?: string;
  endDate?: string;
  userId?: string;
}): EfficiencyV2AggregateResponse {
  const data: UserProductivityV2[] = Array.from(
    { length: 10 },
    (_, i): UserProductivityV2 => {
      const weekStart = `2026-07-${String(6 + (i % 3) * 7).padStart(2, "0")}`;
      const mergedNeedCount = 3 + (i % 5);
      const actualCalendarMin = 1800 + i * 95;
      const baselineCalendarMin = 5200 + i * 140;
      const actualWorkMin = 720 + i * 32;
      const baselineWorkMin = 2050 + i * 58;
      return {
        user_productivity_v2_id: `upv2-${3000 + i}`,
        week_start: weekStart,
        user_id: `u-${200 + (i % 8)}`,
        user_name: USER_NAMES[i % USER_NAMES.length] ?? `User ${3000 + i}`,
        merged_need_count: mergedNeedCount,
        active_need_count: 1 + (i % 4),
        abandoned_need_count: i % 3,
        actual_calendar_min: actualCalendarMin,
        baseline_calendar_min: baselineCalendarMin,
        actual_active_work_corrected_min: actualWorkMin,
        baseline_fused_work_min: baselineWorkMin,
        // decimal ratios; null when actual<=0 (never for these samples)
        efficiency_ratio:
          actualCalendarMin > 0 ? baselineCalendarMin / actualCalendarMin : null,
        work_efficiency_ratio:
          actualWorkMin > 0 ? baselineWorkMin / actualWorkMin : null,
        commit_count: 12 + i * 3,
        commit_diff_lines: 2800 + i * 190,
        confidence_limited: i % 6 === 0,
        confidence_reason: i % 6 === 0 ? "few sample weeks" : "",
        cost: 165 + i * 22.4,
        upstream_tokens: 620_000 + i * 48_000,
        downstream_tokens: 580_000 + i * 42_000,
      };
    },
  );
  return { total: data.length, data };
}

// Non-paginated full users list. Returns a flat UserV2Row[] (~8 rows with
// plausible decimal-ratio values) — mirrors the source getAllUsersV2 which
// paginates internally and flattens. Distinct from the paginated getUsers mock
// (ApiList envelope).
export function getMockAllUsers(_p: {
  startDate?: string;
  endDate?: string;
}): UserV2Row[] {
  return Array.from({ length: 8 }, (_, i) => {
    const mergedNeedCount = 8 + i;
    const actualCalendarMin = 2200 + i * 120;
    const baselineCalendarMin = 6400 + i * 180;
    const actualWorkMin = 850 + i * 40;
    const baselineWorkMin = 2400 + i * 55;
    const confidenceLimited = i % 5 === 0;
    return {
      user_id: `u-${200 + i}`,
      user_name: USER_NAMES[i % USER_NAMES.length] ?? `User ${200 + i}`,
      week_count: 4 + (i % 3),
      merged_need_count: mergedNeedCount,
      active_need_count: 2 + (i % 4),
      abandoned_need_count: i % 3,
      actual_calendar_min: actualCalendarMin,
      baseline_calendar_min: baselineCalendarMin,
      calendar_ratio:
        actualCalendarMin > 0 ? baselineCalendarMin / actualCalendarMin : null,
      actual_work_min: actualWorkMin,
      baseline_work_min: baselineWorkMin,
      work_ratio: actualWorkMin > 0 ? baselineWorkMin / actualWorkMin : null,
      commit_count: 14 + i * 3,
      commit_diff_lines: 3200 + i * 210,
      cost: 180 + i * 24.5,
      tokens: 1_200_000 + i * 95_000,
      ai_code_ratio: 0.26 + (i % 5) * 0.03,
      confidence_limited: confidenceLimited,
      confidence_reason: confidenceLimited ? "few sample weeks" : "",
    };
  });
}

// Non-paginated full repos list. Returns a flat RepoListItem[] (~10 rows).
// Whole-repo aggregation: repo_branch empty, branch_count populated.
// efficiency_ratio is a PERCENTAGE ratio (rendered directly, never x100).
export function getMockAllRepos(_p: {
  startDate?: string;
  endDate?: string;
}): RepoListItem[] {
  return Array.from({ length: 10 }, (_, i) => {
    const sumAncientMinutes = 14_000 + i * 850;
    const sumRealMinutes = 5200 + i * 320;
    return {
      repo_addr: `git@github.com:costrict/repo-${(i % 6) + 1}.git`,
      repo_branch: "", // empty after whole-repo aggregation
      branch_count: 1 + (i % 4), // number of merged branches for this repo
      commit_count: 120 + i * 18,
      start_time: "2026-06-01T00:00:00Z",
      end_time: "2026-07-31T23:59:59Z",
      sum_ancient_minutes: sumAncientMinutes,
      sum_real_minutes: sumRealMinutes,
      task_count: 18 + i * 4,
      // percentage ratio: ((ancient-real)/real)*100
      efficiency_ratio:
        sumRealMinutes > 0
          ? ((sumAncientMinutes - sumRealMinutes) / sumRealMinutes) * 100
          : 0,
      ai_code_ratio: 0.24 + (i % 5) * 0.04, // decimal ratio
      cost: i % 3 === 0 ? 0 : 240 + i * 31.8, // 0 for repos without tasks data
    };
  });
}

// Unpaginated project list. Returns ProjectListItem[] (~6 rows).
// efficiency_ratio is a PERCENTAGE ratio (use PercentPill); the need_* scope
// fields (decimal multipliers) are what the list actually renders.
export function getMockProjectList(_p: {
  order?: string;
  startDate?: string;
  endDate?: string;
}): ProjectListItem[] {
  return Array.from({ length: 6 }, (_, i) => {
    const needActualCalendarMin = 2400 + i * 180;
    const needBaselineCalendarMin = 6900 + i * 260;
    const needActualWorkMin = 920 + i * 60;
    const needBaselineWorkMin = 2600 + i * 75;
    return {
      project_id: `p-${100 + i}`,
      name: `Project ${i + 1}`,
      description: `Sample project ${i + 1} for the efficiency dashboard`,
      repos: null,
      task_ids: null,
      task_ids_silica: null,
      start_time: "2026-06-01T00:00:00Z",
      end_time: "2026-07-31T23:59:59Z",
      start_time_manual: null,
      end_time_manual: null,
      upstream_tokens: 1_240_000 + i * 95_000,
      downstream_tokens: 1_180_000 + i * 88_000,
      cost: 980 + i * 124.5,
      project_ancient_minutes: 12_400 + i * 620,
      project_ancient_minutes_reason: "",
      project_ancient_minutes_manual: null,
      project_ancient_minutes_reason_manual: "",
      project_real_process_minutes: 4600 + i * 210,
      project_real_process_minutes_reason: "",
      project_real_process_minutes_manual: null,
      project_real_process_minutes_reason_manual: "",
      project_real_lead_minutes: 1800 + i * 95,
      project_real_lead_minutes_reason: "",
      project_real_lead_minutes_manual: null,
      project_real_lead_minutes_reason_manual: "",
      created_at: "2026-05-15T08:00:00Z",
      updated_at: "2026-07-20T16:30:00Z",
      repo_count: 1 + (i % 4),
      task_count: 18 + i * 5,
      user_count: 3 + (i % 6),
      total_code_lines: 8400 + i * 720,
      actual_lines_per_day: 240 + i * 28,
      efficiency_ratio: null, // legacy; list renders the need_* scope instead
      // need (branch) scope — decimal multipliers, rendered via RatioPill
      need_calendar_efficiency_ratio:
        needActualCalendarMin > 0
          ? needBaselineCalendarMin / needActualCalendarMin
          : null,
      need_work_efficiency_ratio:
        needActualWorkMin > 0
          ? needBaselineWorkMin / needActualWorkMin
          : null,
      need_ai_code_ratio: 0.28 + (i % 5) * 0.03,
      need_total_loc_net: 5200 + i * 410,
      need_actual_work_min: needActualWorkMin,
      need_cost: 720 + i * 96.2,
      need_eligible_count: 14 + i * 3,
      need_total_count: 18 + i * 4,
      // Batch 3: conserved totals (cross-project avg uses Σbaseline/Σactual)
      need_baseline_calendar_min: needBaselineCalendarMin,
      need_actual_calendar_min: needActualCalendarMin,
      need_baseline_work_min: needBaselineWorkMin,
      need_done_count: 8 + i * 2,
    };
  });
}

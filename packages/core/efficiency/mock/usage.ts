// Mock samples for the usage dimension (Usage Kanban page department
// aggregation + per-user detail). Shapes mirror the *Resp interfaces in
// types-usage.ts verbatim so each literal satisfies its interface without
// `as` casts. Numbers are synthetic but kept in plausible ranges so the
// cards / charts render sensibly during the pre-backend phase.
//
// Like the other mock modules, startDate/endDate/deptId are accepted for
// signature parity with the real query; the samples are static so the window
// is currently ignored. Once /api/v2/efficiency/usage/* is live, set
// EFFICIENCY_MOCK=0 and the queryOptions layer will stop calling these.

import type {
  ActiveUsersDailyPoint,
  AutoRoutingItem,
  DeptActiveUsersResp,
  DeptMemberItem,
  DeptMembersResp,
  DeptModeUsageItem,
  DeptModeUsageResp,
  DeptModelItem,
  DeptModelsResp,
  DeptOverviewResp,
  DeptPeriodCompareResp,
  DeptQuery,
  DeptResultsResp,
  DeptTrendPoint,
  DeptTrendResp,
  DeptWeeklyResp,
  MembersQuery,
  ResultModelItem,
  UserDetailResp,
  UserDetailRow,
  UserDeptItem,
  UserTrendPoint,
  WeekdayItem,
} from "../types-usage";
import { addDays, computePreviousRange } from "../utils/date";

// Enumerate the days in [start, end] as YYYY-MM-DD. Falls back to a static
// 7-day sample window if the query didn't carry dates (defensive).
function daysBetween(start: string | undefined, end: string | undefined): string[] {
  if (!start || !end) {
    return Array.from({ length: 7 }, (_, i) => addDays("2026-07-01", i));
  }
  const out: string[] = [];
  let cur = start;
  // safety cap to avoid runaway loops on bad input
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// ============================ Department aggregation ============================

export function getMockUsageDeptOverview(q: DeptQuery): DeptOverviewResp {
  const activeUsers = 24;
  const totalRequests = 18_640;
  const sumPrompt = 4_120_000;
  const sumCompletion = 2_180_000;
  return {
    dept_id: q.deptId,
    include_children: q.includeChildren,
    active_users: activeUsers,
    total_requests: totalRequests,
    avg_requests_per_user: totalRequests / activeUsers,
    sum_prompt_tokens: sumPrompt,
    sum_completion_tokens: sumCompletion,
    sum_total_tokens: sumPrompt + sumCompletion,
    avg_prompt_tokens_per_user: sumPrompt / activeUsers,
    avg_completion_tokens_per_user: sumCompletion / activeUsers,
    avg_total_tokens_per_user: (sumPrompt + sumCompletion) / activeUsers,
    total_sessions: 3120,
    avg_ttft_ms: 612.4,
    avg_token_output_speed: 48.7,
    avg_duration_ms: 18_240,
    success_rate: 96.4,
    error_rate: 3.6,
  };
}

export function getMockUsageDeptActiveUsers(q: DeptQuery): DeptActiveUsersResp {
  const days = daysBetween(q.start, q.end);
  const dailyTrend: ActiveUsersDailyPoint[] = days.map((date, i) => {
    const dau = 9 + ((i * 3) % 8); // ~9–16
    const wau = 22 + ((i + 1) % 5);
    const mau = 28 + ((i + 2) % 4);
    return {
      date,
      dau,
      wau,
      mau,
      dau_wau_ratio: wau > 0 ? (dau / wau) * 100 : 0,
    };
  });
  return {
    dau: 14,
    wau: 26,
    mau: 31,
    dau_wau_ratio: 26 > 0 ? (14 / 26) * 100 : 0,
    daily_trend: dailyTrend,
  };
}

export function getMockUsageDeptTrend(q: DeptQuery): DeptTrendResp {
  const days = daysBetween(q.start, q.end);
  const trend: DeptTrendPoint[] = days.map((date, i) => ({
    date,
    request_count: 420 + ((i * 37) % 320),
    prompt_tokens: 96_000 + ((i * 5300) % 42_000),
    completion_tokens: 52_000 + ((i * 2900) % 24_000),
    active_users: 9 + ((i * 2) % 9),
  }));
  return { trend };
}

const MODEL_NAMES = [
  "glm-4.6",
  "glm-4.5-air",
  "glm-4.5",
  "gpt-4o",
  "claude-sonnet-4",
];

export function getMockUsageDeptModels(_q: DeptQuery): DeptModelsResp {
  // 4 models with shares that roughly sum to 100% (not enforced to be exact).
  const models: DeptModelItem[] = [
    {
      model: MODEL_NAMES[0]!,
      request_count: 8420,
      request_pct: 45.17,
      prompt_tokens: 1_860_000,
      completion_tokens: 980_000,
      total_tokens: 2_840_000,
      token_pct: 45.13,
      input_output_ratio: 1_860_000 / 980_000,
      success_rate: 97.2,
      estimated_total_cost: 412.6,
    },
    {
      model: MODEL_NAMES[1]!,
      request_count: 4980,
      request_pct: 26.72,
      prompt_tokens: 1_120_000,
      completion_tokens: 620_000,
      total_tokens: 1_740_000,
      token_pct: 27.67,
      input_output_ratio: 1_120_000 / 620_000,
      success_rate: 96.5,
      estimated_total_cost: 218.4,
    },
    {
      model: MODEL_NAMES[2]!,
      request_count: 3120,
      request_pct: 16.74,
      prompt_tokens: 720_000,
      completion_tokens: 380_000,
      total_tokens: 1_100_000,
      token_pct: 17.49,
      input_output_ratio: 720_000 / 380_000,
      success_rate: 95.8,
      estimated_total_cost: 162.8,
    },
    {
      model: MODEL_NAMES[3]!,
      request_count: 2120,
      request_pct: 11.37,
      prompt_tokens: 420_000,
      completion_tokens: 200_000,
      total_tokens: 620_000,
      token_pct: 9.86,
      input_output_ratio: 420_000 / 200_000,
      success_rate: 94.1,
      estimated_total_cost: 96.2,
    },
  ];
  const autoRouting: AutoRoutingItem[] = [
    { routed_model: MODEL_NAMES[0]!, request_count: 5240, request_pct: 60.95 },
    { routed_model: MODEL_NAMES[1]!, request_count: 2120, request_pct: 24.65 },
    { routed_model: MODEL_NAMES[2]!, request_count: 1240, request_pct: 14.41 },
  ];
  return { models, auto_routing: autoRouting };
}

export function getMockUsageDeptWeekly(_q: DeptQuery): DeptWeeklyResp {
  const names = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const counts = [3120, 3340, 3180, 3460, 2980, 1280, 980];
  const weekdays: WeekdayItem[] = counts.map((c, i) => ({
    weekday: i + 1,
    weekday_name: names[i]!,
    request_count: c,
  }));
  return { weekdays };
}

export function getMockUsageDeptResults(_q: DeptQuery): DeptResultsResp {
  const totalRequests = 18_640;
  const errorRequests = 672;
  const successRequests = totalRequests - errorRequests;
  const models: ResultModelItem[] = [
    {
      model: MODEL_NAMES[0]!,
      total_requests: 8420,
      error_requests: 196,
      success_rate: ((8420 - 196) / 8420) * 100,
      error_rate: (196 / 8420) * 100,
    },
    {
      model: MODEL_NAMES[1]!,
      total_requests: 4980,
      error_requests: 148,
      success_rate: ((4980 - 148) / 4980) * 100,
      error_rate: (148 / 4980) * 100,
    },
    {
      model: MODEL_NAMES[2]!,
      total_requests: 3120,
      error_requests: 168,
      success_rate: ((3120 - 168) / 3120) * 100,
      error_rate: (168 / 3120) * 100,
    },
    {
      model: MODEL_NAMES[3]!,
      total_requests: 2120,
      error_requests: 160,
      success_rate: ((2120 - 160) / 2120) * 100,
      error_rate: (160 / 2120) * 100,
    },
  ];
  return {
    total_requests: totalRequests,
    success_requests: successRequests,
    error_requests: errorRequests,
    success_rate: (successRequests / totalRequests) * 100,
    error_rate: (errorRequests / totalRequests) * 100,
    models,
  };
}

export function getMockUsagePeriodCompare(q: DeptQuery): DeptPeriodCompareResp {
  const [prevStart, prevEnd] = computePreviousRange(q.start, q.end);
  const currentRequests = 18_640;
  const previousRequests = 15_420;
  const currentTokens = 6_300_000;
  const previousTokens = 5_180_000;
  return {
    current_period: {
      start: q.start,
      end: q.end,
      total_requests: currentRequests,
      sum_total_tokens: currentTokens,
    },
    previous_period: {
      start: prevStart,
      end: prevEnd,
      total_requests: previousRequests,
      sum_total_tokens: previousTokens,
    },
    request_change_pct:
      previousRequests > 0
        ? ((currentRequests - previousRequests) / previousRequests) * 100
        : 0,
    token_change_pct:
      previousTokens > 0
        ? ((currentTokens - previousTokens) / previousTokens) * 100
        : 0,
  };
}

export function getMockUsageDeptModeUsage(q: DeptQuery): DeptModeUsageResp {
  const items: DeptModeUsageItem[] = [
    { mode: "chat", user_count: 22, request_count: 8420 },
    { mode: "agent", user_count: 14, request_count: 4980 },
    { mode: "code", user_count: 11, request_count: 3120 },
    { mode: "translate", user_count: 6, request_count: 1240 },
    { mode: "search", user_count: 4, request_count: 880 },
  ];
  return { dept_id: q.deptId, items };
}

const MEMBER_NAMES = [
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

export function getMockUsageDeptMembers(q: MembersQuery): DeptMembersResp {
  const total = MEMBER_NAMES.length;
  // Server-side pagination: slice by page/pageSize (1-indexed page).
  const startIdx = (q.page - 1) * q.pageSize;
  const pageMembers = MEMBER_NAMES.slice(startIdx, startIdx + q.pageSize);
  const members: DeptMemberItem[] = pageMembers.map((name, i) => {
    const idx = startIdx + i;
    const totalRequests = 320 - idx * 22;
    const promptTokens = 84_000 - idx * 5200;
    const completionTokens = 44_000 - idx * 2800;
    return {
      universal_id: `u-${200 + idx}`,
      username: name,
      user_id: `EMP${String(1001 + idx).padStart(4, "0")}`,
      total_requests: totalRequests,
      sum_prompt_tokens: promptTokens,
      sum_completion_tokens: completionTokens,
      sum_total_tokens: promptTokens + completionTokens,
      success_rate: 97 - idx * 0.4,
      avg_duration_ms: 17_400 - idx * 320,
      active_days: 18 - idx,
      estimated_total_cost: 86.4 - idx * 4.2,
    };
  });
  return {
    dept_id: q.deptId,
    total,
    page: q.page,
    page_size: q.pageSize,
    members,
  };
}

// ============================ Per-user ============================

export function getMockUsageUserDetail(
  uid: string,
  _start: string,
  _end: string,
): UserDetailResp {
  const totalRequests = 1840;
  const errorRequests = 64;
  const successRequests = totalRequests - errorRequests;
  const promptTokens = 420_000;
  const completionTokens = 226_000;
  const userDetail: UserDetailRow = {
    universal_id: uid,
    username: "Alice Wang",
    total_requests: totalRequests,
    success_requests: successRequests,
    error_requests: errorRequests,
    success_rate: (successRequests / totalRequests) * 100,
    error_rate: (errorRequests / totalRequests) * 100,
    sum_prompt_tokens: promptTokens,
    sum_completion_tokens: completionTokens,
    sum_total_tokens: promptTokens + completionTokens,
    sum_cache_tokens: 48_200,
    total_sessions: 312,
    active_days: 18,
    avg_duration_ms: 16_800,
    avg_ttft_ms: 586.2,
    avg_token_output_speed: 51.3,
    model_preference: MODEL_NAMES[0],
    estimated_total_cost: 184.6,
  };
  const models: DeptModelItem[] = [
    {
      model: MODEL_NAMES[0]!,
      request_count: 980,
      request_pct: 53.26,
      prompt_tokens: 224_000,
      completion_tokens: 120_000,
      total_tokens: 344_000,
      token_pct: 53.29,
      input_output_ratio: 224_000 / 120_000,
      success_rate: 97.8,
      estimated_total_cost: 96.4,
    },
    {
      model: MODEL_NAMES[1]!,
      request_count: 540,
      request_pct: 29.35,
      prompt_tokens: 124_000,
      completion_tokens: 68_000,
      total_tokens: 192_000,
      token_pct: 29.77,
      input_output_ratio: 124_000 / 68_000,
      success_rate: 96.3,
      estimated_total_cost: 54.8,
    },
    {
      model: MODEL_NAMES[2]!,
      request_count: 320,
      request_pct: 17.39,
      prompt_tokens: 72_000,
      completion_tokens: 38_000,
      total_tokens: 110_000,
      token_pct: 17.04,
      input_output_ratio: 72_000 / 38_000,
      success_rate: 94.7,
      estimated_total_cost: 33.4,
    },
  ];
  const autoRouting: AutoRoutingItem[] = [
    { routed_model: MODEL_NAMES[0]!, request_count: 620, request_pct: 53.13 },
    { routed_model: MODEL_NAMES[1]!, request_count: 320, request_pct: 27.4 },
    { routed_model: MODEL_NAMES[2]!, request_count: 228, request_pct: 19.52 },
  ];
  const departments: UserDeptItem[] = [
    {
      user_id: "EMP1001",
      username: "Alice Wang",
      dept_id: "d-infra",
      dept_name: "Infrastructure Platform",
      is_main: 1,
    },
    {
      user_id: "EMP1001",
      username: "Alice Wang",
      dept_id: "d-frontend",
      dept_name: "Frontend Team",
      is_main: 0,
    },
  ];
  return {
    user_detail: userDetail,
    models,
    auto_routing: autoRouting,
    departments,
  };
}

export function getMockUsageUserTrend(
  _uid: string,
  start: string,
  end: string,
): UserTrendPoint[] {
  const days = daysBetween(start, end);
  return days.map((date, i) => ({
    date,
    total_requests: 62 + ((i * 9) % 38),
    success_requests: 58 + ((i * 8) % 34),
    error_requests: 2 + ((i * 1) % 6),
    sum_prompt_tokens: 14_200 + ((i * 640) % 7800),
    sum_completion_tokens: 7600 + ((i * 340) % 4200),
    sum_total_tokens: 21_800 + ((i * 980) % 11_600),
    sum_cache_tokens: 1600 + ((i * 120) % 2200),
    unique_task_count: 4 + ((i * 1) % 8),
    avg_duration_ms: 16_200 + ((i * 240) % 3600),
    avg_first_token_duration_ms: 540 + ((i * 22) % 180),
    estimated_total_cost: 6.2 + ((i * 0.4) % 3.8),
    estimated_input_cost: 2.8 + ((i * 0.2) % 1.8),
    estimated_output_cost: 2.6 + ((i * 0.15) % 1.5),
    estimated_cache_cost: 0.4 + ((i * 0.04) % 0.4),
    estimated_request_cost: 0.4 + ((i * 0.04) % 0.4),
    model_preference: MODEL_NAMES[i % MODEL_NAMES.length],
    auto_router_breakdown:
      i % 3 === 0 ? "auto:glm-4.6,glm-4.5-air" : null,
  }));
}

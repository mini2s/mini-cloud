// Mock samples for the cost dimension (Cost Kanban page department
// aggregation + model/team breakdown + per-user). Shapes mirror the *Resp
// interfaces in types-cost.ts verbatim so each literal satisfies its
// interface without `as` casts. Numbers are synthetic but kept in plausible
// ranges (token costs in yuan) so the cards / charts render sensibly during
// the pre-backend phase.
//
// Like the other mock modules, startDate/endDate/deptId are accepted for
// signature parity with the real query; the samples are mostly static so the
// window is currently ignored except where a daily series is generated. Once
// /api/v2/efficiency/cost/* is live, set EFFICIENCY_MOCK=0 and the
// queryOptions layer will stop calling these.

import type {
  CostAnomalyResp,
  CostCompositionItem,
  CostMembersQuery,
  CostModelCompositionResp,
  CostModelItem,
  CostModelsResp,
  CostModelTrendResp,
  CostModelTrendSeries,
  CostOverviewResp,
  CostPeriodCompareResp,
  CostPeriodSpan,
  CostSubDeptItem,
  CostSubDeptResp,
  CostTeamCompositionItem,
  CostTeamCompositionResp,
  CostTeamTrendResp,
  CostTeamTrendSeries,
  CostTrendPoint,
  CostUnitPrice,
  CostUserItem,
  CostUsersResp,
} from "../types-cost";
import type { DeptQuery } from "../types-usage";
import { addDays, computePreviousRange } from "../utils/date";

// Enumerate the days in [start, end] as YYYY-MM-DD. Falls back to a static
// 7-day sample window if the query didn't carry dates (defensive). Same
// helper shape as mock/usage.ts (kept local so this module is standalone).
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

const MODEL_NAMES = [
  "glm-4.6",
  "glm-4.5-air",
  "glm-4.5",
  "gpt-4o",
  "claude-sonnet-4",
];

const TEAM_NAMES = [
  { dept_id: "d-infra", dept_name: "Infrastructure Platform" },
  { dept_id: "d-frontend", dept_name: "Frontend Team" },
  { dept_id: "d-backend", dept_name: "Backend Team" },
  { dept_id: "d-data", dept_name: "Data Team" },
];

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

// ============================ Department aggregation ============================

export function getMockCostOverview(q: DeptQuery): CostOverviewResp {
  const activeUsers = 24;
  const periodDays = 30;
  const inputCost = 312.4;
  const outputCost = 468.6;
  const cacheCost = 64.2;
  const requestCost = 44.8;
  const totalCost = inputCost + outputCost + cacheCost + requestCost;
  const promptTokens = 4_120_000;
  const completionTokens = 2_180_000;
  const cacheTokens = 612_000;
  const totalTokens = promptTokens + completionTokens + cacheTokens;
  const hitInputTokens = 1_640_000;
  const missInputTokens = promptTokens - hitInputTokens;
  const hitInputCost = 124.8;
  const missInputCost = inputCost - hitInputCost;
  const cacheSavings = 96.4;
  return {
    dept_id: q.deptId,
    include_children: q.includeChildren,
    total_cost: totalCost,
    input_cost: inputCost,
    output_cost: outputCost,
    cache_cost: cacheCost,
    request_cost: requestCost,
    input_cost_pct: totalCost > 0 ? inputCost / totalCost : 0,
    output_cost_pct: totalCost > 0 ? outputCost / totalCost : 0,
    daily_avg_cost: periodDays > 0 ? totalCost / periodDays : 0,
    per_user_avg_cost: activeUsers > 0 ? totalCost / activeUsers : 0,
    per_1k_token_cost: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
    active_users: activeUsers,
    total_tokens: totalTokens,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cache_tokens: cacheTokens,
    period_days: periodDays,
    cache: {
      hit_input_tokens: hitInputTokens,
      hit_input_cost: hitInputCost,
      miss_input_tokens: missInputTokens,
      miss_input_cost: missInputCost,
      hit_rate_pct:
        promptTokens > 0 ? (hitInputTokens / promptTokens) * 100 : 0,
      savings: cacheSavings,
    },
  };
}

export function getMockCostPeriodCompare(
  q: DeptQuery,
): CostPeriodCompareResp {
  const [prevStart, prevEnd] = computePreviousRange(q.start, q.end);
  const currentInput = 312.4;
  const currentOutput = 468.6;
  const currentCache = 64.2;
  const currentTotal = currentInput + currentOutput + currentCache;
  const previousInput = 268.2;
  const previousOutput = 392.4;
  const previousCache = 52.8;
  const previousTotal = previousInput + previousOutput + previousCache;
  const currentPeriod: CostPeriodSpan = {
    start: q.start,
    end: q.end,
    total_cost: currentTotal,
    input_cost: currentInput,
    output_cost: currentOutput,
    cache_cost: currentCache,
  };
  const previousPeriod: CostPeriodSpan = {
    start: prevStart,
    end: prevEnd,
    total_cost: previousTotal,
    input_cost: previousInput,
    output_cost: previousOutput,
    cache_cost: previousCache,
  };
  return {
    current_period: currentPeriod,
    previous_period: previousPeriod,
    cost_change_pct:
      previousTotal > 0
        ? ((currentTotal - previousTotal) / previousTotal) * 100
        : 0,
    input_cost_change_pct:
      previousInput > 0
        ? ((currentInput - previousInput) / previousInput) * 100
        : 0,
    output_cost_change_pct:
      previousOutput > 0
        ? ((currentOutput - previousOutput) / previousOutput) * 100
        : 0,
  };
}

// ============================ Model breakdown ============================

const MODEL_UNIT_PRICES: CostUnitPrice[] = [
  { input_per_1k: 0.05, output_per_1k: 0.5, cache_per_1k: 0.005 },
  { input_per_1k: 0.004, output_per_1k: 0.016, cache_per_1k: 0.0004 },
  { input_per_1k: 0.02, output_per_1k: 0.2, cache_per_1k: 0.002 },
  { input_per_1k: 0.035, output_per_1k: 0.15, cache_per_1k: null },
  { input_per_1k: 0.045, output_per_1k: 0.225, cache_per_1k: 0.0045 },
];

export function getMockCostModels(_q: DeptQuery): CostModelsResp {
  // 4 models with shares roughly summing to 100% (not enforced to be exact).
  const models: CostModelItem[] = [
    {
      model: MODEL_NAMES[0]!,
      total_cost: 412.6,
      input_cost: 168.4,
      output_cost: 214.2,
      cache_cost: 24.0,
      request_cost: 6.0,
      cost_pct: 0.4635,
      request_count: 8420,
      prompt_tokens: 1_860_000,
      completion_tokens: 980_000,
      total_tokens: 2_840_000,
      cache_tokens: 320_000,
      pricing_mode: "token",
      unit_price: MODEL_UNIT_PRICES[0]!,
      actual_avg_cost_per_1k: (412.6 / 2_840_000) * 1000,
    },
    {
      model: MODEL_NAMES[1]!,
      total_cost: 218.4,
      input_cost: 96.2,
      output_cost: 108.4,
      cache_cost: 9.8,
      request_cost: 4.0,
      cost_pct: 0.2454,
      request_count: 4980,
      prompt_tokens: 1_120_000,
      completion_tokens: 620_000,
      total_tokens: 1_740_000,
      cache_tokens: 148_000,
      pricing_mode: "token",
      unit_price: MODEL_UNIT_PRICES[1]!,
      actual_avg_cost_per_1k: (218.4 / 1_740_000) * 1000,
    },
    {
      model: MODEL_NAMES[2]!,
      total_cost: 162.8,
      input_cost: 62.4,
      output_cost: 88.2,
      cache_cost: 9.2,
      request_cost: 3.0,
      cost_pct: 0.1829,
      request_count: 3120,
      prompt_tokens: 720_000,
      completion_tokens: 380_000,
      total_tokens: 1_100_000,
      cache_tokens: 96_000,
      pricing_mode: "token",
      unit_price: MODEL_UNIT_PRICES[2]!,
      actual_avg_cost_per_1k: (162.8 / 1_100_000) * 1000,
    },
    {
      model: MODEL_NAMES[3]!,
      total_cost: 96.2,
      input_cost: 36.4,
      output_cost: 52.8,
      cache_cost: 0,
      request_cost: 7.0,
      cost_pct: 0.1081,
      request_count: 2120,
      prompt_tokens: 420_000,
      completion_tokens: 200_000,
      total_tokens: 620_000,
      cache_tokens: 0,
      pricing_mode: "request",
      unit_price: MODEL_UNIT_PRICES[3]!,
      actual_avg_cost_per_1k: (96.2 / 620_000) * 1000,
    },
  ];
  return { models };
}

export function getMockCostModelTrend(q: DeptQuery): CostModelTrendResp {
  const days = daysBetween(q.start, q.end);
  const modelShares = [0.46, 0.25, 0.18, 0.11];
  const series: CostModelTrendSeries[] = modelShares.map((share, mi) => ({
    model: MODEL_NAMES[mi]!,
    data: days.map((date, i) => {
      const dayTotal = 28.4 + ((i * 2.4) % 12.6);
      const point: CostTrendPoint = {
        date,
        total_cost: Math.round(dayTotal * share * 100) / 100,
      };
      return point;
    }),
  }));
  return { series };
}

export function getMockCostModelComposition(
  _q: DeptQuery,
): CostModelCompositionResp {
  const items: CostCompositionItem[] = [
    { model: MODEL_NAMES[0]!, total_cost: 412.6, cost_pct: 0.4635 },
    { model: MODEL_NAMES[1]!, total_cost: 218.4, cost_pct: 0.2454 },
    { model: MODEL_NAMES[2]!, total_cost: 162.8, cost_pct: 0.1829 },
    { model: MODEL_NAMES[3]!, total_cost: 96.2, cost_pct: 0.1081 },
  ];
  return { items };
}

// ============================ Anomaly detection ============================

export function getMockCostAnomaly(q: DeptQuery): CostAnomalyResp {
  return {
    dept_id: q.deptId,
    daily_spike_count: 3,
    user_spike_count: 2,
    zero_cost_active_users: 4,
    daily_spike_threshold: 120.0,
    user_spike_threshold: 80.0,
  };
}

// ============================ Team (sub-department) breakdown ============================

export function getMockCostSubDepts(q: DeptQuery): CostSubDeptResp {
  const items: CostSubDeptItem[] = [
    {
      dept_id: TEAM_NAMES[0]!.dept_id,
      dept_name: TEAM_NAMES[0]!.dept_name,
      total_cost: 348.2,
      input_cost: 142.6,
      output_cost: 184.4,
      cache_cost: 21.2,
      cost_pct: 0.3911,
      active_users: 9,
      total_tokens: 1_240_000,
    },
    {
      dept_id: TEAM_NAMES[1]!.dept_id,
      dept_name: TEAM_NAMES[1]!.dept_name,
      total_cost: 224.6,
      input_cost: 92.4,
      output_cost: 118.2,
      cache_cost: 14.0,
      cost_pct: 0.2522,
      active_users: 7,
      total_tokens: 820_000,
    },
    {
      dept_id: TEAM_NAMES[2]!.dept_id,
      dept_name: TEAM_NAMES[2]!.dept_name,
      total_cost: 184.8,
      input_cost: 74.2,
      output_cost: 98.4,
      cache_cost: 12.2,
      cost_pct: 0.2075,
      active_users: 5,
      total_tokens: 680_000,
    },
    {
      dept_id: TEAM_NAMES[3]!.dept_id,
      dept_name: TEAM_NAMES[3]!.dept_name,
      total_cost: 132.4,
      input_cost: 54.2,
      output_cost: 67.6,
      cache_cost: 10.6,
      cost_pct: 0.1487,
      active_users: 3,
      total_tokens: 480_000,
    },
  ];
  return { parent_dept_id: q.deptId, items };
}

export function getMockCostTeamTrend(q: DeptQuery): CostTeamTrendResp {
  const days = daysBetween(q.start, q.end);
  const teamShares = [0.39, 0.25, 0.21, 0.15];
  const series: CostTeamTrendSeries[] = teamShares.map((share, ti) => ({
    dept_id: TEAM_NAMES[ti]!.dept_id,
    dept_name: TEAM_NAMES[ti]!.dept_name,
    data: days.map((date, i) => {
      const dayTotal = 29.6 + ((i * 2.2) % 11.8);
      const point: CostTrendPoint = {
        date,
        total_cost: Math.round(dayTotal * share * 100) / 100,
      };
      return point;
    }),
  }));
  return { series };
}

export function getMockCostTeamComposition(
  _q: DeptQuery,
): CostTeamCompositionResp {
  const items: CostTeamCompositionItem[] = [
    {
      dept_id: TEAM_NAMES[0]!.dept_id,
      dept_name: TEAM_NAMES[0]!.dept_name,
      total_cost: 348.2,
      cost_pct: 0.3911,
    },
    {
      dept_id: TEAM_NAMES[1]!.dept_id,
      dept_name: TEAM_NAMES[1]!.dept_name,
      total_cost: 224.6,
      cost_pct: 0.2522,
    },
    {
      dept_id: TEAM_NAMES[2]!.dept_id,
      dept_name: TEAM_NAMES[2]!.dept_name,
      total_cost: 184.8,
      cost_pct: 0.2075,
    },
    {
      dept_id: TEAM_NAMES[3]!.dept_id,
      dept_name: TEAM_NAMES[3]!.dept_name,
      total_cost: 132.4,
      cost_pct: 0.1487,
    },
  ];
  return { items };
}

// ============================ Per-user (members) ============================

export function getMockCostMembers(q: CostMembersQuery): CostUsersResp {
  const total = MEMBER_NAMES.length;
  // Server-side pagination: slice by page/pageSize (1-indexed page).
  const startIdx = (q.page - 1) * q.pageSize;
  const pageMembers = MEMBER_NAMES.slice(startIdx, startIdx + q.pageSize);
  const users: CostUserItem[] = pageMembers.map((name, i) => {
    const idx = startIdx + i;
    const inputCost = 42.4 - idx * 2.8;
    const outputCost = 58.6 - idx * 3.6;
    const cacheCost = 6.2 - idx * 0.4;
    const requestCost = 4.2 - idx * 0.2;
    const totalCost = inputCost + outputCost + cacheCost + requestCost;
    const promptTokens = 84_000 - idx * 5200;
    const completionTokens = 44_000 - idx * 2800;
    const totalTokens = promptTokens + completionTokens;
    return {
      universal_id: `u-${200 + idx}`,
      username: name,
      user_id: `EMP${String(1001 + idx).padStart(4, "0")}`,
      total_cost: Math.round(totalCost * 100) / 100,
      input_cost: Math.round(inputCost * 100) / 100,
      output_cost: Math.round(outputCost * 100) / 100,
      cache_cost: Math.round(cacheCost * 100) / 100,
      request_cost: Math.round(requestCost * 100) / 100,
      cost_pct: 0.18 - idx * 0.012,
      request_count: 320 - idx * 22,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      cache_tokens: 6400 - idx * 420,
      active_days: 18 - idx,
    };
  });
  return {
    dept_id: q.deptId,
    total,
    page: q.page,
    page_size: q.pageSize,
    users,
  };
}

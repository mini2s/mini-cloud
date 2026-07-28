// Cost dimension (Cost Kanban — department aggregation, model breakdown,
// team breakdown, per-user) response types. Migrated from the source
// project's pages/dimensions/cost/costTypes.ts and costData.ts.
//
// Cost reuses the usage dimension's DeptQuery / CostMembersQuery shapes
// (identical {deptId, start, end, includeChildren} surface), so DeptQuery
// is imported from ./types-usage and re-exported here rather than redefined.
// CostMembersQuery is cost-specific (its own sort keys) so it is defined here.
//
// These back the chat statistics /stats/departments/:id/cost/* endpoints;
// the mock layer returns samples shaped exactly like these interfaces.
// Fields align with the source backend responses (token costs in yuan).

import type { DeptQuery } from "./types-usage";

// DeptQuery is shared with the usage dimension (identical {deptId, start,
// end, includeChildren} surface). It is NOT re-exported here: the barrel
// (index.ts) already re-exports it via `export * from "./types-usage"`, so
// re-exporting again would collide. Cost consumers import DeptQuery from
// the package root. The import above is used as the base of CostMembersQuery.

// ============================ Department cost overview ============================

/** /stats/departments/:id/cost/overview — total cost / token cost /
 *  cache cost / per-user per-day per-1k-token average. */
export interface CostOverviewResp {
  dept_id: string;
  include_children: boolean;
  total_cost: number; // total fee actually deducted
  input_cost: number; // input token fee
  output_cost: number; // output token fee
  cache_cost: number; // cache fee
  request_cost: number; // request fee (request/hybrid billing mode)
  input_cost_pct: number; // input fee share
  output_cost_pct: number; // output fee share
  daily_avg_cost: number; // daily average fee
  per_user_avg_cost: number; // per-user average fee
  per_1k_token_cost: number; // average cost per 1k tokens
  active_users: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_tokens: number;
  period_days: number;
  cache: {
    hit_input_tokens: number; // cache-hit input token volume
    hit_input_cost: number; // cache-hit input fee
    miss_input_tokens: number; // cache-miss input token volume
    miss_input_cost: number; // cache-miss input fee
    hit_rate_pct: number; // cache hit rate
    savings: number; // cache savings
  };
}

/** /stats/departments/:id/cost/period-compare — cost period-over-period. */
export interface CostPeriodSpan {
  start: string;
  end: string;
  total_cost: number;
  input_cost: number;
  output_cost: number;
  cache_cost: number;
}
export interface CostPeriodCompareResp {
  current_period: CostPeriodSpan;
  previous_period: CostPeriodSpan;
  cost_change_pct: number; // total fee period-over-period
  input_cost_change_pct: number;
  output_cost_change_pct: number;
}

// ============================ Model cost ============================

/** Model unit price (per 1k tokens, synced from the billing system's
 *  model_pricing by the latest effective price in the window). */
export interface CostUnitPrice {
  input_per_1k: number | null;
  output_per_1k: number | null;
  cache_per_1k: number | null;
}

/** /stats/departments/:id/cost/models — per-model cost / share /
 *  unit price / actual average cost. */
export interface CostModelItem {
  model: string;
  total_cost: number; // per-model fee
  input_cost: number;
  output_cost: number;
  cache_cost: number;
  request_cost: number;
  cost_pct: number; // per-model fee share
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_tokens: number;
  pricing_mode: string | null; // token / request / hybrid
  unit_price: CostUnitPrice; // per-model unit price
  actual_avg_cost_per_1k: number; // = total_cost / total_tokens * 1000
}
export interface CostModelsResp {
  models: CostModelItem[];
}

export interface CostTrendPoint {
  date: string;
  total_cost: number;
}

/** /stats/departments/:id/cost/model-trend — per-model daily cost
 *  (stacked area chart). */
export interface CostModelTrendSeries {
  model: string;
  data: CostTrendPoint[];
}
export interface CostModelTrendResp {
  series: CostModelTrendSeries[];
}

/** /stats/departments/:id/cost/composition/models — model cost
 *  composition share (pie chart). */
export interface CostCompositionItem {
  model: string;
  total_cost: number;
  cost_pct: number;
}
export interface CostModelCompositionResp {
  items: CostCompositionItem[];
}

// ============================ Team (sub-department) cost ============================

/** /stats/departments/:id/cost/sub-departments — per-team (direct
 *  child department) cost comparison. */
export interface CostSubDeptItem {
  dept_id: string;
  dept_name: string; // team name
  total_cost: number; // per-team fee
  input_cost: number;
  output_cost: number;
  cache_cost: number;
  cost_pct: number; // per-team fee share
  active_users: number; // team active users (per-user = total_cost/active_users computed client-side)
  total_tokens: number;
}
export interface CostSubDeptResp {
  parent_dept_id: string;
  items: CostSubDeptItem[];
}

/** /stats/departments/:id/cost/team-trend — per-team daily cost (line). */
export interface CostTeamTrendSeries {
  dept_id: string;
  dept_name: string;
  data: CostTrendPoint[];
}
export interface CostTeamTrendResp {
  series: CostTeamTrendSeries[];
}

/** /stats/departments/:id/cost/composition/teams — team cost
 *  composition share (pie chart). */
export interface CostTeamCompositionItem {
  dept_id: string;
  dept_name: string;
  total_cost: number;
  cost_pct: number;
}
export interface CostTeamCompositionResp {
  items: CostTeamCompositionItem[];
}

// ============================ User cost ============================

/** /stats/departments/:id/cost/users — per-user cost in the dept (paginated). */
export interface CostUserItem {
  universal_id: string;
  username: string | null;
  /** Employee number (human-readable id, distinct from universal_id). */
  user_id?: string;
  total_cost: number; // per-user fee
  input_cost: number;
  output_cost: number;
  cache_cost: number;
  request_cost: number;
  cost_pct: number; // per-user fee share
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_tokens: number;
  active_days: number;
}
export interface CostUsersResp {
  dept_id: string;
  total: number;
  page: number;
  page_size: number;
  users: CostUserItem[];
}

/** /stats/departments/:id/cost/anomaly — anomaly detection. */
export interface CostAnomalyResp {
  dept_id: string;
  daily_spike_count: number; // single-day cost spike count
  user_spike_count: number; // single-user cost spike count (deduped users)
  zero_cost_active_users: number; // active users with zero cost
  daily_spike_threshold: number;
  user_spike_threshold: number;
}

// ============================ Members list query ============================

export type CostMemberSortBy =
  | "total_cost"
  | "input_cost"
  | "output_cost"
  | "total_tokens"
  | "request_count";

/** Members list query: extends DeptQuery with pagination + sort + search. */
export interface CostMembersQuery extends DeptQuery {
  page: number;
  pageSize: number;
  sortBy: CostMemberSortBy;
  sortOrder: "asc" | "desc";
  search: string;
}

// Usage dimension (department aggregation + per-user) response types.
// Migrated verbatim from the source project's pages/dimensions/usage/usageTypes.ts
// and usageData.ts (DeptQuery / MembersQuery / DeptModeUsageItem were local to
// usageData.ts in the source). These back the /api/v2/efficiency/usage/* endpoints
// the mini-cloud backend will mount in a later slice; the mock layer returns
// samples shaped exactly like these interfaces.
//
// Backend n+1 double-count note: except for success_rate/error_rate, the metrics
// below already exclude failed requests (the "clean" caliber).

// ============================ Shared query params ============================

/** Department-scoped query params (include_children is sent as the literal
 *  string "true"/"false" to the backend). */
export interface DeptQuery {
  deptId: string;
  start: string;
  end: string;
  includeChildren: boolean;
}

export type MemberSortBy =
  | "sum_total_tokens"
  | "total_requests"
  | "sum_prompt_tokens"
  | "sum_completion_tokens"
  | "active_days"
  | "success_rate";

/** Members list query: extends DeptQuery with pagination + sort + search. */
export interface MembersQuery extends DeptQuery {
  page: number;
  pageSize: number;
  sortBy: MemberSortBy;
  sortOrder: "asc" | "desc";
  search: string;
}

// ============================ Department aggregation ============================

/** /api/v2/efficiency/usage/dept/:dept_id/overview — full-metric aggregate. */
export interface DeptOverviewResp {
  dept_id: string;
  include_children: boolean;
  active_users: number;
  total_requests: number;
  avg_requests_per_user: number;
  sum_prompt_tokens: number;
  sum_completion_tokens: number;
  sum_total_tokens: number;
  avg_prompt_tokens_per_user: number;
  avg_completion_tokens_per_user: number;
  avg_total_tokens_per_user: number;
  total_sessions: number;
  avg_ttft_ms: number;
  avg_token_output_speed: number;
  avg_duration_ms: number;
  success_rate: number;
  error_rate: number;
}

export interface ActiveUsersDailyPoint {
  date: string;
  dau: number;
  wau: number;
  mau: number;
  dau_wau_ratio: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/active-users — DAU/WAU/MAU + stickiness. */
export interface DeptActiveUsersResp {
  dau: number;
  wau: number;
  mau: number;
  dau_wau_ratio: number;
  daily_trend: ActiveUsersDailyPoint[];
}

export interface DeptTrendPoint {
  date: string;
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  active_users: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/trend — per-day trend (requests / tokens / active users). */
export interface DeptTrendResp {
  trend: DeptTrendPoint[];
}

export interface DeptModelItem {
  model: string;
  request_count: number;
  request_pct: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  token_pct: number;
  input_output_ratio: number;
  success_rate: number;
  estimated_total_cost: number;
}

/** Auto-routing split (backend fields may be model/routed_model and
 *  count/request_count; kept loose here to match the source caliber). */
export interface AutoRoutingItem {
  model?: string;
  routed_model?: string;
  count?: number;
  request_count?: number;
  pct?: number;
  request_pct?: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/models/usage — per-model volume + share. */
export interface DeptModelsResp {
  models: DeptModelItem[];
  auto_routing: AutoRoutingItem[];
}

export interface WeekdayItem {
  weekday: number;
  weekday_name: string;
  request_count: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/distribution/weekly — by-weekday distribution. */
export interface DeptWeeklyResp {
  weekdays: WeekdayItem[];
}

export interface ResultModelItem {
  model: string;
  total_requests: number;
  error_requests: number;
  success_rate: number;
  error_rate: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/results — request outcomes (success/fail/per-model success rate). */
export interface DeptResultsResp {
  total_requests: number;
  success_requests: number;
  error_requests: number;
  success_rate: number;
  error_rate: number;
  models: ResultModelItem[];
}

export interface PeriodSpan {
  start: string;
  end: string;
  total_requests: number;
  sum_total_tokens: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/usage/period-compare — period-over-period change. */
export interface DeptPeriodCompareResp {
  current_period: PeriodSpan;
  previous_period: PeriodSpan;
  request_change_pct: number;
  token_change_pct: number;
}

export interface DeptMemberItem {
  universal_id: string;
  username?: string;
  /** Employee number (human-readable id, distinct from universal_id). */
  user_id?: string;
  total_requests: number;
  sum_prompt_tokens?: number;
  sum_completion_tokens?: number;
  sum_total_tokens: number;
  success_rate: number;
  avg_duration_ms?: number;
  active_days: number;
  estimated_total_cost?: number;
}

/** /api/v2/efficiency/usage/dept/:dept_id/members — paginated member list under the dept. */
export interface DeptMembersResp {
  dept_id: string;
  total: number;
  page: number;
  page_size: number;
  members: DeptMemberItem[];
}

// ---- Kanban-local mode usage (the single non-chat-stats card) ----

/** /api/v2/efficiency/usage/dept/:dept_id/mode-usage item: one conversation
 *  mode (conversations.mode) with deduped user count + request count. */
export interface DeptModeUsageItem {
  mode: string;
  user_count: number;
  request_count: number;
}

export interface DeptModeUsageResp {
  dept_id: string;
  items: DeptModeUsageItem[];
}

// ============================ Per-user ============================

export interface UserDetailRow {
  universal_id: string;
  username?: string;
  total_requests: number;
  success_requests: number;
  error_requests: number;
  success_rate: number;
  error_rate: number;
  sum_prompt_tokens: number;
  sum_completion_tokens: number;
  sum_total_tokens: number;
  sum_cache_tokens: number;
  total_sessions: number;
  active_days: number;
  avg_duration_ms: number;
  avg_ttft_ms: number;
  avg_token_output_speed: number;
  model_preference?: string;
  estimated_total_cost: number;
}

export interface UserDeptItem {
  user_id?: string;
  username?: string;
  dept_id: string;
  dept_name: string;
  is_main: number;
}

/** /api/v2/efficiency/usage/user/:uid/detail — full-dimension per-user detail. */
export interface UserDetailResp {
  user_detail: UserDetailRow;
  models: DeptModelItem[];
  auto_routing: AutoRoutingItem[];
  departments: UserDeptItem[];
}

/** /api/v2/efficiency/usage/user/:uid/trend point (fields align with daily_user_metrics_summary). */
export interface UserTrendPoint {
  date: string;
  total_requests?: number;
  success_requests?: number;
  error_requests?: number;
  sum_prompt_tokens?: number;
  sum_completion_tokens?: number;
  sum_total_tokens?: number;
  sum_cache_tokens?: number;
  unique_task_count?: number;
  avg_duration_ms?: number | null;
  avg_first_token_duration_ms?: number | null;
  estimated_total_cost?: number | null;
  estimated_input_cost?: number | null;
  estimated_output_cost?: number | null;
  estimated_cache_cost?: number | null;
  estimated_request_cost?: number | null;
  model_preference?: string | null;
  auto_router_breakdown?: string | null;
}
// Note: /api/v2/efficiency/usage/user/:uid/trend returns UserTrendPoint[]
// (the source normalizes a bare-array or {trend:[]} backend response into a
// flat array at the hook boundary).

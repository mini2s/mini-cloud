// ── Quota Module Type Definitions ───────────────────────────────────────────
// Mirrors the response shapes of the external quota-manager service:
//   GET /quota-manager/api/v1/quota
//   GET /quota-manager/api/v1/usage/statistics
// Field names intentionally match the upstream snake_case API.

/** A single quota batch with an amount and an expiry. */
export interface QuotaBatch {
  amount: number;
  expiry_date: string;
  source?: string;
}

/** One usage-consumption record (a single credit charge event). */
export interface UsageConsumptionRecord {
  id: number;
  user_id: string;
  model: string;
  mode: string;
  tokens: number;
  credits_used: number;
  package: string;
  record_time: string;
  create_time: string;
  update_time: string;
}

/** GET /quota-manager/api/v1/quota response data. */
export interface UserQuota {
  total_quota: number;
  used_quota: number;
  quota_list: QuotaBatch[];
}

/** Query params for GET /quota-manager/api/v1/usage/statistics. */
export interface UsageStatsParams {
  page: number;
  page_size: number;
  /** Preset: "today" | "7days" | "30days". Mutually exclusive with the custom range. */
  time_range?: string;
  /** Custom range start, formatted "YYYY-MM-DD HH:mm:ss". */
  start_time?: string;
  /** Custom range end, formatted "YYYY-MM-DD HH:mm:ss". */
  end_time?: string;
}

/** GET /quota-manager/api/v1/usage/statistics response data. */
export interface UsageStatsResult {
  records: UsageConsumptionRecord[];
  total: number;
  page: number;
  page_size: number;
}

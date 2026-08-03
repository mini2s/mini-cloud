// ── Personal quota data domain ─────────────────────────────────────────────
// queries.ts: quotaKeys key factory + queryOptions factories + query hooks.
// Types live centrally in packages/core/types/quota.ts.
//
// Backed by the external quota-manager service (reverse-proxied at
// /api/quota-manager/*). Powers the "My Quota" page (Personal Center).

export {
  quotaKeys,
  userQuotaQueryOptions,
  useUserQuota,
  usageStatsQueryOptions,
  useUsageStatistics,
} from "./queries";

export type {
  QuotaBatch,
  UsageConsumptionRecord,
  UserQuota,
  UsageStatsParams,
  UsageStatsResult,
} from "../types/quota";

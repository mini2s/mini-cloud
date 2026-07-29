import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { UsageStatsParams, UserQuota, UsageStatsResult } from "../types/quota";

// ── Query key factory ────────────────────────────────────────────────────
// Personal quota is user-scoped (not workspace-scoped), so there is no wsId
// segment. The quota-manager backend resolves "me" from the session cookie.

export const quotaKeys = {
  all: ["quota"] as const,
  /** The user's quota overview (used/total + per-batch validity list). */
  userQuota: () => [...quotaKeys.all, "user-quota"] as const,
  /** Paginated usage-consumption records. Keyed on the full params so each
   *  page / page-size / time-range / custom-window combination caches
   *  independently. */
  usageStats: (params: UsageStatsParams) => [...quotaKeys.all, "usage-stats", params] as const,
};

// ── Quota overview ───────────────────────────────────────────────────────

export function userQuotaQueryOptions() {
  return queryOptions({
    queryKey: quotaKeys.userQuota(),
    queryFn: async (): Promise<UserQuota> => api.quotaGetUserQuota(),
    staleTime: 60_000,
  });
}

export function useUserQuota() {
  return useQuery(userQuotaQueryOptions());
}

// ── Usage consumption ────────────────────────────────────────────────────

export function usageStatsQueryOptions(params: UsageStatsParams) {
  return queryOptions({
    queryKey: quotaKeys.usageStats(params),
    queryFn: async (): Promise<UsageStatsResult> => api.quotaGetUsageStatistics(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useUsageStatistics(params: UsageStatsParams) {
  return useQuery(usageStatsQueryOptions(params));
}

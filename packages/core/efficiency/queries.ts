import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getAllNeeds,
  getDashboardSummary,
  getDashboardTrends,
  getDeptRanking,
  getDeptTree,
  getGlobalConfig,
  getUsageDeptActiveUsers,
  getUsageDeptMembers,
  getUsageDeptModeUsage,
  getUsageDeptModels,
  getUsageDeptOverview,
  getUsageDeptResults,
  getUsageDeptTrend,
  getUsageDeptWeekly,
  getUsagePeriodCompare,
  getUsageUserDetail,
  getUsageUserTrend,
  getUsers,
} from "./api";
import { MOCK_ENABLED, mock } from "./mock";
import type { DeptQuery, MembersQuery } from "./types-usage";

// Query keys — workspace-scoped (wsId first) so cache isolates per workspace,
// matching the architectural rule "workspace-scoped queries must key on wsId".
export const efficiencyKeys = {
  all: (wsId: string) => ["efficiency", wsId] as const,
  summary: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "summary", startDate, endDate] as const,
  trends: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "trends", startDate, endDate] as const,
  config: (wsId: string) => [...efficiencyKeys.all(wsId), "config"] as const,
  deptTree: (wsId: string) => [...efficiencyKeys.all(wsId), "dept-tree"] as const,
  deptRanking: (
    wsId: string,
    parentDeptId?: string,
    startDate?: string,
    endDate?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "dept-ranking",
      parentDeptId,
      startDate,
      endDate,
    ] as const,
  allNeeds: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "all-needs", startDate, endDate] as const,
  users: (wsId: string, startDate?: string, endDate?: string, pageSize?: number) =>
    [...efficiencyKeys.all(wsId), "users", startDate, endDate, pageSize] as const,

  // ---- Usage dimension ----
  // Trailing field order mirrors the source usageData.ts queryKey exactly
  // (deptId, start, end, includeChildren[ + members paging/sort/search]) so
  // different depts/windows/cache-shape all isolate. The leading
  // ["efficiency", wsId, "usage", <segment>] makes them workspace-scoped.
  usageDeptOverview: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-overview",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptActiveUsers: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-active-users",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptTrend: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-trend",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptModels: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-models",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptWeekly: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-weekly",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptResults: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-results",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usagePeriodCompare: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-period-compare",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptModeUsage: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-mode-usage",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  usageDeptMembers: (wsId: string, q: MembersQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "dept-members",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
      q.page,
      q.pageSize,
      q.sortBy,
      q.sortOrder,
      q.search,
    ] as const,
  usageUserDetail: (wsId: string, uid: string, start: string, end: string) =>
    [
      ...efficiencyKeys.all(wsId),
      "usage",
      "user-detail",
      uid,
      start,
      end,
    ] as const,
  usageUserTrend: (wsId: string, uid: string, start: string, end: string) =>
    [...efficiencyKeys.all(wsId), "usage", "user-trend", uid, start, end] as const,
};

const STALE_TIME = 60 * 1000; // 1 min — matches dashboard rollup cadence

export function dashboardSummaryOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.summary(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.dashboardSummary({ startDate, endDate });
      return getDashboardSummary({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function dashboardTrendsOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.trends(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.dashboardTrends({ startDate, endDate });
      return getDashboardTrends({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function globalConfigOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.config(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.globalConfig();
      return getGlobalConfig();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

// Authoritative full department tree (date-independent). Source uses a longer
// 5min staleTime, but we keep the shared 1min cadence for cross-query cache
// consistency until the Overview page is wired.
export function deptTreeOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.deptTree(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.deptTree();
      return getDeptTree();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function deptRankingOptions(
  wsId: string,
  parentDeptId?: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.deptRanking(wsId, parentDeptId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.deptRanking({ parentDeptId, startDate, endDate });
      return getDeptRanking({ parentDeptId, startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function allNeedsOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.allNeeds(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.allNeeds({ startDate, endDate });
      return getAllNeeds({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function usersOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
  pageSize?: number,
) {
  return queryOptions({
    queryKey: efficiencyKeys.users(wsId, startDate, endDate, pageSize),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.users({ startDate, endDate, pageSize });
      return getUsers({ startDate, endDate, pageSize });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

// ============================ Usage dimension ============================
// Source hooks: useUsageDeptOverview / useUsageDeptActiveUsers /
// useUsageDeptTrend / useUsageDeptModels / useUsageDeptWeekly /
// useUsageDeptResults / useUsagePeriodCompare / useUsageDeptModeUsage /
// useUsageDeptMembers / useUsageUserDetail / useUsageUserTrend. Each becomes
// an xxxOptions(wsId, ...) queryOptions factory. enabled gates on wsId AND the
// dept/uid (matches source's enabled: !!q.deptId / !!uid). The members hook
// used keepPreviousData; queryOptions carries placeholderData: keepPreviousData
// to preserve that paging UX.

export function usageDeptOverviewOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptOverview(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptOverview(q);
      return getUsageDeptOverview(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptActiveUsersOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptActiveUsers(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptActiveUsers(q);
      return getUsageDeptActiveUsers(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptTrendOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptTrend(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptTrend(q);
      return getUsageDeptTrend(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptModelsOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptModels(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptModels(q);
      return getUsageDeptModels(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptWeeklyOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptWeekly(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptWeekly(q);
      return getUsageDeptWeekly(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptResultsOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptResults(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptResults(q);
      return getUsageDeptResults(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

// Period-over-period compare. The "previous" window is the equal-length span
// immediately before the current one (source computePreviousRange). The api
// stub takes the four boundary strings; the mock computes the previous window
// itself from q, so we only forward q to mock and (q, prev*) to api.
export function usagePeriodCompareOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usagePeriodCompare(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usagePeriodCompare(q);
      // computePreviousRange is duplicated in the real api path so the
      // backend receives explicit previous_start/previous_end; the mock
      // path's computePreviousRange lives in mock/usage.ts.
      const span =
        Math.round(
          (new Date(q.end + "T00:00:00").getTime() -
            new Date(q.start + "T00:00:00").getTime()) /
            86_400_000,
        ) + 1;
      const prevStart = addDays(q.start, -span);
      const prevEnd = addDays(q.start, -1);
      return getUsagePeriodCompare(q, prevStart, prevEnd);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptModeUsageOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptModeUsage(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptModeUsage(q);
      return getUsageDeptModeUsage(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function usageDeptMembersOptions(wsId: string, q: MembersQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptMembers(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptMembers(q);
      return getUsageDeptMembers(q);
    },
    enabled: !!wsId && !!q.deptId,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME,
  });
}

export function usageUserDetailOptions(
  wsId: string,
  uid: string,
  start: string,
  end: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.usageUserDetail(wsId, uid, start, end),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageUserDetail(uid, start, end);
      return getUsageUserDetail(uid, start, end);
    },
    enabled: !!wsId && !!uid,
    staleTime: STALE_TIME,
  });
}

export function usageUserTrendOptions(
  wsId: string,
  uid: string,
  start: string,
  end: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.usageUserTrend(wsId, uid, start, end),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageUserTrend(uid, start, end);
      return getUsageUserTrend(uid, start, end);
    },
    enabled: !!wsId && !!uid,
    staleTime: STALE_TIME,
  });
}

// ---- small date helpers local to the period-compare api path ----
function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// TODO(slice 3-6): add deptOverview/repos/commits/tasks/projects/cost/
// contribution options.

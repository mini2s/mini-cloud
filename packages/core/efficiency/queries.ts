import { queryOptions } from "@tanstack/react-query";
import {
  getAllNeeds,
  getDashboardSummary,
  getDashboardTrends,
  getDeptRanking,
  getDeptTree,
  getGlobalConfig,
  getUsers,
} from "./api";
import { MOCK_ENABLED, mock } from "./mock";

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

// TODO(slice 3-6): add deptOverview/repos/commits/tasks/projects/cost/
// contribution options.

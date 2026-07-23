import { queryOptions } from "@tanstack/react-query";
import { getDashboardSummary, getDashboardTrends, getGlobalConfig } from "./api";
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
      if (MOCK_ENABLED) {
        return {
          traditional_dev_lines_per_day: 500,
          cost_per_person_day: 2000,
          dashboard_title_prefix: "",
          chat_stats_enabled: false,
        };
      }
      return getGlobalConfig();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

// TODO(slice 3-6): add deptTree/deptRanking/deptOverview/users/repos/needs/
// commits/tasks/projects/cost/contribution options.

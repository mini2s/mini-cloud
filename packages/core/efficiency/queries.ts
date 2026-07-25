import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  getAllNeeds,
  getAllRepos,
  getAllUsers,
  getChatDatasources,
  getChatDetailQuery,
  getChatLogPreview,
  getChatModelTrend,
  getChatTraceLogs,
  getChatPricing,
  getChatRealtime,
  getChatSyncTasks,
  getChatSystemConfig,
  getChatUserTrend,
  getChatGlobalDaily,
  getChatCostTrend,
  getChatCacheHitRate,
  getChatModelCostRanking,
  getChatModelsUsage,
  getChatUsersRanking,
  getCommitDetailV2,
  getCostAnomaly,
  getCostMembers,
  getCostModelComposition,
  getCostModels,
  getCostModelTrend,
  getCostOverview,
  getCostPeriodCompare,
  getCostSubDepts,
  getCostTeamComposition,
  getCostTeamTrend,
  getDashboardSummary,
  getDashboardTrends,
  getDeptRanking,
  getDeptTree,
  getEfficiencyAggregate,
  getGlobalConfig,
  getNeedDetailV2,
  getNeedRepoOptions,
  getProjectDetail,
  getProjectList,
  getProjectNeeds,
  getProjectTrendV2,
  getRepoBranches,
  getRepoDetailV2,
  getRepoTrendV2,
  getTaskDetailV2,
  getUserNames,
  getUsageDeptActiveUsers,
  getUsageDeptMembers,
  getUsageDeptModeUsage,
  getUsageDeptModels,
  getUsageDeptOverview,
  getUsageDeptResults,
  getUsageDeptTrend,
  getUsageDeptWeekly,
  getUsageDeptPeriodCompare,
  getUserDetailV2,
  getUsageUserDetail,
  getUsageUserTrend,
  getUsers,
} from "./api";
import { MOCK_ENABLED, mock } from "./mock";
import { computePreviousRange } from "./utils/date";
import type { ChatDetailQueryReq } from "./types";
import type { DeptQuery, MembersQuery } from "./types-usage";
import type { CostMembersQuery } from "./types-cost";

/**
 * Trace-log query body (POST /stats/trace-logs). Mirrors the getChatTraceLogs
 * api.ts signature so the RealtimeQuery drawer can pass it straight through.
 * Shared here so both the queryKey factory and the options factory stay in sync.
 */
export interface ChatTraceLogReq {
  datasource_id: string;
  request_id: string;
  label_selector?: string;
  start_time: string;
  end_time: string;
  limit?: number;
  cursor?: string;
}

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
  // Display-name roster (date-independent); resolves user_id → "真名(工号)".
  userNames: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "user-names"] as const,

  // ---- Efficiency dimension (aggregate + non-paginated full lists) ----
  efficiencyAggregate: (
    wsId: string,
    startDate?: string,
    endDate?: string,
    userId?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "efficiency-aggregate",
      startDate,
      endDate,
      userId,
    ] as const,
  allUsers: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "all-users", startDate, endDate] as const,
  allRepos: (wsId: string, startDate?: string, endDate?: string) =>
    [...efficiencyKeys.all(wsId), "all-repos", startDate, endDate] as const,
  projectList: (
    wsId: string,
    startDate?: string,
    endDate?: string,
    order?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "project-list",
      startDate,
      endDate,
      order,
    ] as const,

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
  usageDeptPeriodCompare: (wsId: string, q: DeptQuery) =>
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

  // ---- Cost dimension ----
  // Same trailing-field shape as usage (deptId, start, end, includeChildren
  // [+ members paging/sort/search]) so different depts/windows/cache-shape all
  // isolate. The leading ["efficiency", wsId, "cost", <segment>] keeps them
  // workspace-scoped and distinct from usage keys.
  costOverview: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "overview",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costPeriodCompare: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "period-compare",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costModels: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "models",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costModelTrend: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "model-trend",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costModelComposition: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "model-composition",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costAnomaly: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "anomaly",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costSubDepts: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "sub-depts",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costTeamTrend: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "team-trend",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costTeamComposition: (wsId: string, q: DeptQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "team-composition",
      q.deptId,
      q.start,
      q.end,
      q.includeChildren,
    ] as const,
  costMembers: (wsId: string, q: CostMembersQuery) =>
    [
      ...efficiencyKeys.all(wsId),
      "cost",
      "members",
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

  // ---- Detail dimension (per-entity drill-downs) ----
  // Workspace-scoped (wsId first) so cache isolates per workspace; the trailing
  // id/window fields mirror the source queryKey shapes so different entities /
  // branches / windows all isolate.
  userDetail: (
    wsId: string,
    userId: string,
    startDate?: string,
    endDate?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "detail",
      "user",
      userId,
      startDate,
      endDate,
    ] as const,
  repoDetail: (
    wsId: string,
    p: { repoAddr: string; repoBranch?: string; startDate?: string; endDate?: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "detail",
      "repo",
      p.repoAddr,
      p.repoBranch,
      p.startDate,
      p.endDate,
    ] as const,
  repoBranches: (wsId: string, repoAddr: string) =>
    [...efficiencyKeys.all(wsId), "detail", "repo-branches", repoAddr] as const,
  repoTrend: (
    wsId: string,
    p: { repoAddr?: string; startDate?: string; endDate?: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "detail",
      "repo-trend",
      p.repoAddr,
      p.startDate,
      p.endDate,
    ] as const,
  projectDetail: (wsId: string, projectId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "project", projectId] as const,
  projectTrend: (
    wsId: string,
    p: { projectId?: string; startDate?: string; endDate?: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "detail",
      "project-trend",
      p.projectId,
      p.startDate,
      p.endDate,
    ] as const,
  projectNeeds: (wsId: string, projectId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "project-needs", projectId] as const,
  needDetail: (wsId: string, needId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "need", needId] as const,
  taskDetail: (wsId: string, taskId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "task", taskId] as const,
  commitDetail: (wsId: string, commitId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "commit", commitId] as const,
  // Project "add source" repo selector (need-repo-options). Workspace-scoped,
  // date-independent.
  needRepoOptions: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "detail", "need-repo-options"] as const,

  // ---- Chat dimension (chat-settings + platform-ops pages) ----
  // Workspace-scoped (wsId first). The settings reads are parameterless
  // (pricing/datasources/sync-tasks/config); the platform-ops reads carry
  // their filter shape (range/datasourceId, uid/window, models, req, path).
  chatPricing: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "chat", "pricing"] as const,
  chatDatasources: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "chat", "datasources"] as const,
  chatSyncTasks: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "chat", "sync-tasks"] as const,
  chatSystemConfig: (wsId: string) =>
    [...efficiencyKeys.all(wsId), "chat", "system-config"] as const,
  chatRealtime: (
    wsId: string,
    p: { range: "30m" | "1h" | "3h"; datasourceId?: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "realtime",
      p.range,
      p.datasourceId,
    ] as const,
  chatModelTrend: (
    wsId: string,
    p: { startDate: string; endDate: string; models?: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "model-trend",
      p.startDate,
      p.endDate,
      p.models,
    ] as const,
  chatUserTrend: (
    wsId: string,
    uid: string,
    p: { startDate: string; endDate: string },
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "user-trend",
      uid,
      p.startDate,
      p.endDate,
    ] as const,
  chatDetailQuery: (wsId: string, req: ChatDetailQueryReq) =>
    [...efficiencyKeys.all(wsId), "chat", "detail-query", req] as const,
  chatLogPreview: (wsId: string, localLogPath: string) =>
    [...efficiencyKeys.all(wsId), "chat", "log-preview", localLogPath] as const,
  chatTraceLogs: (wsId: string, req: ChatTraceLogReq) =>
    [...efficiencyKeys.all(wsId), "chat", "trace-logs", req] as const,
  // ---- Chat dimension: platform overview historical stats (/stats/*) ----
  // Per-day series + ranked lists. Window (start/end) always part of the key;
  // cost-trend additionally keys on model filter, users-ranking on sort + search.
  chatGlobalDaily: (wsId: string, startDate: string, endDate: string) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "global-daily",
      startDate,
      endDate,
    ] as const,
  chatCostTrend: (
    wsId: string,
    startDate: string,
    endDate: string,
    model?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "cost-trend",
      startDate,
      endDate,
      model,
    ] as const,
  chatCacheHitRate: (wsId: string, startDate: string, endDate: string) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "cache-hit-rate",
      startDate,
      endDate,
    ] as const,
  chatModelCostRanking: (wsId: string, startDate: string, endDate: string) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "model-cost-ranking",
      startDate,
      endDate,
    ] as const,
  chatModelsUsage: (wsId: string, startDate: string, endDate: string) =>
    [...efficiencyKeys.all(wsId), "chat", "models-usage", startDate, endDate] as const,
  chatUsersRanking: (
    wsId: string,
    startDate: string,
    endDate: string,
    sortBy?: string,
    search?: string,
  ) =>
    [
      ...efficiencyKeys.all(wsId),
      "chat",
      "users-ranking",
      startDate,
      endDate,
      sortBy,
      search,
    ] as const,
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

// Display-name roster. Date-independent and rarely changing (dept-sync roster),
// so it uses a longer 5min staleTime than the shared 1min cadence — the source
// useUserNameMap treated this as a near-static lookup table.
export function userNamesOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.userNames(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.userNames();
      return getUserNames();
    },
    enabled: !!wsId,
    staleTime: 5 * 60 * 1000,
  });
}

// ============================ Efficiency dimension ============================
// Source hooks: useEfficiencyV2 / useAllUsers / useAllRepos / useProjectList.
// Each becomes an xxxOptions(wsId, ...) queryOptions factory. allUsers/allRepos
// are the NON-paginated "fetch everything" variants (source paginated
// internally + flattened) used for client-side ranking/distribution; distinct
// from the paginated usersOptions (which returns the ApiList envelope).
// enabled gates on wsId only (matches the source hooks' no-extra-gating).

export function efficiencyAggregateOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
  userId?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.efficiencyAggregate(
      wsId,
      startDate,
      endDate,
      userId,
    ),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.efficiencyAggregate({ startDate, endDate, userId });
      return getEfficiencyAggregate({ startDate, endDate, userId });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function allUsersOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.allUsers(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.allUsers({ startDate, endDate });
      return getAllUsers({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function allReposOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.allRepos(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.allRepos({ startDate, endDate });
      return getAllRepos({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function projectListOptions(
  wsId: string,
  startDate?: string,
  endDate?: string,
  order?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.projectList(wsId, startDate, endDate, order),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.projectList({ order, startDate, endDate });
      return getProjectList({ order, startDate, endDate });
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
// immediately before the current one, computed once via the shared
// computePreviousRange util (same rule used by the mock path, so the business
// logic lives in one place). The api stub takes the four boundary strings; the
// mock computes the previous window itself from q.
export function usageDeptPeriodCompareOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.usageDeptPeriodCompare(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.usageDeptPeriodCompare(q);
      const [prevStart, prevEnd] = computePreviousRange(q.start, q.end);
      return getUsageDeptPeriodCompare(q, prevStart, prevEnd);
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

// ============================ Cost dimension ============================
// Source hooks: useCostOverview / useCostPeriodCompare / useCostModels /
// useCostModelTrend / useCostModelComposition / useCostAnomaly /
// useCostSubDepts / useCostTeamTrend / useCostTeamComposition /
// useCostMembers. Each becomes an xxxOptions(wsId, q) queryOptions factory.
// enabled gates on wsId AND deptId (matches source's enabled: !!q.deptId).
// The members hook used keepPreviousData; queryOptions carries
// placeholderData: keepPreviousData to preserve that paging UX. Cost reuses
// the usage DeptQuery; costPeriodCompare computes the previous window via
// the shared computePreviousRange util (one place for the business rule).

export function costOverviewOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costOverview(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costOverview(q);
      return getCostOverview(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

// Period-over-period compare. The "previous" window is the equal-length span
// immediately before the current one, computed once via the shared
// computePreviousRange util (same rule used by the mock path). The api stub
// takes the four boundary strings; the mock computes the previous window
// itself from q.
export function costPeriodCompareOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costPeriodCompare(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costPeriodCompare(q);
      const [prevStart, prevEnd] = computePreviousRange(q.start, q.end);
      return getCostPeriodCompare(q, prevStart, prevEnd);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costModelsOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costModels(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costModels(q);
      return getCostModels(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costModelTrendOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costModelTrend(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costModelTrend(q);
      return getCostModelTrend(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costModelCompositionOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costModelComposition(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costModelComposition(q);
      return getCostModelComposition(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costAnomalyOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costAnomaly(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costAnomaly(q);
      return getCostAnomaly(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costSubDeptsOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costSubDepts(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costSubDepts(q);
      return getCostSubDepts(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costTeamTrendOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costTeamTrend(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costTeamTrend(q);
      return getCostTeamTrend(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costTeamCompositionOptions(wsId: string, q: DeptQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costTeamComposition(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costTeamComposition(q);
      return getCostTeamComposition(q);
    },
    enabled: !!wsId && !!q.deptId,
    staleTime: STALE_TIME,
  });
}

export function costMembersOptions(wsId: string, q: CostMembersQuery) {
  return queryOptions({
    queryKey: efficiencyKeys.costMembers(wsId, q),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.costMembers(q);
      return getCostMembers(q);
    },
    enabled: !!wsId && !!q.deptId,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME,
  });
}

// ============================ Detail dimension ============================
// Source hooks: useUserDetail / useRepoDetail / useRepoBranches / useRepoTrend /
// useProjectDetail / useProjectTrend / useProjectNeeds / useNeedDetail /
// useTaskDetail / useCommitDetail. Each becomes an xxxOptions(wsId, ...)
// queryOptions factory. enabled gates on wsId AND the entity id (matches the
// source hooks' enabled: !!id / !!repoAddr). repoDetail/branches/trend carry
// repoAddr; userDetail carries an optional window; the trends accept an empty
// repoAddr/projectId for the "all entities" aggregate view (enabled gate stays
// wsId-only for those, matching source).

export function userDetailOptions(
  wsId: string,
  userId: string,
  startDate?: string,
  endDate?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.userDetail(wsId, userId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.userDetail(userId, { startDate, endDate });
      return getUserDetailV2(userId, { startDate, endDate });
    },
    enabled: !!wsId && !!userId,
    staleTime: STALE_TIME,
  });
}

export function repoDetailOptions(
  wsId: string,
  p: { repoAddr: string; repoBranch?: string; startDate?: string; endDate?: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.repoDetail(wsId, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.repoDetail(p);
      return getRepoDetailV2(p);
    },
    enabled: !!wsId && !!p.repoAddr,
    staleTime: STALE_TIME,
  });
}

export function repoBranchesOptions(wsId: string, repoAddr: string) {
  return queryOptions({
    queryKey: efficiencyKeys.repoBranches(wsId, repoAddr),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.repoBranches(repoAddr);
      return getRepoBranches(repoAddr);
    },
    enabled: !!wsId && !!repoAddr,
    staleTime: STALE_TIME,
  });
}

export function repoTrendOptions(
  wsId: string,
  p: { repoAddr?: string; startDate?: string; endDate?: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.repoTrend(wsId, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.repoTrend(p);
      return getRepoTrendV2(p);
    },
    // source useRepoTrend has no id gate (repoAddr empty = all repos); wsId-only.
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function projectDetailOptions(wsId: string, projectId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.projectDetail(wsId, projectId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.projectDetail(projectId);
      return getProjectDetail(projectId);
    },
    enabled: !!wsId && !!projectId,
    staleTime: STALE_TIME,
  });
}

export function projectTrendOptions(
  wsId: string,
  p: { projectId?: string; startDate?: string; endDate?: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.projectTrend(wsId, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.projectTrend(p);
      return getProjectTrendV2(p);
    },
    // source useProjectTrend has no id gate (projectId empty = all projects); wsId-only.
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function projectNeedsOptions(wsId: string, projectId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.projectNeeds(wsId, projectId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.projectNeeds(projectId);
      return getProjectNeeds(projectId);
    },
    enabled: !!wsId && !!projectId,
    staleTime: STALE_TIME,
  });
}

// Project "add source" repo selector (need-repo-options). wsId-only gate;
// date-independent (the candidate pool is configured server-side).
export function needRepoOptionsOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.needRepoOptions(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.needRepoOptions();
      return getNeedRepoOptions();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function needDetailOptions(wsId: string, needId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.needDetail(wsId, needId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.needDetail(needId);
      return getNeedDetailV2(needId);
    },
    enabled: !!wsId && !!needId,
    staleTime: STALE_TIME,
  });
}

export function taskDetailOptions(wsId: string, taskId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.taskDetail(wsId, taskId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.taskDetail(taskId);
      return getTaskDetailV2(taskId);
    },
    enabled: !!wsId && !!taskId,
    staleTime: STALE_TIME,
  });
}

export function commitDetailOptions(wsId: string, commitId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.commitDetail(wsId, commitId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.commitDetail(commitId);
      return getCommitDetailV2(commitId);
    },
    enabled: !!wsId && !!commitId,
    staleTime: STALE_TIME,
  });
}

// ============================ Chat dimension ============================
// Source hooks: useChatPricing / useChatDatasources / useChatSyncTasks /
// useChatSystemConfig / useChatRealtime + inline useQuery calls for
// chatStats.modelTrend / chatStats.userTrend / chatStats.queryDetail /
// chatStats.previewLog. Each becomes an xxxOptions(wsId, ...) queryOptions
// factory. The settings reads are parameterless; the platform-ops reads carry
// their filter shape. enabled gates on wsId (and the path/uid for
// log-preview / user-trend). Mutations are NOT queryOptions — they stay as
// direct api.ts calls in the UI (the source did the same: page-level
// mutationFn calling chatStats.createPricing etc.).
//
// The source useChatRealtime turned off auto-refetch (server 10s rate limit)
// and used staleTime 10s; that page-level behavior is preserved by carrying
// the shared STALE_TIME here and letting the page drive manual refresh.

export function chatPricingOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.chatPricing(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatPricing();
      return getChatPricing();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatDatasourcesOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.chatDatasources(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatDatasources();
      return getChatDatasources();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatSyncTasksOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.chatSyncTasks(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatSyncTasks();
      return getChatSyncTasks();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatSystemConfigOptions(wsId: string) {
  return queryOptions({
    queryKey: efficiencyKeys.chatSystemConfig(wsId),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatSystemConfig();
      return getChatSystemConfig();
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatRealtimeOptions(
  wsId: string,
  p: { range: "30m" | "1h" | "3h"; datasourceId?: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatRealtime(wsId, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatRealtime(p);
      return getChatRealtime(p);
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatModelTrendOptions(
  wsId: string,
  p: { startDate: string; endDate: string; models?: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatModelTrend(wsId, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatModelTrend(p);
      return getChatModelTrend(p);
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatUserTrendOptions(
  wsId: string,
  uid: string,
  p: { startDate: string; endDate: string },
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatUserTrend(wsId, uid, p),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatUserTrend(uid, p);
      return getChatUserTrend(uid, p);
    },
    enabled: !!wsId && !!uid,
    staleTime: STALE_TIME,
  });
}

export function chatDetailQueryOptions(wsId: string, req: ChatDetailQueryReq) {
  return queryOptions({
    queryKey: efficiencyKeys.chatDetailQuery(wsId, req),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatDetailQuery(req);
      return getChatDetailQuery(req);
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatLogPreviewOptions(wsId: string, localLogPath: string) {
  return queryOptions({
    queryKey: efficiencyKeys.chatLogPreview(wsId, localLogPath),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatLogPreview(localLogPath);
      return getChatLogPreview(localLogPath);
    },
    enabled: !!wsId && !!localLogPath,
    staleTime: STALE_TIME,
  });
}

// Trace-log query (Loki datasource). Backs the RealtimeQuery "链路日志" drawer:
// when a row is selected the drawer fetches that request_id's log lines scoped
// to the committed query window. enabled gates on wsId + a non-empty request_id
// + a datasource (the drawer won't open without one).
export function chatTraceLogsOptions(wsId: string, req: ChatTraceLogReq) {
  return queryOptions({
    queryKey: efficiencyKeys.chatTraceLogs(wsId, req),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatTraceLogs(req);
      return getChatTraceLogs(req);
    },
    enabled:
      !!wsId && !!req.request_id && !!req.datasource_id && !!req.start_time,
    staleTime: STALE_TIME,
  });
}

// ============================ Chat dimension: platform overview historical stats ============================
// Source: PlatformOverview.tsx inline useQuery calls to /stats/* . Each becomes
// an xxxOptions(wsId, ...) queryOptions factory. All take a start/end window;
// cost-trend additionally takes an optional model filter, users-ranking an
// optional sort_by + search. enabled gates on wsId only (the page gates on the
// active tab/range itself before calling useQuery).

export function chatGlobalDailyOptions(
  wsId: string,
  startDate: string,
  endDate: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatGlobalDaily(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatGlobalDaily({ startDate, endDate });
      return getChatGlobalDaily({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatCostTrendOptions(
  wsId: string,
  startDate: string,
  endDate: string,
  model?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatCostTrend(wsId, startDate, endDate, model),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.chatCostTrend({ startDate, endDate, model });
      return getChatCostTrend({ startDate, endDate, model });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatCacheHitRateOptions(
  wsId: string,
  startDate: string,
  endDate: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatCacheHitRate(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatCacheHitRate({ startDate, endDate });
      return getChatCacheHitRate({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatModelCostRankingOptions(
  wsId: string,
  startDate: string,
  endDate: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatModelCostRanking(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.chatModelCostRanking({ startDate, endDate });
      return getChatModelCostRanking({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatModelsUsageOptions(
  wsId: string,
  startDate: string,
  endDate: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatModelsUsage(wsId, startDate, endDate),
    queryFn: async () => {
      if (MOCK_ENABLED) return mock.chatModelsUsage({ startDate, endDate });
      return getChatModelsUsage({ startDate, endDate });
    },
    enabled: !!wsId,
    staleTime: STALE_TIME,
  });
}

export function chatUsersRankingOptions(
  wsId: string,
  startDate: string,
  endDate: string,
  sortBy?: string,
  search?: string,
) {
  return queryOptions({
    queryKey: efficiencyKeys.chatUsersRanking(
      wsId,
      startDate,
      endDate,
      sortBy,
      search,
    ),
    queryFn: async () => {
      if (MOCK_ENABLED)
        return mock.chatUsersRanking({ startDate, endDate, sortBy, search });
      return getChatUsersRanking({ startDate, endDate, sortBy, search });
    },
    enabled: !!wsId,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME,
  });
}

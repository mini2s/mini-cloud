// Mock data layer. Injected at the queryOptions layer (see queries.ts):
// when MOCK_ENABLED is true, queryFn returns mock data instead of hitting
// the API. Flip EFFICIENCY_MOCK=0 in env to disable once the backend
// /api/v2/efficiency/* endpoints are live.
import type {
  ApiList,
  DashboardSummary,
  DashboardTrends,
  DeptRankingResponse,
  DeptTreeNode,
  GlobalConfig,
  NeedsV2Summary,
  UserV2Row,
} from "../types";
import type {
  DeptActiveUsersResp,
  DeptMembersResp,
  DeptModeUsageResp,
  DeptModelsResp,
  DeptOverviewResp,
  DeptPeriodCompareResp,
  DeptQuery,
  DeptResultsResp,
  DeptTrendResp,
  DeptWeeklyResp,
  MembersQuery,
  UserDetailResp,
  UserTrendPoint,
} from "../types-usage";
import type {
  CostAnomalyResp,
  CostMembersQuery,
  CostModelCompositionResp,
  CostModelsResp,
  CostModelTrendResp,
  CostOverviewResp,
  CostPeriodCompareResp,
  CostSubDeptResp,
  CostTeamCompositionResp,
  CostTeamTrendResp,
  CostUsersResp,
} from "../types-cost";
import {
  getMockDashboardSummary,
  getMockDashboardTrends,
  getMockGlobalConfig,
} from "./dashboard";
import { getMockDeptRanking, getMockDeptTree } from "./dept";
import { getMockAllNeeds } from "./needs";
import { getMockUsers } from "./users";
import {
  getMockUsageDeptActiveUsers,
  getMockUsageDeptMembers,
  getMockUsageDeptModeUsage,
  getMockUsageDeptModels,
  getMockUsageDeptOverview,
  getMockUsageDeptResults,
  getMockUsageDeptTrend,
  getMockUsageDeptWeekly,
  getMockUsagePeriodCompare,
  getMockUsageUserDetail,
  getMockUsageUserTrend,
} from "./usage";
import {
  getMockCostAnomaly,
  getMockCostMembers,
  getMockCostModelComposition,
  getMockCostModels,
  getMockCostModelTrend,
  getMockCostOverview,
  getMockCostPeriodCompare,
  getMockCostSubDepts,
  getMockCostTeamComposition,
  getMockCostTeamTrend,
} from "./cost";

const RAW = process.env.EFFICIENCY_MOCK;
// Default: mock ON (backend not yet live). Set EFFICIENCY_MOCK=0 to disable.
export const MOCK_ENABLED = RAW == null ? true : RAW !== "0" && RAW !== "false";

export const mock = {
  dashboardSummary: (p: { startDate?: string; endDate?: string }): DashboardSummary =>
    getMockDashboardSummary(p),
  dashboardTrends: (p: { startDate?: string; endDate?: string }): DashboardTrends =>
    getMockDashboardTrends(p),
  globalConfig: (): GlobalConfig => getMockGlobalConfig(),
  deptTree: (): DeptTreeNode[] => getMockDeptTree(),
  deptRanking: (p: {
    parentDeptId?: string;
    startDate?: string;
    endDate?: string;
  }): DeptRankingResponse => getMockDeptRanking(p),
  allNeeds: (p: {
    startDate?: string;
    endDate?: string;
  }): NeedsV2Summary[] => getMockAllNeeds(p),
  users: (p: {
    startDate?: string;
    endDate?: string;
    pageSize?: number;
  }): ApiList<UserV2Row> => getMockUsers(p),

  // ---- Usage dimension (department aggregation + per-user) ----
  usageDeptOverview: (q: DeptQuery): DeptOverviewResp =>
    getMockUsageDeptOverview(q),
  usageDeptActiveUsers: (q: DeptQuery): DeptActiveUsersResp =>
    getMockUsageDeptActiveUsers(q),
  usageDeptTrend: (q: DeptQuery): DeptTrendResp => getMockUsageDeptTrend(q),
  usageDeptModels: (q: DeptQuery): DeptModelsResp => getMockUsageDeptModels(q),
  usageDeptWeekly: (q: DeptQuery): DeptWeeklyResp => getMockUsageDeptWeekly(q),
  usageDeptResults: (q: DeptQuery): DeptResultsResp => getMockUsageDeptResults(q),
  // Period-compare mock computes the previous window internally from q.start/q.end
  // (mirrors the source computePreviousRange), so it only needs q.
  usageDeptPeriodCompare: (q: DeptQuery): DeptPeriodCompareResp =>
    getMockUsagePeriodCompare(q),
  usageDeptModeUsage: (q: DeptQuery): DeptModeUsageResp =>
    getMockUsageDeptModeUsage(q),
  usageDeptMembers: (q: MembersQuery): DeptMembersResp =>
    getMockUsageDeptMembers(q),
  usageUserDetail: (
    uid: string,
    start: string,
    end: string,
  ): UserDetailResp => getMockUsageUserDetail(uid, start, end),
  usageUserTrend: (
    uid: string,
    start: string,
    end: string,
  ): UserTrendPoint[] => getMockUsageUserTrend(uid, start, end),

  // ---- Cost dimension (department aggregation + model/team breakdown + per-user) ----
  costOverview: (q: DeptQuery): CostOverviewResp => getMockCostOverview(q),
  // Period-compare mock computes the previous window internally from q.start/q.end
  // (via the shared computePreviousRange), so it only needs q.
  costPeriodCompare: (q: DeptQuery): CostPeriodCompareResp =>
    getMockCostPeriodCompare(q),
  costModels: (q: DeptQuery): CostModelsResp => getMockCostModels(q),
  costModelTrend: (q: DeptQuery): CostModelTrendResp => getMockCostModelTrend(q),
  costModelComposition: (q: DeptQuery): CostModelCompositionResp =>
    getMockCostModelComposition(q),
  costAnomaly: (q: DeptQuery): CostAnomalyResp => getMockCostAnomaly(q),
  costSubDepts: (q: DeptQuery): CostSubDeptResp => getMockCostSubDepts(q),
  costTeamTrend: (q: DeptQuery): CostTeamTrendResp => getMockCostTeamTrend(q),
  costTeamComposition: (q: DeptQuery): CostTeamCompositionResp =>
    getMockCostTeamComposition(q),
  costMembers: (q: CostMembersQuery): CostUsersResp => getMockCostMembers(q),
  // contribution/detail mock entry points added in later slices.
} as const;

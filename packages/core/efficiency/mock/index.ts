// Mock data layer. Injected at the queryOptions layer (see queries.ts):
// when MOCK_ENABLED is true, queryFn returns mock data instead of hitting
// the API. Flip EFFICIENCY_MOCK=0 in env to disable once the backend
// /api/v2/efficiency/* endpoints are live.
import type {
  ApiData,
  ApiList,
  ChatDatasource,
  ChatDetailQueryReq,
  ChatDetailQueryResponse,
  ChatLogPreviewResponse,
  ChatModelTrendSeries,
  ChatRealtimeResponse,
  ChatSyncTaskListResponse,
  ChatSystemConfig,
  ChatUserTrendRow,
  CommitDetailResponse,
  DashboardSummary,
  DashboardTrends,
  DeptRankingResponse,
  DeptTreeNode,
  EfficiencyV2AggregateResponse,
  EntityTrendResponse,
  GlobalConfig,
  ModelPricing,
  NeedRepoOption,
  NeedsV2DetailResponse,
  NeedsV2Summary,
  ProjectDetailResponse,
  ProjectListItem,
  ProjectNeedsResponse,
  RepoBranchesResponse,
  RepoDetailResponse,
  RepoListItem,
  TaskDetailResponse,
  UserV2DetailResponse,
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
import {
  getMockCommitDetail,
  getMockNeedDetail,
  getMockNeedRepoOptions,
  getMockProjectDetail,
  getMockProjectNeeds,
  getMockProjectTrend,
  getMockRepoBranches,
  getMockRepoDetail,
  getMockRepoTrend,
  getMockTaskDetail,
  getMockUserDetail,
} from "./detail";
import { getMockDeptRanking, getMockDeptTree } from "./dept";
import {
  getMockAllRepos,
  getMockAllUsers,
  getMockEfficiencyAggregate,
  getMockProjectList,
} from "./efficiency";
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
import {
  getMockChatDatasources,
  getMockChatDetailQuery,
  getMockChatLogPreview,
  getMockChatModelTrend,
  getMockChatPricing,
  getMockChatRealtime,
  getMockChatSyncTasks,
  getMockChatSystemConfig,
  getMockChatUserTrend,
} from "./chat";

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

  // ---- Efficiency dimension (aggregate + non-paginated full lists) ----
  efficiencyAggregate: (p: {
    startDate?: string;
    endDate?: string;
    userId?: string;
  }): EfficiencyV2AggregateResponse => getMockEfficiencyAggregate(p),
  allUsers: (p: {
    startDate?: string;
    endDate?: string;
  }): UserV2Row[] => getMockAllUsers(p),
  allRepos: (p: {
    startDate?: string;
    endDate?: string;
  }): RepoListItem[] => getMockAllRepos(p),
  projectList: (p: {
    order?: string;
    startDate?: string;
    endDate?: string;
  }): ProjectListItem[] => getMockProjectList(p),

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

  // ---- Detail dimension (per-entity drill-downs) ----
  userDetail: (
    userId: string,
    p: { startDate?: string; endDate?: string },
  ): UserV2DetailResponse => getMockUserDetail(userId, p),
  repoDetail: (p: {
    repoAddr: string;
    repoBranch?: string;
    startDate?: string;
    endDate?: string;
  }): RepoDetailResponse => getMockRepoDetail(p),
  repoBranches: (repoAddr: string): RepoBranchesResponse =>
    getMockRepoBranches(repoAddr),
  repoTrend: (p: {
    repoAddr?: string;
    startDate?: string;
    endDate?: string;
  }): EntityTrendResponse => getMockRepoTrend(p),
  projectDetail: (projectId: string): ProjectDetailResponse =>
    getMockProjectDetail(projectId),
  projectTrend: (p: {
    projectId?: string;
    startDate?: string;
    endDate?: string;
  }): EntityTrendResponse => getMockProjectTrend(p),
  projectNeeds: (projectId: string): ProjectNeedsResponse =>
    getMockProjectNeeds(projectId),
  needRepoOptions: (): ApiData<NeedRepoOption> => getMockNeedRepoOptions(),
  needDetail: (needId: string): NeedsV2DetailResponse =>
    getMockNeedDetail(needId),
  taskDetail: (taskId: string): TaskDetailResponse => getMockTaskDetail(taskId),
  commitDetail: (commitId: string): CommitDetailResponse =>
    getMockCommitDetail(commitId),

  // ---- Chat dimension (chat-settings + platform-ops pages) ----
  // Read entries only. Mutations (upsert/delete pricing|datasource|config,
  // submit/retry/cancel sync, test datasource) are NOT mocked — their api.ts
  // stubs throw NOT_WIRED, so the settings forms won't submit in the mock
  // phase. That's intentional until the live backend is wired.
  chatPricing: (): ModelPricing[] => getMockChatPricing(),
  chatDatasources: (): ChatDatasource[] => getMockChatDatasources(),
  chatSyncTasks: (): ChatSyncTaskListResponse => getMockChatSyncTasks(),
  chatSystemConfig: (): ChatSystemConfig => getMockChatSystemConfig(),
  chatRealtime: (p: {
    range: "30m" | "1h" | "3h";
    datasourceId?: string;
  }): ChatRealtimeResponse => getMockChatRealtime(p),
  chatModelTrend: (p: {
    startDate: string;
    endDate: string;
    models?: string;
  }): ChatModelTrendSeries[] => getMockChatModelTrend(p),
  chatUserTrend: (
    uid: string,
    p: { startDate: string; endDate: string },
  ): ChatUserTrendRow[] => getMockChatUserTrend(uid, p),
  chatDetailQuery: (req: ChatDetailQueryReq): ChatDetailQueryResponse =>
    getMockChatDetailQuery(req),
  chatLogPreview: (localLogPath: string): ChatLogPreviewResponse =>
    getMockChatLogPreview(localLogPath),
} as const;

// Endpoint methods for /api/v2/efficiency/*. The mini-cloud backend will
// mount these routes once live. During the mock phase (MOCK_ENABLED=true,
// default) queries.ts never calls these — it returns mock data instead.
//
// The shared ApiClient's fetch is private, so these wrap calls that will be
// added as ApiClient methods (or a dedicated efficiency transport) when the
// backend lands. Until then the false-MOCK path throws a clear error.
import type {
  ApiList,
  DashboardSummary,
  DashboardTrends,
  DeptRankingResponse,
  DeptTreeNode,
  GlobalConfig,
  ListParams,
  NeedsV2Summary,
  UserV2Row,
} from "./types";
import type {
  DeptActiveUsersResp,
  DeptMembersResp,
  DeptModeUsageResp,
  DeptModelsResp,
  DeptOverviewResp,
  DeptPeriodCompareResp,
  DeptResultsResp,
  DeptTrendResp,
  DeptWeeklyResp,
  DeptQuery,
  MembersQuery,
  UserDetailResp,
  UserTrendPoint,
} from "./types-usage";
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
} from "./types-cost";

const BASE = "/api/v2/efficiency";
const NOT_WIRED =
  "Efficiency backend not yet wired — re-enable mock with EFFICIENCY_MOCK=1, or wire up /api/v2/efficiency/* endpoints (slice 7+).";

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
}

// TODO(slice 7+): replace these stubs with real calls once the backend
// mounts /api/v2/efficiency/*. Likely add ApiClient methods (mirroring
// getDashboardUsageDaily) or a dedicated efficiency fetch path.
export async function getDashboardSummary(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardSummary> {
  void `${BASE}/dashboard/summary${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

export async function getDashboardTrends(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardTrends> {
  void `${BASE}/dashboard/trends${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

export async function getGlobalConfig(): Promise<GlobalConfig> {
  void `${BASE}/config`;
  throw new Error(NOT_WIRED);
}

// Authoritative full department tree (proxy of dept-sync /department/tree);
// date-independent. Returns a forest (array of roots).
export async function getDeptTree(): Promise<DeptTreeNode[]> {
  void `${BASE}/dept-tree`;
  throw new Error(NOT_WIRED);
}

// One-shot ranking: each direct child department of parentDeptId with its
// whole-subtree conserved summary. parentDeptId empty => configured root.
export async function getDeptRanking(p: {
  parentDeptId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<DeptRankingResponse> {
  void `${BASE}/dept-tree/ranking${qs({
    parent_dept_id: p.parentDeptId,
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// Paginated fetch of the entire needs list (caller drives pagination; mirrors
// the source getAllNeedsV2 helper which loops pages internally). Returns a
// bare array of merged rows.
export async function getAllNeeds(p: ListParams): Promise<NeedsV2Summary[]> {
  void `${BASE}/needs${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    page: p.page != null ? String(p.page) : undefined,
    page_size: p.pageSize != null ? String(p.pageSize) : undefined,
    order: p.order,
  })}`;
  throw new Error(NOT_WIRED);
}

// Users list (server slices by pageSize; the Overview ranking passes a large
// pageSize and re-sorts client-side). Returns the paginated envelope.
export async function getUsers(p: {
  startDate?: string;
  endDate?: string;
  pageSize?: number;
}): Promise<ApiList<UserV2Row>> {
  void `${BASE}/users${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    page_size: p.pageSize != null ? String(p.pageSize) : undefined,
  })}`;
  throw new Error(NOT_WIRED);
}

// ============================================================================
// Usage dimension (department aggregation + per-user). Source wrapped ~10
// chat-stats endpoints under /stats/departments/:id/* and /stats/users/:uid/*;
// the mini-cloud backend will mount these under /api/v2/efficiency/usage/*.
// Migrated as efficiency endpoints (no chat-proxy). include_children and
// pagination params are serialized as the source did (string "true"/"false").
// ============================================================================

const USAGE_DEPT = `${BASE}/usage/dept`;
const USAGE_USER = `${BASE}/usage/user`;

function deptParams(q: DeptQuery): Record<string, string> {
  return {
    start_date: q.start,
    end_date: q.end,
    include_children: q.includeChildren ? "true" : "false",
  };
}

// ---- Department aggregation ----

export async function getUsageDeptOverview(
  q: DeptQuery,
): Promise<DeptOverviewResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/overview${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptActiveUsers(
  q: DeptQuery,
): Promise<DeptActiveUsersResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/active-users${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptTrend(
  q: DeptQuery,
): Promise<DeptTrendResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/trend${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptModels(
  q: DeptQuery,
): Promise<DeptModelsResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/models/usage${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptWeekly(
  q: DeptQuery,
): Promise<DeptWeeklyResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/distribution/weekly${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptResults(
  q: DeptQuery,
): Promise<DeptResultsResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/results${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

// Period-over-period compare: the previous window is the same length as the
// current window, immediately preceding it. The caller computes prevStart /
// prevEnd (mirrors the source computePreviousRange); the backend only needs
// the four boundary strings.
export async function getUsageDeptPeriodCompare(
  q: DeptQuery,
  prevStart: string,
  prevEnd: string,
): Promise<DeptPeriodCompareResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/usage/period-compare${qs({
    current_start: q.start,
    current_end: q.end,
    previous_start: prevStart,
    previous_end: prevEnd,
    include_children: q.includeChildren ? "true" : "false",
  })}`;
  throw new Error(NOT_WIRED);
}

// Kanban-local mode usage (the only non-chat-stats card in the source): one
// row per conversation mode with deduped user_count + request_count.
export async function getUsageDeptModeUsage(
  q: DeptQuery,
): Promise<DeptModeUsageResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/mode-usage${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getUsageDeptMembers(
  q: MembersQuery,
): Promise<DeptMembersResp> {
  void `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/members${qs({
    ...deptParams(q),
    page: String(q.page),
    page_size: String(q.pageSize),
    sort_by: q.sortBy,
    sort_order: q.sortOrder,
    search: q.search || undefined,
  })}`;
  throw new Error(NOT_WIRED);
}

// ---- Per-user ----

export async function getUsageUserDetail(
  uid: string,
  start: string,
  end: string,
): Promise<UserDetailResp> {
  void `${USAGE_USER}/${encodeURIComponent(uid)}/detail${qs({
    start_date: start,
    end_date: end,
  })}`;
  throw new Error(NOT_WIRED);
}

// Per-user per-day trend. The source normalizes a bare-array OR {trend:[]}
// backend response into a flat array; the api layer returns that normalized
// array so the hook consumer never sees the two shapes.
export async function getUsageUserTrend(
  uid: string,
  start: string,
  end: string,
): Promise<UserTrendPoint[]> {
  void `${USAGE_USER}/${encodeURIComponent(uid)}/trend${qs({
    start_date: start,
    end_date: end,
  })}`;
  throw new Error(NOT_WIRED);
}

// ============================================================================
// Cost dimension (department aggregation + model/team breakdown + per-user).
// Source wrapped ~10 cost endpoints under /stats/departments/:id/cost/*; the
// mini-cloud backend will mount these under /api/v2/efficiency/cost/dept/:id/*.
// include_children and pagination params are serialized as the source did
// (string "true"/"false"). Cost reuses usage's DeptQuery, so the shared
// deptParams helper applies unchanged.
// ============================================================================

const COST_DEPT = `${BASE}/cost/dept`;

// ---- Department aggregation ----

export async function getCostOverview(
  q: DeptQuery,
): Promise<CostOverviewResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/overview${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

// Period-over-period compare: the previous window is the same length as the
// current window, immediately preceding it. The caller computes prevStart /
// prevEnd via the shared computePreviousRange util (same as usage); the
// backend only needs the four boundary strings.
export async function getCostPeriodCompare(
  q: DeptQuery,
  prevStart: string,
  prevEnd: string,
): Promise<CostPeriodCompareResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/period-compare${qs({
    current_start: q.start,
    current_end: q.end,
    previous_start: prevStart,
    previous_end: prevEnd,
    include_children: q.includeChildren ? "true" : "false",
  })}`;
  throw new Error(NOT_WIRED);
}

// ---- Model breakdown ----

export async function getCostModels(q: DeptQuery): Promise<CostModelsResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/models${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getCostModelTrend(
  q: DeptQuery,
): Promise<CostModelTrendResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/model-trend${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getCostModelComposition(
  q: DeptQuery,
): Promise<CostModelCompositionResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/composition/models${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

// ---- Anomaly detection ----

export async function getCostAnomaly(
  q: DeptQuery,
): Promise<CostAnomalyResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/anomaly${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

// ---- Team (sub-department) breakdown ----

export async function getCostSubDepts(
  q: DeptQuery,
): Promise<CostSubDeptResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/sub-departments${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getCostTeamTrend(
  q: DeptQuery,
): Promise<CostTeamTrendResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/team-trend${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

export async function getCostTeamComposition(
  q: DeptQuery,
): Promise<CostTeamCompositionResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/composition/teams${qs(deptParams(q))}`;
  throw new Error(NOT_WIRED);
}

// ---- Per-user (members) ----

export async function getCostMembers(
  q: CostMembersQuery,
): Promise<CostUsersResp> {
  void `${COST_DEPT}/${encodeURIComponent(q.deptId)}/users${qs({
    ...deptParams(q),
    page: String(q.page),
    page_size: String(q.pageSize),
    sort_by: q.sortBy,
    sort_order: q.sortOrder,
    search: q.search || undefined,
  })}`;
  throw new Error(NOT_WIRED);
}

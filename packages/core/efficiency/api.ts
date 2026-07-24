// Endpoint methods for /api/v2/efficiency/*. The mini-cloud backend will
// mount these routes once live. During the mock phase (MOCK_ENABLED=true,
// default) queries.ts never calls these — it returns mock data instead.
//
// The shared ApiClient's fetch is private, so these wrap calls that will be
// added as ApiClient methods (or a dedicated efficiency transport) when the
// backend lands. Until then the false-MOCK path throws a clear error.
import type {
  AddRepoRequest,
  AddTasksRequest,
  ApiList,
  ChatDatasource,
  ChatDatasourceTestResult,
  ChatDatasourceUpsert,
  ChatDetailQueryReq,
  ChatDetailQueryResponse,
  ChatLogPreviewResponse,
  ChatModelTrendSeries,
  ChatRealtimeResponse,
  ChatSyncSubmitReq,
  ChatSyncSubmitResponse,
  ChatSyncTaskListResponse,
  ChatSyncTaskStatus,
  ChatSystemConfig,
  ChatTraceLogResponse,
  ChatUserTrendRow,
  CheckConflictsResponse,
  CommitDetailResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  DashboardSummary,
  DashboardTrends,
  DeptRankingResponse,
  DeptTreeNode,
  EfficiencyV2AggregateResponse,
  EntityTrendResponse,
  GlobalConfig,
  ListParams,
  ModelPricing,
  ModelPricingUpsert,
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
  UpdateCommitManualRequest,
  UpdateProjectManualRequest,
  UpdateProjectNeedSelectionRequest,
  UpdateProjectRequest,
  UpdateTaskManualRequest,
  UserV2DetailResponse,
  UserV2Row,
  UserNameRow,
  ApiData,
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
// Efficiency dimension (user×week aggregate + the non-paginated "fetch
// everything" variants used by the efficiency dimension for client-side
// ranking/distribution). Source wrapped useEfficiencyV2 / useAllUsers /
// useAllRepos / useProjectList; the mini-cloud backend will mount these under
// /api/v2/efficiency/*.
// ============================================================================

// User×week aggregate rows (decimal-ratio efficiency_ratio). Source path
// /v2/efficiency maps to /api/v2/efficiency/efficiency here.
export async function getEfficiencyAggregate(p: {
  startDate?: string;
  endDate?: string;
  userId?: string;
}): Promise<EfficiencyV2AggregateResponse> {
  void `${BASE}/efficiency${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    user_id: p.userId,
  })}`;
  throw new Error(NOT_WIRED);
}

// Non-paginated full users list (source getAllUsersV2 paginates internally and
// returns a flat array; distinct from getUsers which returns the ApiList
// envelope). Used for client-side ranking/distribution across the whole window.
export async function getAllUsers(p: {
  startDate?: string;
  endDate?: string;
}): Promise<UserV2Row[]> {
  void `${BASE}/users/all${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// /v2/user-names → workspace roster for display-name resolution. Bare array of
// {user_id, universal_id, real_name, emp_no}; date-independent. Used by
// useUserNameMap so contributor/member rows show "真名(工号)" instead of raw ids.
export async function getUserNames(): Promise<UserNameRow[]> {
  void `${BASE}/user-names`;
  throw new Error(NOT_WIRED);
}

// Non-paginated full repos list (source getAllReposV2 paginates internally and
// returns a flat array). Whole-repo aggregation across all branches; one row
// per repo (repo_branch empty, branch_count populated). percentage-ratio
// efficiency_ratio.
export async function getAllRepos(p: {
  startDate?: string;
  endDate?: string;
}): Promise<RepoListItem[]> {
  void `${BASE}/repos/all${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// Unpaginated project list (ApiData envelope; the efficiency dimension only
// consumes the bare array, so this returns ProjectListItem[] for direct use by
// client-side filtering/sorting).
export async function getProjectList(p: {
  order?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ProjectListItem[]> {
  void `${BASE}/projects${qs({
    order: p.order,
    start_date: p.startDate,
    end_date: p.endDate,
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

// ============================================================================
// Detail dimension (per-entity drill-downs). Source wrapped getUserDetailV2 /
// getRepoDetailV2 / getRepoBranches / getRepoTrendV2 / getProjectDetail /
// getProjectTrendV2 / getProjectNeeds / getNeedDetailV2 / getTaskDetailV2 /
// getCommitDetailV2 under /v2/*; the mini-cloud backend will mount these under
// /api/v2/efficiency/* (query params serialized snake_case, matching the
// source endpoints.ts shapes). needId may contain slashes — encoded so the
// whole id lands in a single path segment.
// ============================================================================

// /v2/users/{id} → user summary + weekly rows + needs + commits.
export async function getUserDetailV2(
  userId: string,
  p: { startDate?: string; endDate?: string },
): Promise<UserV2DetailResponse> {
  void `${BASE}/users/${encodeURIComponent(userId)}/detail${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// /v2/repos/detail → repo scope (single branch) commits/tasks + efficiency.
export async function getRepoDetailV2(p: {
  repoAddr: string;
  repoBranch?: string;
  startDate?: string;
  endDate?: string;
}): Promise<RepoDetailResponse> {
  void `${BASE}/repos/detail${qs({
    repo_addr: p.repoAddr,
    repo_branch: p.repoBranch,
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// /v2/repos/branches → selectable branches for the repo-detail branch switcher.
export async function getRepoBranches(
  repoAddr: string,
): Promise<RepoBranchesResponse> {
  void `${BASE}/repos/branches${qs({ repo_addr: repoAddr })}`;
  throw new Error(NOT_WIRED);
}

// /v2/repo-trend → weekly aggregate trend (repoAddr empty = all repos).
export async function getRepoTrendV2(p: {
  repoAddr?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EntityTrendResponse> {
  void `${BASE}/repo-trend${qs({
    repo_addr: p.repoAddr,
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// /v2/projects/{id} → project detail (pure Need-scope ratio block).
export async function getProjectDetail(
  projectId: string,
): Promise<ProjectDetailResponse> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}`;
  throw new Error(NOT_WIRED);
}

// /v2/project-trend → weekly aggregate trend (projectId empty = all projects).
export async function getProjectTrendV2(p: {
  projectId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EntityTrendResponse> {
  void `${BASE}/project-trend${qs({
    project_id: p.projectId,
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// /v2/projects/{id}/needs → candidate-pool needs with per-need excluded flag.
export async function getProjectNeeds(
  projectId: string,
): Promise<ProjectNeedsResponse> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/needs`;
  throw new Error(NOT_WIRED);
}

// /v2/needs/{id} → need detail (sessions + commits + stage_metrics + baseline).
// needId may contain slashes (e.g. repo/branch/path) — encodeURIComponent keeps
// the whole id inside one path segment.
export async function getNeedDetailV2(
  needId: string,
): Promise<NeedsV2DetailResponse> {
  void `${BASE}/needs/${encodeURIComponent(needId)}`;
  throw new Error(NOT_WIRED);
}

// /v2/tasks/{id} → task detail (task + conversations; no time_segments).
export async function getTaskDetailV2(
  taskId: string,
): Promise<TaskDetailResponse> {
  void `${BASE}/tasks/${encodeURIComponent(taskId)}`;
  throw new Error(NOT_WIRED);
}

// /v2/commits/{id} → commit detail + related tasks.
export async function getCommitDetailV2(
  commitId: string,
): Promise<CommitDetailResponse> {
  void `${BASE}/commits/${encodeURIComponent(commitId)}`;
  throw new Error(NOT_WIRED);
}

// ----------------------------------------------------------------------------
// Detail-dimension mutations (project / task / commit manual override, repo
// source management, need selection). NOT_WIRED stubs — the UI form layer
// drives these via the mock-aware mutation hooks in mutations.ts; once the
// backend mounts /api/v2/efficiency/* the same hooks call the real paths.
// Source paths: see efficiency-dashboard endpoints.ts (createProject,
// updateProject, deleteProject, updateProjectManual, addTasksToProject,
// addRepoToProject, removeRepoFromProject, checkProjectConflicts,
// updateProjectNeedSelection, updateTaskManualV2, updateCommitManualV2).
// ----------------------------------------------------------------------------

// /v2/need-repo-options → project "add source" repo selector data (needs-same-
// origin normalized repo addresses with their feature branches). Used by the
// project-detail SourceModal; mocked in queries.ts (mock.needRepoOptions).
export async function getNeedRepoOptions(): Promise<ApiData<NeedRepoOption>> {
  void `${BASE}/need-repo-options`;
  throw new Error(NOT_WIRED);
}

// POST /v2/projects → create a project; returns the new project_id.
export async function createProject(
  body: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  void `${BASE}/projects`;
  void body;
  throw new Error(NOT_WIRED);
}

// PUT /v2/projects/{id} → edit a project. ⚠️ repos MUST be echoed back as-is
// (the backend clears them when omitted); task_ids no longer belong to the
// project model.
export async function updateProject(
  projectId: string,
  body: UpdateProjectRequest,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}`;
  void body;
  throw new Error(NOT_WIRED);
}

// DELETE /v2/projects/{id} → delete a project.
export async function deleteProject(projectId: string): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}`;
  throw new Error(NOT_WIRED);
}

// PUT /v2/projects/{id}/manual → manual override (3 minutes/reason pairs +
// start/end_time_manual).
export async function updateProjectManual(
  projectId: string,
  body: UpdateProjectManualRequest,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/manual`;
  void body;
  throw new Error(NOT_WIRED);
}

// POST /v2/projects/{id}/tasks → attach tasks (task_ids + same-length silica).
export async function addTasksToProject(
  projectId: string,
  body: AddTasksRequest,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/tasks`;
  void body;
  throw new Error(NOT_WIRED);
}

// POST /v2/projects/{id}/repos → add a repo source filter (end_time whitelist
// now → null on the backend).
export async function addRepoToProject(
  projectId: string,
  body: AddRepoRequest,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/repos`;
  void body;
  throw new Error(NOT_WIRED);
}

// DELETE /v2/projects/{id}/repos/{index} → remove a repo source filter by
// array index (indexes drift after a remove, so callers must reload).
export async function removeRepoFromProject(
  projectId: string,
  index: number,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/repos/${index}`;
  throw new Error(NOT_WIRED);
}

// POST /v2/projects/check-conflicts → detect commits that already belong to
// another project (two-phase add-to-project confirm flow).
export async function checkProjectConflicts(body: {
  commit_ids: string[];
}): Promise<CheckConflictsResponse> {
  void `${BASE}/projects/check-conflicts`;
  void body;
  throw new Error(NOT_WIRED);
}

// PUT /v2/projects/{id}/needs/selection → include/exclude a single need (writes
// exclude_needs; does not affect the commit-level ancient caliber).
export async function updateProjectNeedSelection(
  projectId: string,
  body: UpdateProjectNeedSelectionRequest,
): Promise<void> {
  void `${BASE}/projects/${encodeURIComponent(projectId)}/needs/selection`;
  void body;
  throw new Error(NOT_WIRED);
}

// PUT /v2/tasks/{id}/manual → task manual override (real/ancient minutes +
// reasons).
export async function updateTaskManual(
  taskId: string,
  body: UpdateTaskManualRequest,
): Promise<void> {
  void `${BASE}/tasks/${encodeURIComponent(taskId)}/manual`;
  void body;
  throw new Error(NOT_WIRED);
}

// PUT /v2/commits/{id}/manual → commit manual override (ancient/real minutes +
// reasons).
export async function updateCommitManual(
  commitId: string,
  body: UpdateCommitManualRequest,
): Promise<void> {
  void `${BASE}/commits/${encodeURIComponent(commitId)}/manual`;
  void body;
  throw new Error(NOT_WIRED);
}

// ============================================================================
// Chat dimension (platform AI monitoring + admin settings). Source wrapped the
// chat-indicator-statistics proxy via the `chatStats` object (chatGet/chatPost
// under /api/v2/chat/*); the mini-cloud backend will mount these as efficiency
// endpoints under /api/v2/efficiency/chat/* (NOT migrated as a chat proxy).
// Read endpoints return mock data in the mock phase; mutation endpoints are
// NOT_WIRED stubs so the types exist for the later UI form wiring.
// ============================================================================

const CHAT = `${BASE}/chat`;

// ---- Settings: model pricing CRUD ----

export async function getChatPricing(): Promise<ModelPricing[]> {
  void `${CHAT}/pricing/models`;
  throw new Error(NOT_WIRED);
}

export async function createChatPricing(
  body: ModelPricingUpsert,
): Promise<ModelPricing> {
  void `${CHAT}/pricing/models`;
  void body;
  throw new Error(NOT_WIRED);
}

export async function updateChatPricing(
  id: number,
  body: ModelPricingUpsert,
): Promise<ModelPricing> {
  void `${CHAT}/pricing/models/${id}`;
  void body;
  throw new Error(NOT_WIRED);
}

export async function deleteChatPricing(id: number): Promise<void> {
  void `${CHAT}/pricing/models/${id}`;
  throw new Error(NOT_WIRED);
}

// ---- Settings: datasource management ----

export async function getChatDatasources(): Promise<ChatDatasource[]> {
  void `${CHAT}/datasources`;
  throw new Error(NOT_WIRED);
}

export async function createChatDatasource(
  body: ChatDatasourceUpsert,
): Promise<ChatDatasource> {
  void `${CHAT}/datasources`;
  void body;
  throw new Error(NOT_WIRED);
}

export async function updateChatDatasource(
  id: number,
  body: ChatDatasourceUpsert,
): Promise<ChatDatasource> {
  void `${CHAT}/datasources/${id}`;
  void body;
  throw new Error(NOT_WIRED);
}

export async function deleteChatDatasource(id: number): Promise<void> {
  void `${CHAT}/datasources/${id}`;
  throw new Error(NOT_WIRED);
}

// Connection test (NOTE: a failure is also HTTP 200; the caller checks the
// returned success/message). Not wired during the mock phase.
export async function testChatDatasource(
  id: number,
): Promise<ChatDatasourceTestResult> {
  void `${CHAT}/datasources/${id}/test`;
  throw new Error(NOT_WIRED);
}

// ---- Settings: sync tasks ----

export async function getChatSyncTasks(): Promise<ChatSyncTaskListResponse> {
  void `${CHAT}/sync/tasks`;
  throw new Error(NOT_WIRED);
}

export async function getChatSyncTask(
  taskId: string,
): Promise<ChatSyncTaskStatus> {
  void `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}`;
  throw new Error(NOT_WIRED);
}

export async function submitChatSyncTask(
  body: ChatSyncSubmitReq,
): Promise<ChatSyncSubmitResponse> {
  void `${CHAT}/sync/tasks`;
  void body;
  throw new Error(NOT_WIRED);
}

export async function retryChatSyncTask(
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  void `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}/retry`;
  throw new Error(NOT_WIRED);
}

export async function cancelChatSyncTask(
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  void `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}/cancel`;
  throw new Error(NOT_WIRED);
}

// ---- Settings: system config (flat KV, e.g. system_currency) ----

export async function getChatSystemConfig(): Promise<ChatSystemConfig> {
  void `${CHAT}/config`;
  throw new Error(NOT_WIRED);
}

export async function updateChatSystemConfig(
  body: ChatSystemConfig,
): Promise<void> {
  void `${CHAT}/config`;
  void body;
  throw new Error(NOT_WIRED);
}

// ---- Platform ops: realtime aggregate + detail/log query ----

// Realtime aggregate (range ∈ 30m|1h|3h; source had a 10s server rate limit,
// so the UI drives manual refresh). datasourceId scopes to a source.
export async function getChatRealtime(p: {
  range: "30m" | "1h" | "3h";
  datasourceId?: string;
}): Promise<ChatRealtimeResponse> {
  void `${CHAT}/stats/realtime${qs({
    range: p.range,
    datasource_id: p.datasourceId,
  })}`;
  throw new Error(NOT_WIRED);
}

// Detail point query (max 100 rows; ISO 8601 times required). Source path
// /stats/detail/query is a POST body; mirrored here.
export async function getChatDetailQuery(
  req: ChatDetailQueryReq,
): Promise<ChatDetailQueryResponse> {
  void `${CHAT}/stats/detail/query`;
  void req;
  throw new Error(NOT_WIRED);
}

// Raw log preview (local_log_path is server-clamped to the configured root).
export async function getChatLogPreview(
  localLogPath: string,
): Promise<ChatLogPreviewResponse> {
  void `${CHAT}/stats/detail/log-preview`;
  void localLogPath;
  throw new Error(NOT_WIRED);
}

// Trace-log query (Loki etc. backend). Not part of the settings/platform read
// list, but stubbed here for type parity with the later RealtimeQuery wiring.
export async function getChatTraceLogs(
  body: {
    datasource_id: string;
    request_id: string;
    label_selector?: string;
    start_time: string;
    end_time: string;
    limit?: number;
    cursor?: string;
  },
): Promise<ChatTraceLogResponse> {
  void `${CHAT}/stats/trace-logs`;
  void body;
  throw new Error(NOT_WIRED);
}

// ---- Platform ops: per-user trend ----

export async function getChatUserTrend(
  uid: string,
  p: { startDate: string; endDate: string },
): Promise<ChatUserTrendRow[]> {
  void `${CHAT}/stats/users/${encodeURIComponent(uid)}/trend${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  throw new Error(NOT_WIRED);
}

// ---- Platform ops: model request/token trend ----

export async function getChatModelTrend(p: {
  startDate: string;
  endDate: string;
  models?: string;
}): Promise<ChatModelTrendSeries[]> {
  void `${CHAT}/stats/model-trend${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    models: p.models,
  })}`;
  throw new Error(NOT_WIRED);
}

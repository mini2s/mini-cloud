// Backend response types — fields align with backend Go struct json tags, see research/api-contract.md §2.
// PR0 first defines types used by the executive dashboard / core lists; other detail/mutation types are added in their respective PRs.

/** Generic paginated response envelope (most list endpoints) */
export interface ApiList<T> {
  total: number
  /** Needs list only: count of entries folded by default (coverage_eligible=false), for the "N collapsed" hint; 0/omitted for other lists / "show all" */
  folded_count?: number
  page: number
  pageSize: number
  data: T[]
}

/** Non-paginated response envelope (Org/Project lists) */
export interface ApiData<T> {
  data: T[]
}

/** /v2/config */
export interface GlobalConfig {
  traditional_dev_lines_per_day: number
  /** Cost per person-day (¥/person-day), used to convert saved cost on the executive dashboard; front-end falls back to 2000 when omitted. */
  cost_per_person_day?: number
  dashboard_title_prefix: string
  /** Whether the chat-indicator-statistics proxy is enabled (backend chat_stats.base_url non-empty). When false/omitted the "Platform" nav group is not rendered. */
  chat_stats_enabled?: boolean
}

/** /v2/dashboard/summary（§2.9 / §5） */
export interface DashboardSummary {
  total_tasks: number
  total_users: number
  total_repos: number
  total_commits: number
  total_branchs: number
  total_work_dirs: number
  total_cost: number
  total_tokens: number
  total_task_lines: number
  total_commit_lines: number
  total_diff_lines: number
  total_real_minutes: number
  avg_efficiency_ratio: number
  total_task_ancient_minutes: number
  total_task_real_minutes: number
  task_efficiency_ratio: number
  total_commit_ancient_minutes: number
  total_commit_real_minutes: number
  commit_efficiency_ratio: number
  total_users_v2: number
  total_needs: number
  merged_needs: number
  eligible_needs: number
  need_actual_calendar_min: number
  need_baseline_calendar_min: number
  need_calendar_ratio: number | null // decimal ratio
  need_work_ratio: number | null // decimal ratio
  ai_code_ratio?: number | null // decimal ratio
  ai_coverage_rate?: number | null // AI penetration card: coverage rate = share of needs whose AI data the dashboard can directly see (~0.28)
  ai_penetration_rate?: number | null // AI penetration card: penetration rate = share of needs whose authors actually use AI (~0.72, including split ones); gap = penetration − coverage, computed on the front-end
}

/** /v2/dashboard/trends single-week point (efficiency_ratio is a decimal ratio; null when actual<=0) */
export interface DashboardTrendPoint {
  week_start: string // YYYY-MM-DD
  efficiency_ratio: number | null
  active_users: number
  merged_need_count: number
  cost: number
  commit_diff_lines: number
}

/** Single-dimension "current period vs. equal-length previous period" delta; delta_pct is null when the previous period is 0 (no arrow drawn) */
export interface DashboardTrendDelta {
  current: number
  previous: number
  delta_pct: number | null
}

/** /v2/dashboard/trends response. compare keys: efficiency/usage/cost/contribution */
export interface DashboardTrends {
  granularity: string
  points: DashboardTrendPoint[]
  compare: Partial<Record<'efficiency' | 'usage' | 'cost' | 'contribution', DashboardTrendDelta>>
}

/** /v2/needs list item (§2.1, decimal ratio) */
export interface NeedsV2Summary {
  need_id: string
  boundary_source: string
  // Backend returns a string enum (e.g. 'high'); verified via curl, not a number
  boundary_confidence?: string | null
  status: string
  repo_addr: string
  repo_branch: string
  primary_user_id: string
  dev_start_ts: string
  dev_end_ts: string
  total_calendar_min: number
  baseline_calendar_min: number | null
  total_active_work_corrected_min: number
  baseline_fused_work_min: number | null
  efficiency_ratio: number | null // calendar efficiency, decimal ratio
  efficiency_band_low: number | null
  efficiency_band_high: number | null
  work_efficiency_ratio: number | null // workload efficiency, decimal ratio
  total_loc_net?: number | null
  ai_covered_loc?: number | null
  ai_code_ratio?: number | null
  confidence_level?: string
  outlier_flag: boolean // derived = outlier in any ratio
  calendar_outlier_flag?: boolean // calendar-efficiency ratio outlier
  work_outlier_flag?: boolean // workload-efficiency ratio outlier
  coverage_eligible: boolean
  total_think_min: number
  total_exec_min: number
  total_verify_min: number
  reason: string
}

/**
 * need object of /v2/needs/{id} (§3.1.1, all snake_case; pointer fields are generally nullable).
 * Only fields used by the detail page are declared; other fields exist in the backend but are not consumed by the page, falling back to the index signature.
 */
export interface NeedDetail {
  need_id: string
  status?: string
  boundary_source?: string
  boundary_confidence?: string | null
  boundary_key?: string
  repo_addr?: string
  repo_branch?: string
  primary_user_id?: string
  contributor_user_ids?: string[] | null
  touched_files?: string[] | string | null
  team_profile_used?: string
  dev_start_ts?: string | null
  dev_end_ts?: string | null
  dev_duration_min?: number | null
  total_session_active_person_min?: number | null
  estimate_uncovered_human_min?: number | null
  total_active_work_corrected_min?: number | null
  total_calendar_min?: number | null
  total_think_min?: number | null
  total_exec_min?: number | null
  total_verify_min?: number | null
  total_other_min?: number | null
  commit_count?: number | null
  total_loc_net?: number | null
  total_files_touched?: number | null
  ai_covered_loc?: number | null
  uncovered_loc?: number | null
  uncovered_work_ratio?: number | null
  ai_code_ratio?: number | null
  silica?: number | null
  churn_ratio?: number | null
  duplication_ratio?: number | null
  revert_count?: number | null
  revert_rate?: number | null
  post_generation_deletion_ratio?: number | null
  feature_dependency_risk?: string
  silica_signal?: string
  ai_code_ratio_signal?: string
  uncovered_work_signal?: string
  efficiency_ratio?: number | null
  efficiency_band_low?: number | null
  efficiency_band_high?: number | null
  work_efficiency_ratio?: number | null
  confidence_level?: string
  outlier_flag?: boolean // derived = outlier in any ratio
  calendar_outlier_flag?: boolean // calendar-efficiency ratio outlier
  work_outlier_flag?: boolean // workload-efficiency ratio outlier
  coverage_eligible?: boolean
  baseline_fused_work_min?: number | null
  baseline_calendar_min?: number | null
  reason?: string
  [k: string]: unknown
}

/** SessionStageMetric (§3.1.2, fields used by detail) */
export interface NeedSession {
  session_id: string
  user_id?: string
  session_start_ts?: string | null
  session_end_ts?: string | null
  total_active_min?: number | null
  think_active_min?: number | null
  exec_active_min?: number | null
  verify_active_min?: number | null
  stage_confidence?: string
  summary?: string
  [k: string]: unknown
}

/** Related Commit (§3.1.3, fields used by detail) */
export interface NeedCommit {
  commit_id: string
  commit_time?: string | null
  user_name?: string
  diff_lines?: number | null
  silica?: number | null
  comment?: string
  touched_files?: string[] | string | null
  [k: string]: unknown
}

/** baseline_components (§3.1.4, pointers nullable) */
export interface NeedBaselineComponents {
  algo_think_min?: number | null
  algo_exec_min?: number | null
  algo_verify_min?: number | null
  algo_total_min?: number | null
  anchor_knn_min?: number | null
  anchor_knn_reason?: string | null
  llm_think_min?: number | null
  llm_exec_min?: number | null
  llm_verify_min?: number | null
  llm_total_min?: number | null
  llm_confidence?: string | null
  llm_reason?: string | null
  fused_work_min?: number | null
  spread_work_min?: number | null
  calendar_min?: number | null
  team_work_density?: number | null
}

/** /v2/needs/{id} top-level response (§3.1) */
export interface NeedsV2DetailResponse {
  need: NeedDetail
  sessions?: NeedSession[]
  commits?: NeedCommit[]
  stage_metrics?: NeedSession[]
  baseline_components?: NeedBaselineComponents
  confidence_signals?: Record<string, unknown>
  quality_signals?: Record<string, unknown> & { reason?: string }
}

/** /v2/users list item (§2.2, decimal ratio) */
export interface UserV2Row {
  user_id: string
  user_name: string
  week_count: number
  merged_need_count: number
  active_need_count: number
  abandoned_need_count: number
  actual_calendar_min: number
  baseline_calendar_min: number
  calendar_ratio: number | null // decimal ratio
  actual_work_min: number
  baseline_work_min: number
  work_ratio: number | null // decimal ratio
  commit_count: number
  commit_diff_lines: number
  cost: number
  tokens: number
  ai_code_ratio?: number | null // decimal ratio
  confidence_limited: boolean
  confidence_reason?: string
}

/**
 * /v2/users/{id} weekly detail item (models.UserProductivityV2, decimal ratio).
 * Only fields used by the UserDetail weekly table / trend are declared; other fields exist in the backend but are not consumed by the page, falling back to the index signature.
 */
export interface UserProductivityV2 {
  user_productivity_v2_id?: string
  week_start: string
  user_id?: string
  user_name?: string
  merged_need_count?: number
  active_need_count?: number
  abandoned_need_count?: number
  actual_calendar_min?: number
  baseline_calendar_min?: number
  actual_active_work_corrected_min?: number
  baseline_fused_work_min?: number
  efficiency_ratio?: number | null // decimal ratio
  work_efficiency_ratio?: number | null // decimal ratio
  commit_count?: number
  commit_diff_lines?: number
  confidence_limited?: boolean
  confidence_reason?: string
  cost?: number
  upstream_tokens?: number
  downstream_tokens?: number
  [k: string]: unknown
}

/** /v2/efficiency top-level response (user×week aggregate rows, decimal-ratio efficiency_ratio). */
export interface EfficiencyV2AggregateResponse {
  total: number
  data: UserProductivityV2[]
}

/**
 * /v2/user-names row: maps a dashboard user_id (and/or universal_id) to the
 * display name + employee number shown on the detail pages. Resolves the raw
 * UUID-style user_id that lists otherwise surface into "真名(工号)".
 * universal_id is optional — populated only when the roster links the two.
 */
export interface UserNameRow {
  user_id: string
  universal_id?: string
  real_name: string
  emp_no: string
}

/** /v2/users/{id} top-level response (§User-2, summary uses decimal ratio) */
export interface UserV2DetailResponse {
  summary: UserV2Row
  weeks: UserProductivityV2[]
  needs: NeedsV2Summary[]
  commits: NeedCommit[]
}

/** /v2/user-groups/{id} member/summary item (§User-3, WARNING percentage ratio) */
export interface UserGroupMember {
  user_id: string
  user_name: string
  day_count: number
  task_count: number
  commit_count: number
  task_diff_lines: number
  upstream_tokens: number
  downstream_tokens: number
  cost: number
  task_real_minutes: number
  task_ancient_minutes: number
  task_efficiency_ratio: number | null // percentage ratio
  commit_diff_lines: number
  commit_ancient_minutes: number
  commit_real_minutes: number
  commit_efficiency_ratio: number | null // percentage ratio
}

export interface UserGroupSummary {
  day_count: number
  task_count: number
  commit_count: number
  task_diff_lines: number
  upstream_tokens: number
  downstream_tokens: number
  cost: number
  task_real_minutes: number
  task_ancient_minutes: number
  task_efficiency_ratio: number | null // percentage ratio
  commit_diff_lines: number
  commit_ancient_minutes: number
  commit_real_minutes: number
  commit_efficiency_ratio: number | null // percentage ratio
}

export interface UserGroup {
  group_id: string
  name: string
  org_name?: string
  user_ids?: unknown
  created_at?: string
  updated_at?: string
}

/** /v2/user-groups/{id} top-level response (§User-3) */
export interface UserGroupDetailResponse {
  group: UserGroup | null
  summary: UserGroupSummary
  members: UserGroupMember[]
}

/** /v2/orgs list item (§2.3, decimal ratio) */
export interface OrgV2Row {
  org_name: string
  user_count: number
  merged_need_count: number
  actual_calendar_min: number
  baseline_calendar_min: number
  calendar_ratio: number | null // decimal ratio
  work_ratio: number | null // decimal ratio
  ai_code_ratio?: number | null // decimal ratio
  commit_count: number
  commit_diff_lines: number
  cost: number
}

/** /v2/repos list item (§Repo-4, WARNING percentage-ratio efficiency_ratio = CalcEfficiencyRatio(ancient,real)).
 *  Whole-repo scope: backend aggregates across all branches (one row per repo), repo_branch is empty, branch_count = number of merged branches. */
export interface RepoListItem {
  repo_addr: string
  repo_branch: string // empty after whole-repo aggregation; can switch branch when drilling into detail
  branch_count?: number // number of merged branches for this repo
  commit_count: number
  start_time: string
  end_time: string
  sum_ancient_minutes: number
  sum_real_minutes: number
  task_count: number
  efficiency_ratio: number // percentage ratio
  ai_code_ratio?: number | null // decimal ratio
  cost?: number // dashboard-derived cost (Need→session→tasks.cost aggregated across branches); 0 for repos without tasks data
}

/** /v2/repo-trend、/v2/project-trend weekly aggregate point (efficiency_pct is already a percentage efficiency; front-end renders directly without ×100). */
export interface EntityTrendPoint {
  week_start: string // Monday of the week, YYYY-MM-DD
  efficiency_pct: number // efficiency percentage (gain%, 200 = 2x uplift); project side = weekly Σbaseline/Σactual conserved, same scope as project cards
  commit_count: number // repo scope: number of commits this week
  diff_lines: number // repo scope: lines of code this week
  need_count: number // project scope: number of clean Needs this week
  loc: number // project scope: net generated code lines this week
  cost?: number // repo scope: session cost this week (Need→session→tasks.cost, bucketed by dev_end_ts); always 0 for archived repos
}

export interface EntityTrendResponse {
  data: EntityTrendPoint[]
}

/** efficiency block of /v2/repos/detail (percentage ratio). */
export interface RepoEfficiency {
  repo_ancient_minutes: number
  repo_real_minutes: number
  efficiency_ratio: number // percentage ratio
  repo_ancient_minutes_reason?: string
  repo_real_minutes_reason?: string
}

/** commits item of /v2/repos/detail (§Repo-5, commit_*_manual takes precedence; silica is the commit-level AI code share, decimal ratio). */
export interface RepoCommitItem {
  commit_id: string
  commit_time?: string | null
  git_user_name?: string
  comment?: string
  diff_lines?: number | null
  commit_real_minutes?: number | null
  commit_real_minutes_manual?: number | null
  commit_ancient_minutes?: number | null
  commit_ancient_minutes_manual?: number | null
  silica?: number | null
  cost?: number | null
  upstream_tokens?: number | null
  downstream_tokens?: number | null
  efficiency_ratio?: number | null // percentage ratio
  [k: string]: unknown
}

/** /v2/repos/detail top-level response (§Repo-5). */
export interface RepoDetailResponse {
  repo_addr: string
  repo_branch: string
  branches: string[]
  commits: RepoCommitItem[]
  tasks: TaskListItem[]
  efficiency: RepoEfficiency
  summary?: { commit_count?: number; task_count?: number; ai_code_ratio?: number | null }
}

/** /v2/repos/branches response. */
export interface RepoBranchesResponse {
  branches: string[]
}

/** /v2/orgs/detail summary block (§Org-7, WARNING percentage ratio). */
export interface OrgSummary {
  user_count: number
  task_diff_lines: number
  task_real_minutes: number
  task_ancient_minutes: number
  task_efficiency_ratio: number // percentage ratio
  commit_diff_lines: number
  commit_real_minutes: number
  commit_ancient_minutes: number
  commit_efficiency_ratio: number // percentage ratio
  upstream_tokens: number
  downstream_tokens: number
  cost: number
}

/** /v2/orgs/detail commits time-series item (§Org-7, percentage ratio). */
export interface CommitTimeSeriesItem {
  period_key: string
  period_label: string
  commit_count: number
  commit_diff_lines: number
  commit_real_minutes: number
  commit_ancient_minutes: number
  commit_efficiency_ratio: number // percentage ratio
  upstream_tokens: number
  downstream_tokens: number
  cost: number
  [k: string]: unknown
}

/** /v2/orgs/detail tasks time-series item (§Org-7, percentage ratio). */
export interface TaskTimeSeriesItem {
  period_key: string
  period_label: string
  task_count: number
  task_diff_lines: number
  task_real_minutes: number
  task_ancient_minutes: number
  task_efficiency_ratio: number // percentage ratio
  upstream_tokens: number
  downstream_tokens: number
  cost: number
  [k: string]: unknown
}

/** /v2/orgs/detail members item (UserDetail, §Org-7, percentage ratio). */
export interface OrgMember {
  user_id: string
  user_name: string
  org1?: string
  org2?: string
  org3?: string
  org4?: string
  org_display?: string
  task_diff_lines: number
  task_real_minutes: number
  task_ancient_minutes: number
  task_efficiency_ratio: number // percentage ratio
  commit_diff_lines: number
  commit_real_minutes: number
  commit_ancient_minutes: number
  commit_efficiency_ratio: number // percentage ratio
  upstream_tokens: number
  downstream_tokens: number
  cost: number
  [k: string]: unknown
}

/** /v2/dept-tree node (recursive). Sourced from the authoritative full department tree provided by dept-sync (passed through). */
export interface DeptTreeNode {
  dept_id: string
  dept_name: string
  parent_dept_id: string
  dept_path: string
  dept_level: number
  order_num: number
  child_dept_count: number
  status: number
  children: DeptTreeNode[]
}

/** /v2/dept-tree/overview node: tree structure + conserved efficiency summary of this node's entire subtree (returned in one pass, replacing per-node ranking N+1). */
export interface DeptTreeNodeWithSummary {
  dept_id: string
  dept_name: string
  parent_dept_id: string
  dept_path: string
  dept_level: number
  order_num: number
  child_dept_count: number
  status: number
  summary: DeptMembersSummary
  children: DeptTreeNodeWithSummary[]
}

/** /v2/dept-tree/overview top-level response: a forest (multiple roots) + per-node conserved subtree summary. */
export interface DeptOverviewResponse {
  nodes: DeptTreeNodeWithSummary[]
}

/** /v2/dept-tree/members a single member: dept-sync roster + left-joined dashboard V2 metrics (by universal_id). */
export interface DeptMember {
  universal_id: string
  real_name: string
  emp_no: string
  /** The member's direct department id (the cost tree buckets direct costs per department by this). */
  dept_id: string
  position: string
  is_main: number
  has_kanban_data: boolean
  merged_need_count: number
  actual_calendar_min: number
  baseline_calendar_min: number
  calendar_ratio: number | null // decimal ratio
  work_ratio: number | null // decimal ratio
  ai_code_ratio?: number | null // decimal ratio
  commit_count: number
  commit_diff_lines: number
  cost: number
}

/** /v2/dept-tree/members summary (sum of this department's direct members, decimal efficiency ratio). */
export interface DeptMembersSummary {
  dept_id: string
  member_count: number
  kanban_member_count: number
  merged_need_count: number
  actual_calendar_min: number
  baseline_calendar_min: number
  calendar_ratio: number | null // decimal ratio
  work_ratio: number | null // decimal ratio
  ai_code_ratio?: number | null // decimal ratio
  commit_count: number
  commit_diff_lines: number
  cost: number
}

/** /v2/dept-tree/members top-level response. */
export interface DeptMembersResponse {
  summary: DeptMembersSummary
  members: DeptMember[]
}

/** /v2/dept-tree/ranking first-level child department ranking item (whole-subtree summary, reuses the DeptMembersSummary scope). */
export interface DeptRankingItem {
  dept_id: string
  dept_name: string
  summary: DeptMembersSummary
}

/** /v2/dept-tree/ranking top-level response: aggregated ranking of each direct child department under parent (single aggregation, replacing per-department N× members calls). */
export interface DeptRankingResponse {
  parent_dept_id: string
  items: DeptRankingItem[]
  /** Batch 4: conserved summary of all members under parent's entire subtree (including the parent level itself); defaults to null when parent has no child departments and takes the early return.
   *  self.dept_id == parent_dept_id; calendar_ratio/work_ratio are decimal multiplier ratios (RatioPill); cost in yuan. */
  self?: DeptMembersSummary | null
}

/** /v2/orgs/detail top-level response (§Org-7). */
export interface OrgDetailResponse {
  org_path: string
  summary: OrgSummary | null
  commits: CommitTimeSeriesItem[] | null
  tasks: TaskTimeSeriesItem[] | null
  members: OrgMember[] | null
  granularity: string
}

/** Generic list query params */
export interface ListParams {
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  order?: string
  [k: string]: unknown
}

/**
 * /v2/tasks list item & detail task object (§6, backend db.go TaskListItem).
 * WARNING: efficiency_ratio is a **percentage ratio** (300=300%), computed by the backend as ((ancient-real)/real)*100, including manual overrides.
 * Opposite of the Need decimal ratio; the front-end renders it **without ×100** and must never use formatV2Ratio/RatioPill.
 */
export interface TaskListItem {
  task_id: string
  session_id?: string
  commit_id?: string
  title?: string
  user_id?: string
  user_name?: string
  client_id?: string
  client_ide?: string
  client_version?: string
  client_os?: string
  client_os_version?: string
  caller?: string
  repo_addr?: string
  repo_branch?: string
  work_dir?: string
  work_dir_id?: string
  start_time?: string | null
  end_time?: string | null
  upstream_tokens?: number
  downstream_tokens?: number
  cost?: number
  silica?: number
  accept_ratio?: number
  diff_lines?: number
  task_ancient_minutes?: number | null
  task_ancient_minutes_reason?: string
  task_ancient_minutes_manual?: number | null
  task_ancient_minutes_reason_manual?: string
  task_real_minutes?: number | null
  task_real_minutes_reason?: string
  task_real_minutes_manual?: number | null
  task_real_minutes_reason_manual?: string
  efficiency_ratio?: number | null // percentage ratio
  org1?: string
  org2?: string
  org3?: string
  org4?: string
  org5?: string
  org6?: string
  org7?: string
  org8?: string
  org9?: string
  org_display?: string
  [k: string]: unknown
}

/** Conversation (§7.5, core/models/models.go Conversation, used for the detail conversation history) */
export interface Conversation {
  id?: number
  session_id?: string
  request_id?: string
  user_id?: string
  username?: string
  task_id?: string
  sender?: string
  prompt_mode?: string
  mode?: string
  model?: string
  start_time?: string | null
  end_time?: string | null
  process_time?: number | null
  process_ttft?: number | null
  upstream_tokens?: number | null
  downstream_tokens?: number | null
  cost?: number | null
  diff_lines?: number | null
  user_input?: string
  request_content?: string
  error_code?: string
  error_reason?: string
  [k: string]: unknown
}

/** /v2/tasks/{id} top-level response (§7.1, no time_segments — that is dead code) */
export interface TaskDetailResponse {
  task: TaskListItem
  conversations?: Conversation[]
  efficiency_ratio?: number | null // provided again at top level, percentage ratio
}

/** PUT /v2/tasks/{id}/manual request body (§7.6) */
export interface UpdateTaskManualRequest {
  task_real_minutes_manual: number | null
  task_real_minutes_reason_manual: string
  task_ancient_minutes_manual: number | null
  task_ancient_minutes_reason_manual: string
}

/**
 * /v2/commits list item (PR4 §1.1, backend db.go CommitListItem).
 * WARNING: efficiency_ratio is a **percentage ratio** (300=300%, rendered directly as .toFixed(1)+'%' without ×100).
 */
export interface CommitListItem {
  commit_id: string
  commit_time?: string | null
  repo_addr?: string
  repo_branch?: string
  git_user_name?: string
  git_user_email?: string
  user_id?: string
  user_name?: string
  client_id?: string
  work_dir?: string
  diff_lines?: number | null
  commit_ancient_minutes?: number | null
  commit_ancient_minutes_manual?: number | null
  commit_real_minutes?: number | null
  commit_real_minutes_manual?: number | null
  commit_real_ai_minutes?: number | null
  commit_real_ancient_minutes?: number | null
  comment?: string
  cost?: number | null
  upstream_tokens?: number | null
  downstream_tokens?: number | null
  silica?: number | null
  efficiency_ratio?: number | null // percentage ratio
  org1?: string
  org2?: string
  org3?: string
  org4?: string
  org5?: string
  org6?: string
  org7?: string
  org8?: string
  org9?: string
  org_display?: string
  [k: string]: unknown
}

/**
 * commit object of /v2/commits/{id} (models.Commit, fields used by detail; pointer fields are nullable).
 */
export interface CommitDetail {
  commit_id: string
  commit_time?: string | null
  repo_addr?: string
  repo_branch?: string
  git_user_name?: string
  git_user_email?: string
  user_id?: string
  user_name?: string
  comment?: string
  diff_lines?: number | null
  commit_ancient_minutes?: number | null
  commit_ancient_minutes_reason?: string
  commit_ancient_minutes_manual?: number | null
  commit_ancient_minutes_reason_manual?: string
  commit_real_minutes?: number | null
  commit_real_minutes_reason?: string
  commit_real_minutes_manual?: number | null
  commit_real_minutes_reason_manual?: string
  silica?: number | null
  efficiency_ratio?: number | null // percentage ratio
  [k: string]: unknown
}

/** related_tasks item of /v2/commits/{id} (db.go RelatedTask, silica is 0~1 and must be ×100). */
export interface RelatedTask {
  task_id: string
  user_name?: string
  start_time?: string | null
  task_real_minutes?: number | null
  silica?: number | null // 0~1
  cost?: number | null
  diff_lines?: number | null
  [k: string]: unknown
}

/** /v2/commits/{id} top-level response (PR4 §1.2). */
export interface CommitDetailResponse {
  commit: CommitDetail
  related_tasks?: RelatedTask[]
  efficiency_ratio?: number | null // top level, percentage ratio
  total_cost?: number | null
  silica?: number | null
  upstream_tokens?: number | null
  downstream_tokens?: number | null
}

/** PUT /v2/commits/{id}/manual request body (PR4 §1.2, 4 fields). */
export interface UpdateCommitManualRequest {
  commit_ancient_minutes_manual: number | null
  commit_ancient_minutes_reason_manual: string
  commit_real_minutes_manual: number | null
  commit_real_minutes_reason_manual: string
}

// ============ Projects (PR4b, percentage ratio; list is unpaginated) ============

/** Project "add source" repo selector: a selectable feature branch under a repo (need-repo-options endpoint). */
export interface NeedRepoBranchOption {
  repo_branch: string
  need_count: number
  last_active?: string | null
}

/** Project "add source" repo selector: a repo that can be used as a source (same origin as needs, normalized address, selecting it always matches). */
export interface NeedRepoOption {
  repo_addr: string
  need_count: number
  last_active?: string | null
  branches: NeedRepoBranchOption[]
}

/** In-project repo filter config (an item of the project.repos JSON array). */
export interface ProjectRepo {
  repo_addr: string
  repo_branch: string
  start_time?: string | null
  end_time?: string | null
  exclude_commits?: string[] | null
  include_only_commits?: string[] | null
  // Need-dimension allow/deny list (need_id); only applies to the "aggregate by Need (branch)" scope, independent of the commit-level lists.
  exclude_needs?: string[] | null
  include_only_needs?: string[] | null
  [k: string]: unknown
}

/**
 * /v2/projects list item (PR4 §2.1 / §5, project_handler_v2.go ProjectListItem).
 * WARNING: efficiency_ratio is a **percentage ratio** (300=300%); use PercentPill.
 */
export interface ProjectListItem {
  project_id: string
  name: string
  description?: string
  repos?: ProjectRepo[] | null
  task_ids?: string[] | null
  task_ids_silica?: number[] | null
  start_time?: string | null
  end_time?: string | null
  start_time_manual?: string | null
  end_time_manual?: string | null
  upstream_tokens?: number | null
  downstream_tokens?: number | null
  cost?: number | null
  project_ancient_minutes?: number | null
  project_ancient_minutes_reason?: string
  project_ancient_minutes_manual?: number | null
  project_ancient_minutes_reason_manual?: string
  project_real_process_minutes?: number | null
  project_real_process_minutes_reason?: string
  project_real_process_minutes_manual?: number | null
  project_real_process_minutes_reason_manual?: string
  project_real_lead_minutes?: number | null
  project_real_lead_minutes_reason?: string
  project_real_lead_minutes_manual?: number | null
  project_real_lead_minutes_reason_manual?: string
  created_at?: string
  updated_at?: string
  repo_count?: number
  task_count?: number
  user_count?: number
  total_code_lines?: number
  actual_lines_per_day?: number | null
  efficiency_ratio?: number | null // percentage ratio (legacy method; the list has migrated to the Need scope and no longer renders this)
  // —— Need(branch) scope (decimal multipliers, same source as the detail page; the list renders these) ——
  need_calendar_efficiency_ratio?: number | null
  need_work_efficiency_ratio?: number | null
  need_ai_code_ratio?: number | null
  need_total_loc_net?: number | null
  need_actual_work_min?: number | null
  need_cost?: number | null
  need_eligible_count?: number
  need_total_count?: number
  // —— Batch 3: per-project baseline/actual totals (cross-project conserved average uses Σbaseline/Σactual; never take the arithmetic mean of per-project ratios) ——
  need_baseline_calendar_min?: number // calendar baseline minutes total Σbaseline
  need_actual_calendar_min?: number // calendar actual minutes total Σactual
  need_baseline_work_min?: number // workload baseline minutes total (paired with need_actual_work_min for workload conservation)
  need_done_count?: number // number of completed (status='merged') needs, denominator for "¥ per completed need"
  [k: string]: unknown
}

/** project object of /v2/projects/{id} (models.Project, includes repos/task_ids/task_ids_silica). */
export interface ProjectModel extends ProjectListItem {
  repos?: ProjectRepo[] | null
  task_ids?: string[] | null
  task_ids_silica?: number[] | null
}

/** /v2/projects/{id} top-level response (pure Need(branch) scope; a project = a set of Needs, decimal ratio uses RatioPill). */
export interface ProjectDetailResponse {
  project: ProjectModel
  need_calendar_efficiency_ratio?: number | null // calendar-scope efficiency ratio (primary)
  need_work_efficiency_ratio?: number | null // workload-scope efficiency ratio (drilldown)
  need_ai_code_ratio?: number | null // AI code share (0~1)
  need_actual_calendar_min?: number | null
  need_baseline_calendar_min?: number | null
  need_actual_work_min?: number | null
  need_baseline_work_min?: number | null
  need_eligible_count?: number // number of clean Needs counted toward the metrics
  need_excluded_count?: number // number of Needs auto-excluded as calendar-scope outliers
  need_total_count?: number // total Needs in the candidate pool (dashboard scope, including unselected / excluded / ineligible)
  need_total_loc_net?: number // sum of net LOC across selected clean Needs (generated code volume)
  need_cost?: number // sum of session cost across selected Needs (deduplicated by session)
  need_upstream_tokens?: number
  need_downstream_tokens?: number
}

/** /v2/projects/{id}/needs list item: reuses NeedsV2Summary (decimal ratio) + whether currently excluded by the project. */
export interface ProjectNeedItem extends NeedsV2Summary {
  excluded: boolean
}

/** /v2/projects/{id}/needs response. */
export interface ProjectNeedsResponse {
  data: ProjectNeedItem[] | null
  total_count: number // candidate-pool total (including unselected / excluded / ineligible), same source as the detail card's need_total_count
  eligible_count: number
  excluded_count: number
  stale_count: number // number of need_ids in the configured list that are no longer in the candidate pool (recompute drift)
}

/** PUT /v2/projects/{id}/needs/selection (include/exclude a single Need). */
export interface UpdateProjectNeedSelectionRequest {
  repo_addr: string
  repo_branch: string
  need_id: string
  excluded: boolean
}

/** POST/PUT /v2/projects (create/edit) */
export interface CreateProjectRequest {
  name: string
  description?: string
}

/** PUT /v2/projects/{id} (repos must be echoed back as-is, otherwise the backend clears them; task_ids no longer belong to the project model). */
export interface UpdateProjectRequest {
  name: string
  description?: string
  repos: ProjectRepo[]
}

/** PUT /v2/projects/{id}/manual (6 minutes/reason + start/end_time_manual). */
export interface UpdateProjectManualRequest {
  project_ancient_minutes_manual: number | null
  project_ancient_minutes_reason_manual: string
  project_real_process_minutes_manual: number | null
  project_real_process_minutes_reason_manual: string
  project_real_lead_minutes_manual: number | null
  project_real_lead_minutes_reason_manual: string
  start_time_manual: string | null
  end_time_manual: string | null
}

/** POST /v2/projects/{id}/tasks (task_ids + a silica array of the same length). */
export interface AddTasksRequest {
  task_ids: string[]
  task_ids_silica: number[]
}

/** POST /v2/projects/{id}/repos (end_time whitelist: now → null). */
export interface AddRepoRequest {
  repo_addr: string
  repo_branch: string
  start_time?: string | null
  end_time?: string | null
  exclude_commits: string[]
  include_only_commits: string[]
}

/** POST /v2/projects/check-conflicts response item. */
export interface ProjectConflict {
  commit_id: string
  project_id: string
  project_name: string
}

export interface CheckConflictsResponse {
  conflicts: ProjectConflict[]
}

/** POST /v2/projects (create) response (includes project_id). */
export interface CreateProjectResponse {
  project_id: string
  name?: string
  [k: string]: unknown
}

// ============================================================
// chat-indicator-statistics proxy types (/api/v2/chat/* → chat service /chat-indicator-statistics/api/v1/*)
// Fields mirror the json tags of its source code pkg/model/models.go + pkg/http/handler/{realtime,handler}.go; do not add/remove fields arbitrarily.
// WARNING: the chat-side response envelope is {success,code,data} (errors are 400 + {error:{code,message,type}}),
//    unlike the dashboard's "bare data + {error:string}" — unpack via client.ts's chatGet/chatPost/... and never mix with apiGet.
// ============================================================

/** GET /v2/chat/stats/realtime response summary (realtime.go aggregateRealtime). */
export interface ChatRealtimeSummary {
  total_requests: number
  total_users: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_cache_tokens: number
  total_error_requests: number
  total_cost: number
}

/** token per-minute trend item (time is formatted like "HH:mm"). */
export interface ChatTokenTrendItem {
  time: string
  prompt_tokens: number
  completion_tokens: number
  cache_tokens: number
}

/** Cache hit-rate per-minute trend item (rate is a percentage 0-100). */
export interface ChatCacheRateItem {
  time: string
  cache_tokens: number
  prompt_tokens: number
  rate: number
}

/** Model request distribution item. */
export interface ChatModelRequestItem {
  model: string
  request_count: number
  user_count: number
  prompt_tokens: number
  completion_tokens: number
  total_cost: number
}

/** Auto-routing breakdown item (percentage is 0-100, 1 decimal place). */
export interface ChatAutoRouterItem {
  routed_model: string
  request_count: number
  percentage: number
}

/** Request volume per-minute trend item. */
export interface ChatRequestTrendItem {
  time: string
  request_count: number
}

/** Top-50 user item. */
export interface ChatTopUserItem {
  universal_id: string
  username: string
  request_count: number
  prompt_tokens: number
  completion_tokens: number
}

/** GET /v2/chat/stats/realtime (range=30m|1h|3h; server-side rate limit of 10s). */
export interface ChatRealtimeResponse {
  summary: ChatRealtimeSummary
  token_trend: ChatTokenTrendItem[]
  cache_hit_rate: ChatCacheRateItem[]
  model_requests: ChatModelRequestItem[]
  auto_router_breakdown: ChatAutoRouterItem[]
  request_trend: ChatRequestTrendItem[]
  top_users: ChatTopUserItem[]
}

/** POST /v2/chat/stats/detail/query request body (realtime.go RawDataQuery; times are ISO 8601 and required). */
export interface ChatDetailQueryReq {
  datasource_id?: string
  start_time: string
  end_time: string
  universal_id?: string
  request_id?: string
  user_id?: string
  username?: string
  /** true = errors only, false = successes only, omitted = all */
  has_error?: boolean
  model?: string
  routed_model?: string
  /** Page default 100, max 5000 */
  limit?: number
  /** 'asc' | 'desc' (default desc) */
  order?: string
}

/** Detail row (rawMetricItem; pointer fields can be null). */
export interface ChatDetailRow {
  id: number
  request_id: string
  user_id: string
  username: string | null
  universal_id: string | null
  ts: string
  system_tokens: number | null
  user_tokens: number | null
  processed_system_tokens?: number | null
  processed_user_tokens?: number | null
  retry_num?: number | null
  first_token_duration: number | null
  duration: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
  cache_tokens: number | null
  error_code: string | null
  slow_chunk: number | null
  chunk_per_second?: number | null
  token_output_time?: number | null
  token_output_speed?: number | null
  token_output_speed_e2e?: number | null
  task_id?: string | null
  client_version?: string | null
  request_time: string | null
  forward_request_time?: string | null
  end_time: string | null
  mode: string | null
  model: string | null
  routed_model: string | null
  local_log_path?: string | null
  created_at?: string | null
}

export interface ChatDetailQueryResponse {
  total: number
  items: ChatDetailRow[]
}

/** POST /v2/chat/stats/detail/log-preview response. When the threshold is exceeded or content is not UTF-8, only a hint is returned and no content. */
export interface ChatLogPreviewResponse {
  path: string
  file_name: string
  size_bytes: number
  size_mb: number
  max_size_mb: number
  previewable: boolean
  exceeded: boolean
  content?: string
  message?: string
}

/** model_pricing row (models.go ModelPricing; pricing_mode ∈ token|request|hybrid). */
export interface ModelPricing {
  id: number
  model_name: string
  pricing_mode: string
  input_price_per_token: number | null
  output_price_per_token: number | null
  cache_price_per_token: number | null
  request_price: number | null
  currency: string
  exchange_rate: number | null
  original_currency: string | null
  original_input_price: number | null
  original_output_price: number | null
  original_cache_price: number | null
  original_request_price: number | null
  effective_date: string
  end_date: string | null
  notes: string | null
  created_at: string
}

/** Create/edit pricing request body (id/created_at are server-generated). */
export type ModelPricingUpsert = Omit<ModelPricing, 'id' | 'created_at'> & { id?: number }

/** source_datasource row (models.go SourceDatasource; source_type ∈ postgres|elasticsearch). */
export interface ChatDatasource {
  id: number
  name: string
  source_type: string
  is_enabled: boolean
  /** JSON config for new types (loki/dept_api/log_storage); PG/ES may also migrate to this field. */
  config_json: string | null
  // -- PG flat fields (backward compatibility for legacy data) --
  pg_host: string | null
  pg_port: number | null
  pg_database: string | null
  pg_schema: string | null
  pg_table: string | null
  pg_username: string | null
  pg_password: string | null
  pg_ssl_mode: string | null
  // -- ES flat fields --
  es_hosts: string | null
  es_username: string | null
  es_password: string | null
  es_index: string | null
  es_verify_certs: boolean | null
  es_scroll_duration: string | null
  // -- Loki flat fields (backward compatibility) --
  loki_url: string | null
  loki_username: string | null
  loki_password: string | null
  loki_tenant_id: string | null
  loki_verify_certs: boolean | null
  loki_queries: string | null // JSON array [{name, label_selector}]
  // -- Other --
  max_open_conns: number | null
  max_idle_conns: number | null
  notes: string | null
  created_at: string
  updated_at: string | null
}

/** Create/edit datasource request body. */
export type ChatDatasourceUpsert = Partial<Omit<ChatDatasource, 'id' | 'created_at' | 'updated_at'>> &
  Pick<ChatDatasource, 'name' | 'source_type'>

/** POST /v2/chat/datasources/{id}/test result (note: a connection failure is also HTTP 200; check success). */
export interface ChatDatasourceTestResult {
  success: boolean
  message: string
  ping_ms: number
}

/** sync_task row (models.go SyncTask; status ∈ pending|running|completed|failed|retrying). */
export interface ChatSyncTask {
  id: number
  task_id: string
  status: string
  req_start_time: string
  req_end_time: string
  total_gaps: number
  completed_gaps: number
  total_rows_processed: number
  total_rows_written: number
  error_message: string | null
  retry_count: number
  source_name: string
  started_at: string | null
  finished_at: string | null
  created_at: string
}

/** GET /v2/chat/sync/tasks response. */
export interface ChatSyncTaskListResponse {
  total: number
  tasks: ChatSyncTask[]
}

/** POST /v2/chat/sync/tasks request body (times are ISO 8601). */
export interface ChatSyncSubmitReq {
  start_time: string
  end_time: string
  source_id?: number
  /** Force overwrite: pre-deletes the summary data for the dates in this range */
  force?: boolean
}

/** POST /v2/chat/sync/tasks response (WARNING: this endpoint's envelope is {code:0,data}; chatPost still unpacks data). */
export interface ChatSyncSubmitResponse {
  task_id: string
  status: string
  gaps: unknown[]
  source_id: number
  source_name: string
}

/** GET /v2/chat/sync/tasks/{task_id} response (progress is a percentage 0-100). */
export interface ChatSyncTaskStatus {
  task_id: string
  status: string
  progress: number
  total_gaps: number
  completed_gaps: number
  total_rows_processed: number
  total_rows_written: number
  error_message: string | null
  source_name: string
  started_at: string | null
  finished_at: string | null
}

/** GET/PUT /v2/chat/config — flat KV map (e.g. system_currency / exchange_rate_usd_cny). */
export type ChatSystemConfig = Record<string, string>

// ---- trace-logs ----

export interface ChatTraceLogEntry {
  timestamp: string
  line: string
}

export interface ChatTraceLogResponse {
  entries: ChatTraceLogEntry[]
  next_cursor: string
  has_more: boolean
}

// ---- user trend ----

export interface ChatUserTrendRow {
  date: string
  total_requests: number
  sum_total_tokens: number
  sum_prompt_tokens: number
  sum_completion_tokens: number
  sum_cache_tokens: number
  estimated_total_cost: number
  estimated_input_cost: number
  estimated_output_cost: number
  estimated_cache_cost: number
  estimated_request_cost: number
  unique_task_count: number
  avg_duration_ms: number | null
  avg_first_token_duration_ms: number | null
  error_requests: number
  model_preference: string | null // JSON {model: count}
  auto_router_breakdown: string | null // JSON {model: count}
}

// ---- model trend ----

export interface ChatModelTrendSeries {
  model: string
  data: ChatModelTrendRow[]
}

export interface ChatModelTrendRow {
  date: string
  total_requests: number
  input_tokens: number
  output_tokens: number
}

// ---- Platform overview historical stats (/stats/*) ----
// These mirror the inline interfaces of the source PlatformOverview.tsx (the
// chat-indicator-statistics historical summary endpoints). Field names keep the
// backend snake_case; see research/api-contract.md §6 for the chat summary ETL.

/** GET /stats/global/daily row — per-day platform aggregate. */
export interface ChatDailyGlobal {
  date: string
  total_requests: number
  total_users: number
  total_error_requests: number
  error_rate: number | null
  unique_task_count: number
  total_requests_including_errors: number
  sum_prompt_tokens: number
  sum_completion_tokens: number
  sum_total_tokens: number
  sum_cache_tokens: number
  avg_duration_ms: number | null
  avg_first_token_duration_ms: number | null
  avg_token_output_speed: number | null
  estimated_total_cost: number | null
  /** JSON {model: count} when the auto router is enabled; null otherwise. */
  auto_router_breakdown_global?: string | null
}

/** GET /stats/cost-trend row — per-day cost split by input/output/cache/request. */
export interface ChatCostTrendRow {
  date: string
  total_cost: number
  input_cost: number
  output_cost: number
  cache_cost: number
  request_cost: number
  total_requests: number
  /** Present when the caller filtered to a single model. */
  model?: string
}

/** GET /stats/cache-hit-rate row — per-day cache hit rate (rate computed as cache/prompt tokens). */
export interface ChatCacheHitRateRow {
  date: string
  sum_cache_tokens: number
  sum_prompt_tokens: number
  cache_hit_rate_pct: number
}

/** GET /stats/models/cost-ranking row — per-model cost ranking. */
export interface ChatModelCostRow {
  model: string
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost: number
}

/** GET /stats/models/usage item — per-model request/token share. */
export interface ChatModelUsageItem {
  model: string
  request_count: number
  request_pct: number
  total_tokens: number
  token_pct: number
}

/** GET /stats/models/usage response. */
export interface ChatModelsUsageResp {
  models: ChatModelUsageItem[]
}

/** GET /stats/users/ranking row — a single ranked user. */
export interface ChatUserRankingRow {
  universal_id: string
  username: string | null
  total_requests: number
  success_requests: number
  error_requests: number
  sum_prompt_tokens: number
  sum_completion_tokens: number
  sum_total_tokens: number
  sum_cache_tokens: number
  unique_task_count: number
  active_days: number
  estimated_total_cost: number
  avg_duration_ms: number
  error_rate: number
  max_duration_ms: number
  avg_token_output_speed: number
}

/** GET /stats/users/ranking response (paginated envelope). */
export interface ChatUsersRankingResp {
  total: number
  page: number
  page_size: number
  data: ChatUserRankingRow[]
}

// Mock samples for the detail dimension (per-entity drill-down pages).
// Shapes mirror the *Response interfaces in types.ts verbatim so each literal
// satisfies its interface without `as` casts. Numbers are synthetic but kept in
// plausible ranges so the detail cards / tables / charts render sensibly during
// the pre-backend phase.
//
// Required fields are always populated; optional fields are filled when they
// carry information the detail UI renders (sessions/commits/baselines/etc.).
// id / window params are accepted for signature parity with the real query;
// the samples are mostly static so they are currently ignored. Once
// /api/v2/efficiency/* detail endpoints are live, set EFFICIENCY_MOCK=0 and
// the queryOptions layer will stop calling these.

import type {
  CommitDetail,
  CommitDetailResponse,
  Conversation,
  EntityTrendResponse,
  EntityTrendPoint,
  NeedBaselineComponents,
  NeedCommit,
  NeedDetail,
  NeedSession,
  NeedsV2DetailResponse,
  NeedsV2Summary,
  ProjectDetailResponse,
  ProjectModel,
  ProjectNeedItem,
  ProjectNeedsResponse,
  RelatedTask,
  RepoBranchesResponse,
  RepoCommitItem,
  RepoDetailResponse,
  RepoEfficiency,
  TaskDetailResponse,
  TaskListItem,
  UserProductivityV2,
  UserV2DetailResponse,
  UserV2Row,
} from "../types";

// ---- shared sample constants ----------------------------------------------

const NAMES = [
  "Alice Wang",
  "Bob Li",
  "Carol Zhang",
  "David Chen",
  "Emma Liu",
  "Frank Zhao",
];

// ---- user detail ----------------------------------------------------------
// /v2/users/{id}: summary (UserV2Row) + weekly rows + needs + commits.

function makeUserSummary(i: number): UserV2Row {
  const actualCalendarMin = 4400 + i * 120;
  const baselineCalendarMin = 12_800 + i * 180;
  const actualWorkMin = 1700 + i * 40;
  const baselineWorkMin = 4800 + i * 55;
  return {
    user_id: `u-${200 + i}`,
    user_name: NAMES[i % NAMES.length] ?? `User ${200 + i}`,
    week_count: 8 + (i % 4),
    merged_need_count: 16 + i,
    active_need_count: 4 + (i % 5),
    abandoned_need_count: i % 3,
    actual_calendar_min: actualCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    calendar_ratio:
      actualCalendarMin > 0 ? baselineCalendarMin / actualCalendarMin : null,
    actual_work_min: actualWorkMin,
    baseline_work_min: baselineWorkMin,
    work_ratio: actualWorkMin > 0 ? baselineWorkMin / actualWorkMin : null,
    commit_count: 28 + i * 3,
    commit_diff_lines: 6400 + i * 210,
    cost: 360 + i * 24.5,
    tokens: 2_400_000 + i * 95_000,
    ai_code_ratio: 0.28 + (i % 5) * 0.03,
    confidence_limited: i % 7 === 0,
    confidence_reason: i % 7 === 0 ? "few sample weeks" : "",
  };
}

function makeUserWeek(i: number): UserProductivityV2 {
  const actualCalendarMin = 520 + i * 90;
  const baselineCalendarMin = 1500 + i * 140;
  const actualWorkMin = 200 + i * 32;
  const baselineWorkMin = 580 + i * 58;
  return {
    user_productivity_v2_id: `upv2-d-${4000 + i}`,
    week_start: `2026-07-${String(6 + (i % 3) * 7).padStart(2, "0")}`,
    user_id: "u-200",
    user_name: NAMES[0],
    merged_need_count: 3 + (i % 4),
    active_need_count: 1 + (i % 3),
    abandoned_need_count: i % 2,
    actual_calendar_min: actualCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    actual_active_work_corrected_min: actualWorkMin,
    baseline_fused_work_min: baselineWorkMin,
    efficiency_ratio:
      actualCalendarMin > 0 ? baselineCalendarMin / actualCalendarMin : null,
    work_efficiency_ratio:
      actualWorkMin > 0 ? baselineWorkMin / actualWorkMin : null,
    commit_count: 6 + i,
    commit_diff_lines: 720 + i * 90,
    confidence_limited: i % 6 === 0,
    confidence_reason: i % 6 === 0 ? "few sample weeks" : "",
    cost: 42 + i * 12.4,
    upstream_tokens: 180_000 + i * 24_000,
    downstream_tokens: 160_000 + i * 21_000,
  };
}

function makeUserNeed(i: number): NeedsV2Summary {
  const totalCalendarMin = 900 + i * 60;
  const baselineCalendarMin = 2600 + i * 90;
  const activeWorkMin = 340 + i * 25;
  const baselineWorkMin = 980 + i * 36;
  const isOutlier = i % 8 === 0;
  return {
    need_id: `n-u-${3000 + i}`,
    boundary_source: i % 2 === 0 ? "git_branch" : "kanban",
    boundary_confidence: i % 3 === 0 ? "high" : "medium",
    status: i % 3 === 0 ? "merged" : "open",
    repo_addr: `git@github.com:costrict/repo-${(i % 5) + 1}.git`,
    repo_branch: "main",
    primary_user_id: "u-200",
    dev_start_ts: `2026-07-${String(1 + i).padStart(2, "0")}T09:00:00Z`,
    dev_end_ts: `2026-07-${String(8 + i).padStart(2, "0")}T18:00:00Z`,
    total_calendar_min: totalCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    total_active_work_corrected_min: activeWorkMin,
    baseline_fused_work_min: baselineWorkMin,
    efficiency_ratio:
      totalCalendarMin > 0 ? baselineCalendarMin / totalCalendarMin : null,
    efficiency_band_low: 1.5,
    efficiency_band_high: 3.5,
    work_efficiency_ratio:
      activeWorkMin > 0 ? baselineWorkMin / activeWorkMin : null,
    total_loc_net: 260 + i * 18,
    ai_covered_loc: Math.round((260 + i * 18) * 0.31),
    ai_code_ratio: 0.27 + (i % 5) * 0.02,
    confidence_level: i % 4 === 0 ? "low" : "high",
    outlier_flag: isOutlier,
    calendar_outlier_flag: isOutlier,
    work_outlier_flag: false,
    coverage_eligible: i % 5 !== 0,
    total_think_min: 120 + i * 4,
    total_exec_min: 190 + i * 6,
    total_verify_min: 40 + i,
    reason: "",
  };
}

function makeUserCommit(i: number): NeedCommit {
  return {
    commit_id: `c-u-${5000 + i}`,
    commit_time: `2026-07-${String(10 + i).padStart(2, "0")}T14:20:00Z`,
    user_name: NAMES[0],
    diff_lines: 180 + i * 22,
    silica: 0.3 + (i % 5) * 0.04,
    comment: `refactor module ${i + 1} for clarity`,
    touched_files: [`src/mod-${i + 1}.ts`, `tests/mod-${i + 1}.spec.ts`],
  };
}

export function getMockUserDetail(
  _userId: string,
  _p: { startDate?: string; endDate?: string },
): UserV2DetailResponse {
  return {
    summary: makeUserSummary(0),
    weeks: Array.from({ length: 6 }, (_, i) => makeUserWeek(i)),
    needs: Array.from({ length: 5 }, (_, i) => makeUserNeed(i)),
    commits: Array.from({ length: 4 }, (_, i) => makeUserCommit(i)),
  };
}

// ---- repo detail ----------------------------------------------------------
// /v2/repos/detail: branches + commits + tasks + efficiency block.

function makeRepoCommit(i: number): RepoCommitItem {
  const ancient = 140 + i * 18;
  const real = 46 + i * 6;
  return {
    commit_id: `c-r-${6000 + i}`,
    commit_time: `2026-07-${String(5 + i).padStart(2, "0")}T11:30:00Z`,
    git_user_name: NAMES[i % NAMES.length] ?? `User ${i}`,
    comment: `fix: handle edge case ${i + 1}`,
    diff_lines: 120 + i * 24,
    commit_real_minutes: real,
    commit_ancient_minutes: ancient,
    silica: 0.32 + (i % 5) * 0.03,
    cost: 12.4 + i * 2.1,
    upstream_tokens: 22_000 + i * 1800,
    downstream_tokens: 19_500 + i * 1600,
    efficiency_ratio: real > 0 ? ((ancient - real) / real) * 100 : null,
  };
}

function makeRepoTask(i: number): TaskListItem {
  return {
    task_id: `t-r-${7000 + i}`,
    session_id: `s-${7000 + i}`,
    title: `Implement feature slice ${i + 1}`,
    user_id: `u-${200 + (i % 6)}`,
    user_name: NAMES[i % NAMES.length] ?? `User ${i}`,
    client_ide: "vscode",
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    work_dir: "/workspace/repo-1",
    start_time: `2026-07-${String(3 + i).padStart(2, "0")}T09:00:00Z`,
    end_time: `2026-07-${String(3 + i).padStart(2, "0")}T11:15:00Z`,
    upstream_tokens: 18_000 + i * 1400,
    downstream_tokens: 15_200 + i * 1200,
    cost: 9.8 + i * 1.6,
    silica: 0.34 + (i % 5) * 0.03,
    accept_ratio: 0.62 + (i % 4) * 0.05,
    diff_lines: 140 + i * 22,
    task_ancient_minutes: 120 + i * 18,
    task_real_minutes: 38 + i * 4,
    efficiency_ratio: 210 + i * 12,
  };
}

export function getMockRepoDetail(_p: {
  repoAddr: string;
  repoBranch?: string;
  startDate?: string;
  endDate?: string;
}): RepoDetailResponse {
  const repoAncient = 14_800;
  const repoReal = 4600;
  const efficiency: RepoEfficiency = {
    repo_ancient_minutes: repoAncient,
    repo_real_minutes: repoReal,
    efficiency_ratio:
      repoReal > 0 ? ((repoAncient - repoReal) / repoReal) * 100 : 0,
    repo_ancient_minutes_reason: "",
    repo_real_minutes_reason: "",
  };
  const commits = Array.from({ length: 5 }, (_, i) => makeRepoCommit(i));
  return {
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    branches: ["main", "develop", "feature/x"],
    commits,
    tasks: Array.from({ length: 4 }, (_, i) => makeRepoTask(i)),
    efficiency,
    summary: {
      commit_count: commits.length,
      task_count: 4,
      ai_code_ratio: 0.31,
    },
  };
}

export function getMockRepoBranches(_repoAddr: string): RepoBranchesResponse {
  return { branches: ["main", "develop", "feature/x", "release/1.0"] };
}

// ---- entity trend (repo + project) ----------------------------------------
// /v2/repo-trend and /v2/project-trend share EntityTrendResponse. The point
// shape carries both repo- and project-scope fields; both are filled so either
// consumer renders correctly.

function makeTrendPoint(i: number): EntityTrendPoint {
  return {
    week_start: `2026-06-${String(1 + i * 7).padStart(2, "0")}`,
    efficiency_pct: 180 + i * 18,
    commit_count: 24 + i * 3,
    diff_lines: 2400 + i * 220,
    need_count: 4 + i,
    loc: 1800 + i * 160,
    cost: 120 + i * 14.8,
  };
}

export function getMockRepoTrend(_p: {
  repoAddr?: string;
  startDate?: string;
  endDate?: string;
}): EntityTrendResponse {
  return { data: Array.from({ length: 6 }, (_, i) => makeTrendPoint(i)) };
}

// ---- project detail + needs ----------------------------------------------
// /v2/projects/{id}: project model + Need-scope ratio block (decimal ratios).

function makeProjectModel(i: number): ProjectModel {
  return {
    project_id: `p-${100 + i}`,
    name: `Project ${i + 1}`,
    description: `Sample project ${i + 1} for the efficiency dashboard`,
    repos: [
      {
        repo_addr: "git@github.com:costrict/repo-1.git",
        repo_branch: "main",
        start_time: "2026-06-01T00:00:00Z",
        end_time: null,
        exclude_commits: null,
        include_only_commits: null,
        exclude_needs: null,
        include_only_needs: null,
      },
    ],
    task_ids: [`t-a-${i}`, `t-b-${i}`],
    task_ids_silica: [0.4, 0.55],
    start_time: "2026-06-01T00:00:00Z",
    end_time: "2026-07-31T23:59:59Z",
    start_time_manual: null,
    end_time_manual: null,
    upstream_tokens: 1_240_000 + i * 95_000,
    downstream_tokens: 1_180_000 + i * 88_000,
    cost: 980 + i * 124.5,
    project_ancient_minutes: 12_400 + i * 620,
    project_ancient_minutes_reason: "",
    project_ancient_minutes_manual: null,
    project_ancient_minutes_reason_manual: "",
    project_real_process_minutes: 4600 + i * 210,
    project_real_process_minutes_reason: "",
    project_real_process_minutes_manual: null,
    project_real_process_minutes_reason_manual: "",
    project_real_lead_minutes: 1800 + i * 95,
    project_real_lead_minutes_reason: "",
    project_real_lead_minutes_manual: null,
    project_real_lead_minutes_reason_manual: "",
    created_at: "2026-05-15T08:00:00Z",
    updated_at: "2026-07-20T16:30:00Z",
    repo_count: 1 + (i % 3),
    task_count: 18 + i * 5,
    user_count: 3 + (i % 6),
    total_code_lines: 8400 + i * 720,
    actual_lines_per_day: 240 + i * 28,
    efficiency_ratio: null,
    need_calendar_efficiency_ratio: 2.8 + i * 0.1,
    need_work_efficiency_ratio: 2.6 + i * 0.08,
    need_ai_code_ratio: 0.28 + (i % 5) * 0.03,
    need_total_loc_net: 5200 + i * 410,
    need_actual_work_min: 920 + i * 60,
    need_cost: 720 + i * 96.2,
    need_eligible_count: 14 + i * 3,
    need_total_count: 18 + i * 4,
    need_baseline_calendar_min: 6900 + i * 260,
    need_actual_calendar_min: 2400 + i * 180,
    need_baseline_work_min: 2600 + i * 75,
    need_done_count: 8 + i * 2,
  };
}

export function getMockProjectDetail(
  _projectId: string,
): ProjectDetailResponse {
  const project = makeProjectModel(0);
  return {
    project,
    need_calendar_efficiency_ratio: 2.85,
    need_work_efficiency_ratio: 2.62,
    need_ai_code_ratio: 0.31,
    need_actual_calendar_min: 2400,
    need_baseline_calendar_min: 6840,
    need_actual_work_min: 920,
    need_baseline_work_min: 2410,
    need_eligible_count: 14,
    need_excluded_count: 2,
    need_total_count: 18,
    need_total_loc_net: 5200,
    need_cost: 720,
    need_upstream_tokens: 1_240_000,
    need_downstream_tokens: 1_180_000,
  };
}

export function getMockProjectTrend(_p: {
  projectId?: string;
  startDate?: string;
  endDate?: string;
}): EntityTrendResponse {
  return { data: Array.from({ length: 6 }, (_, i) => makeTrendPoint(i)) };
}

function makeProjectNeed(i: number): ProjectNeedItem {
  const totalCalendarMin = 900 + i * 60;
  const baselineCalendarMin = 2600 + i * 90;
  const activeWorkMin = 340 + i * 25;
  const baselineWorkMin = 980 + i * 36;
  const isOutlier = i % 9 === 0;
  return {
    need_id: `n-p-${8000 + i}`,
    boundary_source: i % 2 === 0 ? "git_branch" : "kanban",
    boundary_confidence: i % 3 === 0 ? "high" : "medium",
    status: i % 3 === 0 ? "merged" : "open",
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    primary_user_id: `u-${200 + (i % 6)}`,
    dev_start_ts: `2026-07-${String(1 + i).padStart(2, "0")}T09:00:00Z`,
    dev_end_ts: `2026-07-${String(8 + i).padStart(2, "0")}T18:00:00Z`,
    total_calendar_min: totalCalendarMin,
    baseline_calendar_min: baselineCalendarMin,
    total_active_work_corrected_min: activeWorkMin,
    baseline_fused_work_min: baselineWorkMin,
    efficiency_ratio:
      totalCalendarMin > 0 ? baselineCalendarMin / totalCalendarMin : null,
    efficiency_band_low: 1.5,
    efficiency_band_high: 3.5,
    work_efficiency_ratio:
      activeWorkMin > 0 ? baselineWorkMin / activeWorkMin : null,
    total_loc_net: 260 + i * 18,
    ai_covered_loc: Math.round((260 + i * 18) * 0.31),
    ai_code_ratio: 0.27 + (i % 5) * 0.02,
    confidence_level: i % 4 === 0 ? "low" : "high",
    outlier_flag: isOutlier,
    calendar_outlier_flag: isOutlier,
    work_outlier_flag: false,
    coverage_eligible: i % 5 !== 0,
    total_think_min: 120 + i * 4,
    total_exec_min: 190 + i * 6,
    total_verify_min: 40 + i,
    reason: "",
    excluded: i % 7 === 0,
  };
}

export function getMockProjectNeeds(
  _projectId: string,
): ProjectNeedsResponse {
  const data = Array.from({ length: 8 }, (_, i) => makeProjectNeed(i));
  const excluded = data.filter((n) => n.excluded).length;
  return {
    data,
    total_count: data.length,
    eligible_count: data.length - excluded,
    excluded_count: excluded,
    stale_count: 0,
  };
}

// ---- need detail ----------------------------------------------------------
// /v2/needs/{id}: need + sessions + commits + stage_metrics + baseline.

function makeNeed(i: number): NeedDetail {
  return {
    need_id: `n-d-${9000 + i}`,
    status: "merged",
    boundary_source: "git_branch",
    boundary_confidence: "high",
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    primary_user_id: "u-200",
    contributor_user_ids: ["u-200", "u-201"],
    touched_files: ["src/index.ts", "src/util.ts"],
    team_profile_used: "backend-default",
    dev_start_ts: "2026-07-01T09:00:00Z",
    dev_end_ts: "2026-07-10T18:00:00Z",
    dev_duration_min: 1350,
    total_session_active_person_min: 540,
    estimate_uncovered_human_min: 180,
    total_active_work_corrected_min: 480,
    total_calendar_min: 1350,
    total_think_min: 180,
    total_exec_min: 220,
    total_verify_min: 60,
    total_other_min: 20,
    commit_count: 4,
    total_loc_net: 620,
    total_files_touched: 3,
    ai_covered_loc: 192,
    uncovered_loc: 428,
    uncovered_work_ratio: 0.32,
    ai_code_ratio: 0.31,
    silica: 0.34,
    churn_ratio: 0.08,
    duplication_ratio: 0.04,
    revert_count: 0,
    revert_rate: 0,
    post_generation_deletion_ratio: 0.05,
    feature_dependency_risk: "low",
    silica_signal: "normal",
    ai_code_ratio_signal: "normal",
    uncovered_work_signal: "normal",
    efficiency_ratio: 2.85,
    efficiency_band_low: 1.5,
    efficiency_band_high: 3.5,
    work_efficiency_ratio: 2.6,
    confidence_level: "high",
    outlier_flag: false,
    calendar_outlier_flag: false,
    work_outlier_flag: false,
    coverage_eligible: true,
    baseline_fused_work_min: 1248,
    baseline_calendar_min: 3840,
    reason: "",
  };
}

function makeSession(i: number): NeedSession {
  return {
    session_id: `s-nd-${9100 + i}`,
    user_id: `u-${200 + (i % 3)}`,
    session_start_ts: `2026-07-${String(1 + i).padStart(2, "0")}T09:00:00Z`,
    session_end_ts: `2026-07-${String(1 + i).padStart(2, "0")}T11:00:00Z`,
    total_active_min: 120,
    think_active_min: 40,
    exec_active_min: 60,
    verify_active_min: 20,
    stage_confidence: "high",
    summary: `session ${i + 1}: scaffolded module and added tests`,
  };
}

function makeNeedCommit(i: number): NeedCommit {
  return {
    commit_id: `c-nd-${9200 + i}`,
    commit_time: `2026-07-${String(3 + i).padStart(2, "0")}T15:30:00Z`,
    user_name: NAMES[i % NAMES.length] ?? `User ${i}`,
    diff_lines: 160 + i * 24,
    silica: 0.32 + (i % 5) * 0.03,
    comment: `feat: implement slice ${i + 1}`,
    touched_files: [`src/slice-${i + 1}.ts`],
  };
}

function makeBaseline(): NeedBaselineComponents {
  return {
    algo_think_min: 180,
    algo_exec_min: 220,
    algo_verify_min: 60,
    algo_total_min: 460,
    anchor_knn_min: 240,
    anchor_knn_reason: "matched 12 historical needs in the same module",
    llm_think_min: 200,
    llm_exec_min: 240,
    llm_verify_min: 70,
    llm_total_min: 510,
    llm_confidence: "high",
    llm_reason: "stable cross-model agreement",
    fused_work_min: 1248,
    spread_work_min: 1180,
    calendar_min: 3840,
    team_work_density: 0.62,
  };
}

export function getMockNeedDetail(_needId: string): NeedsV2DetailResponse {
  return {
    need: makeNeed(0),
    sessions: Array.from({ length: 3 }, (_, i) => makeSession(i)),
    commits: Array.from({ length: 4 }, (_, i) => makeNeedCommit(i)),
    stage_metrics: Array.from({ length: 3 }, (_, i) => makeSession(i)),
    baseline_components: makeBaseline(),
    confidence_signals: { level: "high", contributors: 2, weeks_seen: 3 },
    quality_signals: { reason: "", duplication_ratio: 0.04, churn_ratio: 0.08 },
  };
}

// ---- task detail ----------------------------------------------------------
// /v2/tasks/{id}: task + conversations; no time_segments (dead code).

function makeTask(i: number): TaskListItem {
  return {
    task_id: `t-d-${9300 + i}`,
    session_id: `s-td-${9300 + i}`,
    commit_id: `c-td-${9300 + i}`,
    title: `Build module ${i + 1} with tests`,
    user_id: "u-200",
    user_name: NAMES[0],
    client_id: "client-1",
    client_ide: "vscode",
    client_version: "1.9.0",
    client_os: "darwin",
    caller: "ide",
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    work_dir: "/workspace/repo-1",
    work_dir_id: "wd-1",
    start_time: "2026-07-02T09:00:00Z",
    end_time: "2026-07-02T11:15:00Z",
    upstream_tokens: 24_000,
    downstream_tokens: 20_200,
    cost: 14.8,
    silica: 0.36,
    accept_ratio: 0.68,
    diff_lines: 180,
    task_ancient_minutes: 132,
    task_ancient_minutes_reason: "",
    task_ancient_minutes_manual: null,
    task_ancient_minutes_reason_manual: "",
    task_real_minutes: 42,
    task_real_minutes_reason: "",
    task_real_minutes_manual: null,
    task_real_minutes_reason_manual: "",
    efficiency_ratio: 214,
  };
}

function makeConversation(i: number): Conversation {
  return {
    id: 1000 + i,
    session_id: "s-td-9300",
    request_id: `req-${1100 + i}`,
    user_id: "u-200",
    username: NAMES[0],
    task_id: "t-d-9300",
    sender: i % 2 === 0 ? "user" : "assistant",
    prompt_mode: "agent",
    mode: "agent",
    model: "glm-4.6",
    start_time: `2026-07-02T09:${String(5 + i).padStart(2, "0")}:00Z`,
    end_time: `2026-07-02T09:${String(7 + i).padStart(2, "0")}:30Z`,
    process_time: 150 + i * 12,
    process_ttft: 0.8 + i * 0.05,
    upstream_tokens: 1200 + i * 180,
    downstream_tokens: 980 + i * 150,
    cost: 0.8 + i * 0.12,
    diff_lines: i % 2 === 0 ? 40 + i : null,
    user_input: `please implement step ${i + 1}`,
    request_content: "",
    error_code: "",
    error_reason: "",
  };
}

export function getMockTaskDetail(_taskId: string): TaskDetailResponse {
  return {
    task: makeTask(0),
    conversations: Array.from({ length: 4 }, (_, i) => makeConversation(i)),
    efficiency_ratio: 214,
  };
}

// ---- commit detail --------------------------------------------------------
// /v2/commits/{id}: commit + related tasks.

function makeCommit(i: number): CommitDetail {
  return {
    commit_id: `c-cd-${9400 + i}`,
    commit_time: "2026-07-04T14:20:00Z",
    repo_addr: "git@github.com:costrict/repo-1.git",
    repo_branch: "main",
    git_user_name: NAMES[0],
    git_user_email: "alice@costrict.com",
    user_id: "u-200",
    user_name: NAMES[0],
    comment: "feat: add module scaffold and tests",
    diff_lines: 220 + i * 12,
    commit_ancient_minutes: 140 + i * 8,
    commit_ancient_minutes_reason: "",
    commit_ancient_minutes_manual: null,
    commit_ancient_minutes_reason_manual: "",
    commit_real_minutes: 46 + i * 3,
    commit_real_minutes_reason: "",
    commit_real_minutes_manual: null,
    commit_real_minutes_reason_manual: "",
    silica: 0.34,
    efficiency_ratio: 204 + i * 6,
  };
}

function makeRelatedTask(i: number): RelatedTask {
  return {
    task_id: `t-cd-${9500 + i}`,
    user_name: NAMES[i % NAMES.length] ?? `User ${i}`,
    start_time: `2026-07-${String(2 + i).padStart(2, "0")}T09:00:00Z`,
    task_real_minutes: 42 + i * 4,
    silica: 0.34 + (i % 5) * 0.02,
    cost: 9.8 + i * 1.4,
    diff_lines: 140 + i * 18,
  };
}

export function getMockCommitDetail(
  _commitId: string,
): CommitDetailResponse {
  return {
    commit: makeCommit(0),
    related_tasks: Array.from({ length: 3 }, (_, i) => makeRelatedTask(i)),
    efficiency_ratio: 210,
    total_cost: 12.4,
    silica: 0.34,
    upstream_tokens: 22_000,
    downstream_tokens: 19_500,
  };
}

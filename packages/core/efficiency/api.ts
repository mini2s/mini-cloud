// Typed client for the separately deployed efficiency-dashboard backend.
// Browser requests keep the source application's historical /kanban/api
// prefix; the Web app proxies that prefix to the configured upstream.
import { z, type ZodType } from "zod";
import { parseWithFallback } from "../api/schema";
import { formatDateParam } from "./utils/date";
import type {
  AddRepoRequest,
  AddTasksRequest,
  ActivityListQuery,
  ApiList,
  ChatDatasource,
  ChatDatasourceTestResult,
  ChatDatasourceUpsert,
  ChatDailyGlobal,
  ChatCacheHitRateRow,
  ChatCostTrendRow,
  ChatDimensionRow,
  ChatDetailQueryReq,
  ChatDetailQueryResponse,
  ChatHourlyDistributionResponse,
  ChatHourlyRow,
  ChatLogPreviewResponse,
  ChatModelCostRow,
  ChatModelTrendSeries,
  ChatModelsUsageResp,
  ChatPerformanceByModelResponse,
  ChatPerformanceOverview,
  ChatRealtimeResponse,
  ChatSyncSubmitReq,
  ChatSyncSubmitResponse,
  ChatSyncTaskListResponse,
  ChatSyncTaskStatus,
  ChatSystemConfig,
  ChatTraceLogResponse,
  ChatUserTrendRow,
  ChatUsersRankingResp,
  CheckConflictsResponse,
  CommitDetailResponse,
  CommitListItem,
  CreateProjectRequest,
  CreateProjectResponse,
  DashboardSummary,
  DashboardTrends,
  DeptMembersResponse,
  DeptOverviewResponse,
  DeptRankingResponse,
  DeptTreeNode,
  DeptTreeNodeWithSummary,
  EfficiencyV2AggregateResponse,
  EntityTrendResponse,
  GlobalConfig,
  ListParams,
  ModelPricing,
  ModelPricingUpsert,
  NeedRepoOption,
  NeedsListQuery,
  NeedsV2DetailResponse,
  NeedsV2Summary,
  ProjectDetailResponse,
  ProjectListItem,
  ProjectNeedsResponse,
  RepoBranchesResponse,
  RepoDetailResponse,
  RepoListItem,
  TaskDetailResponse,
  TaskListItem,
  UpdateCommitManualRequest,
  UpdateProjectManualRequest,
  UpdateProjectNeedSelectionRequest,
  UpdateProjectRequest,
  UpdateTaskManualRequest,
  UserV2DetailResponse,
  UserV2Row,
  UserGroupDetailResponse,
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

const BASE = "/kanban/api/v2";
const CHAT = `${BASE}/chat`;
const DEFAULT_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 65_000;
type RequestKind = "plain" | "chat";

interface RequestOptions<T> {
  endpoint: string;
  schema: ZodType;
  fallback: T;
  kind?: RequestKind;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

const chatEnvelopeSchema = z.looseObject({
  success: z.boolean().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  data: z.unknown().optional(),
});

interface ChatEnvelope {
  success?: boolean;
  code?: string | number;
  data?: unknown;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = Reflect.get(body, "error");
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.length > 0) return message;
  }
  const message = Reflect.get(body, "message");
  return typeof message === "string" && message.length > 0
    ? message
    : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Efficiency API returned invalid JSON (${response.status})`);
  }
}

async function request<T>(
  path: string,
  options: RequestOptions<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs =
    options.kind === "chat" ? CHAT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await readJson(response);

    if (!response.ok) {
      throw new Error(
        errorMessage(
          raw,
          `Efficiency API request failed: ${response.status} ${response.statusText}`,
        ),
      );
    }

    let payload = raw;
    if (options.kind === "chat") {
      const envelope = parseWithFallback<ChatEnvelope>(
        raw,
        chatEnvelopeSchema,
        {},
        { endpoint: `${options.endpoint}:envelope` },
      );
      if (envelope.success === false) {
        throw new Error(errorMessage(raw, "Efficiency chat request failed"));
      }
      payload = envelope.data;
    }

    return parseWithFallback(
      payload,
      options.schema,
      options.fallback,
      { endpoint: options.endpoint },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Efficiency API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const dashboardSummarySchema = z.looseObject({
  total_tasks: z.number(),
  total_users: z.number(),
  total_repos: z.number(),
  total_commits: z.number(),
  total_branchs: z.number(),
  total_work_dirs: z.number(),
  total_cost: z.number(),
  total_tokens: z.number(),
  total_task_lines: z.number(),
  total_commit_lines: z.number(),
  total_diff_lines: z.number(),
  total_real_minutes: z.number(),
  avg_efficiency_ratio: z.number(),
  total_task_ancient_minutes: z.number(),
  total_task_real_minutes: z.number(),
  task_efficiency_ratio: z.number(),
  total_commit_ancient_minutes: z.number(),
  total_commit_real_minutes: z.number(),
  commit_efficiency_ratio: z.number(),
  total_users_v2: z.number(),
  total_needs: z.number(),
  merged_needs: z.number(),
  eligible_needs: z.number(),
  need_actual_calendar_min: z.number(),
  need_baseline_calendar_min: z.number(),
  need_calendar_ratio: z.number().nullable(),
  need_work_ratio: z.number().nullable(),
  ai_code_ratio: z.number().nullable().optional(),
  ai_coverage_rate: z.number().nullable().optional(),
  ai_penetration_rate: z.number().nullable().optional(),
});

const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  total_tasks: 0,
  total_users: 0,
  total_repos: 0,
  total_commits: 0,
  total_branchs: 0,
  total_work_dirs: 0,
  total_cost: 0,
  total_tokens: 0,
  total_task_lines: 0,
  total_commit_lines: 0,
  total_diff_lines: 0,
  total_real_minutes: 0,
  avg_efficiency_ratio: 0,
  total_task_ancient_minutes: 0,
  total_task_real_minutes: 0,
  task_efficiency_ratio: 0,
  total_commit_ancient_minutes: 0,
  total_commit_real_minutes: 0,
  commit_efficiency_ratio: 0,
  total_users_v2: 0,
  total_needs: 0,
  merged_needs: 0,
  eligible_needs: 0,
  need_actual_calendar_min: 0,
  need_baseline_calendar_min: 0,
  need_calendar_ratio: null,
  need_work_ratio: null,
};

const dashboardTrendPointSchema = z.looseObject({
  week_start: z.string(),
  efficiency_ratio: z.number().nullable(),
  active_users: z.number(),
  merged_need_count: z.number(),
  cost: z.number(),
  commit_diff_lines: z.number(),
});

const dashboardTrendDeltaSchema = z.looseObject({
  current: z.number(),
  previous: z.number(),
  delta_pct: z.number().nullable(),
});

const dashboardTrendsSchema = z.looseObject({
  granularity: z.string(),
  points: z.array(dashboardTrendPointSchema),
  compare: z.record(z.string(), dashboardTrendDeltaSchema),
});

const EMPTY_DASHBOARD_TRENDS: DashboardTrends = {
  granularity: "week",
  points: [],
  compare: {},
};

const globalConfigSchema = z.looseObject({
  traditional_dev_lines_per_day: z.number(),
  cost_per_person_day: z.number().optional(),
  dashboard_title_prefix: z.string(),
  chat_stats_enabled: z.boolean().optional(),
});

const EMPTY_GLOBAL_CONFIG: GlobalConfig = {
  traditional_dev_lines_per_day: 0,
  dashboard_title_prefix: "",
};

const deptTreeNodeSchema: ZodType<DeptTreeNode> = z.lazy(() =>
  z.looseObject({
    dept_id: z.string(),
    dept_name: z.string(),
    parent_dept_id: z.string(),
    dept_path: z.string(),
    dept_level: z.number(),
    order_num: z.number(),
    child_dept_count: z.number(),
    status: z.number(),
    children: z.array(deptTreeNodeSchema),
  }),
);

const deptMembersSummarySchema = z.looseObject({
  dept_id: z.string(),
  member_count: z.number(),
  kanban_member_count: z.number(),
  merged_need_count: z.number(),
  actual_calendar_min: z.number(),
  baseline_calendar_min: z.number(),
  calendar_ratio: z.number().nullable(),
  work_ratio: z.number().nullable(),
  ai_code_ratio: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  commit_count: z.number(),
  commit_diff_lines: z.number(),
  cost: z.number(),
});

const deptTreeNodeWithSummarySchema: ZodType<DeptTreeNodeWithSummary> = z.lazy(
  () =>
    z.looseObject({
      dept_id: z.string(),
      dept_name: z.string(),
      parent_dept_id: z.string(),
      dept_path: z.string(),
      dept_level: z.number(),
      order_num: z.number(),
      child_dept_count: z.number(),
      status: z.number(),
      summary: deptMembersSummarySchema,
      children: z.array(deptTreeNodeWithSummarySchema),
    }),
);

const deptOverviewSchema = z.looseObject({
  nodes: z.array(deptTreeNodeWithSummarySchema),
});

const deptMemberSchema = z.looseObject({
  universal_id: z.string(),
  real_name: z.string(),
  emp_no: z.string(),
  dept_id: z.string(),
  position: z.string(),
  is_main: z.number(),
  has_kanban_data: z.boolean(),
  merged_need_count: z.number(),
  actual_calendar_min: z.number(),
  baseline_calendar_min: z.number(),
  calendar_ratio: z.number().nullable(),
  work_ratio: z.number().nullable(),
  ai_code_ratio: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  commit_count: z.number(),
  commit_diff_lines: z.number(),
  cost: z.number(),
});

const deptMembersResponseSchema = z.looseObject({
  summary: deptMembersSummarySchema,
  members: z.array(deptMemberSchema),
});

const deptRankingSchema = z.looseObject({
  parent_dept_id: z.string(),
  items: z.array(
    z.looseObject({
      dept_id: z.string(),
      dept_name: z.string(),
      summary: deptMembersSummarySchema,
    }),
  ),
  self: deptMembersSummarySchema.nullable().optional(),
});

const EMPTY_DEPT_RANKING: DeptRankingResponse = {
  parent_dept_id: "",
  items: [],
};

const needSummarySchema = z.looseObject({
  need_id: z.string(),
  boundary_source: z.string(),
  boundary_confidence: z.string().nullable().optional(),
  status: z.string(),
  repo_addr: z.string(),
  repo_branch: z.string(),
  primary_user_id: z.string(),
  dev_start_ts: z.string(),
  dev_end_ts: z.string(),
  total_calendar_min: z.number(),
  baseline_calendar_min: z.number().nullable(),
  total_active_work_corrected_min: z.number(),
  baseline_fused_work_min: z.number().nullable(),
  efficiency_ratio: z.number().nullable(),
  efficiency_band_low: z.number().nullable(),
  efficiency_band_high: z.number().nullable(),
  work_efficiency_ratio: z.number().nullable(),
  total_loc_net: z.number().nullable().optional(),
  ai_covered_loc: z.number().nullable().optional(),
  ai_code_ratio: z.number().nullable().optional(),
  confidence_level: z.string().optional(),
  outlier_flag: z.boolean(),
  calendar_outlier_flag: z.boolean().optional(),
  work_outlier_flag: z.boolean().optional(),
  coverage_eligible: z.boolean(),
  total_think_min: z.number(),
  total_exec_min: z.number(),
  total_verify_min: z.number(),
  reason: z.string(),
});

const userSummarySchema = z.looseObject({
  user_id: z.string(),
  user_name: z.string(),
  week_count: z.number(),
  merged_need_count: z.number(),
  active_need_count: z.number(),
  abandoned_need_count: z.number(),
  actual_calendar_min: z.number(),
  baseline_calendar_min: z.number(),
  calendar_ratio: z.number().nullable(),
  actual_work_min: z.number(),
  baseline_work_min: z.number(),
  work_ratio: z.number().nullable(),
  commit_count: z.number(),
  commit_diff_lines: z.number(),
  cost: z.number(),
  tokens: z.number(),
  ai_code_ratio: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  confidence_limited: z.boolean(),
  confidence_reason: z.string().optional(),
});

const chatDailyGlobalSchema = z.looseObject({
  date: z.string(),
  total_requests: z.number(),
  total_users: z.number(),
  total_error_requests: z.number(),
  error_rate: z.number().nullable(),
  unique_task_count: z.number(),
  total_requests_including_errors: z.number(),
  sum_prompt_tokens: z.number(),
  sum_completion_tokens: z.number(),
  sum_total_tokens: z.number(),
  sum_cache_tokens: z.number(),
  avg_duration_ms: z.number().nullable(),
  avg_first_token_duration_ms: z.number().nullable(),
  avg_token_output_speed: z.number().nullable(),
  estimated_total_cost: z.number().nullable(),
  auto_router_breakdown_global: z.string().nullable().optional(),
});

const chatCostTrendRowSchema = z.looseObject({
  date: z.string(),
  total_cost: z.number(),
  input_cost: z.number(),
  output_cost: z.number(),
  cache_cost: z.number(),
  request_cost: z.number(),
  total_requests: z.number(),
  model: z.string().optional(),
});

const chatCacheHitRateRowSchema = z.looseObject({
  date: z.string(),
  sum_cache_tokens: z.number(),
  sum_prompt_tokens: z.number(),
  cache_hit_rate_pct: z.number(),
});

const chatModelCostRowSchema = z.looseObject({
  model: z.string(),
  total_requests: z.number(),
  total_input_tokens: z.number(),
  total_output_tokens: z.number(),
  total_cost: z.number(),
});

const chatModelUsageItemSchema = z.looseObject({
  model: z.string(),
  request_count: z.number(),
  request_pct: z.number(),
  total_tokens: z.number(),
  token_pct: z.number(),
});

const chatModelsUsageResponseSchema = z.looseObject({
  models: z.array(chatModelUsageItemSchema),
});

const chatUserRankingRowSchema = z.looseObject({
  universal_id: z.string(),
  username: z.string().nullable(),
  total_requests: z.number(),
  success_requests: z.number(),
  error_requests: z.number(),
  sum_prompt_tokens: z.number(),
  sum_completion_tokens: z.number(),
  sum_total_tokens: z.number(),
  sum_cache_tokens: z.number(),
  unique_task_count: z.number(),
  active_days: z.number(),
  estimated_total_cost: z.number(),
  avg_duration_ms: z.number(),
  error_rate: z.number(),
  max_duration_ms: z.number(),
  avg_token_output_speed: z.number(),
});

const chatUsersRankingResponseSchema = z.looseObject({
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  data: z.array(chatUserRankingRowSchema),
});

const chatRealtimeResponseSchema = z.looseObject({
  summary: z.looseObject({
    total_requests: z.number(),
    total_users: z.number(),
    total_prompt_tokens: z.number(),
    total_completion_tokens: z.number(),
    total_cache_tokens: z.number(),
    total_error_requests: z.number(),
    total_cost: z.number(),
  }),
  token_trend: z.array(
    z.looseObject({
      time: z.string(),
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      cache_tokens: z.number(),
    }),
  ),
  cache_hit_rate: z.array(
    z.looseObject({
      time: z.string(),
      cache_tokens: z.number(),
      prompt_tokens: z.number(),
      rate: z.number(),
    }),
  ),
  model_requests: z.array(
    z.looseObject({
      model: z.string(),
      request_count: z.number(),
      user_count: z.number(),
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_cost: z.number(),
    }),
  ),
  auto_router_breakdown: z.array(
    z.looseObject({
      routed_model: z.string(),
      request_count: z.number(),
      percentage: z.number(),
    }),
  ),
  request_trend: z.array(
    z.looseObject({
      time: z.string(),
      request_count: z.number(),
    }),
  ),
  top_users: z.array(
    z.looseObject({
      universal_id: z.string(),
      username: z.string(),
      request_count: z.number(),
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
    }),
  ),
});

const chatDetailRowSchema = z.looseObject({
  id: z.number(),
  request_id: z.string(),
  user_id: z.string(),
  username: z.string().nullable(),
  universal_id: z.string().nullable(),
  ts: z.string(),
  system_tokens: z.number().nullable(),
  user_tokens: z.number().nullable(),
  processed_system_tokens: z.number().nullable().optional(),
  processed_user_tokens: z.number().nullable().optional(),
  retry_num: z.number().nullable().optional(),
  first_token_duration: z.number().nullable(),
  duration: z.number().nullable(),
  prompt_tokens: z.number().nullable(),
  completion_tokens: z.number().nullable(),
  cache_tokens: z.number().nullable(),
  error_code: z.string().nullable(),
  slow_chunk: z.number().nullable(),
  chunk_per_second: z.number().nullable().optional(),
  token_output_time: z.number().nullable().optional(),
  token_output_speed: z.number().nullable().optional(),
  token_output_speed_e2e: z.number().nullable().optional(),
  task_id: z.string().nullable().optional(),
  client_version: z.string().nullable().optional(),
  request_time: z.string().nullable(),
  forward_request_time: z.string().nullable().optional(),
  end_time: z.string().nullable(),
  mode: z.string().nullable(),
  model: z.string().nullable(),
  routed_model: z.string().nullable(),
  local_log_path: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const chatDetailQueryResponseSchema = z.looseObject({
  total: z.number(),
  items: z.array(chatDetailRowSchema),
});

const chatLogPreviewResponseSchema = z.looseObject({
  path: z.string(),
  file_name: z.string(),
  size_bytes: z.number(),
  size_mb: z.number(),
  max_size_mb: z.number(),
  previewable: z.boolean(),
  exceeded: z.boolean(),
  content: z.string().optional(),
  message: z.string().optional(),
});

const chatTraceLogResponseSchema = z.looseObject({
  entries: z.array(
    z.looseObject({
      timestamp: z.string(),
      line: z.string(),
    }),
  ),
  next_cursor: z.string(),
  has_more: z.boolean(),
});

const chatUserTrendRowSchema = z.looseObject({
  date: z.string(),
  total_requests: z.number(),
  sum_total_tokens: z.number(),
  sum_prompt_tokens: z.number(),
  sum_completion_tokens: z.number(),
  sum_cache_tokens: z.number(),
  estimated_total_cost: z.number(),
  estimated_input_cost: z.number(),
  estimated_output_cost: z.number(),
  estimated_cache_cost: z.number(),
  estimated_request_cost: z.number(),
  unique_task_count: z.number(),
  avg_duration_ms: z.number().nullable(),
  avg_first_token_duration_ms: z.number().nullable(),
  error_requests: z.number(),
  model_preference: z.string().nullable(),
  auto_router_breakdown: z.string().nullable(),
});

const chatPerformanceOverviewSchema = z.looseObject({
  avg_ttft_ms: z.number().nullable(),
  avg_token_output_speed: z.number().nullable(),
  avg_duration_ms: z.number().nullable(),
});

const chatPerformanceModelSchema = z.looseObject({
  model: z.string(),
  avg_ttft_ms: z.number().nullable(),
  avg_token_output_speed: z.number().nullable(),
  avg_duration_ms: z.number().nullable(),
});

const chatPerformanceByModelResponseSchema = z.looseObject({
  models: z.array(chatPerformanceModelSchema),
});

const chatHourlyDistributionResponseSchema = z.looseObject({
  hours: z.array(
    z.looseObject({
      hour: z.number(),
      request_count: z.number(),
      active_users: z.number(),
    }),
  ),
});

const chatHourlyRowSchema = z.looseObject({
  date_hour: z.string(),
  total_requests: z.number(),
  total_users: z.number().optional(),
  error_requests: z.number().optional(),
});

const chatDimensionRowSchema = z.looseObject({
  dimension_value: z.string(),
  total_requests: z.number().optional(),
  total_users: z.number().optional(),
  total_prompt_tokens: z.number().optional(),
  total_completion_tokens: z.number().optional(),
  total_cache_tokens: z.number().optional(),
  avg_first_token_duration_ms: z.number().nullable().optional(),
  avg_duration_ms: z.number().nullable().optional(),
  avg_token_output_speed: z.number().nullable().optional(),
  error_requests: z.number().optional(),
  total_requests_including_errors: z.number().optional(),
  error_rate: z.number().nullable(),
});

const chatModelTrendSeriesSchema = z.looseObject({
  model: z.string(),
  data: z.array(
    z.looseObject({
      date: z.string(),
      total_requests: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  ),
});

function apiListSchema(itemSchema: ZodType): ZodType {
  return z.looseObject({
    total: z.number(),
    folded_count: z.number().optional(),
    page: z.number(),
    pageSize: z.number(),
    data: z.array(itemSchema),
  });
}

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;

    // The regular efficiency API accepts compact dates, while chat endpoints
    // use snake_case parameters with ISO dates. Keep that contract difference
    // at the transport boundary instead of spreading conversion across pages.
    const normalized =
      k === "startDate" || k === "endDate" ? formatDateParam(v) : v;
    s.set(k, normalized);
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

// Stage 1 sample endpoints. Later stages migrate the remaining source
// endpoints in domain-sized batches after this transport is accepted.
export async function getDashboardSummary(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardSummary> {
  const path = `${BASE}/dashboard/summary${qs({
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dashboard/summary",
    schema: dashboardSummarySchema,
    fallback: EMPTY_DASHBOARD_SUMMARY,
  });
}

export async function getDashboardTrends(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DashboardTrends> {
  const path = `${BASE}/dashboard/trends${qs({
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dashboard/trends",
    schema: dashboardTrendsSchema,
    fallback: EMPTY_DASHBOARD_TRENDS,
  });
}

export async function getGlobalConfig(): Promise<GlobalConfig> {
  return request(`${BASE}/config`, {
    endpoint: "GET /kanban/api/v2/config",
    schema: globalConfigSchema,
    fallback: EMPTY_GLOBAL_CONFIG,
  });
}

// Authoritative full department tree (proxy of dept-sync /department/tree);
// date-independent. Returns a forest (array of roots).
export async function getDeptTree(): Promise<DeptTreeNode[]> {
  return request(`${BASE}/dept-tree`, {
    endpoint: "GET /kanban/api/v2/dept-tree",
    schema: z.array(deptTreeNodeSchema),
    fallback: [],
  });
}

export async function getDeptOverview(p: {
  startDate?: string;
  endDate?: string;
}): Promise<DeptOverviewResponse> {
  const path = `${BASE}/dept-tree/overview${qs({
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dept-tree/overview",
    schema: deptOverviewSchema,
    fallback: { nodes: [] },
  });
}

export async function getDeptTreeMembers(p: {
  deptId: string;
  startDate?: string;
  endDate?: string;
}): Promise<DeptMembersResponse> {
  const path = `${BASE}/dept-tree/members${qs({
    dept_id: p.deptId,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dept-tree/members",
    schema: deptMembersResponseSchema,
    fallback: {
      summary: {
        dept_id: p.deptId,
        member_count: 0,
        kanban_member_count: 0,
        merged_need_count: 0,
        actual_calendar_min: 0,
        baseline_calendar_min: 0,
        calendar_ratio: null,
        work_ratio: null,
        commit_count: 0,
        commit_diff_lines: 0,
        cost: 0,
      },
      members: [],
    },
  });
}

// One-shot ranking: each direct child department of parentDeptId with its
// whole-subtree conserved summary. parentDeptId empty => configured root.
export async function getDeptRanking(p: {
  parentDeptId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<DeptRankingResponse> {
  const path = `${BASE}/dept-tree/ranking${qs({
    parent_dept_id: p.parentDeptId,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dept-tree/ranking",
    schema: deptRankingSchema,
    fallback: EMPTY_DEPT_RANKING,
  });
}

// /v2/dept-tree/trend → weekly aggregate for the selected department subtree.
// An empty dept id lets the backend use the configured company root.
export async function getDeptTreeTrendV2(p: {
  deptId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EntityTrendResponse> {
  const path = `${BASE}/dept-tree/trend${qs({
    dept_id: p.deptId ?? "",
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dept-tree/trend",
    schema: entityTrendSchema,
    fallback: { data: [] },
  });
}

// Paginated fetch of the entire needs list. The backend caps pageSize at 200,
// so Overview trends and rankings must merge every page before aggregating.
export async function getAllNeeds(p: ListParams): Promise<NeedsV2Summary[]> {
  const maxPages = 50;
  const pageSize = 200;
  const all: NeedsV2Summary[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages; page += 1) {
    const path = `${BASE}/needs${qs({
      startDate: p.startDate,
      endDate: p.endDate,
      outlierOnly: p.outlierOnly === true ? "true" : undefined,
      page: String(page),
      pageSize: String(pageSize),
    })}`;
    const response = await request<ApiList<NeedsV2Summary>>(path, {
      endpoint: "GET /kanban/api/v2/needs",
      schema: apiListSchema(needSummarySchema),
      fallback: { total: 0, page, pageSize, data: [] },
    });
    const rows = response.data ?? [];
    all.push(...rows);
    total = response.total;
    if (rows.length === 0 || all.length >= total) break;
  }

  return all;
}

// Server-paginated needs list used by the dedicated Needs page. Keep the
// source dashboard's camelCase filter/sort contract at this boundary.
export async function getNeedsList(
  p: NeedsListQuery,
): Promise<ApiList<NeedsV2Summary>> {
  const path = `${BASE}/needs${qs({
    startDate: p.startDate,
    endDate: p.endDate,
    page: String(p.page),
    pageSize: String(p.pageSize),
    order: p.order,
    repoAddr: p.repoAddr,
    repoBranch: p.repoBranch,
    userId: p.userId,
    boundarySource: p.boundarySource,
    outlierOnly: p.outlierOnly ? "true" : undefined,
    includeAll: p.includeAll ? "true" : undefined,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/needs",
    schema: apiListSchema(needSummarySchema),
    fallback: {
      total: 0,
      folded_count: 0,
      page: p.page,
      pageSize: p.pageSize,
      data: [],
    },
  });
}

// Users list (server slices by pageSize; the Overview ranking passes a large
// pageSize and re-sorts client-side). Returns the paginated envelope.
export async function getUsers(p: {
  startDate?: string;
  endDate?: string;
  pageSize?: number;
}): Promise<ApiList<UserV2Row>> {
  const pageSize = p.pageSize ?? 50;
  const path = `${BASE}/users${qs({
    startDate: p.startDate,
    endDate: p.endDate,
    pageSize: String(pageSize),
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/users",
    schema: apiListSchema(userSummarySchema),
    fallback: { total: 0, page: 1, pageSize, data: [] },
  });
}

// ============================================================================
// Efficiency dimension (user×week aggregate + full user/repository/project
// lists). Paths and camelCase query parameters match the source dashboard's
// regular /v2 API contract.
// ============================================================================

const userProductivitySchema = z.looseObject({
  user_productivity_v2_id: z.string().optional(),
  week_start: z.string(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  merged_need_count: z.number().optional(),
  active_need_count: z.number().optional(),
  abandoned_need_count: z.number().optional(),
  actual_calendar_min: z.number().optional(),
  baseline_calendar_min: z.number().optional(),
  actual_active_work_corrected_min: z.number().optional(),
  baseline_fused_work_min: z.number().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  work_efficiency_ratio: z.number().nullable().optional(),
  commit_count: z.number().optional(),
  commit_diff_lines: z.number().optional(),
  confidence_limited: z.boolean().optional(),
  confidence_reason: z.string().optional(),
  cost: z.number().optional(),
  upstream_tokens: z.number().optional(),
  downstream_tokens: z.number().optional(),
});

const efficiencyAggregateSchema = z.looseObject({
  total: z.number(),
  data: z.array(userProductivitySchema),
});

const repoListItemSchema = z.looseObject({
  repo_addr: z.string(),
  repo_branch: z.string(),
  branch_count: z.number().optional(),
  commit_count: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  sum_ancient_minutes: z.number(),
  sum_real_minutes: z.number(),
  task_count: z.number(),
  efficiency_ratio: z.number(),
  ai_code_ratio: z.number().nullable().optional(),
  cost: z.number().optional(),
});

const projectRepoSchema = z.looseObject({
  repo_addr: z.string(),
  repo_branch: z.string(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  exclude_commits: z.array(z.string()).nullable().optional(),
  include_only_commits: z.array(z.string()).nullable().optional(),
  exclude_needs: z.array(z.string()).nullable().optional(),
  include_only_needs: z.array(z.string()).nullable().optional(),
});

const projectListItemSchema = z.looseObject({
  project_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  repos: z.array(projectRepoSchema).nullable().optional(),
  task_ids: z.array(z.string()).nullable().optional(),
  task_ids_silica: z.array(z.number()).nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  start_time_manual: z.string().nullable().optional(),
  end_time_manual: z.string().nullable().optional(),
  upstream_tokens: z.number().nullable().optional(),
  downstream_tokens: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
  project_ancient_minutes: z.number().nullable().optional(),
  project_ancient_minutes_reason: z.string().optional(),
  project_ancient_minutes_manual: z.number().nullable().optional(),
  project_ancient_minutes_reason_manual: z.string().optional(),
  project_real_process_minutes: z.number().nullable().optional(),
  project_real_process_minutes_reason: z.string().optional(),
  project_real_process_minutes_manual: z.number().nullable().optional(),
  project_real_process_minutes_reason_manual: z.string().optional(),
  project_real_lead_minutes: z.number().nullable().optional(),
  project_real_lead_minutes_reason: z.string().optional(),
  project_real_lead_minutes_manual: z.number().nullable().optional(),
  project_real_lead_minutes_reason_manual: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  repo_count: z.number().optional(),
  task_count: z.number().optional(),
  user_count: z.number().optional(),
  total_code_lines: z.number().optional(),
  actual_lines_per_day: z.number().nullable().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  need_calendar_efficiency_ratio: z.number().nullable().optional(),
  need_work_efficiency_ratio: z.number().nullable().optional(),
  need_ai_code_ratio: z.number().nullable().optional(),
  need_total_loc_net: z.number().nullable().optional(),
  need_actual_work_min: z.number().nullable().optional(),
  need_cost: z.number().nullable().optional(),
  need_eligible_count: z.number().optional(),
  need_total_count: z.number().optional(),
  need_baseline_calendar_min: z.number().optional(),
  need_actual_calendar_min: z.number().optional(),
  need_baseline_work_min: z.number().optional(),
  need_done_count: z.number().optional(),
});

const projectDetailResponseSchema = z.looseObject({
  project: projectListItemSchema.nullable(),
  need_calendar_efficiency_ratio: z.number().nullable().optional(),
  need_work_efficiency_ratio: z.number().nullable().optional(),
  need_ai_code_ratio: z.number().nullable().optional(),
  need_actual_calendar_min: z.number().nullable().optional(),
  need_baseline_calendar_min: z.number().nullable().optional(),
  need_actual_work_min: z.number().nullable().optional(),
  need_baseline_work_min: z.number().nullable().optional(),
  need_eligible_count: z.number().optional(),
  need_excluded_count: z.number().optional(),
  need_total_count: z.number().optional(),
  need_total_loc_net: z.number().optional(),
  need_cost: z.number().optional(),
  need_upstream_tokens: z.number().optional(),
  need_downstream_tokens: z.number().optional(),
});

const projectNeedItemSchema = needSummarySchema.extend({
  excluded: z.boolean(),
});

const projectNeedsResponseSchema = z.looseObject({
  data: z.array(projectNeedItemSchema).nullable(),
  total_count: z.number().optional(),
  eligible_count: z.number().optional(),
  excluded_count: z.number().optional(),
  stale_count: z.number().optional(),
});

const needRepoBranchOptionSchema = z.looseObject({
  repo_branch: z.string(),
  need_count: z.number(),
  last_active: z.string().nullable().optional(),
});

const needRepoOptionSchema = z.looseObject({
  repo_addr: z.string(),
  need_count: z.number(),
  last_active: z.string().nullable().optional(),
  branches: z.array(needRepoBranchOptionSchema),
});

const entityTrendSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      week_start: z.string(),
      efficiency_pct: z.number(),
      commit_count: z.number(),
      diff_lines: z.number(),
      need_count: z.number(),
      loc: z.number(),
      cost: z.number().optional(),
    }),
  ),
});

const needCommitSchema = z.looseObject({
  commit_id: z.string(),
  commit_time: z.string().nullable().optional(),
  user_name: z.string().optional(),
  diff_lines: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  comment: z.string().optional(),
  touched_files: z
    .union([z.array(z.string()), z.string()])
    .nullable()
    .optional(),
});

const userV2DetailSchema = z.looseObject({
  summary: userSummarySchema.nullable(),
  weeks: z.array(userProductivitySchema),
  needs: z
    .array(needSummarySchema)
    .nullable()
    .transform((needs) => needs ?? []),
  commits: z.array(needCommitSchema),
});

const needDetailSchema = z.looseObject({
  need_id: z.string(),
  status: z.string().optional(),
  boundary_source: z.string().optional(),
  boundary_confidence: z.string().nullable().optional(),
  boundary_key: z.string().optional(),
  repo_addr: z.string().optional(),
  repo_branch: z.string().optional(),
  primary_user_id: z.string().optional(),
  contributor_user_ids: z.array(z.string()).nullable().optional(),
  touched_files: z
    .union([z.array(z.string()), z.string()])
    .nullable()
    .optional(),
  team_profile_used: z.string().optional(),
  dev_start_ts: z.string().nullable().optional(),
  dev_end_ts: z.string().nullable().optional(),
  dev_duration_min: z.number().nullable().optional(),
  total_session_active_person_min: z.number().nullable().optional(),
  estimate_uncovered_human_min: z.number().nullable().optional(),
  total_active_work_corrected_min: z.number().nullable().optional(),
  total_calendar_min: z.number().nullable().optional(),
  total_think_min: z.number().nullable().optional(),
  total_exec_min: z.number().nullable().optional(),
  total_verify_min: z.number().nullable().optional(),
  total_other_min: z.number().nullable().optional(),
  commit_count: z.number().nullable().optional(),
  total_loc_net: z.number().nullable().optional(),
  total_files_touched: z.number().nullable().optional(),
  ai_covered_loc: z.number().nullable().optional(),
  uncovered_loc: z.number().nullable().optional(),
  uncovered_work_ratio: z.number().nullable().optional(),
  ai_code_ratio: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  churn_ratio: z.number().nullable().optional(),
  duplication_ratio: z.number().nullable().optional(),
  revert_count: z.number().nullable().optional(),
  revert_rate: z.number().nullable().optional(),
  post_generation_deletion_ratio: z.number().nullable().optional(),
  feature_dependency_risk: z.string().optional(),
  silica_signal: z.string().optional(),
  ai_code_ratio_signal: z.string().optional(),
  uncovered_work_signal: z.string().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  efficiency_band_low: z.number().nullable().optional(),
  efficiency_band_high: z.number().nullable().optional(),
  work_efficiency_ratio: z.number().nullable().optional(),
  confidence_level: z.string().optional(),
  outlier_flag: z.boolean().optional(),
  calendar_outlier_flag: z.boolean().optional(),
  work_outlier_flag: z.boolean().optional(),
  coverage_eligible: z.boolean().optional(),
  baseline_fused_work_min: z.number().nullable().optional(),
  baseline_calendar_min: z.number().nullable().optional(),
  reason: z.string().optional(),
});

const needSessionSchema = z.looseObject({
  session_id: z.string(),
  user_id: z.string().optional(),
  session_start_ts: z.string().nullable().optional(),
  session_end_ts: z.string().nullable().optional(),
  total_active_min: z.number().nullable().optional(),
  think_active_min: z.number().nullable().optional(),
  exec_active_min: z.number().nullable().optional(),
  verify_active_min: z.number().nullable().optional(),
  stage_confidence: z.string().optional(),
  summary: z.string().optional(),
});

const needBaselineSchema = z.looseObject({
  algo_think_min: z.number().nullable().optional(),
  algo_exec_min: z.number().nullable().optional(),
  algo_verify_min: z.number().nullable().optional(),
  algo_total_min: z.number().nullable().optional(),
  anchor_knn_min: z.number().nullable().optional(),
  anchor_knn_reason: z.string().nullable().optional(),
  llm_think_min: z.number().nullable().optional(),
  llm_exec_min: z.number().nullable().optional(),
  llm_verify_min: z.number().nullable().optional(),
  llm_total_min: z.number().nullable().optional(),
  llm_confidence: z.string().nullable().optional(),
  llm_reason: z.string().nullable().optional(),
  fused_work_min: z.number().nullable().optional(),
  spread_work_min: z.number().nullable().optional(),
  calendar_min: z.number().nullable().optional(),
  team_work_density: z.number().nullable().optional(),
});

const needV2DetailSchema = z.looseObject({
  need: needDetailSchema.nullable(),
  sessions: z
    .array(needSessionSchema)
    .nullable()
    .optional()
    .transform((sessions) => sessions ?? []),
  commits: z
    .array(needCommitSchema)
    .nullable()
    .optional()
    .transform((commits) => commits ?? []),
  stage_metrics: z
    .array(needSessionSchema)
    .nullable()
    .optional()
    .transform((metrics) => metrics ?? []),
  baseline_components: needBaselineSchema
    .nullable()
    .optional()
    .transform((components) => components ?? {}),
  confidence_signals: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((signals) => signals ?? {}),
  quality_signals: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((signals) => signals ?? {}),
});

const taskListItemSchema = z.looseObject({
  task_id: z.string(),
  session_id: z.string().optional(),
  commit_id: z.string().optional(),
  title: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  client_id: z.string().optional(),
  client_ide: z.string().optional(),
  client_version: z.string().optional(),
  client_os: z.string().optional(),
  client_os_version: z.string().optional(),
  caller: z.string().optional(),
  repo_addr: z.string().optional(),
  repo_branch: z.string().optional(),
  work_dir: z.string().optional(),
  work_dir_id: z.string().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  upstream_tokens: z.number().optional(),
  downstream_tokens: z.number().optional(),
  cost: z.number().optional(),
  silica: z.number().optional(),
  accept_ratio: z.number().optional(),
  diff_lines: z.number().optional(),
  task_ancient_minutes: z.number().nullable().optional(),
  task_ancient_minutes_reason: z.string().optional(),
  task_ancient_minutes_manual: z.number().nullable().optional(),
  task_ancient_minutes_reason_manual: z.string().optional(),
  task_real_minutes: z.number().nullable().optional(),
  task_real_minutes_reason: z.string().optional(),
  task_real_minutes_manual: z.number().nullable().optional(),
  task_real_minutes_reason_manual: z.string().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  org1: z.string().optional(),
  org2: z.string().optional(),
  org3: z.string().optional(),
  org4: z.string().optional(),
  org5: z.string().optional(),
  org6: z.string().optional(),
  org7: z.string().optional(),
  org8: z.string().optional(),
  org9: z.string().optional(),
  org_display: z.string().optional(),
});

const userGroupMetricSchema = z.looseObject({
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  day_count: z.number(),
  task_count: z.number(),
  commit_count: z.number(),
  task_diff_lines: z.number(),
  upstream_tokens: z.number(),
  downstream_tokens: z.number(),
  cost: z.number(),
  task_real_minutes: z.number(),
  task_ancient_minutes: z.number(),
  task_efficiency_ratio: z.number().nullable(),
  commit_diff_lines: z.number(),
  commit_ancient_minutes: z.number(),
  commit_real_minutes: z.number(),
  commit_efficiency_ratio: z.number().nullable(),
});

const userGroupDetailSchema = z.looseObject({
  group: z
    .looseObject({
      group_id: z.string(),
      name: z.string(),
      org_name: z.string().optional(),
      user_ids: z.unknown().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })
    .nullable(),
  summary: userGroupMetricSchema,
  members: z.array(
    userGroupMetricSchema.extend({
      user_id: z.string(),
      user_name: z.string(),
    }),
  ),
});

const conversationSchema = z.looseObject({
  id: z.number().optional(),
  session_id: z.string().optional(),
  request_id: z.string().optional(),
  user_id: z.string().optional(),
  username: z.string().optional(),
  task_id: z.string().optional(),
  sender: z.string().optional(),
  prompt_mode: z.string().optional(),
  mode: z.string().optional(),
  model: z.string().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  process_time: z.number().nullable().optional(),
  process_ttft: z.number().nullable().optional(),
  upstream_tokens: z.number().nullable().optional(),
  downstream_tokens: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
  diff_lines: z.number().nullable().optional(),
  user_input: z.string().optional(),
  request_content: z.string().optional(),
  error_code: z.string().optional(),
  error_reason: z.string().optional(),
});

const taskDetailResponseSchema = z.looseObject({
  task: taskListItemSchema.nullable(),
  conversations: z.array(conversationSchema).optional(),
  efficiency_ratio: z.number().nullable().optional(),
});

const commitListItemSchema = z.looseObject({
  commit_id: z.string(),
  commit_time: z.string().nullable().optional(),
  repo_addr: z.string().optional(),
  repo_branch: z.string().optional(),
  git_user_name: z.string().optional(),
  git_user_email: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  client_id: z.string().optional(),
  work_dir: z.string().optional(),
  diff_lines: z.number().nullable().optional(),
  commit_ancient_minutes: z.number().nullable().optional(),
  commit_ancient_minutes_manual: z.number().nullable().optional(),
  commit_real_minutes: z.number().nullable().optional(),
  commit_real_minutes_manual: z.number().nullable().optional(),
  commit_real_ai_minutes: z.number().nullable().optional(),
  commit_real_ancient_minutes: z.number().nullable().optional(),
  comment: z.string().optional(),
  cost: z.number().nullable().optional(),
  upstream_tokens: z.number().nullable().optional(),
  downstream_tokens: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  org1: z.string().optional(),
  org2: z.string().optional(),
  org3: z.string().optional(),
  org4: z.string().optional(),
  org5: z.string().optional(),
  org6: z.string().optional(),
  org7: z.string().optional(),
  org8: z.string().optional(),
  org9: z.string().optional(),
  org_display: z.string().optional(),
});

const repoCommitItemSchema = z.looseObject({
  commit_id: z.string(),
  commit_time: z.string().nullable().optional(),
  repo_branch: z.string().optional(),
  git_user_name: z.string().optional(),
  comment: z.string().optional(),
  diff_lines: z.number().nullable().optional(),
  commit_real_minutes: z.number().nullable().optional(),
  commit_real_minutes_manual: z.number().nullable().optional(),
  commit_ancient_minutes: z.number().nullable().optional(),
  commit_ancient_minutes_manual: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  silica_reason: z.string().optional(),
  matched_tasks: z
    .array(
      z.looseObject({
        task_id: z.string(),
        user_name: z.string().optional(),
        user_id: z.string().optional(),
        silica: z.number().nullable().optional(),
      }),
    )
    .optional(),
  cost: z.number().nullable().optional(),
  upstream_tokens: z.number().nullable().optional(),
  downstream_tokens: z.number().nullable().optional(),
  efficiency_ratio: z.number().nullable().optional(),
});

const repoEfficiencySchema = z.looseObject({
  repo_ancient_minutes: z.number().nullable().optional(),
  repo_real_minutes: z.number().nullable().optional(),
  efficiency_ratio: z.number().nullable().optional(),
  repo_ancient_minutes_reason: z.string().optional(),
  repo_real_minutes_reason: z.string().optional(),
});

const repoDetailResponseSchema = z.looseObject({
  repo_addr: z.string().optional(),
  repo_branch: z.string().optional(),
  branches: z.array(z.string()).optional(),
  commits: z.array(repoCommitItemSchema).optional(),
  tasks: z.array(taskListItemSchema).optional(),
  efficiency: repoEfficiencySchema.nullable().optional(),
  summary: z
    .looseObject({
      commit_count: z.number().optional(),
      task_count: z.number().optional(),
      ai_code_ratio: z.number().nullable().optional(),
    })
    .optional(),
});

const repoBranchesResponseSchema = z.looseObject({
  branches: z.array(z.string()),
});

const createProjectResponseSchema = z.looseObject({
  project_id: z.string(),
  name: z.string().optional(),
});

const checkConflictsResponseSchema = z.looseObject({
  conflicts: z.array(
    z.looseObject({
      commit_id: z.string(),
      project_id: z.string(),
      project_name: z.string(),
    }),
  ),
});

const commitDetailSchema = z.looseObject({
  commit_id: z.string(),
  commit_time: z.string().nullable().optional(),
  repo_addr: z.string().optional(),
  repo_branch: z.string().optional(),
  git_user_name: z.string().optional(),
  git_user_email: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  comment: z.string().optional(),
  diff_lines: z.number().nullable().optional(),
  commit_ancient_minutes: z.number().nullable().optional(),
  commit_ancient_minutes_reason: z.string().optional(),
  commit_ancient_minutes_manual: z.number().nullable().optional(),
  commit_ancient_minutes_reason_manual: z.string().optional(),
  commit_real_minutes: z.number().nullable().optional(),
  commit_real_minutes_reason: z.string().optional(),
  commit_real_minutes_manual: z.number().nullable().optional(),
  commit_real_minutes_reason_manual: z.string().optional(),
  silica: z.number().nullable().optional(),
  efficiency_ratio: z.number().nullable().optional(),
});

const relatedTaskSchema = z.looseObject({
  task_id: z.string(),
  user_name: z.string().optional(),
  start_time: z.string().nullable().optional(),
  task_real_minutes: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
  diff_lines: z.number().nullable().optional(),
});

const commitDetailResponseSchema = z.looseObject({
  commit: commitDetailSchema.nullable(),
  related_tasks: z
    .array(relatedTaskSchema)
    .nullable()
    .optional()
    .transform((tasks) => tasks ?? []),
  efficiency_ratio: z.number().nullable().optional(),
  total_cost: z.number().nullable().optional(),
  silica: z.number().nullable().optional(),
  upstream_tokens: z.number().nullable().optional(),
  downstream_tokens: z.number().nullable().optional(),
});

// User×week aggregate rows (decimal-ratio efficiency_ratio).
export async function getEfficiencyAggregate(p: {
  startDate?: string;
  endDate?: string;
  userId?: string;
}): Promise<EfficiencyV2AggregateResponse> {
  const path = `${BASE}/efficiency${qs({
    startDate: p.startDate,
    endDate: p.endDate,
    userId: p.userId,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/efficiency",
    schema: efficiencyAggregateSchema,
    fallback: { total: 0, data: [] },
  });
}

// Fetch every user page before client-side ranking/distribution.
export async function getAllUsers(p: {
  startDate?: string;
  endDate?: string;
}): Promise<UserV2Row[]> {
  const maxPages = 50;
  const pageSize = 500;
  const all: UserV2Row[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages; page += 1) {
    const path = `${BASE}/users${qs({
      startDate: p.startDate,
      endDate: p.endDate,
      page: String(page),
      pageSize: String(pageSize),
    })}`;
    const response = await request<ApiList<UserV2Row>>(path, {
      endpoint: "GET /kanban/api/v2/users",
      schema: apiListSchema(userSummarySchema),
      fallback: { total: 0, page, pageSize, data: [] },
    });
    const rows = response.data ?? [];
    all.push(...rows);
    total = response.total;
    if (rows.length === 0 || all.length >= total) break;
  }

  return all;
}

// /v2/user-names → workspace roster for display-name resolution. Bare array of
// {user_id, universal_id, real_name, emp_no}; date-independent. Used by
// useUserNameMap so contributor/member rows show "真名(工号)" instead of raw ids.
export async function getUserNames(): Promise<UserNameRow[]> {
  return request(`${BASE}/user-names`, {
    endpoint: "GET /kanban/api/v2/user-names",
    schema: z.array(
      z.looseObject({
        user_id: z.string(),
        universal_id: z.string().optional(),
        real_name: z.string(),
        emp_no: z.string(),
      }),
    ),
    fallback: [],
  });
}

// Fetch every whole-repository page before client-side ranking/distribution.
export async function getAllRepos(p: {
  startDate?: string;
  endDate?: string;
}): Promise<RepoListItem[]> {
  const maxPages = 100;
  const pageSize = 500;
  const all: RepoListItem[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages; page += 1) {
    const path = `${BASE}/repos${qs({
      startDate: p.startDate,
      endDate: p.endDate,
      page: String(page),
      pageSize: String(pageSize),
    })}`;
    const response = await request<ApiList<RepoListItem>>(path, {
      endpoint: "GET /kanban/api/v2/repos",
      schema: apiListSchema(repoListItemSchema),
      fallback: { total: 0, page, pageSize, data: [] },
    });
    const rows = response.data ?? [];
    all.push(...rows);
    total = response.total;
    if (rows.length === 0 || all.length >= total) break;
  }

  return all;
}

// Project list uses a non-paginated {data: []} envelope.
export async function getProjectList(p: {
  order?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ProjectListItem[]> {
  const path = `${BASE}/projects${qs({
    order: p.order,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  const response = await request<ApiData<ProjectListItem>>(path, {
    endpoint: "GET /kanban/api/v2/projects",
    schema: z.looseObject({ data: z.array(projectListItemSchema) }),
    fallback: { data: [] },
  });
  return response.data ?? [];
}

// ============================================================================
// Usage dimension (department aggregation + per-user). These routes preserve
// the source dashboard's split contract: department/user statistics go through
// the chat proxy and mode usage comes from the regular kanban API.
// ============================================================================

const USAGE_DEPT = `${CHAT}/stats/departments`;
const USAGE_USER = `${CHAT}/stats/users`;

const usageDeptOverviewSchema = z.looseObject({
  dept_id: z.string(),
  include_children: z.boolean(),
  active_users: z.number(),
  total_requests: z.number(),
  avg_requests_per_user: z.number(),
  sum_prompt_tokens: z.number(),
  sum_completion_tokens: z.number(),
  sum_total_tokens: z.number(),
  avg_prompt_tokens_per_user: z.number(),
  avg_completion_tokens_per_user: z.number(),
  avg_total_tokens_per_user: z.number(),
  total_sessions: z.number(),
  avg_ttft_ms: z.number(),
  avg_token_output_speed: z.number(),
  avg_duration_ms: z.number(),
  success_rate: z.number(),
  error_rate: z.number(),
});

const EMPTY_USAGE_DEPT_OVERVIEW: DeptOverviewResp = {
  dept_id: "",
  include_children: false,
  active_users: 0,
  total_requests: 0,
  avg_requests_per_user: 0,
  sum_prompt_tokens: 0,
  sum_completion_tokens: 0,
  sum_total_tokens: 0,
  avg_prompt_tokens_per_user: 0,
  avg_completion_tokens_per_user: 0,
  avg_total_tokens_per_user: 0,
  total_sessions: 0,
  avg_ttft_ms: 0,
  avg_token_output_speed: 0,
  avg_duration_ms: 0,
  success_rate: 0,
  error_rate: 0,
};

const usageActiveUsersSchema = z.looseObject({
  dau: z.number(),
  wau: z.number(),
  mau: z.number(),
  dau_wau_ratio: z.number(),
  daily_trend: z.array(
    z.looseObject({
      date: z.string(),
      dau: z.number(),
      wau: z.number(),
      mau: z.number(),
      dau_wau_ratio: z.number(),
    }),
  ),
});

const EMPTY_USAGE_ACTIVE_USERS: DeptActiveUsersResp = {
  dau: 0,
  wau: 0,
  mau: 0,
  dau_wau_ratio: 0,
  daily_trend: [],
};

const usageTrendPointSchema = z.looseObject({
  date: z.string(),
  request_count: z.number(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  active_users: z.number(),
});

const usageTrendSchema = z.looseObject({
  trend: z.array(usageTrendPointSchema),
});

const usageModelSchema = z.looseObject({
  model: z.string(),
  request_count: z.number(),
  request_pct: z.number(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  token_pct: z.number(),
  input_output_ratio: z.number(),
  success_rate: z.number(),
  estimated_total_cost: z.number(),
});

const autoRoutingSchema = z.looseObject({
  model: z.string().optional(),
  routed_model: z.string().optional(),
  count: z.number().optional(),
  request_count: z.number().optional(),
  pct: z.number().optional(),
  request_pct: z.number().optional(),
});

const usageModelsSchema = z.looseObject({
  models: z.array(usageModelSchema),
  auto_routing: z.array(autoRoutingSchema),
});

const usageWeeklySchema = z.looseObject({
  weekdays: z.array(
    z.looseObject({
      weekday: z.number(),
      weekday_name: z.string(),
      request_count: z.number(),
    }),
  ),
});

const usageResultsSchema = z.looseObject({
  total_requests: z.number(),
  success_requests: z.number(),
  error_requests: z.number(),
  success_rate: z.number(),
  error_rate: z.number(),
  models: z.array(
    z.looseObject({
      model: z.string(),
      total_requests: z.number(),
      error_requests: z.number(),
      success_rate: z.number(),
      error_rate: z.number(),
    }),
  ),
});

const periodSpanSchema = z.looseObject({
  start: z.string(),
  end: z.string(),
  total_requests: z.number(),
  sum_total_tokens: z.number(),
});

const usagePeriodCompareSchema = z.looseObject({
  current_period: periodSpanSchema,
  previous_period: periodSpanSchema,
  request_change_pct: z.number(),
  token_change_pct: z.number(),
});

const usageModeSchema = z.looseObject({
  dept_id: z.string(),
  items: z.array(
    z.looseObject({
      mode: z.string(),
      user_count: z.number(),
      request_count: z.number(),
    }),
  ),
});

const usageMemberSchema = z.looseObject({
  universal_id: z.string(),
  username: z.string().nullable().optional(),
  user_id: z.string().optional(),
  total_requests: z.number(),
  sum_prompt_tokens: z.number().optional(),
  sum_completion_tokens: z.number().optional(),
  sum_total_tokens: z.number(),
  success_rate: z.number(),
  avg_duration_ms: z.number().optional(),
  active_days: z.number(),
  estimated_total_cost: z.number().optional(),
});

const usageMembersSchema = z.looseObject({
  dept_id: z.string(),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  members: z.array(usageMemberSchema),
});

const userDetailRowSchema = z.looseObject({
  universal_id: z.string(),
  username: z.string().nullable().optional(),
  total_requests: z.number(),
  success_requests: z.number(),
  error_requests: z.number(),
  success_rate: z.number(),
  error_rate: z.number(),
  sum_prompt_tokens: z.number(),
  sum_completion_tokens: z.number(),
  sum_total_tokens: z.number(),
  sum_cache_tokens: z.number(),
  total_sessions: z.number(),
  active_days: z.number(),
  avg_duration_ms: z.number(),
  avg_ttft_ms: z.number(),
  avg_token_output_speed: z.number(),
  model_preference: z.string().nullable().optional(),
  estimated_total_cost: z.number(),
});

const userDetailSchema = z.looseObject({
  user_detail: userDetailRowSchema,
  models: z.array(usageModelSchema),
  auto_routing: z.array(autoRoutingSchema),
  departments: z.array(
    z.looseObject({
      user_id: z.string().optional(),
      username: z.string().optional(),
      dept_id: z.string(),
      dept_name: z.string(),
      is_main: z.number(),
    }),
  ),
});

const userTrendPointSchema = z.looseObject({
  date: z.string(),
  total_requests: z.number().optional(),
  success_requests: z.number().optional(),
  error_requests: z.number().optional(),
  sum_prompt_tokens: z.number().optional(),
  sum_completion_tokens: z.number().optional(),
  sum_total_tokens: z.number().optional(),
  sum_cache_tokens: z.number().optional(),
  unique_task_count: z.number().optional(),
  avg_duration_ms: z.number().nullable().optional(),
  avg_first_token_duration_ms: z.number().nullable().optional(),
  estimated_total_cost: z.number().nullable().optional(),
  estimated_input_cost: z.number().nullable().optional(),
  estimated_output_cost: z.number().nullable().optional(),
  estimated_cache_cost: z.number().nullable().optional(),
  estimated_request_cost: z.number().nullable().optional(),
  model_preference: z.string().nullable().optional(),
  auto_router_breakdown: z.string().nullable().optional(),
});

const userTrendResponseSchema = z.union([
  z.array(userTrendPointSchema),
  z.looseObject({ trend: z.array(userTrendPointSchema) }),
]);

const EMPTY_USAGE_USER_DETAIL: UserDetailResp = {
  user_detail: {
    universal_id: "",
    total_requests: 0,
    success_requests: 0,
    error_requests: 0,
    success_rate: 0,
    error_rate: 0,
    sum_prompt_tokens: 0,
    sum_completion_tokens: 0,
    sum_total_tokens: 0,
    sum_cache_tokens: 0,
    total_sessions: 0,
    active_days: 0,
    avg_duration_ms: 0,
    avg_ttft_ms: 0,
    avg_token_output_speed: 0,
    estimated_total_cost: 0,
  },
  models: [],
  auto_routing: [],
  departments: [],
};

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
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/overview${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/overview",
    schema: usageDeptOverviewSchema,
    fallback: EMPTY_USAGE_DEPT_OVERVIEW,
    kind: "chat",
  });
}

export async function getUsageDeptActiveUsers(
  q: DeptQuery,
): Promise<DeptActiveUsersResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/active-users${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/active-users",
    schema: usageActiveUsersSchema,
    fallback: EMPTY_USAGE_ACTIVE_USERS,
    kind: "chat",
  });
}

export async function getUsageDeptTrend(
  q: DeptQuery,
): Promise<DeptTrendResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/trend${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/trend",
    schema: usageTrendSchema,
    fallback: { trend: [] },
    kind: "chat",
  });
}

export async function getUsageDeptModels(
  q: DeptQuery,
): Promise<DeptModelsResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/models/usage${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/models/usage",
    schema: usageModelsSchema,
    fallback: { models: [], auto_routing: [] },
    kind: "chat",
  });
}

export async function getUsageDeptWeekly(
  q: DeptQuery,
): Promise<DeptWeeklyResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/distribution/weekly${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/distribution/weekly",
    schema: usageWeeklySchema,
    fallback: { weekdays: [] },
    kind: "chat",
  });
}

export async function getUsageDeptResults(
  q: DeptQuery,
): Promise<DeptResultsResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/results${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/results",
    schema: usageResultsSchema,
    fallback: {
      total_requests: 0,
      success_requests: 0,
      error_requests: 0,
      success_rate: 0,
      error_rate: 0,
      models: [],
    },
    kind: "chat",
  });
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
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/usage/period-compare${qs({
    current_start: q.start,
    current_end: q.end,
    previous_start: prevStart,
    previous_end: prevEnd,
    include_children: q.includeChildren ? "true" : "false",
  })}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/usage/period-compare",
    schema: usagePeriodCompareSchema,
    fallback: {
      current_period: {
        start: q.start,
        end: q.end,
        total_requests: 0,
        sum_total_tokens: 0,
      },
      previous_period: {
        start: prevStart,
        end: prevEnd,
        total_requests: 0,
        sum_total_tokens: 0,
      },
      request_change_pct: 0,
      token_change_pct: 0,
    },
    kind: "chat",
  });
}

// Kanban-local mode usage (the only non-chat-stats card in the source): one
// row per conversation mode with deduped user_count + request_count.
export async function getUsageDeptModeUsage(
  q: DeptQuery,
): Promise<DeptModeUsageResp> {
  const path = `${BASE}/dept-tree/mode-usage${qs({
    dept_id: q.deptId,
    include_children: q.includeChildren ? "true" : "false",
    startDate: q.start,
    endDate: q.end,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/dept-tree/mode-usage",
    schema: usageModeSchema,
    fallback: { dept_id: q.deptId, items: [] },
  });
}

export async function getUsageDeptMembers(
  q: MembersQuery,
): Promise<DeptMembersResp> {
  const path = `${USAGE_DEPT}/${encodeURIComponent(q.deptId)}/members${qs({
    ...deptParams(q),
    page: String(q.page),
    page_size: String(q.pageSize),
    sort_by: q.sortBy,
    sort_order: q.sortOrder,
    search: q.search || undefined,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/members",
    schema: usageMembersSchema,
    fallback: {
      dept_id: q.deptId,
      total: 0,
      page: q.page,
      page_size: q.pageSize,
      members: [],
    },
    kind: "chat",
  });
}

// ---- Per-user ----

export async function getUsageUserDetail(
  uid: string,
  start: string,
  end: string,
): Promise<UserDetailResp> {
  const path = `${USAGE_USER}/${encodeURIComponent(uid)}/detail${qs({
    start_date: start,
    end_date: end,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/users/:id/detail",
    schema: userDetailSchema,
    fallback: EMPTY_USAGE_USER_DETAIL,
    kind: "chat",
  });
}

// Per-user per-day trend. The source normalizes a bare-array OR {trend:[]}
// backend response into a flat array; the api layer returns that normalized
// array so the hook consumer never sees the two shapes.
export async function getUsageUserTrend(
  uid: string,
  start: string,
  end: string,
): Promise<UserTrendPoint[]> {
  const path = `${USAGE_USER}/${encodeURIComponent(uid)}/trend${qs({
    start_date: start,
    end_date: end,
  })}`;
  const response = await request<
    UserTrendPoint[] | { trend: UserTrendPoint[] }
  >(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/users/:id/trend",
    schema: userTrendResponseSchema,
    fallback: [],
    kind: "chat",
  });
  return Array.isArray(response) ? response : response.trend;
}

// ============================================================================
// Cost dimension (department aggregation + model/team breakdown + per-user).
// These endpoints share the chat statistics transport and wrapped response
// envelope used by the usage dimension.
// ============================================================================

const COST_DEPT = `${CHAT}/stats/departments`;

const costPeriodSpanSchema = z.looseObject({
  start: z.string(),
  end: z.string(),
  total_cost: z.number(),
  input_cost: z.number(),
  output_cost: z.number(),
  cache_cost: z.number(),
});

const costOverviewSchema = z.looseObject({
  dept_id: z.string(),
  include_children: z.boolean(),
  total_cost: z.number(),
  input_cost: z.number(),
  output_cost: z.number(),
  cache_cost: z.number(),
  request_cost: z.number(),
  input_cost_pct: z.number(),
  output_cost_pct: z.number(),
  daily_avg_cost: z.number(),
  per_user_avg_cost: z.number(),
  per_1k_token_cost: z.number(),
  active_users: z.number(),
  total_tokens: z.number(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  cache_tokens: z.number(),
  period_days: z.number(),
  cache: z.looseObject({
    hit_input_tokens: z.number(),
    hit_input_cost: z.number(),
    miss_input_tokens: z.number(),
    miss_input_cost: z.number(),
    hit_rate_pct: z.number(),
    savings: z.number(),
  }),
});

const costPeriodCompareSchema = z.looseObject({
  current_period: costPeriodSpanSchema,
  previous_period: costPeriodSpanSchema,
  cost_change_pct: z.number(),
  input_cost_change_pct: z.number(),
  output_cost_change_pct: z.number(),
});

const costUnitPriceSchema = z.looseObject({
  input_per_1k: z.number().nullable(),
  output_per_1k: z.number().nullable(),
  cache_per_1k: z.number().nullable(),
});

const costModelSchema = z.looseObject({
  model: z.string(),
  total_cost: z.number(),
  input_cost: z.number(),
  output_cost: z.number(),
  cache_cost: z.number(),
  request_cost: z.number(),
  cost_pct: z.number(),
  request_count: z.number(),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  cache_tokens: z.number(),
  pricing_mode: z.string().nullable(),
  unit_price: costUnitPriceSchema,
  actual_avg_cost_per_1k: z.number(),
});

const costTrendPointSchema = z.looseObject({
  date: z.string(),
  total_cost: z.number(),
});

const costModelTrendSchema = z.looseObject({
  series: z.array(
    z.looseObject({
      model: z.string(),
      data: z.array(costTrendPointSchema),
    }),
  ),
});

const costModelCompositionSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      model: z.string(),
      total_cost: z.number(),
      cost_pct: z.number(),
    }),
  ),
});

const costAnomalySchema = z.looseObject({
  dept_id: z.string(),
  daily_spike_count: z.number(),
  user_spike_count: z.number(),
  zero_cost_active_users: z.number(),
  daily_spike_threshold: z.number(),
  user_spike_threshold: z.number(),
});

const costSubDeptSchema = z.looseObject({
  parent_dept_id: z.string(),
  items: z.array(
    z.looseObject({
      dept_id: z.string(),
      dept_name: z.string(),
      total_cost: z.number(),
      input_cost: z.number(),
      output_cost: z.number(),
      cache_cost: z.number(),
      cost_pct: z.number(),
      active_users: z.number(),
      total_tokens: z.number(),
    }),
  ),
});

const costTeamTrendSchema = z.looseObject({
  series: z.array(
    z.looseObject({
      dept_id: z.string(),
      dept_name: z.string(),
      data: z.array(costTrendPointSchema),
    }),
  ),
});

const costTeamCompositionSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      dept_id: z.string(),
      dept_name: z.string(),
      total_cost: z.number(),
      cost_pct: z.number(),
    }),
  ),
});

const costUsersSchema = z.looseObject({
  dept_id: z.string(),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  users: z.array(
    z.looseObject({
      universal_id: z.string(),
      username: z.string().nullable(),
      user_id: z.string().optional(),
      total_cost: z.number(),
      input_cost: z.number(),
      output_cost: z.number(),
      cache_cost: z.number(),
      request_cost: z.number(),
      cost_pct: z.number(),
      request_count: z.number(),
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
      cache_tokens: z.number(),
      active_days: z.number(),
    }),
  ),
});

const EMPTY_COST_OVERVIEW: CostOverviewResp = {
  dept_id: "",
  include_children: false,
  total_cost: 0,
  input_cost: 0,
  output_cost: 0,
  cache_cost: 0,
  request_cost: 0,
  input_cost_pct: 0,
  output_cost_pct: 0,
  daily_avg_cost: 0,
  per_user_avg_cost: 0,
  per_1k_token_cost: 0,
  active_users: 0,
  total_tokens: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  cache_tokens: 0,
  period_days: 0,
  cache: {
    hit_input_tokens: 0,
    hit_input_cost: 0,
    miss_input_tokens: 0,
    miss_input_cost: 0,
    hit_rate_pct: 0,
    savings: 0,
  },
};

// ---- Department aggregation ----

export async function getCostOverview(
  q: DeptQuery,
): Promise<CostOverviewResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/overview${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/overview",
    schema: costOverviewSchema,
    fallback: { ...EMPTY_COST_OVERVIEW, dept_id: q.deptId },
    kind: "chat",
  });
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
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/period-compare${qs({
    current_start: q.start,
    current_end: q.end,
    previous_start: prevStart,
    previous_end: prevEnd,
    include_children: q.includeChildren ? "true" : "false",
  })}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/period-compare",
    schema: costPeriodCompareSchema,
    fallback: {
      current_period: {
        start: q.start,
        end: q.end,
        total_cost: 0,
        input_cost: 0,
        output_cost: 0,
        cache_cost: 0,
      },
      previous_period: {
        start: prevStart,
        end: prevEnd,
        total_cost: 0,
        input_cost: 0,
        output_cost: 0,
        cache_cost: 0,
      },
      cost_change_pct: 0,
      input_cost_change_pct: 0,
      output_cost_change_pct: 0,
    },
    kind: "chat",
  });
}

// ---- Model breakdown ----

export async function getCostModels(q: DeptQuery): Promise<CostModelsResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/models${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/cost/models",
    schema: z.looseObject({ models: z.array(costModelSchema) }),
    fallback: { models: [] },
    kind: "chat",
  });
}

export async function getCostModelTrend(
  q: DeptQuery,
): Promise<CostModelTrendResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/model-trend${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/model-trend",
    schema: costModelTrendSchema,
    fallback: { series: [] },
    kind: "chat",
  });
}

export async function getCostModelComposition(
  q: DeptQuery,
): Promise<CostModelCompositionResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/composition/models${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/composition/models",
    schema: costModelCompositionSchema,
    fallback: { items: [] },
    kind: "chat",
  });
}

// ---- Anomaly detection ----

export async function getCostAnomaly(
  q: DeptQuery,
): Promise<CostAnomalyResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/anomaly${qs(deptParams(q))}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/cost/anomaly",
    schema: costAnomalySchema,
    fallback: {
      dept_id: q.deptId,
      daily_spike_count: 0,
      user_spike_count: 0,
      zero_cost_active_users: 0,
      daily_spike_threshold: 0,
      user_spike_threshold: 0,
    },
    kind: "chat",
  });
}

// ---- Team (sub-department) breakdown ----

export async function getCostSubDepts(
  q: DeptQuery,
): Promise<CostSubDeptResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/sub-departments${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/sub-departments",
    schema: costSubDeptSchema,
    fallback: { parent_dept_id: q.deptId, items: [] },
    kind: "chat",
  });
}

export async function getCostTeamTrend(
  q: DeptQuery,
): Promise<CostTeamTrendResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/team-trend${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/team-trend",
    schema: costTeamTrendSchema,
    fallback: { series: [] },
    kind: "chat",
  });
}

export async function getCostTeamComposition(
  q: DeptQuery,
): Promise<CostTeamCompositionResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/composition/teams${qs(deptParams(q))}`;
  return request(path, {
    endpoint:
      "GET /kanban/api/v2/chat/stats/departments/:id/cost/composition/teams",
    schema: costTeamCompositionSchema,
    fallback: { items: [] },
    kind: "chat",
  });
}

// ---- Per-user (members) ----

export async function getCostMembers(
  q: CostMembersQuery,
): Promise<CostUsersResp> {
  const path = `${COST_DEPT}/${encodeURIComponent(q.deptId)}/cost/users${qs({
    ...deptParams(q),
    page: String(q.page),
    page_size: String(q.pageSize),
    sort_by: q.sortBy,
    sort_order: q.sortOrder,
    search: q.search || undefined,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/departments/:id/cost/users",
    schema: costUsersSchema,
    fallback: {
      dept_id: q.deptId,
      total: 0,
      page: q.page,
      page_size: q.pageSize,
      users: [],
    },
    kind: "chat",
  });
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
  const path = `${BASE}/users/${encodeURIComponent(userId)}${qs({
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/users/:id",
    schema: userV2DetailSchema,
    fallback: { summary: null, weeks: [], needs: [], commits: [] },
  });
}

export async function getUserGroupDetail(
  groupId: string,
  p: { startDate?: string; endDate?: string },
): Promise<UserGroupDetailResponse> {
  const path = `${BASE}/user-groups/${encodeURIComponent(groupId)}${qs({
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/user-groups/:id",
    schema: userGroupDetailSchema,
    fallback: {
      group: null,
      summary: {
        day_count: 0,
        task_count: 0,
        commit_count: 0,
        task_diff_lines: 0,
        upstream_tokens: 0,
        downstream_tokens: 0,
        cost: 0,
        task_real_minutes: 0,
        task_ancient_minutes: 0,
        task_efficiency_ratio: null,
        commit_diff_lines: 0,
        commit_ancient_minutes: 0,
        commit_real_minutes: 0,
        commit_efficiency_ratio: null,
      },
      members: [],
    },
  });
}

export async function deleteUserGroup(groupId: string): Promise<void> {
  await request(`${BASE}/user-groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
    endpoint: "DELETE /kanban/api/v2/user-groups/:id",
    schema: z.unknown(),
    fallback: undefined,
  });
}

// /v2/repos/detail → repo scope (single branch) commits/tasks + efficiency.
export async function getRepoDetailV2(p: {
  repoAddr: string;
  repoBranch?: string;
  startDate?: string;
  endDate?: string;
}): Promise<RepoDetailResponse> {
  const path = `${BASE}/repos/detail${qs({
    repoAddr: p.repoAddr,
    repoBranch: p.repoBranch,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/repos/detail",
    schema: repoDetailResponseSchema,
    fallback: {
      repo_addr: p.repoAddr,
      repo_branch: p.repoBranch ?? "",
      branches: [],
      commits: [],
      tasks: [],
      efficiency: null,
    },
  });
}

// /v2/repos/branches → selectable branches for the repo-detail branch switcher.
export async function getRepoBranches(
  repoAddr: string,
): Promise<RepoBranchesResponse> {
  const path = `${BASE}/repos/branches${qs({ repoAddr })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/repos/branches",
    schema: repoBranchesResponseSchema,
    fallback: { branches: [] },
  });
}

// /v2/repo-trend → weekly aggregate trend (repoAddr empty = all repos).
export async function getRepoTrendV2(p: {
  repoAddr?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EntityTrendResponse> {
  const path = `${BASE}/repo-trend${qs({
    repoAddr: p.repoAddr,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/repo-trend",
    schema: entityTrendSchema,
    fallback: { data: [] },
  });
}

// /v2/projects/{id} → project detail (pure Need-scope ratio block).
export async function getProjectDetail(
  projectId: string,
): Promise<ProjectDetailResponse> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/projects/:id",
    schema: projectDetailResponseSchema,
    fallback: { project: null },
  });
}

// /v2/project-trend → weekly aggregate trend (projectId empty = all projects).
export async function getProjectTrendV2(p: {
  projectId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EntityTrendResponse> {
  const path = `${BASE}/project-trend${qs({
    projectId: p.projectId,
    startDate: p.startDate,
    endDate: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/project-trend",
    schema: entityTrendSchema,
    fallback: { data: [] },
  });
}

// /v2/projects/{id}/needs → candidate-pool needs with per-need excluded flag.
export async function getProjectNeeds(
  projectId: string,
): Promise<ProjectNeedsResponse> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/needs`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/projects/:id/needs",
    schema: projectNeedsResponseSchema,
    fallback: {
      data: [],
      total_count: 0,
      eligible_count: 0,
      excluded_count: 0,
      stale_count: 0,
    },
  });
}

// /v2/needs/{id} → need detail (sessions + commits + stage_metrics + baseline).
// Encode the complete need id once, matching the source dashboard. The Web
// runtime proxy preserves encoded slashes, so the backend receives the exact
// value stored in `needs.need_id`.
export async function getNeedDetailV2(
  needId: string,
): Promise<NeedsV2DetailResponse> {
  const path = `${BASE}/needs/${encodeURIComponent(needId)}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/needs/:id",
    schema: needV2DetailSchema,
    fallback: { need: null, sessions: [], commits: [] },
  });
}

// /v2/tasks/{id} → task detail (task + conversations; no time_segments).
export async function getTaskDetailV2(
  taskId: string,
): Promise<TaskDetailResponse> {
  const path = `${BASE}/tasks/${encodeURIComponent(taskId)}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/tasks/:id",
    schema: taskDetailResponseSchema,
    fallback: { task: null, conversations: [] },
  });
}

export async function getTasksList(
  p: ActivityListQuery,
): Promise<ApiList<TaskListItem>> {
  const path = `${BASE}/tasks${qs({
    startDate: p.startDate,
    endDate: p.endDate,
    page: String(p.page),
    pageSize: String(p.pageSize),
    order: p.order,
    userName: p.userName,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/tasks",
    schema: apiListSchema(taskListItemSchema),
    fallback: { total: 0, page: p.page, pageSize: p.pageSize, data: [] },
  });
}

// /v2/tasks/file → source summary/conversation text file. The browser opens
// this URL directly so the upstream response can keep its native content type.
export function getTaskFileUrl(
  type: "summary" | "conversation",
  taskId: string,
): string {
  return `${BASE}/tasks/file?type=${type}&taskId=${encodeURIComponent(taskId)}`;
}

// /v2/commits/{id} → commit detail + related tasks.
export async function getCommitDetailV2(
  commitId: string,
): Promise<CommitDetailResponse> {
  const path = `${BASE}/commits/${encodeURIComponent(commitId)}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/commits/:id",
    schema: commitDetailResponseSchema,
    fallback: { commit: null, related_tasks: [] },
  });
}

export async function getCommitsList(
  p: ActivityListQuery,
): Promise<ApiList<CommitListItem>> {
  const path = `${BASE}/commits${qs({
    startDate: p.startDate,
    endDate: p.endDate,
    page: String(p.page),
    pageSize: String(p.pageSize),
    order: p.order,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/commits",
    schema: apiListSchema(commitListItemSchema),
    fallback: { total: 0, page: p.page, pageSize: p.pageSize, data: [] },
  });
}

// ----------------------------------------------------------------------------
// Detail-dimension mutations (project / task / commit manual override, repo
// source management, need selection). The UI form layer drives these through
// the mock-aware mutation hooks in mutations.ts.
// Source paths: see efficiency-dashboard endpoints.ts (createProject,
// updateProject, deleteProject, updateProjectManual, addTasksToProject,
// addRepoToProject, removeRepoFromProject, checkProjectConflicts,
// updateProjectNeedSelection, updateTaskManualV2, updateCommitManualV2).
// ----------------------------------------------------------------------------

// /v2/need-repo-options → project "add source" repo selector data (needs-same-
// origin normalized repo addresses with their feature branches). Used by the
// project-detail SourceModal; mocked in queries.ts (mock.needRepoOptions).
export async function getNeedRepoOptions(): Promise<ApiData<NeedRepoOption>> {
  return request(`${BASE}/need-repo-options`, {
    endpoint: "GET /kanban/api/v2/need-repo-options",
    schema: z.looseObject({ data: z.array(needRepoOptionSchema) }),
    fallback: { data: [] },
  });
}

// POST /v2/projects → create a project; returns the new project_id.
export async function createProject(
  body: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return request(`${BASE}/projects`, {
    endpoint: "POST /kanban/api/v2/projects",
    method: "POST",
    body,
    schema: createProjectResponseSchema,
    fallback: { project_id: "" },
  });
}

// PUT /v2/projects/{id} → edit a project. ⚠️ repos MUST be echoed back as-is
// (the backend clears them when omitted); task_ids no longer belong to the
// project model.
export async function updateProject(
  projectId: string,
  body: UpdateProjectRequest,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/projects/:id",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// DELETE /v2/projects/{id} → delete a project.
export async function deleteProject(projectId: string): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}`;
  return request<void>(path, {
    endpoint: "DELETE /kanban/api/v2/projects/:id",
    method: "DELETE",
    schema: z.unknown(),
    fallback: undefined,
  });
}

// PUT /v2/projects/{id}/manual → manual override (3 minutes/reason pairs +
// start/end_time_manual).
export async function updateProjectManual(
  projectId: string,
  body: UpdateProjectManualRequest,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/manual`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/projects/:id/manual",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// POST /v2/projects/{id}/tasks → attach tasks (task_ids + same-length silica).
export async function addTasksToProject(
  projectId: string,
  body: AddTasksRequest,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/tasks`;
  return request<void>(path, {
    endpoint: "POST /kanban/api/v2/projects/:id/tasks",
    method: "POST",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// POST /v2/projects/{id}/repos → add a repo source filter (end_time whitelist
// now → null on the backend).
export async function addRepoToProject(
  projectId: string,
  body: AddRepoRequest,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/repos`;
  return request<void>(path, {
    endpoint: "POST /kanban/api/v2/projects/:id/repos",
    method: "POST",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// DELETE /v2/projects/{id}/repos/{index} → remove a repo source filter by
// array index (indexes drift after a remove, so callers must reload).
export async function removeRepoFromProject(
  projectId: string,
  index: number,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/repos/${index}`;
  return request<void>(path, {
    endpoint: "DELETE /kanban/api/v2/projects/:id/repos/:index",
    method: "DELETE",
    schema: z.unknown(),
    fallback: undefined,
  });
}

// POST /v2/projects/check-conflicts → detect commits that already belong to
// another project (two-phase add-to-project confirm flow).
export async function checkProjectConflicts(body: {
  commit_ids: string[];
}): Promise<CheckConflictsResponse> {
  return request(`${BASE}/projects/check-conflicts`, {
    endpoint: "POST /kanban/api/v2/projects/check-conflicts",
    method: "POST",
    body,
    schema: checkConflictsResponseSchema,
    fallback: { conflicts: [] },
  });
}

// PUT /v2/projects/{id}/needs/selection → include/exclude a single need (writes
// exclude_needs; does not affect the commit-level ancient caliber).
export async function updateProjectNeedSelection(
  projectId: string,
  body: UpdateProjectNeedSelectionRequest,
): Promise<void> {
  const path = `${BASE}/projects/${encodeURIComponent(projectId)}/needs/selection`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/projects/:id/needs/selection",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// PUT /v2/tasks/{id}/manual → task manual override (real/ancient minutes +
// reasons).
export async function updateTaskManual(
  taskId: string,
  body: UpdateTaskManualRequest,
): Promise<void> {
  const path = `${BASE}/tasks/${encodeURIComponent(taskId)}/manual`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/tasks/:id/manual",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// PUT /v2/commits/{id}/manual → commit manual override (ancient/real minutes +
// reasons).
export async function updateCommitManual(
  commitId: string,
  body: UpdateCommitManualRequest,
): Promise<void> {
  const path = `${BASE}/commits/${encodeURIComponent(commitId)}/manual`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/commits/:id/manual",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// ============================================================================
// Chat dimension (platform AI monitoring + admin settings). Source wrapped the
// chat-indicator-statistics proxy via the `chatStats` object (chatGet/chatPost
// under /api/v2/chat/*). Browser requests keep that contract under the shared
// /kanban proxy.
// ============================================================================

const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().nullable();
const nullableBooleanSchema = z.boolean().nullable();

// ---- Settings: model pricing CRUD ----

const modelPricingSchema = z.looseObject({
  id: z.number(),
  model_name: z.string(),
  pricing_mode: z.string(),
  input_price_per_token: nullableNumberSchema,
  output_price_per_token: nullableNumberSchema,
  cache_price_per_token: nullableNumberSchema,
  request_price: nullableNumberSchema,
  currency: z.string(),
  exchange_rate: nullableNumberSchema,
  original_currency: nullableStringSchema,
  original_input_price: nullableNumberSchema,
  original_output_price: nullableNumberSchema,
  original_cache_price: nullableNumberSchema,
  original_request_price: nullableNumberSchema,
  effective_date: z.string(),
  end_date: nullableStringSchema,
  notes: nullableStringSchema,
  created_at: z.string(),
});

export async function getChatPricing(): Promise<ModelPricing[]> {
  const path = `${CHAT}/pricing/models`;
  return request<ModelPricing[]>(path, {
    endpoint: "GET /kanban/api/v2/chat/pricing/models",
    kind: "chat",
    schema: z.array(modelPricingSchema),
    fallback: [],
  });
}

export async function createChatPricing(
  body: ModelPricingUpsert,
): Promise<ModelPricing> {
  const path = `${CHAT}/pricing/models`;
  return request<ModelPricing>(path, {
    endpoint: "POST /kanban/api/v2/chat/pricing/models",
    kind: "chat",
    method: "POST",
    body,
    schema: modelPricingSchema,
    fallback: {} as ModelPricing,
  });
}

export async function updateChatPricing(
  id: number,
  body: ModelPricingUpsert,
): Promise<ModelPricing> {
  const path = `${CHAT}/pricing/models/${id}`;
  return request<ModelPricing>(path, {
    endpoint: "PUT /kanban/api/v2/chat/pricing/models/:id",
    kind: "chat",
    method: "PUT",
    body,
    schema: modelPricingSchema,
    fallback: {} as ModelPricing,
  });
}

export async function deleteChatPricing(id: number): Promise<void> {
  const path = `${CHAT}/pricing/models/${id}`;
  return request<void>(path, {
    endpoint: "DELETE /kanban/api/v2/chat/pricing/models/:id",
    kind: "chat",
    method: "DELETE",
    schema: z.unknown(),
    fallback: undefined,
  });
}

// ---- Settings: datasource management ----

const chatDatasourceSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  source_type: z.string(),
  is_enabled: z.boolean(),
  config_json: nullableStringSchema,
  pg_host: nullableStringSchema,
  pg_port: nullableNumberSchema,
  pg_database: nullableStringSchema,
  pg_schema: nullableStringSchema,
  pg_table: nullableStringSchema,
  pg_username: nullableStringSchema,
  pg_password: nullableStringSchema,
  pg_ssl_mode: nullableStringSchema,
  es_hosts: nullableStringSchema,
  es_username: nullableStringSchema,
  es_password: nullableStringSchema,
  es_index: nullableStringSchema,
  es_verify_certs: nullableBooleanSchema,
  es_scroll_duration: nullableStringSchema,
  loki_url: nullableStringSchema,
  loki_username: nullableStringSchema,
  loki_password: nullableStringSchema,
  loki_tenant_id: nullableStringSchema,
  loki_verify_certs: nullableBooleanSchema,
  loki_queries: nullableStringSchema,
  max_open_conns: nullableNumberSchema,
  max_idle_conns: nullableNumberSchema,
  notes: nullableStringSchema,
  created_at: z.string(),
  updated_at: nullableStringSchema,
});

const chatDatasourceTestResultSchema = z.looseObject({
  success: z.boolean(),
  message: z.string(),
  ping_ms: z.number().default(0),
});

const chatSystemConfigSchema = z.record(z.string(), z.string());

export async function getChatDatasources(): Promise<ChatDatasource[]> {
  const path = `${CHAT}/datasources`;
  return request<ChatDatasource[]>(path, {
    endpoint: "GET /kanban/api/v2/chat/datasources",
    kind: "chat",
    schema: z.array(chatDatasourceSchema),
    fallback: [],
  });
}

export async function createChatDatasource(
  body: ChatDatasourceUpsert,
): Promise<ChatDatasource> {
  const path = `${CHAT}/datasources`;
  return request<ChatDatasource>(path, {
    endpoint: "POST /kanban/api/v2/chat/datasources",
    kind: "chat",
    method: "POST",
    body,
    schema: chatDatasourceSchema,
    fallback: {} as ChatDatasource,
  });
}

export async function updateChatDatasource(
  id: number,
  body: ChatDatasourceUpsert,
): Promise<ChatDatasource> {
  const path = `${CHAT}/datasources/${id}`;
  return request<ChatDatasource>(path, {
    endpoint: "PUT /kanban/api/v2/chat/datasources/:id",
    kind: "chat",
    method: "PUT",
    body,
    schema: chatDatasourceSchema,
    fallback: {} as ChatDatasource,
  });
}

export async function deleteChatDatasource(id: number): Promise<void> {
  const path = `${CHAT}/datasources/${id}`;
  return request<void>(path, {
    endpoint: "DELETE /kanban/api/v2/chat/datasources/:id",
    kind: "chat",
    method: "DELETE",
    schema: z.unknown(),
    fallback: undefined,
  });
}

// Connection test (NOTE: a failure is also HTTP 200; the caller checks the
// returned success/message).
export async function testChatDatasource(
  id: number,
): Promise<ChatDatasourceTestResult> {
  const path = `${CHAT}/datasources/${id}/test`;
  return request<ChatDatasourceTestResult>(path, {
    endpoint: "POST /kanban/api/v2/chat/datasources/:id/test",
    kind: "chat",
    method: "POST",
    schema: chatDatasourceTestResultSchema,
    fallback: {
      success: false,
      message: "",
      ping_ms: 0,
    },
  });
}

// ---- Settings: sync tasks ----

const chatSyncTaskSchema = z.looseObject({
  id: z.number(),
  task_id: z.string(),
  status: z.string(),
  req_start_time: z.string(),
  req_end_time: z.string(),
  total_gaps: z.number(),
  completed_gaps: z.number(),
  total_rows_processed: z.number(),
  total_rows_written: z.number(),
  error_message: nullableStringSchema,
  retry_count: z.number(),
  source_name: z.string(),
  started_at: nullableStringSchema,
  finished_at: nullableStringSchema,
  created_at: z.string(),
});

const chatSyncTaskListSchema = z.looseObject({
  total: z.number(),
  tasks: z.array(chatSyncTaskSchema),
});

const chatSyncTaskStatusSchema = z.looseObject({
  task_id: z.string(),
  status: z.string(),
  progress: z.number(),
  total_gaps: z.number(),
  completed_gaps: z.number(),
  total_rows_processed: z.number(),
  total_rows_written: z.number(),
  error_message: nullableStringSchema,
  source_name: z.string(),
  started_at: nullableStringSchema,
  finished_at: nullableStringSchema,
});

const chatSyncSubmitResponseSchema = z.looseObject({
  task_id: z.string(),
  status: z.string(),
  gaps: z.array(z.unknown()).default([]),
  source_id: z.number(),
  source_name: z.string(),
});

const chatSyncActionResponseSchema = z.looseObject({
  task_id: z.string(),
  status: z.string(),
});

export async function getChatSyncTasks(): Promise<ChatSyncTaskListResponse> {
  const path = `${CHAT}/sync/tasks`;
  return request<ChatSyncTaskListResponse>(path, {
    endpoint: "GET /kanban/api/v2/chat/sync/tasks",
    kind: "chat",
    schema: chatSyncTaskListSchema,
    fallback: { total: 0, tasks: [] },
  });
}

export async function getChatSyncTask(
  taskId: string,
): Promise<ChatSyncTaskStatus> {
  const path = `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}`;
  return request<ChatSyncTaskStatus>(path, {
    endpoint: "GET /kanban/api/v2/chat/sync/tasks/:taskId",
    kind: "chat",
    schema: chatSyncTaskStatusSchema,
    fallback: {} as ChatSyncTaskStatus,
  });
}

export async function submitChatSyncTask(
  body: ChatSyncSubmitReq,
): Promise<ChatSyncSubmitResponse> {
  const path = `${CHAT}/sync/tasks`;
  return request<ChatSyncSubmitResponse>(path, {
    endpoint: "POST /kanban/api/v2/chat/sync/tasks",
    kind: "chat",
    method: "POST",
    body,
    schema: chatSyncSubmitResponseSchema,
    fallback: {} as ChatSyncSubmitResponse,
  });
}

export async function retryChatSyncTask(
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const path = `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}/retry`;
  return request<{ task_id: string; status: string }>(path, {
    endpoint: "POST /kanban/api/v2/chat/sync/tasks/:taskId/retry",
    kind: "chat",
    method: "POST",
    schema: chatSyncActionResponseSchema,
    fallback: { task_id: taskId, status: "unknown" },
  });
}

export async function cancelChatSyncTask(
  taskId: string,
): Promise<{ task_id: string; status: string }> {
  const path = `${CHAT}/sync/tasks/${encodeURIComponent(taskId)}/cancel`;
  return request<{ task_id: string; status: string }>(path, {
    endpoint: "POST /kanban/api/v2/chat/sync/tasks/:taskId/cancel",
    kind: "chat",
    method: "POST",
    schema: chatSyncActionResponseSchema,
    fallback: { task_id: taskId, status: "unknown" },
  });
}

// ---- Settings: system config (flat KV, e.g. system_currency) ----

export async function getChatSystemConfig(): Promise<ChatSystemConfig> {
  const path = `${CHAT}/config`;
  return request<ChatSystemConfig>(path, {
    endpoint: "GET /kanban/api/v2/chat/config",
    kind: "chat",
    schema: chatSystemConfigSchema,
    fallback: {},
  });
}

export async function updateChatSystemConfig(
  body: ChatSystemConfig,
): Promise<void> {
  const path = `${CHAT}/config`;
  return request<void>(path, {
    endpoint: "PUT /kanban/api/v2/chat/config",
    kind: "chat",
    method: "PUT",
    body,
    schema: z.unknown(),
    fallback: undefined,
  });
}

// ---- Platform ops: realtime aggregate + detail/log query ----

// Realtime aggregate (range ∈ 30m|1h|3h; source had a 10s server rate limit,
// so the UI drives manual refresh). datasourceId scopes to a source.
export async function getChatRealtime(p: {
  range: "30m" | "1h" | "3h";
  datasourceId?: string;
}): Promise<ChatRealtimeResponse> {
  const path = `${CHAT}/stats/realtime${qs({
    range: p.range,
    datasource_id: p.datasourceId,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/realtime",
    kind: "chat",
    schema: chatRealtimeResponseSchema,
    fallback: {
      summary: {
        total_requests: 0,
        total_users: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cache_tokens: 0,
        total_error_requests: 0,
        total_cost: 0,
      },
      token_trend: [],
      cache_hit_rate: [],
      model_requests: [],
      auto_router_breakdown: [],
      request_trend: [],
      top_users: [],
    },
  });
}

// Detail point query (max 5000 rows; ISO 8601 times required). Source path
// /stats/detail/query is a POST body; mirrored here.
export async function getChatDetailQuery(
  req: ChatDetailQueryReq,
): Promise<ChatDetailQueryResponse> {
  const path = `${CHAT}/stats/detail/query`;
  return request(path, {
    endpoint: "POST /kanban/api/v2/chat/stats/detail/query",
    kind: "chat",
    method: "POST",
    body: req,
    schema: chatDetailQueryResponseSchema,
    fallback: { total: 0, items: [] },
  });
}

// Raw log preview (local_log_path is server-clamped to the configured root).
export async function getChatLogPreview(
  localLogPath: string,
): Promise<ChatLogPreviewResponse> {
  const path = `${CHAT}/stats/detail/log-preview`;
  return request(path, {
    endpoint: "POST /kanban/api/v2/chat/stats/detail/log-preview",
    kind: "chat",
    method: "POST",
    body: { local_log_path: localLogPath },
    schema: chatLogPreviewResponseSchema,
    fallback: {
      path: localLogPath,
      file_name: "",
      size_bytes: 0,
      size_mb: 0,
      max_size_mb: 0,
      previewable: false,
      exceeded: false,
      message: "",
    },
  });
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
  const path = `${CHAT}/stats/trace-logs`;
  return request(path, {
    endpoint: "POST /kanban/api/v2/chat/stats/trace-logs",
    kind: "chat",
    method: "POST",
    body,
    schema: chatTraceLogResponseSchema,
    fallback: { entries: [], next_cursor: "", has_more: false },
  });
}

// ---- Platform ops: per-user trend ----

export async function getChatUserTrend(
  uid: string,
  p: { startDate: string; endDate: string },
): Promise<ChatUserTrendRow[]> {
  const path = `${CHAT}/stats/users/${encodeURIComponent(uid)}/trend${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/users/:uid/trend",
    kind: "chat",
    schema: z.array(chatUserTrendRowSchema),
    fallback: [],
  });
}

// ---- Platform ops: model request/token trend ----

export async function getChatModelTrend(p: {
  startDate: string;
  endDate: string;
  models?: string;
}): Promise<ChatModelTrendSeries[]> {
  const path = `${CHAT}/stats/model-trend${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    models: p.models,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/model-trend",
    kind: "chat",
    schema: z.array(chatModelTrendSeriesSchema),
    fallback: [],
  });
}

// ---- Platform ops: historical overview stats (/stats/*) ----
// Source path /stats/*; proxied under /kanban/api/v2/chat/stats/*. Each
// returns a per-day series or ranked list aggregated from the chat summary ETL.
// All take a start_date/end_date window; some take an extra filter (model for
// cost-trend, sort_by for users ranking).

// Per-day global aggregate (requests / tokens / cost / users / errors).
export async function getChatGlobalDaily(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatDailyGlobal[]> {
  const path = `${CHAT}/stats/global/daily${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/global/daily",
    schema: z.array(chatDailyGlobalSchema),
    fallback: [],
    kind: "chat",
  });
}

// Per-day cost split (total/input/output/cache/request); model optional.
export async function getChatCostTrend(p: {
  startDate: string;
  endDate: string;
  model?: string;
}): Promise<ChatCostTrendRow[]> {
  const path = `${CHAT}/stats/cost-trend${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    model: p.model,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/cost-trend",
    schema: z.array(chatCostTrendRowSchema),
    fallback: [],
    kind: "chat",
  });
}

// Per-day cache hit rate (cache/prompt token ratio).
export async function getChatCacheHitRate(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatCacheHitRateRow[]> {
  const path = `${CHAT}/stats/cache-hit-rate${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/cache-hit-rate",
    kind: "chat",
    schema: z.array(chatCacheHitRateRowSchema),
    fallback: [],
  });
}

// Per-model cost ranking (sorted by cumulative cost desc).
export async function getChatModelCostRanking(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatModelCostRow[]> {
  const path = `${CHAT}/stats/models/cost-ranking${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/models/cost-ranking",
    kind: "chat",
    schema: z.array(chatModelCostRowSchema),
    fallback: [],
  });
}

// Per-model request/token share.
export async function getChatModelsUsage(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatModelsUsageResp> {
  const path = `${CHAT}/stats/models/usage${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/models/usage",
    kind: "chat",
    schema: chatModelsUsageResponseSchema,
    fallback: { models: [] },
  });
}

// Top-N users ranking (paginated; sortBy ∈ sum_total_tokens | total_requests |
// estimated_total_cost; search filters by universal_id/username).
export async function getChatUsersRanking(p: {
  startDate: string;
  endDate: string;
  sortBy?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<ChatUsersRankingResp> {
  const path = `${CHAT}/stats/users/ranking${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    sort_by: p.sortBy,
    search: p.search,
    page: p.page != null ? String(p.page) : undefined,
    page_size: p.pageSize != null ? String(p.pageSize) : undefined,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/users/ranking",
    kind: "chat",
    schema: chatUsersRankingResponseSchema,
    fallback: { total: 0, page: 1, page_size: p.pageSize ?? 50, data: [] },
  });
}

export async function getChatPerformanceOverview(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatPerformanceOverview> {
  const path = `${CHAT}/stats/performance/overview${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/performance/overview",
    kind: "chat",
    schema: chatPerformanceOverviewSchema,
    fallback: {
      avg_ttft_ms: null,
      avg_token_output_speed: null,
      avg_duration_ms: null,
    },
  });
}

export async function getChatPerformanceByModel(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatPerformanceByModelResponse> {
  const path = `${CHAT}/stats/performance/by-model${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/performance/by-model",
    kind: "chat",
    schema: chatPerformanceByModelResponseSchema,
    fallback: { models: [] },
  });
}

export async function getChatHourlyDistribution(p: {
  startDate: string;
  endDate: string;
}): Promise<ChatHourlyDistributionResponse> {
  const path = `${CHAT}/stats/distribution/hourly${qs({
    start_date: p.startDate,
    end_date: p.endDate,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/distribution/hourly",
    kind: "chat",
    schema: chatHourlyDistributionResponseSchema,
    fallback: { hours: [] },
  });
}

export async function getChatHourly(p: {
  startHour: string;
  endHour: string;
}): Promise<ChatHourlyRow[]> {
  const path = `${CHAT}/stats/hourly${qs({
    start_hour: p.startHour,
    end_hour: p.endHour,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/hourly",
    kind: "chat",
    schema: z.array(chatHourlyRowSchema),
    fallback: [],
  });
}

export async function getChatDimension(p: {
  startDate: string;
  endDate: string;
  dimensionType: string;
  sortOrder?: string;
}): Promise<ChatDimensionRow[]> {
  const path = `${CHAT}/stats/dimension${qs({
    start_date: p.startDate,
    end_date: p.endDate,
    dimension_type: p.dimensionType,
    sort_order: p.sortOrder,
  })}`;
  return request(path, {
    endpoint: "GET /kanban/api/v2/chat/stats/dimension",
    kind: "chat",
    schema: z.array(chatDimensionRowSchema),
    fallback: [],
  });
}

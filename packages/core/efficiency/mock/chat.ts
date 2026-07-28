// Mock samples for the chat dimension (chat-settings + platform-ops pages).
// Shapes mirror the Chat* interfaces in types.ts verbatim so each literal
// satisfies its interface without `as` casts. Numbers are synthetic but kept
// in plausible ranges (token counts / yuan costs / percentages) so the cards
// and charts render sensibly during the pre-backend phase.
//
// The settings/platform READ endpoints (pricing list, datasources list, sync
// tasks list, system config, realtime aggregate, model/user trends, detail
// query, log preview) are mocked here. Mutation behavior is defined in
// mutations.ts; live mode now uses the migrated chat endpoints.
//
// Like the other mock modules, range/dates/ids are accepted for signature
// parity with the real query; the samples are mostly static so the window is
// currently ignored except where a time series is generated. Once
// /api/v2/efficiency/chat/* is live, set EFFICIENCY_MOCK=0 and the
// queryOptions layer will stop calling these.

import type {
  ChatAutoRouterItem,
  ChatCacheHitRateRow,
  ChatCacheRateItem,
  ChatCostTrendRow,
  ChatDailyGlobal,
  ChatDatasource,
  ChatDetailQueryReq,
  ChatDetailQueryResponse,
  ChatDetailRow,
  ChatLogPreviewResponse,
  ChatModelCostRow,
  ChatModelRequestItem,
  ChatModelTrendRow,
  ChatModelTrendSeries,
  ChatModelUsageItem,
  ChatModelsUsageResp,
  ChatRealtimeResponse,
  ChatRequestTrendItem,
  ChatSyncTask,
  ChatSyncTaskListResponse,
  ChatSystemConfig,
  ChatTokenTrendItem,
  ChatTopUserItem,
  ChatTraceLogEntry,
  ChatTraceLogResponse,
  ChatUserRankingRow,
  ChatUserTrendRow,
  ChatUsersRankingResp,
  ModelPricing,
} from "../types";
import { addDays } from "../utils/date";

const MODEL_NAMES = [
  "glm-4.6",
  "glm-4.5-air",
  "glm-4.5",
  "gpt-4o",
  "claude-sonnet-4",
];

// Enumerate the days in [start, end] as YYYY-MM-DD. Falls back to a static
// 7-day sample window if the query didn't carry dates (defensive). Same
// helper shape as mock/cost.ts (kept local so this module is standalone).
function daysBetween(start: string | undefined, end: string | undefined): string[] {
  if (!start || !end) {
    return Array.from({ length: 7 }, (_, i) => addDays("2026-07-01", i));
  }
  const out: string[] = [];
  let cur = start;
  // safety cap to avoid runaway loops on bad input
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// ============================ Settings: model pricing ============================

export function getMockChatPricing(): ModelPricing[] {
  return [
    {
      id: 1,
      model_name: MODEL_NAMES[0]!,
      pricing_mode: "token",
      input_price_per_token: 0.00005,
      output_price_per_token: 0.0005,
      cache_price_per_token: 0.000005,
      request_price: null,
      currency: "CNY",
      exchange_rate: 1,
      original_currency: null,
      original_input_price: null,
      original_output_price: null,
      original_cache_price: null,
      original_request_price: null,
      effective_date: "2026-07-01",
      end_date: null,
      notes: "Flagship chat model pricing",
      created_at: "2026-06-20T08:00:00Z",
    },
    {
      id: 2,
      model_name: MODEL_NAMES[1]!,
      pricing_mode: "token",
      input_price_per_token: 0.000004,
      output_price_per_token: 0.000016,
      cache_price_per_token: 0.0000004,
      request_price: null,
      currency: "CNY",
      exchange_rate: 1,
      original_currency: null,
      original_input_price: null,
      original_output_price: null,
      original_cache_price: null,
      original_request_price: null,
      effective_date: "2026-07-01",
      end_date: null,
      notes: "Air-tier cost-effective model",
      created_at: "2026-06-20T08:00:00Z",
    },
    {
      id: 3,
      model_name: MODEL_NAMES[3]!,
      pricing_mode: "request",
      input_price_per_token: null,
      output_price_per_token: null,
      cache_price_per_token: null,
      request_price: 0.07,
      currency: "USD",
      exchange_rate: 7.2,
      original_currency: "USD",
      original_input_price: null,
      original_output_price: null,
      original_cache_price: null,
      original_request_price: 0.07,
      effective_date: "2026-07-01",
      end_date: null,
      notes: "Per-request pricing (USD)",
      created_at: "2026-06-20T08:00:00Z",
    },
  ];
}

// ============================ Settings: datasources ============================

export function getMockChatDatasources(): ChatDatasource[] {
  return [
    {
      id: 1,
      name: "Primary Postgres",
      source_type: "postgres",
      is_enabled: true,
      config_json: null,
      pg_host: "10.0.0.10",
      pg_port: 5432,
      pg_database: "chat_metrics",
      pg_schema: "public",
      pg_table: "raw_metrics",
      pg_username: "reader",
      pg_password: "",
      pg_ssl_mode: "disable",
      es_hosts: null,
      es_username: null,
      es_password: null,
      es_index: null,
      es_verify_certs: null,
      es_scroll_duration: null,
      loki_url: null,
      loki_username: null,
      loki_password: null,
      loki_tenant_id: null,
      loki_verify_certs: null,
      loki_queries: null,
      max_open_conns: 20,
      max_idle_conns: 5,
      notes: "Main chat-metrics warehouse",
      created_at: "2026-05-01T10:00:00Z",
      updated_at: "2026-06-15T12:30:00Z",
    },
    {
      id: 2,
      name: "ES Logs",
      source_type: "elasticsearch",
      is_enabled: true,
      config_json: null,
      pg_host: null,
      pg_port: null,
      pg_database: null,
      pg_schema: null,
      pg_table: null,
      pg_username: null,
      pg_password: null,
      pg_ssl_mode: null,
      es_hosts: "10.0.0.20:9200",
      es_username: "elastic",
      es_password: "",
      es_index: "chat-logs-*",
      es_verify_certs: false,
      es_scroll_duration: "1m",
      loki_url: null,
      loki_username: null,
      loki_password: null,
      loki_tenant_id: null,
      loki_verify_certs: null,
      loki_queries: null,
      max_open_conns: null,
      max_idle_conns: null,
      notes: "Elasticsearch log store",
      created_at: "2026-05-02T10:00:00Z",
      updated_at: null,
    },
    {
      id: 3,
      name: "Loki Trace",
      source_type: "loki",
      is_enabled: false,
      config_json: null,
      pg_host: null,
      pg_port: null,
      pg_database: null,
      pg_schema: null,
      pg_table: null,
      pg_username: null,
      pg_password: null,
      pg_ssl_mode: null,
      es_hosts: null,
      es_username: null,
      es_password: null,
      es_index: null,
      es_verify_certs: null,
      es_scroll_duration: null,
      loki_url: "http://loki:3100",
      loki_username: "",
      loki_password: "",
      loki_tenant_id: "platform-ops",
      loki_verify_certs: false,
      loki_queries:
        '[{"name":"errors","label_selector":"{level=\\"error\\"}"}]',
      max_open_conns: null,
      max_idle_conns: null,
      notes: "Disabled trace backend",
      created_at: "2026-05-03T10:00:00Z",
      updated_at: "2026-06-20T09:00:00Z",
    },
  ];
}

// ============================ Settings: sync tasks ============================

export function getMockChatSyncTasks(): ChatSyncTaskListResponse {
  const tasks: ChatSyncTask[] = [
    {
      id: 101,
      task_id: "sync-20260720001",
      status: "completed",
      req_start_time: "2026-07-15T00:00:00Z",
      req_end_time: "2026-07-19T00:00:00Z",
      total_gaps: 120,
      completed_gaps: 120,
      total_rows_processed: 48000,
      total_rows_written: 47960,
      error_message: null,
      retry_count: 0,
      source_name: "Primary Postgres",
      started_at: "2026-07-20T01:00:00Z",
      finished_at: "2026-07-20T01:12:30Z",
      created_at: "2026-07-20T01:00:00Z",
    },
    {
      id: 102,
      task_id: "sync-20260721002",
      status: "running",
      req_start_time: "2026-07-19T00:00:00Z",
      req_end_time: "2026-07-21T00:00:00Z",
      total_gaps: 48,
      completed_gaps: 31,
      total_rows_processed: 12400,
      total_rows_written: 12400,
      error_message: null,
      retry_count: 0,
      source_name: "ES Logs",
      started_at: "2026-07-21T00:30:00Z",
      finished_at: null,
      created_at: "2026-07-21T00:30:00Z",
    },
    {
      id: 103,
      task_id: "sync-20260718003",
      status: "failed",
      req_start_time: "2026-07-10T00:00:00Z",
      req_end_time: "2026-07-15T00:00:00Z",
      total_gaps: 240,
      completed_gaps: 180,
      total_rows_processed: 72000,
      total_rows_written: 54000,
      error_message: "connection reset by peer at gap 181",
      retry_count: 2,
      source_name: "Primary Postgres",
      started_at: "2026-07-18T22:00:00Z",
      finished_at: "2026-07-18T22:48:09Z",
      created_at: "2026-07-18T22:00:00Z",
    },
    {
      id: 104,
      task_id: "sync-20260722004",
      status: "retrying",
      req_start_time: "2026-07-20T00:00:00Z",
      req_end_time: "2026-07-22T00:00:00Z",
      total_gaps: 96,
      completed_gaps: 64,
      total_rows_processed: 25600,
      total_rows_written: 25600,
      error_message: "transient timeout, retrying",
      retry_count: 1,
      source_name: "ES Logs",
      started_at: "2026-07-22T00:15:00Z",
      finished_at: null,
      created_at: "2026-07-22T00:15:00Z",
    },
  ];
  return { total: tasks.length, tasks };
}

// ============================ Settings: system config ============================

export function getMockChatSystemConfig(): ChatSystemConfig {
  return {
    system_currency: "CNY",
    exchange_rate_usd_cny: "7.2",
    realtime_refresh_seconds: "10",
    detail_query_max_rows: "5000",
    auto_router_enabled: "true",
    cache_pricing_enabled: "true",
  };
}

// ============================ Platform ops: realtime aggregate ============================

// Builds a per-minute time series of `points` steps ending "now", formatted
// HH:mm (matches the source realtime.go token_trend time formatting).
function minuteSeries(points: number, stepMin: number): string[] {
  const now = Date.now();
  const out: string[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now - i * stepMin * 60_000);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    out.push(`${hh}:${mm}`);
  }
  return out;
}

export function getMockChatRealtime(p: {
  range: "30m" | "1h" | "3h";
  datasourceId?: string;
}): ChatRealtimeResponse {
  // 30m → 6 points @5min, 1h → 12 @5min, 3h → 18 @10min. Keeps the series
  // legible without being too dense.
  const pointCount = p.range === "30m" ? 6 : p.range === "1h" ? 12 : 18;
  const stepMin = p.range === "3h" ? 10 : 5;
  const times = minuteSeries(pointCount, stepMin);

  const baseRequests = 240;
  const basePrompt = 180_000;
  const baseCompletion = 96_000;
  const baseCache = 42_000;

  let totalRequests = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCache = 0;
  let totalErrors = 0;

  const token_trend: ChatTokenTrendItem[] = times.map((time, i) => {
    const wave = Math.sin(i * 0.7) * 0.2 + 1; // 0.8..1.2 gentle ripple
    const prompt = Math.round(basePrompt * wave);
    const completion = Math.round(baseCompletion * wave);
    const cache = Math.round(baseCache * wave);
    totalPrompt += prompt;
    totalCompletion += completion;
    totalCache += cache;
    return { time, prompt_tokens: prompt, completion_tokens: completion, cache_tokens: cache };
  });

  const cache_hit_rate: ChatCacheRateItem[] = times.map((time, i) => {
    const prompt = token_trend[i]!.prompt_tokens;
    const cache = token_trend[i]!.cache_tokens;
    const rate = prompt > 0 ? Math.round((cache / prompt) * 1000) / 10 : 0;
    return { time, cache_tokens: cache, prompt_tokens: prompt, rate };
  });

  const request_trend: ChatRequestTrendItem[] = times.map((time, i) => {
    const wave = Math.sin(i * 0.5) * 0.15 + 1;
    const req = Math.round(baseRequests * wave);
    totalRequests += req;
    totalErrors += i % 6 === 0 ? 2 : 0;
    return { time, request_count: req };
  });

  const modelShares = [0.46, 0.25, 0.18, 0.11];
  const model_requests: ChatModelRequestItem[] = modelShares.map((share, mi) => ({
    model: MODEL_NAMES[mi]!,
    request_count: Math.round(totalRequests * share),
    user_count: Math.round(48 * share),
    prompt_tokens: Math.round(totalPrompt * share),
    completion_tokens: Math.round(totalCompletion * share),
    total_cost: Math.round(totalPrompt * share * 0.00005 * 100) / 100,
  }));

  const routerShares = [0.52, 0.3, 0.18];
  const auto_router_breakdown: ChatAutoRouterItem[] = routerShares.map((share, mi) => ({
    routed_model: MODEL_NAMES[mi]!,
    request_count: Math.round(totalRequests * share),
    percentage: Math.round(share * 1000) / 10,
  }));

  const topUserNames = [
    "Alice Wang",
    "Bob Li",
    "Carol Zhang",
    "David Chen",
    "Emma Liu",
  ];
  const top_users: ChatTopUserItem[] = topUserNames.map((username, i) => {
    const req = 320 - i * 42;
    const prompt = 24_000 - i * 3200;
    const completion = 12_800 - i * 1600;
    return {
      universal_id: `u-${300 + i}`,
      username,
      request_count: req,
      prompt_tokens: prompt,
      completion_tokens: completion,
    };
  });

  return {
    summary: {
      total_requests: totalRequests,
      total_users: 48,
      total_prompt_tokens: totalPrompt,
      total_completion_tokens: totalCompletion,
      total_cache_tokens: totalCache,
      total_error_requests: totalErrors,
      total_cost: Math.round(totalPrompt * 0.00005 * 100) / 100,
    },
    token_trend,
    cache_hit_rate,
    model_requests,
    auto_router_breakdown,
    request_trend,
    top_users,
  };
}

// ============================ Platform ops: detail query ============================

export function getMockChatDetailQuery(
  req: ChatDetailQueryReq,
): ChatDetailQueryResponse {
  const limit = req.limit ?? 100;
  const rowCount = Math.min(limit, 8);
  const baseDate = req.start_time ? req.start_time.slice(0, 10) : "2026-07-21";
  const items: ChatDetailRow[] = Array.from({ length: rowCount }, (_, i) => {
    const ts = `${baseDate}T10:${String(15 + i).padStart(2, "0")}:42Z`;
    const isError = i % 4 === 3;
    const model = MODEL_NAMES[i % MODEL_NAMES.length]!;
    return {
      id: 5000 + i,
      request_id: `req-${20260721 + i}-${String(i).padStart(4, "0")}`,
      user_id: `EMP${String(1001 + i).padStart(4, "0")}`,
      username: ["Alice Wang", "Bob Li", "Carol Zhang", "David Chen"][i % 4] ?? null,
      universal_id: `u-${300 + (i % 6)}`,
      ts,
      system_tokens: 640 + i * 12,
      user_tokens: 4200 + i * 80,
      processed_system_tokens: 640 + i * 12,
      processed_user_tokens: 4200 + i * 80,
      retry_num: i % 4 === 0 ? 1 : 0,
      first_token_duration: 180 + i * 12,
      duration: 2400 + i * 96,
      prompt_tokens: 4840 + i * 92,
      completion_tokens: 1280 + i * 36,
      cache_tokens: 820 + i * 14,
      error_code: isError ? "upstream_timeout" : null,
      slow_chunk: isError ? 1 : 0,
      chunk_per_second: 24 + i,
      token_output_time: 2.4 + i * 0.06,
      token_output_speed: 48 + i,
      token_output_speed_e2e: 42 + i,
      task_id: `task-${7000 + i}`,
      client_version: "2.4.1",
      request_time: ts,
      forward_request_time: ts,
      end_time: `${baseDate}T10:${String(16 + i).padStart(2, "0")}:10Z`,
      mode: ["agent", "chat", "edit"][i % 3] ?? null,
      model,
      routed_model: model,
      local_log_path: `/var/log/chat/${baseDate}/req-${i}.log`,
      created_at: ts,
    };
  });
  return { total: rowCount, items };
}

export function getMockChatLogPreview(
  localLogPath: string,
): ChatLogPreviewResponse {
  const file_name = localLogPath.split("/").pop() ?? localLogPath;
  const content = [
    "2026-07-21T10:15:42Z [INFO] request received model=glm-4.6",
    "2026-07-21T10:15:43Z [INFO] tokens prompt=4840 completion=1280",
    "2026-07-21T10:15:44Z [WARN] slow chunk detected duration=2400ms",
    "2026-07-21T10:15:44Z [INFO] request completed cost=0.32",
  ].join("\n");
  return {
    path: localLogPath,
    file_name,
    size_bytes: content.length,
    size_mb: Math.round((content.length / (1024 * 1024)) * 1000) / 1000,
    max_size_mb: 2,
    previewable: true,
    exceeded: false,
    content,
    message: undefined,
  };
}

// ============================ Platform ops: trace logs (Loki) ============================

// Trace-log samples for the RealtimeQuery "链路日志" drawer. The backend query
// targets a Loki datasource scoped to a single request_id across the form's
// time window; each entry is a timestamped log line. We synthesize a plausible
// request lifecycle (receive → route → upstream call → stream chunks → complete)
// anchored on the window's start so the drawer shows a coherent timeline. The
// cursor/has_more paging fields are static (no second page in the mock).
export function getMockChatTraceLogs(
  req: {
    datasource_id: string;
    request_id: string;
    label_selector?: string;
    start_time: string;
    end_time: string;
    limit?: number;
    cursor?: string;
  },
): ChatTraceLogResponse {
  const limit = req.limit ?? 100;
  // Anchor the synthetic timeline on the window start (fallback: a fixed ts).
  const baseMs = req.start_time
    ? Date.parse(req.start_time)
    : Date.parse("2026-07-21T10:15:00Z");
  const anchor = Number.isFinite(baseMs) ? baseMs : Date.now();
  const rid = req.request_id || "req-unknown";
  const model = MODEL_NAMES[0]!;
  const lines: Array<{ offsetMs: number; level: string; text: string }> = [
    { offsetMs: 0, level: "INFO", text: `request received request_id=${rid} model=${model} mode=chat` },
    { offsetMs: 120, level: "INFO", text: `auth ok user_id=u-301 universal_id=u-301 client=ide/2.4.1` },
    { offsetMs: 180, level: "INFO", text: `auto-router selected model=${model} routed_model=${model}` },
    { offsetMs: 240, level: "INFO", text: `upstream connect host=api.example.com port=443 tls=true` },
    { offsetMs: 420, level: "INFO", text: `first token ttft=180ms prompt_tokens=4840` },
    { offsetMs: 1800, level: "WARN", text: `slow chunk detected gap=640ms chunk_index=12` },
    { offsetMs: 2400, level: "INFO", text: `stream complete completion_tokens=1280 duration=2400ms` },
    { offsetMs: 2420, level: "INFO", text: `request finished cost=0.32 status=ok` },
  ];
  const entries: ChatTraceLogEntry[] = lines
    .slice(0, limit)
    .map(({ offsetMs, level, text }) => {
      const ts = new Date(anchor + offsetMs).toISOString();
      return { timestamp: ts, line: `${ts.replace("T", " ").replace("Z", "")} [${level}] ${text}` };
    });
  return {
    entries,
    next_cursor: "",
    has_more: false,
  };
}

// ============================ Platform ops: per-user trend ============================

export function getMockChatUserTrend(
  _uid: string,
  p: { startDate: string; endDate: string },
): ChatUserTrendRow[] {
  const days = daysBetween(p.startDate, p.endDate);
  return days.map((date, i) => {
    const wave = Math.sin(i * 0.5) * 0.15 + 1;
    const totalRequests = Math.round(42 * wave);
    const promptTokens = Math.round(8400 * wave);
    const completionTokens = Math.round(2600 * wave);
    const cacheTokens = Math.round(1400 * wave);
    const sumTotalTokens = promptTokens + completionTokens + cacheTokens;
    const inputCost = promptTokens * 0.00005;
    const outputCost = completionTokens * 0.0005;
    const cacheCost = cacheTokens * 0.000005;
    const requestCost = totalRequests * 0.02;
    const estimatedTotalCost =
      Math.round((inputCost + outputCost + cacheCost + requestCost) * 100) / 100;
    const row: ChatUserTrendRow = {
      date,
      total_requests: totalRequests,
      sum_total_tokens: sumTotalTokens,
      sum_prompt_tokens: promptTokens,
      sum_completion_tokens: completionTokens,
      sum_cache_tokens: cacheTokens,
      estimated_total_cost: estimatedTotalCost,
      estimated_input_cost: Math.round(inputCost * 100) / 100,
      estimated_output_cost: Math.round(outputCost * 100) / 100,
      estimated_cache_cost: Math.round(cacheCost * 100) / 100,
      estimated_request_cost: Math.round(requestCost * 100) / 100,
      unique_task_count: Math.max(1, Math.round(6 * wave)),
      avg_duration_ms: 2400 + ((i * 120) % 600),
      avg_first_token_duration_ms: 180 + ((i * 12) % 80),
      error_requests: i % 7 === 0 ? 1 : 0,
      model_preference: '{"glm-4.6": 28, "glm-4.5-air": 14}',
      auto_router_breakdown: '{"glm-4.6": 30, "glm-4.5": 12}',
    };
    return row;
  });
}

// ============================ Platform ops: model trend ============================

export function getMockChatModelTrend(p: {
  startDate: string;
  endDate: string;
  models?: string;
}): ChatModelTrendSeries[] {
  const days = daysBetween(p.startDate, p.endDate);
  // If the caller passed a comma-separated models list, use it; otherwise fall
  // back to the default catalog.
  const models = p.models
    ? p.models.split(",").map((m) => m.trim()).filter(Boolean)
    : MODEL_NAMES.slice(0, 4);
  const shares = [0.46, 0.25, 0.18, 0.11];
  return models.map((model, mi) => {
    const share = shares[mi % shares.length]!;
    const data: ChatModelTrendRow[] = days.map((date, i) => {
      const wave = Math.sin(i * 0.4) * 0.2 + 1;
      const totalRequests = Math.round(420 * share * wave);
      const inputTokens = Math.round(1_800_000 * share * wave);
      const outputTokens = Math.round(960_000 * share * wave);
      return {
        date,
        total_requests: totalRequests,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      };
    });
    return { model, data };
  });
}

// ============================ Platform ops: historical overview stats ============================
// Mock factories for the /stats/* historical endpoints used by PlatformOverview.
// Each generates a plausible per-day series or ranked list over the requested
// window (daysBetween), consistent with the realtime/mock model mix above so the
// charts render sensibly. Numbers are synthetic but kept in plausible ranges
// (token counts / yuan costs / percentages).

// Per-day global aggregate. Reuses the same per-day waveform as the user/model
// trends so the three tabs read consistently.
export function getMockChatGlobalDaily(p: {
  startDate: string;
  endDate: string;
}): ChatDailyGlobal[] {
  const days = daysBetween(p.startDate, p.endDate);
  return days.map((date, i) => {
    const wave = Math.sin(i * 0.45) * 0.18 + 1;
    const weekendDip = isWeekend(date) ? 0.62 : 1;
    const w = wave * weekendDip;
    const totalRequests = Math.round(420 * w);
    const totalErrorRequests = i % 9 === 0 ? Math.round(6 * w) : i % 5 === 0 ? 2 : 0;
    const totalUsers = Math.round(48 * w);
    const sumPrompt = Math.round(1_800_000 * w);
    const sumCompletion = Math.round(960_000 * w);
    const sumCache = Math.round(420_000 * w);
    const sumTotal = sumPrompt + sumCompletion + sumCache;
    const incErr = totalRequests + totalErrorRequests;
    const inputCost = sumPrompt * 0.00005;
    const outputCost = sumCompletion * 0.0005;
    const cacheCost = sumCache * 0.000005;
    const requestCost = totalRequests * 0.02;
    const estCost = Math.round((inputCost + outputCost + cacheCost + requestCost) * 100) / 100;
    const row: ChatDailyGlobal = {
      date,
      total_requests: totalRequests,
      total_users: totalUsers,
      total_error_requests: totalErrorRequests,
      error_rate: incErr > 0 ? Math.round((totalErrorRequests / incErr) * 1e4) / 1e4 : null,
      unique_task_count: Math.max(1, Math.round(60 * w)),
      total_requests_including_errors: incErr,
      sum_prompt_tokens: sumPrompt,
      sum_completion_tokens: sumCompletion,
      sum_total_tokens: sumTotal,
      sum_cache_tokens: sumCache,
      avg_duration_ms: 2400 + ((i * 120) % 600),
      avg_first_token_duration_ms: 180 + ((i * 12) % 80),
      avg_token_output_speed: 46 + (i % 8),
      estimated_total_cost: estCost,
      auto_router_breakdown_global:
        '{"glm-4.6": ' + Math.round(totalRequests * 0.52) +
        ', "glm-4.5-air": ' + Math.round(totalRequests * 0.3) +
        ', "glm-4.5": ' + Math.round(totalRequests * 0.18) + "}",
    };
    return row;
  });
}

// Per-day cost split. When model is set, scale to that model's share so the
// filtered curve still reads as a plausible cost series.
export function getMockChatCostTrend(p: {
  startDate: string;
  endDate: string;
  model?: string;
}): ChatCostTrendRow[] {
  const days = daysBetween(p.startDate, p.endDate);
  // Approximate the selected model's share of total cost (falls back to ~1.0
  // for "all"/unknown so the unfiltered series shows the full platform cost).
  const share =
    p.model === MODEL_NAMES[0] ? 0.52 :
    p.model === MODEL_NAMES[1] ? 0.18 :
    p.model === MODEL_NAMES[2] ? 0.22 :
    p.model === MODEL_NAMES[3] ? 0.06 :
    p.model === MODEL_NAMES[4] ? 0.04 : 1;
  return days.map((date, i) => {
    const wave = Math.sin(i * 0.4) * 0.2 + 1;
    const weekendDip = isWeekend(date) ? 0.62 : 1;
    const w = wave * weekendDip * share;
    const inputCost = +(1_800_000 * 0.00005 * w).toFixed(2);
    const outputCost = +(960_000 * 0.0005 * w).toFixed(2);
    const cacheCost = +(420_000 * 0.000005 * w).toFixed(2);
    const requestCost = +(420 * 0.02 * w).toFixed(2);
    const totalCost = Math.round((inputCost + outputCost + cacheCost + requestCost) * 100) / 100;
    const row: ChatCostTrendRow = {
      date,
      total_cost: totalCost,
      input_cost: inputCost,
      output_cost: outputCost,
      cache_cost: cacheCost,
      request_cost: requestCost,
      total_requests: Math.round(420 * w),
      ...(p.model ? { model: p.model } : {}),
    };
    return row;
  });
}

// Per-day cache hit rate. cache_hit_rate_pct is recomputed from the token sums
// (the chart recomputes it from sums anyway, but the field is populated for
// table parity with the source shape).
export function getMockChatCacheHitRate(p: {
  startDate: string;
  endDate: string;
}): ChatCacheHitRateRow[] {
  const days = daysBetween(p.startDate, p.endDate);
  return days.map((date, i) => {
    const wave = Math.sin(i * 0.5) * 0.15 + 1;
    const weekendDip = isWeekend(date) ? 0.62 : 1;
    const w = wave * weekendDip;
    const cache = Math.round(420_000 * w);
    const prompt = Math.round(1_800_000 * w);
    const row: ChatCacheHitRateRow = {
      date,
      sum_cache_tokens: cache,
      sum_prompt_tokens: prompt,
      cache_hit_rate_pct: prompt > 0 ? Math.round((cache / prompt) * 1000) / 10 : 0,
    };
    return row;
  });
}

// Per-model cost ranking (sorted by cumulative cost desc).
export function getMockChatModelCostRanking(p: {
  startDate: string;
  endDate: string;
}): ChatModelCostRow[] {
  const days = daysBetween(p.startDate, p.endDate).length;
  const shares = [0.46, 0.25, 0.18, 0.07, 0.04];
  const rows: ChatModelCostRow[] = MODEL_NAMES.map((model, mi) => {
    const share = shares[mi % shares.length]!;
    const totalRequests = Math.round(420 * days * share);
    const totalInputTokens = Math.round(1_800_000 * days * share);
    const totalOutputTokens = Math.round(960_000 * days * share);
    const totalCost =
      Math.round(
        (totalInputTokens * 0.00005 + totalOutputTokens * 0.0005 + totalRequests * 0.02) * 100,
      ) / 100;
    return {
      model,
      total_requests: totalRequests,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_cost: totalCost,
    };
  });
  rows.sort((a, b) => b.total_cost - a.total_cost);
  return rows;
}

// Per-model request/token share.
export function getMockChatModelsUsage(p: {
  startDate: string;
  endDate: string;
}): ChatModelsUsageResp {
  const days = daysBetween(p.startDate, p.endDate).length;
  const shares = [0.46, 0.25, 0.18, 0.07, 0.04];
  const items: ChatModelUsageItem[] = MODEL_NAMES.map((model, mi) => {
    const share = shares[mi % shares.length]!;
    const requestCount = Math.round(420 * days * share);
    const totalTokens = Math.round((1_800_000 + 960_000) * days * share);
    return {
      model,
      request_count: requestCount,
      request_pct: Math.round(share * 1000) / 10,
      total_tokens: totalTokens,
      token_pct: Math.round(share * 1000) / 10,
    };
  });
  return { models: items };
}

// Top-N users ranking. search filters by username/universal_id; sortBy reorders
// the synthetic rows so the sort control visibly changes the table.
export function getMockChatUsersRanking(p: {
  startDate: string;
  endDate: string;
  sortBy?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): ChatUsersRankingResp {
  const days = daysBetween(p.startDate, p.endDate).length;
  const names = [
    "Alice Wang",
    "Bob Li",
    "Carol Zhang",
    "David Chen",
    "Emma Liu",
    "Frank Zhao",
    "Grace Sun",
    "Henry Wu",
    "Ivy Zhou",
    "Jack Ma",
    "Karen Yang",
    "Leo Tang",
  ];
  let rows: ChatUserRankingRow[] = names.map((username, i) => {
    const decay = 1 - i * 0.06; // top users heavier
    const totalRequests = Math.max(1, Math.round(420 * days * decay * 0.22));
    const prompt = Math.round(1_800_000 * days * decay * 0.22);
    const completion = Math.round(960_000 * days * decay * 0.22);
    const cache = Math.round(420_000 * days * decay * 0.22);
    const totalTokens = prompt + completion + cache;
    const cost =
      Math.round((prompt * 0.00005 + completion * 0.0005 + totalRequests * 0.02) * 100) / 100;
    const errors = i % 4 === 0 ? Math.max(1, Math.round(totalRequests * 0.02)) : 0;
    return {
      universal_id: `u-${1001 + i}`,
      username,
      total_requests: totalRequests,
      success_requests: totalRequests - errors,
      error_requests: errors,
      sum_prompt_tokens: prompt,
      sum_completion_tokens: completion,
      sum_total_tokens: totalTokens,
      sum_cache_tokens: cache,
      unique_task_count: Math.max(1, Math.round(60 * days * decay * 0.22)),
      active_days: Math.min(days, Math.max(1, Math.round(days * decay * 0.7))),
      estimated_total_cost: cost,
      avg_duration_ms: 2200 + i * 90,
      error_rate: totalRequests > 0 ? errors / totalRequests : 0,
      max_duration_ms: 4800 + i * 120,
      avg_token_output_speed: 46 + (i % 8),
    };
  });
  if (p.search) {
    const q = p.search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.username?.toLowerCase().includes(q) ||
        r.universal_id.toLowerCase().includes(q),
    );
  }
  const sortBy = p.sortBy ?? "sum_total_tokens";
  rows.sort((a, b) => {
    const av = rankKey(a, sortBy);
    const bv = rankKey(b, sortBy);
    return bv - av;
  });
  const pageSize = p.pageSize ?? 50;
  const page = p.page ?? 1;
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    total: rows.length,
    page,
    page_size: pageSize,
    data: paged,
  };
}

function rankKey(r: ChatUserRankingRow, sortBy: string): number {
  if (sortBy === "total_requests") return r.total_requests;
  if (sortBy === "estimated_total_cost") return r.estimated_total_cost;
  return r.sum_total_tokens;
}

// Sunday=0 / Saturday=6 → weekend dip, so the per-day series has a realistic
// weekly cadence rather than a flat line.
function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

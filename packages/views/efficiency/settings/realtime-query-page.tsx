"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ListFilter, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  chatDetailQueryOptions,
  chatLogPreviewOptions,
  chatTraceLogsOptions,
  globalConfigOptions,
  formatLocalTime,
  formatNumber,
  MOCK_ENABLED,
  type ChatDetailQueryReq,
  type ChatDetailRow,
  type ChatDatasource,
  type ChatLogPreviewResponse,
  type ChatTraceLogEntry,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { NativeSelect } from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@multica/ui/components/ui/sheet";
import { PageHeader } from "../../layout/page-header";
import { Section } from "./shared";
import { Th, ThNum, Td, TdNum, fmtMs } from "../usage/shared";
import { ToneBadge } from "../detail/shared";
import {
  MultiTrendChart,
  VerticalBarChart,
  type MultiTrendPoint,
} from "../charts";

// Platform ops · Realtime (detail) query. Ports the source RealtimeQuery.tsx
// (2138 lines) — a live LLM-request detail lookup (chat-indicator-statistics
// /stats/detail/query). The form builds a SQL query from the filters; results
// are a paginated ChatDetailRow table; row click opens a full-field detail
// dialog; the detail's "preview log" button opens a log preview dialog.
//
// This is the largest source file. The migrated flow covers the filter form,
// results table, complete row detail, local log preview, client-side speed and
// concurrency analysis, trace-log drill-down, and CSV export.
//   - Speed-distribution chart (bar chart of token_output_speed buckets,
//     computed client-side from the detail rows — no new endpoint).
//   - Loki trace-log drawer (Sheet) — when a row is selected, a "查询链路日志"
//     button opens a side panel showing that request's Loki trace entries
//     (fetched via chatTraceLogsOptions).
//   - CSV export — serializes the current ChatDetailRow[] to CSV + triggers a
//     browser download (pure frontend).
// Presentation difference vs source: speed-range results and concurrency are
// rendered inline instead of in additional nested modals. The same read-only
// analysis remains available without adding another overlay layer.
//
// Design decisions:
//   - No react-router, no ECharts. Semantic tokens only. Charts use the
//     shared recharts-based VerticalBarChart primitive.
//   - Mock phase: useQuery(chatDetailQueryOptions) — returns mock rows. The
//     source used useMutation (point-query, no cache); we use useQuery keyed
//     on the form so refetch-on-filter-change is automatic. This matches the
//     realtime-report page's data layer.
//   - Query only fires after the user clicks 查询 (we hold the form in a
//     separate state and copy it into the query key on submit) so the table
//     doesn't reload on every keystroke.

// ============================ Constants ============================

const QUICK_RANGES: Array<{ label: string; minutes: number }> = [
  { label: "近30分钟", minutes: 30 },
  { label: "近1小时", minutes: 60 },
  { label: "近3小时", minutes: 180 },
  { label: "近6小时", minutes: 360 },
  { label: "近12小时", minutes: 720 },
  { label: "近24小时", minutes: 1440 },
];

const QUERY_LIMIT_OPTIONS = [1, 10, 100, 300, 500, 1000, 3000, 5000];
const DEFAULT_QUICK_RANGE_MINUTES = 30;
const DEFAULT_LIMIT = 100;

const DISPLAY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_DISPLAY_PAGE_SIZE = 20;

/** error_code is an error when non-empty and not "0" (source isErrorCode). */
function isErrorCode(code: string | null | undefined): boolean {
  return !!code && code !== "0";
}

// ============================ Speed distribution buckets ============================
// Ports the source buildSpeedBuckets (RealtimeQuery.tsx ~L211-263): bucket the
// detail rows' token_output_speed into up to SPEED_BUCKET_COUNT equal-width
// ranges between min and max, plus a single overflow bucket for speeds beyond
// SPEED_OVERFLOW_THRESHOLD. Each bucket counts the rows whose speed falls in
// [min, max]. Pure frontend — no new endpoint.

/** Max number of regular (non-overflow) buckets. */
const SPEED_BUCKET_COUNT = 12;
/** Speeds above this roll into one ">threshold" overflow bucket. */
const SPEED_OVERFLOW_THRESHOLD = 1000;

interface SpeedBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  overflow?: boolean;
}

/** Numeric token_output_speed, or null when missing/invalid. */
function getOutputSpeed(row: ChatDetailRow): number | null {
  const value = Number(row.token_output_speed);
  return Number.isFinite(value) ? value : null;
}

function formatSpeedBucketLabel(min: number, max: number): string {
  if (min === max) return formatNumber(min, 0);
  return `${formatNumber(min, 0)}~${formatNumber(max, 0)}`;
}

function buildSpeedBuckets(rows: ChatDetailRow[]): SpeedBucket[] {
  const speedRows = rows
    .map((row) => ({ row, speed: getOutputSpeed(row) }))
    .filter((item): item is { row: ChatDetailRow; speed: number } => item.speed != null)
    .sort((a, b) => a.speed - b.speed);

  if (speedRows.length === 0) return [];

  const regularRows = speedRows.filter((item) => item.speed <= SPEED_OVERFLOW_THRESHOLD);
  const overflowRows = speedRows.filter((item) => item.speed > SPEED_OVERFLOW_THRESHOLD);
  const buckets: SpeedBucket[] = [];

  if (regularRows.length === 0) {
    return [{
      label: `>${formatNumber(SPEED_OVERFLOW_THRESHOLD, 0)}`,
      min: SPEED_OVERFLOW_THRESHOLD,
      max: Number.POSITIVE_INFINITY,
      count: overflowRows.length,
      overflow: true,
    }];
  }

  const minSpeed = regularRows[0]!.speed;
  const maxSpeed = regularRows[regularRows.length - 1]!.speed;
  const span = maxSpeed - minSpeed;
  const bucketCount = Math.min(SPEED_BUCKET_COUNT, Math.max(1, regularRows.length));
  const bucketSize = span > 0 ? span / bucketCount : 1;
  buckets.push(...Array.from({ length: bucketCount }, (_, index): SpeedBucket => {
    const min = span > 0 ? minSpeed + index * bucketSize : minSpeed;
    const max = span > 0 && index < bucketCount - 1 ? min + bucketSize : maxSpeed;
    return { label: formatSpeedBucketLabel(min, max), min, max, count: 0 };
  }));

  regularRows.forEach(({ speed }) => {
    const index = span > 0
      ? Math.min(Math.floor((speed - minSpeed) / bucketSize), buckets.length - 1)
      : 0;
    buckets[index]!.count += 1;
  });

  if (overflowRows.length > 0) {
    buckets.push({
      label: `>${formatNumber(SPEED_OVERFLOW_THRESHOLD, 0)}`,
      min: SPEED_OVERFLOW_THRESHOLD,
      max: Number.POSITIVE_INFINITY,
      count: overflowRows.length,
      overflow: true,
    });
  }

  return buckets;
}

function finiteValues(
  rows: ChatDetailRow[],
  key: keyof ChatDetailRow,
): number[] {
  return rows
    .map((row) => row[key])
    .filter((value) => value != null)
    .map(Number)
    .filter(Number.isFinite);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (percent / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const left = sorted[lower] ?? 0;
  const right = sorted[upper] ?? left;
  return left + (right - left) * (rank - lower);
}

function metric(value: number | null, digits = 2): string {
  return value == null ? "-" : formatNumber(value, digits);
}

function metricWithUnit(
  value: number | null,
  unit: string,
  digits = 2,
): string {
  return value == null ? "-" : `${formatNumber(value, digits)} ${unit}`;
}

function buildConcurrencyTrend(rows: ChatDetailRow[]): MultiTrendPoint[] {
  const events: Array<{ time: number; delta: number }> = [];
  for (const row of rows) {
    const start = Date.parse(row.request_time || row.ts);
    if (!Number.isFinite(start)) continue;
    let end = row.end_time ? Date.parse(row.end_time) : Number.NaN;
    if (!Number.isFinite(end) && row.duration != null) {
      end = start + row.duration;
    }
    if (!Number.isFinite(end) || end < start) continue;
    events.push({ time: start, delta: 1 }, { time: end, delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  return events.map((event) => {
    active = Math.max(0, active + event.delta);
    return {
      label: new Date(event.time).toLocaleTimeString("zh-CN", {
        hour12: false,
      }),
      concurrency: active,
    };
  });
}

// ============================ CSV export ============================
// Serializes the current ChatDetailRow[] to CSV. Columns mirror the results
// table (time / request id / user / model / routed / status / tokens /
// duration / output speed). Pure frontend — Blob + anchor download.

/** CSV columns matching the results-table header order. */
const CSV_COLUMNS: Array<{ header: string; get: (row: ChatDetailRow) => string }> = [
  { header: "时间", get: (r) => r.ts ?? "" },
  { header: "Request ID", get: (r) => r.request_id ?? "" },
  { header: "Universal ID", get: (r) => r.universal_id ?? "" },
  { header: "User ID", get: (r) => r.user_id ?? "" },
  { header: "用户名", get: (r) => r.username ?? "" },
  { header: "Model", get: (r) => r.model ?? "" },
  { header: "Routed", get: (r) => r.routed_model ?? "" },
  { header: "状态", get: (r) => (isErrorCode(r.error_code) ? r.error_code ?? "" : "OK") },
  { header: "输入 Token", get: (r) => String(r.prompt_tokens ?? "") },
  { header: "输出 Token", get: (r) => String(r.completion_tokens ?? "") },
  { header: "耗时(ms)", get: (r) => String(r.duration ?? "") },
  { header: "输出速度(token/s)", get: (r) => String(r.token_output_speed ?? "") },
  {
    header: "E2E 输出速度(token/s)",
    get: (r) => String(r.token_output_speed_e2e ?? ""),
  },
];

/** RFC 4180 CSV cell quoting: wrap in quotes if it contains comma/quote/newline. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: ChatDetailRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const body = rows
    .map((row) => CSV_COLUMNS.map((c) => csvCell(c.get(row))).join(","))
    .join("\r\n");
  // Prepend a UTF-8 BOM so Excel opens Chinese headers correctly.
  return `\uFEFF${header}\r\n${body}`;
}

/** Trigger a browser download of `csv` as a timestamped .csv file. */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---- datetime-local <-> ISO 8601 with browser offset (source helpers) ----

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date -> datetime-local input value (local tz, 'YYYY-MM-DDTHH:mm'). */
function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

/** datetime-local value -> 'YYYY-MM-DDTHH:mm:ss±HH:mm' (pad seconds + tz). */
function toIsoWithOffset(v: string): string {
  const d = new Date(v);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const base = v.length === 16 ? `${v}:00` : v;
  return `${base}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function buildQuickRange(minutes: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60_000);
  return { start: toLocalInputValue(start), end: toLocalInputValue(end) };
}

// ============================ Form state ============================

interface QueryForm {
  datasourceId: string;
  start: string;
  end: string;
  universalId: string;
  userId: string;
  userName: string;
  requestId: string;
  model: string;
  routedModel: string;
  /** '' = all, 'true' = errors only, 'false' = successes only */
  hasError: "" | "true" | "false";
  limit: number;
  order: "desc" | "asc";
}

function defaultForm(datasourceId = ""): QueryForm {
  const { start, end } = buildQuickRange(DEFAULT_QUICK_RANGE_MINUTES);
  return {
    datasourceId,
    start,
    end,
    universalId: "",
    userId: "",
    userName: "",
    requestId: "",
    model: "",
    routedModel: "",
    hasError: "",
    limit: DEFAULT_LIMIT,
    order: "desc",
  };
}

// ============================ Page ============================

export function RealtimeQueryPage() {
  const wsId = useWorkspaceId();

  // Datasource list + global chat-enabled flag (gate the page like the source).
  const dsQ = useQuery(chatDatasourcesOptions(wsId));
  const gcQ = useQuery(globalConfigOptions(wsId));

  const queryDatasources = useMemo(
    () =>
      (dsQ.data ?? []).filter(
        (d) =>
          d.is_enabled &&
          (d.source_type === "postgres" ||
            d.source_type === "elasticsearch"),
      ),
    [dsQ.data],
  );
  const lokiDatasources = useMemo(
    () =>
      (dsQ.data ?? []).filter(
        (d) => d.is_enabled && d.source_type === "loki",
      ),
    [dsQ.data],
  );

  const [form, setForm] = useState<QueryForm>(() => defaultForm());
  const [activeQuickRange, setActiveQuickRange] = useState<number | null>(
    DEFAULT_QUICK_RANGE_MINUTES,
  );
  const [validateMsg, setValidateMsg] = useState("");
  /** Committed form — what the query actually runs on. Null until first 查询. */
  const [committed, setCommitted] = useState<QueryForm | null>(null);
  const [queryRun, setQueryRun] = useState(0);
  const [displayPage, setDisplayPage] = useState(1);
  const [displayPageSize, setDisplayPageSize] = useState(DEFAULT_DISPLAY_PAGE_SIZE);
  const [showStats, setShowStats] = useState(false);
  const [showConcurrency, setShowConcurrency] = useState(false);
  const [speedMin, setSpeedMin] = useState("");
  const [speedMax, setSpeedMax] = useState("");

  // Auto-select the first enabled datasource once the list resolves.
  useEffect(() => {
    const first = queryDatasources[0];
    if (!form.datasourceId && first) {
      setForm((f) => ({ ...f, datasourceId: String(first.id) }));
    }
  }, [form.datasourceId, queryDatasources]);

  function setField<K extends keyof QueryForm>(key: K, value: QueryForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setTimeField(key: "start" | "end", value: string) {
    setActiveQuickRange(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applyQuickRange(minutes: number) {
    setActiveQuickRange(minutes);
    setForm((f) => ({ ...f, ...buildQuickRange(minutes) }));
  }

  function submit() {
    // Re-snapshot the quick range so the committed start/end match the label.
    const effective: QueryForm =
      activeQuickRange == null
        ? form
        : { ...form, ...buildQuickRange(activeQuickRange) };
    if (activeQuickRange != null) setForm(effective);

    if (!effective.datasourceId) {
      setValidateMsg("请选择数据源");
      return;
    }
    if (!effective.start || !effective.end) {
      setValidateMsg("请选择查询起止时间");
      return;
    }
    const startMs = new Date(effective.start).getTime();
    const endMs = new Date(effective.end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setValidateMsg("时间格式无效");
      return;
    }
    if (startMs >= endMs) {
      setValidateMsg("开始时间必须早于结束时间");
      return;
    }
    setValidateMsg("");
    setDisplayPage(1);
    setCommitted(effective);
    setQueryRun((value) => value + 1);
  }

  function resetForm() {
    const firstDs = queryDatasources[0];
    const next = defaultForm(form.datasourceId || (firstDs ? String(firstDs.id) : ""));
    setForm(next);
    setActiveQuickRange(DEFAULT_QUICK_RANGE_MINUTES);
    setValidateMsg("");
    setCommitted(null);
    setShowStats(false);
    setShowConcurrency(false);
  }

  // Build the query request from the committed form. Only the non-empty
  // optional filters are included (server treats omitted as "no filter").
  const queryReq = useMemo<ChatDetailQueryReq | null>(() => {
    if (!committed) return null;
    const req: ChatDetailQueryReq = {
      datasource_id: committed.datasourceId,
      start_time: toIsoWithOffset(committed.start),
      end_time: toIsoWithOffset(committed.end),
      limit: committed.limit,
      order: committed.order,
    };
    const userId = committed.userId.trim();
    const userName = committed.userName.trim();
    const universalId = committed.universalId.trim();
    const requestId = committed.requestId.trim();
    const model = committed.model.trim();
    const routedModel = committed.routedModel.trim();
    if (universalId) req.universal_id = universalId;
    if (userId) req.user_id = userId;
    if (userName) req.username = userName;
    if (requestId) req.request_id = requestId;
    if (model) req.model = model;
    if (routedModel) req.routed_model = routedModel;
    if (committed.hasError === "true") req.has_error = true;
    else if (committed.hasError === "false") req.has_error = false;
    return req;
  }, [committed]);

  const detailOptions = chatDetailQueryOptions(
    wsId,
    queryReq ?? EMPTY_REQ,
    queryRun,
  );
  const detailQ = useQuery({
    ...detailOptions,
    // Don't fire until the user submits; EMPTY_REQ keeps the key stable pre-submit.
    enabled: !!queryReq,
  });

  const rows = detailQ.data?.items ?? [];
  const total = detailQ.data?.total ?? 0;

  // Reset display page when a new result set arrives / page size changes.
  useEffect(() => {
    setDisplayPage(1);
    setSpeedMin("");
    setSpeedMax("");
  }, [detailQ.data, displayPageSize]);

  const totalDisplayPages = Math.max(1, Math.ceil(rows.length / displayPageSize));
  const safePage = Math.min(displayPage, totalDisplayPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * displayPageSize;
    return rows.slice(start, start + displayPageSize);
  }, [displayPageSize, rows, safePage]);
  const pageStart = rows.length === 0 ? 0 : (safePage - 1) * displayPageSize + 1;
  const pageEnd = Math.min(safePage * displayPageSize, rows.length);

  // chat_stats_enabled guard (mock bypasses it).
  const configResolved = MOCK_ENABLED || !gcQ.isLoading;
  const chatEnabled = MOCK_ENABLED || gcQ.data?.chat_stats_enabled === true;

  const [detailRow, setDetailRow] = useState<ChatDetailRow | null>(null);

  // ---- Speed distribution buckets (client-side, from the detail rows) ----
  const speedBuckets = useMemo(() => buildSpeedBuckets(rows), [rows]);
  const speedStats = useMemo(() => {
    const completion = finiteValues(rows, "completion_tokens");
    const speed = finiteValues(rows, "token_output_speed");
    const speedE2e = finiteValues(rows, "token_output_speed_e2e");
    const ttft = finiteValues(rows, "first_token_duration");
    return [
      { label: "统计样本", value: formatNumber(rows.length) },
      { label: "平均输出 Token", value: metric(average(completion)) },
      {
        label: "平均输出速度",
        value: metricWithUnit(average(speed), "token/s"),
      },
      {
        label: "平均 E2E 输出速度",
        value: metricWithUnit(average(speedE2e), "token/s"),
      },
      {
        label: "平均 TTFT",
        value: metricWithUnit(average(ttft), "ms", 0),
      },
      {
        label: "P90 输出速度",
        value: metricWithUnit(percentile(speed, 90), "token/s"),
      },
      {
        label: "P95 输出速度",
        value: metricWithUnit(percentile(speed, 95), "token/s"),
      },
      {
        label: "P90 E2E 输出速度",
        value: metricWithUnit(percentile(speedE2e, 90), "token/s"),
      },
      {
        label: "P95 E2E 输出速度",
        value: metricWithUnit(percentile(speedE2e, 95), "token/s"),
      },
      {
        label: "P90 TTFT",
        value: metricWithUnit(percentile(ttft, 90), "ms", 0),
      },
      {
        label: "P95 TTFT",
        value: metricWithUnit(percentile(ttft, 95), "ms", 0),
      },
    ];
  }, [rows]);
  const concurrencyTrend = useMemo(() => buildConcurrencyTrend(rows), [rows]);
  const speedFilteredRows = useMemo(() => {
    const min = speedMin === "" ? null : Number(speedMin);
    const max = speedMax === "" ? null : Number(speedMax);
    return rows.filter((row) => {
      const speed = getOutputSpeed(row);
      if (speed == null) return false;
      if (min != null && Number.isFinite(min) && speed < min) return false;
      if (max != null && Number.isFinite(max) && speed > max) return false;
      return true;
    });
  }, [rows, speedMax, speedMin]);

  // ---- Loki trace-log drawer state ----
  // When a row is selected the detail dialog offers a "查询链路日志" button
  // (only when a Loki datasource exists). Opening it sets `traceRequestId`,
  // which drives the Sheet's open state and the trace-logs query.
  const hasEnabledLokiDatasource = lokiDatasources.length > 0;
  const [traceRequestId, setTraceRequestId] = useState<string | null>(null);

  function exportResults() {
    if (rows.length === 0) return;
    const csv = rowsToCsv(rows);
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, "")
      .replace(/\..+/, "");
    downloadCsv(csv, `realtime-query-${stamp}.csv`);
  }

  const header = (
    <PageHeader className="h-auto min-h-12 flex-wrap items-center px-5 py-1.5 sm:py-0">
      <div className="flex min-w-0 items-center gap-2">
        <ListFilter className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">明细查询</h1>
        <span className="truncate text-xs text-muted-foreground">
          · 直查源库 · 最多 5000 条
        </span>
      </div>
    </PageHeader>
  );

  if (!configResolved) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-6 lg:px-8">
            <FormSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (!chatEnabled) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 lg:px-8">
            <div className="flex min-h-[12rem] items-center justify-center rounded-lg border bg-card px-4 text-center text-sm text-muted-foreground">
              当前环境未启用平台指标服务（chat_stats_enabled=false），配置平台源后将可按条件点查 LLM 请求明细。
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          {/* ============ Filter form ============ */}
          <Section
            title="查询条件"
            bodyClassName="space-y-3 p-4"
            rightSlot={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={submit}
                  disabled={
                    detailQ.isFetching ||
                    dsQ.isLoading ||
                    queryDatasources.length === 0
                  }
                >
                  <Search className="size-3.5" />
                  {detailQ.isFetching ? "查询中…" : "查询"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={resetForm}
                >
                  重置
                </Button>
              </div>
            }
          >
            {/* Row 1: datasource + time range + quick ranges */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterLabel htmlFor="rq-datasource">数据源</FilterLabel>
              <NativeSelect
                id="rq-datasource"
                value={form.datasourceId}
                onChange={(e) => setField("datasourceId", e.target.value)}
                disabled={dsQ.isLoading || detailQ.isFetching}
                aria-label="数据源"
                className="min-w-[240px]"
              >
                {dsQ.isLoading ? (
                  <option value="">正在加载数据源...</option>
                ) : queryDatasources.length === 0 ? (
                  <option value="">暂无可用数据源</option>
                ) : (
                  <>
                    <option value="">请选择数据源</option>
                    {(dsQ.data ?? [])
                      .filter(
                        (d) =>
                          d.source_type === "postgres" ||
                          d.source_type === "elasticsearch",
                      )
                      .map((d) => (
                        <option
                          key={d.id}
                          value={String(d.id)}
                          disabled={!d.is_enabled}
                        >
                          {d.name}（{d.source_type === "postgres" ? "PG" : "ES"}）
                          {d.is_enabled ? "" : " - 未启用"}
                        </option>
                      ))}
                  </>
                )}
              </NativeSelect>
              <FilterLabel htmlFor="rq-start">时间范围</FilterLabel>
              <Input
                id="rq-start"
                type="datetime-local"
                value={form.start}
                onChange={(e) => setTimeField("start", e.target.value)}
                className="w-[200px]"
                aria-label="开始时间"
              />
              <span className="text-muted-foreground">~</span>
              <Input
                type="datetime-local"
                value={form.end}
                onChange={(e) => setTimeField("end", e.target.value)}
                className="w-[200px]"
                aria-label="结束时间"
              />
              <span className="ml-1 text-xs text-muted-foreground">快捷：</span>
              {QUICK_RANGES.map((r) => (
                <Button
                  key={r.minutes}
                  type="button"
                  size="sm"
                  variant={activeQuickRange === r.minutes ? "default" : "outline"}
                  onClick={() => applyQuickRange(r.minutes)}
                  aria-pressed={activeQuickRange === r.minutes}
                >
                  {r.label}
                </Button>
              ))}
            </div>

            {/* Row 2: text filters + status + limit + order */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={form.universalId}
                onChange={(e) => setField("universalId", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Universal ID（精确）"
                className="w-[200px]"
              />
              <Input
                value={form.userId}
                onChange={(e) => setField("userId", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="User ID（精确）"
                className="w-[170px]"
              />
              <Input
                value={form.userName}
                onChange={(e) => setField("userName", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="用户名（精确）"
                className="w-[170px]"
              />
              <Input
                value={form.requestId}
                onChange={(e) => setField("requestId", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Request ID（精确）"
                className="w-[260px]"
              />
              <Input
                value={form.model}
                onChange={(e) => setField("model", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Model（精确）"
                className="w-[160px]"
              />
              <Input
                value={form.routedModel}
                onChange={(e) => setField("routedModel", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Routed Model（精确）"
                className="w-[180px]"
              />
              <NativeSelect
                value={form.hasError}
                onChange={(e) =>
                  setField("hasError", e.target.value as QueryForm["hasError"])
                }
                aria-label="是否存在错误"
              >
                <option value="">全部请求</option>
                <option value="true">仅错误</option>
                <option value="false">仅成功</option>
              </NativeSelect>
              <NativeSelect
                value={form.limit}
                onChange={(e) => setField("limit", Number(e.target.value))}
                aria-label="最多返回条数"
              >
                {QUERY_LIMIT_OPTIONS.map((limit) => (
                  <option key={limit} value={limit}>
                    最多 {limit} 条
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={form.order}
                onChange={(e) =>
                  setField("order", e.target.value as QueryForm["order"])
                }
                aria-label="排序方向"
              >
                <option value="desc">时间倒序</option>
                <option value="asc">时间正序</option>
              </NativeSelect>
            </div>

            {validateMsg ? (
              <div className="text-sm text-warning">{validateMsg}</div>
            ) : null}
            {dsQ.error ? (
              <div className="text-sm text-destructive">
                {(dsQ.error as Error)?.message || "获取数据源失败"}
              </div>
            ) : null}
          </Section>

          {/* ============ Results table ============ */}
          <Section
            title="查询结果"
            count={
              detailQ.isSuccess ? (
                <span className="font-normal text-muted-foreground">
                  共 {formatNumber(total)} 条记录
                </span>
              ) : null
            }
            rightSlot={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={showStats ? "default" : "outline"}
                  onClick={() => setShowStats((value) => !value)}
                  disabled={!detailQ.isSuccess}
                >
                  速度统计
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={showConcurrency ? "default" : "outline"}
                  onClick={() => setShowConcurrency((value) => !value)}
                  disabled={!detailQ.isSuccess || concurrencyTrend.length === 0}
                >
                  并发统计
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportResults}
                  disabled={!detailQ.isSuccess || rows.length === 0}
                  title="导出当前查询结果为 CSV"
                >
                  <Download className="size-3.5" />
                  导出
                </Button>
              </div>
            }
            bodyClassName="overflow-x-auto"
          >
            {detailQ.error ? (
              <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {(detailQ.error as Error)?.message || "查询失败"}
              </div>
            ) : null}

            {showStats && detailQ.isSuccess ? (
              <div className="grid grid-cols-2 gap-3 border-b bg-muted/20 p-4 md:grid-cols-4 xl:grid-cols-6">
                {speedStats.map((item) => (
                  <div key={item.label} className="rounded-md border bg-card p-3">
                    <div className="text-xs text-muted-foreground">
                      {item.label}
                    </div>
                    <div className="mt-1 font-semibold tabular-nums">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>时间</Th>
                  <Th>Request ID</Th>
                  <Th>Universal ID</Th>
                  <Th>User ID</Th>
                  <Th>用户名</Th>
                  <Th>Model</Th>
                  <Th>Routed</Th>
                  <Th>状态</Th>
                  <ThNum>输入 Token</ThNum>
                  <ThNum>输出 Token</ThNum>
                  <ThNum>耗时</ThNum>
                  <ThNum>输出速度</ThNum>
                  <ThNum>E2E 输出速度</ThNum>
                </tr>
              </thead>
              <tbody>
                {detailQ.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td colSpan={13} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-12 text-center">
                      <span className="text-sm text-muted-foreground">
                        {detailQ.isSuccess
                          ? "未查询到符合条件的记录"
                          : "设置查询条件后点击「查询」"}
                      </span>
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row, idx) => {
                    const hasErr = isErrorCode(row.error_code);
                    return (
                      <tr
                        // ES datasource rows share id=0; request_id is the
                        // unique key, padded with the page index for safety.
                        key={`${row.request_id || "row"}-${
                          (safePage - 1) * displayPageSize + idx
                        }`}
                        onClick={() => setDetailRow(row)}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                      >
                        <Td>{formatLocalTime(row.ts)}</Td>
                        <Td>
                          <span
                            className="block max-w-[220px] truncate font-mono text-xs text-primary"
                            title={row.request_id || undefined}
                          >
                            {row.request_id || "-"}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className="block max-w-[150px] truncate font-mono text-xs"
                            title={row.universal_id || undefined}
                          >
                            {row.universal_id || "-"}
                          </span>
                        </Td>
                        <Td>
                          <span
                            className="block max-w-[150px] truncate font-mono text-xs"
                            title={row.user_id || undefined}
                          >
                            {row.user_id || "-"}
                          </span>
                        </Td>
                        <Td>
                          <span className="block max-w-[160px] truncate">
                            {row.username || "-"}
                          </span>
                        </Td>
                        <Td>
                          {row.model ? (
                            <ToneBadge tone="primary">{row.model}</ToneBadge>
                          ) : (
                            "-"
                          )}
                        </Td>
                        <Td>
                          {row.routed_model ? (
                            <ToneBadge tone="info">{row.routed_model}</ToneBadge>
                          ) : (
                            "-"
                          )}
                        </Td>
                        <Td>
                          {hasErr ? (
                            <ToneBadge tone="error">
                              {row.error_code}
                            </ToneBadge>
                          ) : (
                            <ToneBadge tone="success">OK</ToneBadge>
                          )}
                        </Td>
                        <TdNum>{formatNumber(row.prompt_tokens)}</TdNum>
                        <TdNum>{formatNumber(row.completion_tokens)}</TdNum>
                        <TdNum>{fmtMs(row.duration)}</TdNum>
                        <TdNum>
                          {row.token_output_speed != null &&
                          Number.isFinite(Number(row.token_output_speed)) ? (
                            <>
                              {formatNumber(Number(row.token_output_speed), 2)}
                              <span className="ml-0.5 text-[10px] text-muted-foreground">
                                token/s
                              </span>
                            </>
                          ) : (
                            "-"
                          )}
                        </TdNum>
                        <TdNum>
                          {row.token_output_speed_e2e != null &&
                          Number.isFinite(Number(row.token_output_speed_e2e)) ? (
                            <>
                              {formatNumber(
                                Number(row.token_output_speed_e2e),
                                2,
                              )}
                              <span className="ml-0.5 text-[10px] text-muted-foreground">
                                token/s
                              </span>
                            </>
                          ) : (
                            "-"
                          )}
                        </TdNum>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {detailQ.isSuccess && rows.length > 0 ? (
              <ResultsPager
                page={safePage}
                pageSize={displayPageSize}
                total={rows.length}
                pageStart={pageStart}
                pageEnd={pageEnd}
                onPageChange={setDisplayPage}
                onPageSizeChange={setDisplayPageSize}
              />
            ) : null}
          </Section>

          {/* ============ Speed distribution chart ============ */}
          {/* Bar chart of token_output_speed buckets computed client-side from
              the detail rows. Only shown once results land with speed data. */}
          {detailQ.isSuccess && speedBuckets.length > 0 ? (
            <Section
              title="输出速度分布"
              count={
                <span className="font-normal text-muted-foreground">
                  按输出速度（token/s）分桶统计 {formatNumber(rows.length)} 条记录
                </span>
              }
              bodyClassName="space-y-4 p-4"
            >
              <SpeedDistributionChart buckets={speedBuckets} />
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  最小输出速度
                  <Input
                    type="number"
                    step="0.01"
                    value={speedMin}
                    onChange={(event) => setSpeedMin(event.target.value)}
                    className="mt-1 w-[150px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  最大输出速度
                  <Input
                    type="number"
                    step="0.01"
                    value={speedMax}
                    onChange={(event) => setSpeedMax(event.target.value)}
                    className="mt-1 w-[150px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  快速选择区间
                  <NativeSelect
                    className="mt-1 min-w-[240px]"
                    value=""
                    onChange={(event) => {
                      const bucket = speedBuckets[Number(event.target.value)];
                      if (!bucket) return;
                      setSpeedMin(
                        Number.isFinite(bucket.min) ? String(bucket.min) : "",
                      );
                      setSpeedMax(
                        Number.isFinite(bucket.max) ? String(bucket.max) : "",
                      );
                    }}
                  >
                    <option value="">选择一个速度区间</option>
                    {speedBuckets.map((bucket, index) => (
                      <option key={`${bucket.min}-${bucket.max}`} value={index}>
                        {bucket.label} token/s · {bucket.count} 条
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSpeedMin("");
                    setSpeedMax("");
                  }}
                >
                  全部速度
                </Button>
              </div>
              <div className="max-h-[320px] overflow-auto rounded-md border">
                <div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  速度区间内请求：{formatNumber(speedFilteredRows.length)} 条
                </div>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b">
                      <Th>时间</Th>
                      <Th>Request ID</Th>
                      <Th>Model</Th>
                      <ThNum>输出速度</ThNum>
                      <ThNum>E2E 输出速度</ThNum>
                    </tr>
                  </thead>
                  <tbody>
                    {speedFilteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          当前区间没有请求
                        </td>
                      </tr>
                    ) : (
                      speedFilteredRows.map((row, index) => (
                        <tr
                          key={`${row.request_id}-${index}`}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                          onClick={() => setDetailRow(row)}
                        >
                          <Td>{formatLocalTime(row.ts)}</Td>
                          <Td>{row.request_id || "-"}</Td>
                          <Td>{row.model || "-"}</Td>
                          <TdNum>{metric(getOutputSpeed(row))}</TdNum>
                          <TdNum>
                            {metric(
                              row.token_output_speed_e2e == null
                                ? null
                                : Number(row.token_output_speed_e2e),
                            )}
                          </TdNum>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {showConcurrency && concurrencyTrend.length > 0 ? (
            <Section title="请求并发统计" count="按请求开始与结束时间计算" bodyClassName="p-4">
              <MultiTrendChart
                data={concurrencyTrend}
                series={[
                  {
                    key: "concurrency",
                    name: "并发数",
                    color: "var(--primary)",
                  },
                ]}
                formatY={(value) => formatNumber(value)}
              />
            </Section>
          ) : null}
        </div>
      </div>

      {/* ============ Row detail dialog (full field set) ============ */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>请求详情 · {detailRow?.request_id || "-"}</DialogTitle>
            <DialogDescription>
              点击行查看该请求的全部字段；Local Log Path 可在线预览日志。
            </DialogDescription>
          </DialogHeader>
          {detailRow ? (
            <RowDetail
              row={detailRow}
              onClose={() => setDetailRow(null)}
              canOpenTrace={
                !!detailRow.request_id && hasEnabledLokiDatasource
              }
              onOpenTrace={(requestId) => setTraceRequestId(requestId)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ============ Loki trace-log drawer ============ */}
      {/* Side panel showing the selected request's trace-log entries fetched
          via chatTraceLogsOptions (scoped to the committed query window). */}
      <TraceLogDrawer
        wsId={wsId}
        requestId={traceRequestId}
        datasources={lokiDatasources}
        startTime={
          committed ? toIsoWithOffset(committed.start) : toIsoWithOffset(form.start)
        }
        endTime={
          committed ? toIsoWithOffset(committed.end) : toIsoWithOffset(form.end)
        }
        onClose={() => setTraceRequestId(null)}
      />
    </div>
  );
}

// Stable empty request so the query key is stable before the first submit.
// The query is disabled until `queryReq` is non-null, so this never fires.
const EMPTY_REQ: ChatDetailQueryReq = {
  start_time: "",
  end_time: "",
};

// ============================ Sub-components ============================

function FilterLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm text-muted-foreground"
    >
      {children}
    </label>
  );
}

/** Results-table pager — page size + prev/next + range text. */
function ResultsPager({
  page,
  pageSize,
  total,
  pageStart,
  pageEnd,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  pageStart: number;
  pageEnd: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
      <div>
        展示 {formatNumber(pageStart)}-{formatNumber(pageEnd)} /{" "}
        {formatNumber(total)} 条
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>每页</span>
        <NativeSelect
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="表格每页展示条数"
        >
          {DISPLAY_PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size} 条
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          上一页
        </Button>
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/** Row detail — full ChatDetailRow field set across labelled sections. */
function RowDetail({
  row,
  onClose,
  canOpenTrace,
  onOpenTrace,
}: {
  row: ChatDetailRow;
  onClose: () => void;
  /** Whether a Loki datasource exists + this row has a request_id. */
  canOpenTrace?: boolean;
  /** Open the Loki trace-log drawer for the given request_id. */
  onOpenTrace?: (requestId: string) => void;
}) {
  const hasErr = isErrorCode(row.error_code);
  const localLogPath = (row.local_log_path || "").trim();

  const [logOpen, setLogOpen] = useState(false);

  return (
    <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
      {hasErr ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
          该请求出错，错误码：
          <span className="font-mono font-bold">{row.error_code}</span>
        </div>
      ) : null}

      <DetailSection title="基础信息">
        <Field label="ID" value={row.id} />
        <Field
          label="状态"
          value={
            hasErr ? (
              <ToneBadge tone="error">{row.error_code}</ToneBadge>
            ) : (
              <ToneBadge tone="success">OK</ToneBadge>
            )
          }
        />
        <Field
          label="Request ID"
          span2
          mono
          value={
            row.request_id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all">{row.request_id}</span>
                {canOpenTrace && onOpenTrace ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenTrace(row.request_id)}
                  >
                    查询链路日志
                  </Button>
                ) : null}
              </div>
            ) : (
              "-"
            )
          }
        />
        <Field label="Universal ID" value={row.universal_id} mono />
        <Field label="User ID" value={row.user_id} mono />
        <Field label="用户名" value={row.username} />
        <Field label="错误码" value={row.error_code} mono />
      </DetailSection>

      <DetailSection title="模型与标签">
        <Field
          label="Model"
          value={
            row.model ? <ToneBadge tone="primary">{row.model}</ToneBadge> : null
          }
        />
        <Field
          label="Routed Model"
          value={
            row.routed_model ? (
              <ToneBadge tone="info">{row.routed_model}</ToneBadge>
            ) : null
          }
        />
        <Field
          label="Mode"
          value={row.mode ? <ToneBadge tone="neutral">{row.mode}</ToneBadge> : null}
        />
        <Field label="Client Version" value={row.client_version} mono />
        <Field label="Task ID" value={row.task_id} span2 mono />
      </DetailSection>

      <DetailSection title="Token 指标">
        <Field label="Prompt Tokens" value={formatNumber(row.prompt_tokens)} />
        <Field label="Completion Tokens" value={formatNumber(row.completion_tokens)} />
        <Field label="Cache Tokens" value={formatNumber(row.cache_tokens)} />
        <Field label="Retry Num" value={formatNumber(row.retry_num)} />
        <Field label="System Tokens" value={formatNumber(row.system_tokens)} />
        <Field label="User Tokens" value={formatNumber(row.user_tokens)} />
        <Field
          label="Processed System Tokens"
          value={formatNumber(row.processed_system_tokens)}
        />
        <Field
          label="Processed User Tokens"
          value={formatNumber(row.processed_user_tokens)}
        />
      </DetailSection>

      <DetailSection title="性能指标">
        <Field label="Duration" value={fmtMs(row.duration)} />
        <Field label="TTFT" value={fmtMs(row.first_token_duration)} />
        <Field label="Slow Chunk" value={formatNumber(row.slow_chunk)} />
        <Field label="Chunk/s" value={formatNumber(row.chunk_per_second, 2)} />
        <Field label="Token Output Time" value={fmtMs(row.token_output_time)} />
        <Field
          label="Token Output Speed"
          value={
            row.token_output_speed != null
              ? `${formatNumber(Number(row.token_output_speed), 2)} token/s`
              : null
          }
        />
        <Field
          label="Token Output Speed E2E"
          value={
            row.token_output_speed_e2e != null
              ? `${formatNumber(Number(row.token_output_speed_e2e), 2)} token/s`
              : null
          }
        />
      </DetailSection>

      <DetailSection title="时间链路">
        <Field label="TS" value={formatLocalTime(row.ts)} />
        <Field
          label="Created At"
          value={row.created_at ? formatLocalTime(row.created_at) : null}
        />
        <Field
          label="Request Time"
          value={row.request_time ? formatLocalTime(row.request_time) : null}
        />
        <Field
          label="Forward Request Time"
          value={
            row.forward_request_time
              ? formatLocalTime(row.forward_request_time)
              : null
          }
        />
        <Field
          label="End Time"
          value={row.end_time ? formatLocalTime(row.end_time) : null}
        />
      </DetailSection>

      <DetailSection title="日志">
        <Field
          label="Local Log Path"
          span2
          mono
          value={
            localLogPath ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all">{localLogPath}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLogOpen(true)}
                >
                  预览
                </Button>
              </div>
            ) : null
          }
        />
      </DetailSection>

      <LogPreviewDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        localLogPath={localLogPath}
        // Close the row detail too once the user closes the log preview.
        onRowClose={onClose}
      />
    </div>
  );
}

/** Detail dialog labelled section (title + 2-col KV grid). */
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

/** Labelled value cell. Falsy values render as "-". */
function Field({
  label,
  value,
  span2 = false,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  span2?: boolean;
  mono?: boolean;
}) {
  const display = value == null || value === "" ? "-" : value;
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <div className="mb-0.5 text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm text-card-foreground ${mono ? "break-all font-mono" : ""}`}
      >
        {display}
      </div>
    </div>
  );
}

/**
 * Log preview dialog. Fetches the log content via chatLogPreviewOptions when
 * opened. Shows file metadata and formats JSON content when possible.
 */
function LogPreviewDialog({
  open,
  onOpenChange,
  localLogPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localLogPath: string;
  onRowClose: () => void;
}) {
  const wsId = useWorkspaceId();
  const previewQ = useQuery({
    ...chatLogPreviewOptions(wsId, localLogPath),
    enabled: open && !!localLogPath,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>日志预览</DialogTitle>
          <DialogDescription>
            {localLogPath ? (
              <span className="break-all font-mono text-xs">
                {localLogPath}
              </span>
            ) : (
              "无日志路径"
            )}
          </DialogDescription>
        </DialogHeader>
        <LogPreviewBody
          loading={previewQ.isLoading}
          error={previewQ.error as Error | null}
          data={previewQ.data}
          fallbackPath={localLogPath}
        />
      </DialogContent>
    </Dialog>
  );
}

function LogPreviewBody({
  loading,
  error,
  data,
  fallbackPath,
}: {
  loading: boolean;
  error: Error | null;
  data: ChatLogPreviewResponse | undefined;
  fallbackPath: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error.message || "日志预览失败"}
      </div>
    );
  }
  if (!data) return null;

  if (!data.previewable) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="文件名" value={data.file_name || "-"} />
          <Field label="大小" value={formatBytes(Number(data.size_bytes))} />
          <Field
            label="路径"
            span2
            mono
            value={data.path || fallbackPath}
          />
        </div>
        <div className="rounded-lg border border-info/20 bg-info/5 px-4 py-3 text-sm text-info">
          {data.message || "该文件不支持在线预览"}
        </div>
      </div>
    );
  }

  const content = formattedLogLine(data.content || "");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="文件名" value={data.file_name || "-"} />
        <Field label="大小" value={formatBytes(Number(data.size_bytes))} />
        <Field
          label="路径"
          span2
          mono
          value={data.path || fallbackPath}
        />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          原文预览（{formatBytes(Number(data.size_bytes))}）
        </div>
        <pre className="m-0 max-h-[420px] overflow-auto bg-background p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
          {content}
        </pre>
      </div>
    </div>
  );
}

/** Format bytes as B / KB / MB (source helper). */
function formatBytes(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

/** Filter-form skeleton (pre config resolve). */
function FormSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <Skeleton className="h-9 w-full rounded" />
      <Skeleton className="h-9 w-full rounded" />
    </div>
  );
}

/**
 * Speed distribution chart. Renders the bucketed token_output_speed as a
 * vertical bar chart (categories on X = speed range labels, values on Y =
 * request count). The overflow bucket (">1000") is tinted with a warning
 * color so outliers stand out. Pure presentation — no interactivity.
 */
function SpeedDistributionChart({ buckets }: { buckets: SpeedBucket[] }) {
  const data = buckets.map((b) => ({ label: b.label, value: b.count }));
  const colors = buckets.map((b) =>
    b.overflow ? "var(--chart-5, #ef4444)" : "var(--chart-1)",
  );
  return (
    <VerticalBarChart
      data={data}
      colors={colors}
      formatY={(v) => formatNumber(v)}
      heightClass="h-[280px]"
    />
  );
}

interface LokiQueryPreset {
  name: string;
  label_selector: string;
}

function datasourcePresets(datasource: ChatDatasource | undefined): LokiQueryPreset[] {
  if (!datasource) return [];
  const candidates = [datasource.config_json, datasource.loki_queries];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as
        | { queries?: unknown[] }
        | unknown[];
      const values = Array.isArray(parsed) ? parsed : parsed.queries;
      if (!Array.isArray(values)) continue;
      return values
        .filter(
          (value): value is LokiQueryPreset =>
            typeof value === "object" &&
            value !== null &&
            typeof Reflect.get(value, "label_selector") === "string",
        )
        .map((value, index) => ({
          name: value.name || `预设 ${index + 1}`,
          label_selector: value.label_selector,
        }));
    } catch {
      // Ignore malformed legacy datasource configuration.
    }
  }
  return [];
}

function formattedLogLine(line: string): string {
  const starts = [line.indexOf("{"), line.indexOf("[")].filter(
    (index) => index >= 0,
  );
  if (starts.length === 0) return line;
  const start = Math.min(...starts);
  try {
    const parsed = JSON.parse(line.slice(start));
    return `${line.slice(0, start)}${JSON.stringify(parsed, null, 2)}`;
  } catch {
    return line;
  }
}

function TraceLogDrawer({
  wsId,
  requestId,
  datasources,
  startTime,
  endTime,
  onClose,
}: {
  wsId: string;
  requestId: string | null;
  datasources: ChatDatasource[];
  startTime: string;
  endTime: string;
  onClose: () => void;
}) {
  const open = !!requestId;
  const [datasourceId, setDatasourceId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [labelSelector, setLabelSelector] = useState("");
  const [cursor, setCursor] = useState("");
  const [entries, setEntries] = useState<ChatTraceLogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] =
    useState<ChatTraceLogEntry | null>(null);
  const selectedDatasource = datasources.find(
    (datasource) => String(datasource.id) === datasourceId,
  );
  const presets = useMemo(
    () => datasourcePresets(selectedDatasource),
    [selectedDatasource],
  );

  useEffect(() => {
    if (!open) return;
    const first = datasources[0];
    const firstPresets = datasourcePresets(first);
    const preset = firstPresets[0];
    setDatasourceId(first ? String(first.id) : "");
    setPresetName(preset?.name ?? "");
    setLabelSelector(preset?.label_selector ?? "");
    setCursor("");
    setEntries([]);
    setSelectedEntry(null);
  }, [datasources, open, requestId]);

  const req = useMemo(
    () => ({
      datasource_id: datasourceId,
      request_id: requestId ?? "",
      label_selector: labelSelector || undefined,
      start_time: startTime,
      end_time: endTime,
      limit: 100,
      cursor: cursor || undefined,
    }),
    [
      cursor,
      datasourceId,
      endTime,
      labelSelector,
      requestId,
      startTime,
    ],
  );
  const traceQ = useQuery({
    ...chatTraceLogsOptions(wsId, req),
    enabled: open && !!requestId && !!datasourceId && !!startTime,
  });

  useEffect(() => {
    const nextEntries = traceQ.data?.entries;
    if (!nextEntries) return;
    setEntries((current) => {
      const base = cursor ? current : [];
      const seen = new Set(
        base.map((entry) => `${entry.timestamp}\u0000${entry.line}`),
      );
      return [
        ...base,
        ...nextEntries.filter((entry) => {
          const key = `${entry.timestamp}\u0000${entry.line}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ];
    });
  }, [cursor, traceQ.data]);

  const loading = traceQ.isFetching;
  const error = traceQ.error as Error | null;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>链路日志 · {requestId || "-"}</SheetTitle>
            <SheetDescription>
              选择 Loki 数据源和查询预设，按当前明细查询时间范围获取日志。
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-wrap items-center gap-2 border-b px-4 pb-3">
            <NativeSelect
              value={datasourceId}
              onChange={(event) => {
                const nextId = event.target.value;
                const datasource = datasources.find(
                  (item) => String(item.id) === nextId,
                );
                const preset = datasourcePresets(datasource)[0];
                setDatasourceId(nextId);
                setPresetName(preset?.name ?? "");
                setLabelSelector(preset?.label_selector ?? "");
                setCursor("");
                setEntries([]);
              }}
              aria-label="Loki 数据源"
            >
              {datasources.length === 0 ? (
                <option value="">未配置 Loki 数据源</option>
              ) : (
                datasources.map((datasource) => (
                  <option key={datasource.id} value={String(datasource.id)}>
                    {datasource.name}
                  </option>
                ))
              )}
            </NativeSelect>
            <NativeSelect
              value={presetName}
              onChange={(event) => {
                const preset = presets.find(
                  (item) => item.name === event.target.value,
                );
                setPresetName(event.target.value);
                setLabelSelector(preset?.label_selector ?? "");
                setCursor("");
                setEntries([]);
              }}
              disabled={presets.length === 0}
              aria-label="Loki 查询预设"
            >
              {presets.length === 0 ? (
                <option value="">使用数据源默认查询</option>
              ) : (
                presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))
              )}
            </NativeSelect>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            {error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error.message || "链路日志查询失败"}
              </div>
            ) : null}

            {loading && entries.length === 0 ? (
              <div className="space-y-2 py-6">
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-3/4 rounded" />
              </div>
            ) : entries.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {datasourceId ? "未找到相关日志" : "请先配置并启用 Loki 数据源"}
              </div>
            ) : (
              <div className="space-y-1">
                {entries.map((entry, index) => (
                  <button
                    type="button"
                    key={`${entry.timestamp}-${index}`}
                    onClick={() => setSelectedEntry(entry)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left font-mono text-xs leading-relaxed hover:bg-muted/50"
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">
                      {entry.timestamp
                        ? entry.timestamp.replace("T", " ").replace(/\+.*/, "")
                        : "-"}
                    </span>
                    <span className="break-all text-card-foreground">
                      {entry.line}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {traceQ.data?.has_more ? (
              <div className="flex justify-center py-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading || !traceQ.data.next_cursor}
                  onClick={() => setCursor(traceQ.data?.next_cursor ?? "")}
                >
                  {loading ? "加载中..." : "加载更多"}
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!selectedEntry}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedEntry(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>日志条目详情</DialogTitle>
            <DialogDescription>
              {selectedEntry?.timestamp || "未提供时间戳"}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[520px] overflow-auto rounded-lg border bg-muted/20 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {selectedEntry ? formattedLogLine(selectedEntry.line) : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

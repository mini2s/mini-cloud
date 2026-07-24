"use client";

import { useEffect, useMemo, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatDatasourcesOptions,
  chatDetailQueryOptions,
  chatLogPreviewOptions,
  globalConfigOptions,
  formatLocalTime,
  formatNumber,
  MOCK_ENABLED,
  type ChatDetailQueryReq,
  type ChatDetailRow,
  type ChatLogPreviewResponse,
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
import { PageHeader } from "../../layout/page-header";
import { Section } from "./shared";
import { Th, ThNum, Td, TdNum, fmtMs } from "../usage/shared";
import { ToneBadge } from "../detail/shared";

// Platform ops · Realtime (detail) query. Ports the source RealtimeQuery.tsx
// (2138 lines) — a live LLM-request detail lookup (chat-indicator-statistics
// /stats/detail/query). The form builds a SQL query from the filters; results
// are a paginated ChatDetailRow table; row click opens a full-field detail
// dialog; the detail's "preview log" button opens a log preview dialog.
//
// This is the largest source file. Per the migration brief we port the CORE
// flow (filter form → results table → row detail → log preview) and drop the
// exotic pieces. Simplifications vs source:
//   - DROP: speed-distribution chart + speed-range filter modal (~250 lines,
//     ECharts bar + bucket math).
//   - DROP: concurrency chart + "Request Time + TTFT" modal (~180 lines,
//     ECharts step-line + concurrency math).
//   - DROP: Loki trace-log drawer + per-entry detail modal + JSON fold/highlight
//     view (~600 lines; needs a Loki datasource + chatStats.traceLogs which is
//     not in the shared query layer yet).
//   - DROP: client-side stats block (avg/p90/p95 tokens / speed / TTFT). The
//     source computes these from the returned rows; we keep the table only.
//   - DROP: result export (the source had no export either; NOT_WIRED button).
//   - SIMPLIFY: filters kept are the most-used subset (datasource / time range
//     / quick ranges / user id / username / request id / model / error-only /
//     limit / order). Dropped universal_id + routed_model + limit-as-pager.
//   - SIMPLIFY: results table shows the key columns (time / request id /
//     user / model / routed / status / tokens / duration / output speed). The
//     full field set is still visible in the row detail dialog.
//
// Design decisions:
//   - No react-router, no ECharts. Semantic tokens only.
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
  userId: string;
  userName: string;
  requestId: string;
  model: string;
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
    userId: "",
    userName: "",
    requestId: "",
    model: "",
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

  const enabledDatasources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );

  const [form, setForm] = useState<QueryForm>(() => defaultForm());
  const [activeQuickRange, setActiveQuickRange] = useState<number | null>(
    DEFAULT_QUICK_RANGE_MINUTES,
  );
  const [validateMsg, setValidateMsg] = useState("");
  /** Committed form — what the query actually runs on. Null until first 查询. */
  const [committed, setCommitted] = useState<QueryForm | null>(null);
  const [displayPage, setDisplayPage] = useState(1);
  const [displayPageSize, setDisplayPageSize] = useState(DEFAULT_DISPLAY_PAGE_SIZE);

  // Auto-select the first enabled datasource once the list resolves.
  useEffect(() => {
    const first = enabledDatasources[0];
    if (!form.datasourceId && first) {
      setForm((f) => ({ ...f, datasourceId: String(first.id) }));
    }
  }, [form.datasourceId, enabledDatasources]);

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
  }

  function resetForm() {
    const firstDs = enabledDatasources[0];
    const next = defaultForm(form.datasourceId || (firstDs ? String(firstDs.id) : ""));
    setForm(next);
    setActiveQuickRange(DEFAULT_QUICK_RANGE_MINUTES);
    setValidateMsg("");
    setCommitted(null);
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
    const requestId = committed.requestId.trim();
    const model = committed.model.trim();
    if (userId) req.user_id = userId;
    if (userName) req.username = userName;
    if (requestId) req.request_id = requestId;
    if (model) req.model = model;
    if (committed.hasError === "true") req.has_error = true;
    else if (committed.hasError === "false") req.has_error = false;
    return req;
  }, [committed]);

  const detailQ = useQuery({
    ...chatDetailQueryOptions(wsId, queryReq ?? EMPTY_REQ),
    // Don't fire until the user submits; EMPTY_REQ keeps the key stable pre-submit.
    enabled: !!queryReq,
  });

  const rows = detailQ.data?.items ?? [];
  const total = detailQ.data?.total ?? 0;

  // Reset display page when a new result set arrives / page size changes.
  useEffect(() => {
    setDisplayPage(1);
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
          <div className="mx-auto max-w-6xl space-y-4 p-6">
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
          <div className="mx-auto max-w-6xl p-6">
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
        <div className="mx-auto max-w-6xl space-y-4 p-6">
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
                    enabledDatasources.length === 0
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
                ) : enabledDatasources.length === 0 ? (
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
            bodyClassName="overflow-x-auto"
          >
            {detailQ.error ? (
              <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {(detailQ.error as Error)?.message || "查询失败"}
              </div>
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>时间</Th>
                  <Th>Request ID</Th>
                  <Th>User ID</Th>
                  <Th>用户名</Th>
                  <Th>Model</Th>
                  <Th>Routed</Th>
                  <Th>状态</Th>
                  <ThNum>输入 Token</ThNum>
                  <ThNum>输出 Token</ThNum>
                  <ThNum>耗时</ThNum>
                  <ThNum>输出速度</ThNum>
                </tr>
              </thead>
              <tbody>
                {detailQ.isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td colSpan={11} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-12 text-center">
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
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
}: {
  row: ChatDetailRow;
  onClose: () => void;
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
        <Field label="Request ID" value={row.request_id} mono />
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
 * opened. Shows the file metadata + the raw content (the source's JSON
 * fold/highlight view is dropped as a simplification).
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

  const content = data.content || "";
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

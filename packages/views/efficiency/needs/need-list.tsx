"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  ACTUAL_CALENDAR_TIP,
  ACTUAL_WORK_TIP,
  BASELINE_CALENDAR_TIP,
  CALENDAR_RATIO_TIP,
  formatDateTimeNoYear,
  formatDuration,
  FUSED_BASELINE_WORK_TIP,
  getDefaultDateRangeWide,
  needsListOptions,
  parseOrder,
  toOrder,
  useUserNameMap,
  useViewState,
  WORK_RATIO_TIP,
  type NeedsListQuery,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Input } from "@multica/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { PageHeader } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { DateRangePicker } from "../components";
import {
  DRILLDOWN_LINK_CLASS,
  DRILLDOWN_ROW_CLASS,
} from "../components/drilldown-styles";
import { RatioPill } from "../components/ratio-pill";
import { ErrorBanner } from "../detail/shared";
import { InfoTip, SortHeader, Td, TdNum, Th, ThNum } from "../usage/shared";

export interface NeedListFilters {
  repoAddr: string;
  repoBranch: string;
  userId: string;
  boundarySource: string;
  outlierOnly: boolean;
  includeAll: boolean;
}

export interface NeedListState {
  dateRange: [string, string];
  page: number;
  pageSize: number;
  order: string;
  filters: NeedListFilters;
}

export const EMPTY_NEED_FILTERS: NeedListFilters = {
  repoAddr: "",
  repoBranch: "",
  userId: "",
  boundarySource: "",
  outlierOnly: false,
  includeAll: false,
};

const BOUNDARY_SOURCES = [
  ["lv1_pr", "PR"],
  ["lv2_branch", "分支"],
  ["lv3_issue", "议题"],
  ["lv4_cluster", "聚类"],
  ["lv5_orphan", "孤儿"],
] as const;

const SORT_FIELDS = {
  calendar: "efficiencyRatio",
  work: "workEfficiencyRatio",
  ai: "aiCodeRatio",
  actualCalendar: "totalCalendarMin",
  baselineCalendar: "baselineCalendarMin",
  startedAt: "devStartTs",
} as const;

export function NeedList({
  state,
  onStateChange,
}: {
  state: NeedListState;
  onStateChange: (state: NeedListState) => void;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();
  const { setTimeRange } = useViewState();
  const [draftFilters, setDraftFilters] = useState<NeedListFilters>(
    state.filters,
  );
  const parsedOrder = useMemo(() => parseOrder(state.order), [state.order]);

  useEffect(() => {
    setDraftFilters(state.filters);
  }, [state.filters]);

  const params = useMemo<NeedsListQuery>(
    () => ({
      startDate: state.dateRange[0],
      endDate: state.dateRange[1],
      page: state.page,
      pageSize: state.pageSize,
      order: state.order || undefined,
      repoAddr: state.filters.repoAddr || undefined,
      repoBranch: state.filters.repoBranch || undefined,
      userId: state.filters.userId || undefined,
      boundarySource: state.filters.boundarySource || undefined,
      outlierOnly: state.filters.outlierOnly,
      includeAll: state.filters.includeAll,
    }),
    [state],
  );
  const query = useQuery(needsListOptions(wsId, params));
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const foldedCount = query.data?.folded_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  function commit(patch: Partial<NeedListState>) {
    onStateChange({ ...state, filters: draftFilters, ...patch });
  }

  function applyFilters() {
    commit({
      filters: {
        ...draftFilters,
        repoAddr: draftFilters.repoAddr.trim(),
        repoBranch: draftFilters.repoBranch.trim(),
        userId: draftFilters.userId.trim(),
        boundarySource: draftFilters.boundarySource.trim(),
      },
      page: 1,
    });
  }

  function resetFilters() {
    const dateRange = getDefaultDateRangeWide(90);
    setDraftFilters(EMPTY_NEED_FILTERS);
    setTimeRange(dateRange);
    onStateChange({
      ...state,
      dateRange,
      page: 1,
      pageSize: 20,
      order: "",
      filters: EMPTY_NEED_FILTERS,
    });
  }

  function onFilterKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") applyFilters();
  }

  function onSort(field: string) {
    let nextOrder = "";
    if (!parsedOrder || parsedOrder.field !== field) {
      nextOrder = toOrder(field, false) ?? "";
    } else if (!parsedOrder.desc) {
      nextOrder = toOrder(field, true) ?? "";
    }
    commit({ order: nextOrder, page: 1 });
  }

  const isSortActive = (field: string) => parsedOrder?.field === field;
  const isSortDesc = (field: string) =>
    parsedOrder?.field === field && parsedOrder.desc;

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">需求看板</h1>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <p className="text-sm text-muted-foreground">
            按需求边界度量提效比，日历提效看交付周期缩短了多少，人力提效看人工投入节省了多少。
          </p>

          <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <DateRangePicker
                value={state.dateRange}
                onChange={(dateRange) => {
                  setTimeRange(dateRange);
                  commit({ dateRange, page: 1 });
                }}
              />
              <Input
                className="w-[220px]"
                value={draftFilters.repoAddr}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    repoAddr: event.target.value,
                  }))
                }
                onKeyDown={onFilterKeyDown}
                placeholder="仓库地址"
              />
              <Input
                className="w-[170px]"
                value={draftFilters.repoBranch}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    repoBranch: event.target.value,
                  }))
                }
                onKeyDown={onFilterKeyDown}
                placeholder="分支"
              />
              <Input
                className="w-[180px]"
                value={draftFilters.userId}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                onKeyDown={onFilterKeyDown}
                placeholder="真名/工号/ID"
              />
              <Select
                value={draftFilters.boundarySource || "all"}
                onValueChange={(value) =>
                  setDraftFilters((current) => ({
                    ...current,
                    boundarySource: value === "all" || value == null ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">边界来源</SelectItem>
                  {BOUNDARY_SOURCES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FilterCheckbox
                label="仅异常"
                checked={draftFilters.outlierOnly}
                onChange={(outlierOnly) =>
                  setDraftFilters((current) => ({ ...current, outlierOnly }))
                }
              />
              <FilterCheckbox
                label="显示全部"
                title="放开看板口径：显示 active 未交付 + 主干分支 + 全部需求"
                checked={draftFilters.includeAll}
                onChange={(includeAll) =>
                  setDraftFilters((current) => ({ ...current, includeAll }))
                }
              />
              <Button onClick={applyFilters} disabled={query.isFetching}>
                查询
              </Button>
              <Button variant="outline" onClick={resetFilters}>
                重置
              </Button>
            </div>
          </section>

          {foldedCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              已折叠{" "}
              <span className="font-medium text-foreground">{foldedCount}</span>{" "}
              个无 AI 数据的 need（未进提效计算）；勾选上方“显示全部”查看。
            </p>
          ) : null}

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">需求列表</span>
              <span className="text-xs text-muted-foreground">
                按可计入需求汇总{query.isFetching && !query.isLoading ? " · 更新中" : ""}
              </span>
            </div>

            {query.isError ? (
              <div className="p-4">
                <ErrorBanner
                  message={
                    query.error instanceof Error
                      ? query.error.message
                      : "获取需求列表失败"
                  }
                />
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <Th>需求 ID</Th>
                    <Th>
                      <span className="inline-flex items-center gap-1">
                        <SortHeader
                          label="日历提效"
                          active={isSortActive(SORT_FIELDS.calendar)}
                          desc={isSortDesc(SORT_FIELDS.calendar)}
                          onClick={() => onSort(SORT_FIELDS.calendar)}
                        />
                        <InfoTip tip={CALENDAR_RATIO_TIP} />
                      </span>
                    </Th>
                    <Th>
                      <span className="inline-flex items-center gap-1">
                        <SortHeader
                          label="人力提效"
                          active={isSortActive(SORT_FIELDS.work)}
                          desc={isSortDesc(SORT_FIELDS.work)}
                          onClick={() => onSort(SORT_FIELDS.work)}
                        />
                        <InfoTip tip={WORK_RATIO_TIP} />
                      </span>
                    </Th>
                    <Th>
                      <SortHeader
                        label="AI 代码占比"
                        active={isSortActive(SORT_FIELDS.ai)}
                        desc={isSortDesc(SORT_FIELDS.ai)}
                        onClick={() => onSort(SORT_FIELDS.ai)}
                      />
                    </Th>
                    <Th>仓库</Th>
                    <Th>分支</Th>
                    <Th>主用户</Th>
                    <ThNum>
                      <span className="inline-flex items-center justify-end gap-1">
                        <SortHeader
                          label="实际周期"
                          active={isSortActive(SORT_FIELDS.actualCalendar)}
                          desc={isSortDesc(SORT_FIELDS.actualCalendar)}
                          onClick={() => onSort(SORT_FIELDS.actualCalendar)}
                        />
                        <InfoTip tip={ACTUAL_CALENDAR_TIP} />
                      </span>
                    </ThNum>
                    <ThNum>
                      <span className="inline-flex items-center justify-end gap-1">
                        <SortHeader
                          label="传统周期预估"
                          active={isSortActive(SORT_FIELDS.baselineCalendar)}
                          desc={isSortDesc(SORT_FIELDS.baselineCalendar)}
                          onClick={() => onSort(SORT_FIELDS.baselineCalendar)}
                        />
                        <InfoTip tip={BASELINE_CALENDAR_TIP} />
                      </span>
                    </ThNum>
                    <ThNum>
                      <span className="inline-flex items-center justify-end gap-1">
                        实际人力
                        <InfoTip tip={ACTUAL_WORK_TIP} />
                      </span>
                    </ThNum>
                    <ThNum>
                      <span className="inline-flex items-center justify-end gap-1">
                        传统人力预估
                        <InfoTip tip={FUSED_BASELINE_WORK_TIP} />
                      </span>
                    </ThNum>
                    <Th>
                      <SortHeader
                        label="开发开始时间"
                        active={isSortActive(SORT_FIELDS.startedAt)}
                        desc={isSortDesc(SORT_FIELDS.startedAt)}
                        onClick={() => onSort(SORT_FIELDS.startedAt)}
                      />
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading ? (
                    Array.from({ length: 8 }, (_, index) => (
                      <tr key={index} className="border-b last:border-0">
                        <td colSpan={12} className="px-3 py-3">
                          <div className="h-5 animate-pulse rounded bg-muted" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={12}
                        className="px-3 py-12 text-center text-muted-foreground"
                      >
                        暂无需求数据
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.need_id}
                        tabIndex={0}
                        className={`${DRILLDOWN_ROW_CLASS} border-b last:border-0`}
                        onClick={() => push(paths.metricsNeedDetail(row.need_id))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            push(paths.metricsNeedDetail(row.need_id));
                          }
                        }}
                      >
                        <Td title={row.need_id}>
                          <span className="font-mono text-xs text-primary">
                            {shortNeedId(row.need_id)}
                          </span>
                        </Td>
                        <Td>
                          <RatioPill value={row.efficiency_ratio} />
                        </Td>
                        <Td>
                          <RatioPill value={row.work_efficiency_ratio} />
                        </Td>
                        {/* ai_code_ratio=0 means silica has no data (not a true
                            0) — render '-' like the source's fmtPct caliber. */}
                        <Td>
                          <RatioPill value={row.ai_code_ratio || null} />
                        </Td>
                        <Td title={row.repo_addr}>
                          <Ellipsis value={row.repo_addr} />
                        </Td>
                        <Td title={row.repo_branch}>
                          <Ellipsis value={row.repo_branch} />
                        </Td>
                        <Td title={resolveName(row.primary_user_id)}>
                          {row.primary_user_id ? (
                            <button
                              type="button"
                              className={`max-w-[220px] truncate text-left ${DRILLDOWN_LINK_CLASS}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                push(paths.metricsUserDetail(row.primary_user_id));
                              }}
                            >
                              {resolveName(row.primary_user_id)}
                            </button>
                          ) : (
                            "-"
                          )}
                        </Td>
                        <TdNum>{formatDuration(row.total_calendar_min)}</TdNum>
                        <TdNum>{formatDuration(row.baseline_calendar_min)}</TdNum>
                        <TdNum>
                          {formatDuration(row.total_active_work_corrected_min)}
                        </TdNum>
                        <TdNum>
                          {formatDuration(row.baseline_fused_work_min)}
                        </TdNum>
                        <Td>{formatDateTimeNoYear(row.dev_start_ts)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={state.page}
              pageSize={state.pageSize}
              total={total}
              totalPages={totalPages}
              onPageChange={(page) => commit({ page })}
              onPageSizeChange={(pageSize) =>
                commit({ page: 1, pageSize })
              }
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterCheckbox({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
      title={title}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <span className="text-xs text-muted-foreground">
        第 {page} / {totalPages} 页，共 {total} 条
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          每页
          <select
            className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {[20, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
        >
          首页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          末页
        </Button>
      </div>
    </div>
  );
}

function shortNeedId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function Ellipsis({ value }: { value?: string | null }) {
  return <div className="max-w-[240px] truncate">{value || "-"}</div>;
}

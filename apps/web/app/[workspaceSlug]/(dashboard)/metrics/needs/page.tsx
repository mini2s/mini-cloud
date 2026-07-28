"use client";

import { use, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { paths } from "@multica/core/paths";
import {
  formatDateParam,
  getDefaultDateRangeWide,
} from "@multica/core/efficiency";
import {
  EMPTY_NEED_FILTERS,
  NeedList,
  type NeedListState,
} from "@multica/views/efficiency";

type SearchParams = Record<string, string | string[] | undefined>;

export default function NeedsRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { workspaceSlug } = use(params);
  const rawSearchParams = use(searchParams);
  const router = useRouter();
  const route = paths.workspace(workspaceSlug).metricsNeeds();

  const state = useMemo(
    () => stateFromParams(rawSearchParams),
    [rawSearchParams],
  );
  const onStateChange = useCallback(
    (next: NeedListState) => {
      const query = buildQuery(next);
      router.replace(query ? `${route}?${query}` : route, { scroll: false });
    },
    [route, router],
  );

  return <NeedList state={state} onStateChange={onStateChange} />;
}

function stateFromParams(params: SearchParams): NeedListState {
  const defaultRange = getDefaultDateRangeWide(90);
  const startDate = normalizeDate(first(params.startDate));
  const endDate = normalizeDate(first(params.endDate));
  const page = positiveInteger(first(params.page), 1);
  const requestedPageSize = positiveInteger(first(params.pageSize), 20);
  const pageSize = [20, 50, 100, 200].includes(requestedPageSize)
    ? requestedPageSize
    : 20;

  return {
    dateRange:
      startDate && endDate ? [startDate, endDate] : defaultRange,
    page,
    pageSize,
    order: first(params.order)?.trim() ?? "",
    filters: {
      repoAddr: first(params.repoAddr)?.trim() ?? "",
      repoBranch: first(params.repoBranch)?.trim() ?? "",
      userId: first(params.userId)?.trim() ?? "",
      boundarySource: first(params.boundarySource)?.trim() ?? "",
      outlierOnly: first(params.outlierOnly) === "true",
      includeAll: first(params.includeAll) === "true",
    },
  };
}

function buildQuery(state: NeedListState): string {
  const query = new URLSearchParams({
    startDate: formatDateParam(state.dateRange[0]),
    endDate: formatDateParam(state.dateRange[1]),
  });
  if (state.page !== 1) query.set("page", String(state.page));
  if (state.pageSize !== 20) query.set("pageSize", String(state.pageSize));
  if (state.order) query.set("order", state.order);

  const filters = { ...EMPTY_NEED_FILTERS, ...state.filters };
  if (filters.repoAddr.trim()) query.set("repoAddr", filters.repoAddr.trim());
  if (filters.repoBranch.trim()) {
    query.set("repoBranch", filters.repoBranch.trim());
  }
  if (filters.userId.trim()) query.set("userId", filters.userId.trim());
  if (filters.boundarySource.trim()) {
    query.set("boundarySource", filters.boundarySource.trim());
  }
  if (filters.outlierOnly) query.set("outlierOnly", "true");
  if (filters.includeAll) query.set("includeAll", "true");
  return query.toString();
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  const date = value.trim();
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

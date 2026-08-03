"use client";

import { use } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getDefaultDateRangeWide,
  formatDateParam,
} from "@multica/core/efficiency";
import {
  CommitListPage,
  TaskListPage,
  type ActivityListState,
} from "@multica/views/efficiency";

type SearchParams = Record<string, string | string[] | undefined>;

export function ActivityListRoute({
  kind,
  searchParams,
}: {
  kind: "task" | "commit";
  searchParams: Promise<SearchParams>;
}) {
  const raw = use(searchParams);
  const router = useRouter();
  const pathname = usePathname();
  const state = stateFromParams(raw);
  const Component = kind === "task" ? TaskListPage : CommitListPage;

  return (
    <Component
      state={state}
      onStateChange={(patch) => {
        const next = { ...state, ...patch };
        const params = toUrlSearchParams(raw);
        writeState(params, next);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

function stateFromParams(raw: SearchParams): ActivityListState {
  const fallback = getDefaultDateRangeWide();
  const startDate = normalizeDate(first(raw.startDate)) || fallback[0];
  const endDate = normalizeDate(first(raw.endDate)) || fallback[1];
  return {
    startDate,
    endDate,
    page: positiveInt(first(raw.page), 1),
    pageSize: positiveInt(first(raw.pageSize), 250),
    order: first(raw.order)?.trim() ?? "",
    userName: first(raw.userName)?.trim() ?? "",
    org1: first(raw.org1)?.trim() ?? "",
    org2: first(raw.org2)?.trim() ?? "",
    org3: first(raw.org3)?.trim() ?? "",
    org4: first(raw.org4)?.trim() ?? "",
  };
}

function writeState(params: URLSearchParams, state: ActivityListState) {
  params.set("startDate", formatDateParam(state.startDate));
  params.set("endDate", formatDateParam(state.endDate));
  setOptional(params, "page", state.page === 1 ? "" : String(state.page));
  setOptional(
    params,
    "pageSize",
    state.pageSize === 250 ? "" : String(state.pageSize),
  );
  setOptional(params, "order", state.order);
  setOptional(params, "userName", state.userName);
  setOptional(params, "org1", state.org1);
  setOptional(params, "org2", state.org2);
  setOptional(params, "org3", state.org3);
  setOptional(params, "org4", state.org4);
}

function setOptional(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.trim();
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function toUrlSearchParams(raw: SearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value != null) {
      params.set(key, value);
    }
  }
  return params;
}

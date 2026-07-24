"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  fmtCost,
  formatNumber,
  usageDeptMembersOptions,
  type MemberSortBy,
  type MembersQuery,
} from "@multica/core/efficiency";
import { Input } from "@multica/ui/components/ui/input";
import { PCT, SortHeader, shortToken, Td, TdNum, Th, ThNum } from "./shared";

// Member list view — second tab of the Usage Kanban. Ports the source
// MembersView: paginated / sortable / searchable table of the dept's members.
// Row click opens the member detail dialog (per design decision #2, we don't
// navigate; we surface detail in a Dialog owned by the parent).
//
// Sort/search behavior matches the source: search is debounced 400ms + trimmed,
// sort columns are total_requests / sum_total_tokens / success_rate / active_days
// (the source's full set), and switching dept / includeChildren / search resets
// to page 1.

interface MembersViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
  /** Fired with universal_id when the user clicks a row. */
  onRowClick: (uid: string) => void;
}

const SORT_COLS: { field: MemberSortBy; label: string }[] = [
  { field: "total_requests", label: "请求数" },
  { field: "sum_total_tokens", label: "总 Token" },
  { field: "success_rate", label: "成功率" },
  { field: "active_days", label: "活跃天数" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function MembersView({
  deptId,
  startDate,
  endDate,
  includeChildren,
  onRowClick,
}: MembersViewProps) {
  const wsId = useWorkspaceId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<MemberSortBy>("sum_total_tokens");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // 400ms debounce + trim — matches the source's input discipline.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Reset to page 1 when the scope changes (matches the source).
  useEffect(() => {
    setPage(1);
  }, [deptId, includeChildren, search]);

  const q: MembersQuery = {
    deptId,
    start: startDate,
    end: endDate,
    includeChildren,
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
  };
  const membersQ = useQuery(usageDeptMembersOptions(wsId, q));
  const rows = membersQ.data?.members ?? [];
  const total = membersQ.data?.total ?? 0;

  const handleSort = (field: MemberSortBy) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            本部门人员
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            按 {SORT_COLS.find((c) => c.field === sortBy)?.label ?? sortBy}{" "}
            {sortOrder === "desc" ? "降序" : "升序"}
            {includeChildren ? " · 含子部门" : " · 仅直属"}
          </p>
        </div>
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索 ID / 用户名"
          className="h-8 w-56"
          aria-label="搜索成员"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <ThNum>#</ThNum>
              <Th>用户名</Th>
              <Th>工号</Th>
              <Th>用户 ID</Th>
              {SORT_COLS.map((c) => (
                <ThNum key={c.field}>
                  <SortHeader
                    label={c.label}
                    active={sortBy === c.field}
                    desc={sortOrder === "desc"}
                    onClick={() => handleSort(c.field)}
                  />
                </ThNum>
              ))}
              <ThNum>预估花费</ThNum>
            </tr>
          </thead>
          <tbody>
            {membersQ.isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((m, i) => {
                const uid = m.universal_id || "";
                return (
                  <tr
                    key={uid || i}
                    onClick={uid ? () => onRowClick(uid) : undefined}
                    className={
                      uid
                        ? "cursor-pointer border-b border-border/50 transition-colors hover:bg-muted"
                        : "border-b border-border/50"
                    }
                  >
                    <TdNum>{(page - 1) * pageSize + i + 1}</TdNum>
                    <Td>
                      <span className="max-w-[220px] truncate" title={m.username || uid}>
                        {m.username || uid || "-"}
                      </span>
                    </Td>
                    <Td title={m.user_id || ""}>{m.user_id || "-"}</Td>
                    <Td>
                      <span
                        className="font-mono text-xs text-muted-foreground"
                        title={m.universal_id || ""}
                      >
                        {m.universal_id ? `${m.universal_id.slice(0, 12)}…` : "-"}
                      </span>
                    </Td>
                    <TdNum>{formatNumber(m.total_requests)}</TdNum>
                    <TdNum title={formatNumber(m.sum_total_tokens)}>
                      {shortToken(m.sum_total_tokens)}
                    </TdNum>
                    <TdNum>{PCT(m.success_rate)}</TdNum>
                    <TdNum>{formatNumber(m.active_days)}</TdNum>
                    <TdNum>
                      {m.estimated_total_cost != null ? fmtCost(m.estimated_total_cost) : "-"}
                    </TdNum>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </div>
  );
}

/** Sortable column header + table cell primitives (Th/ThNum/Td/TdNum) are
 * imported from ./shared — single source of truth shared with the other
 * usage views. */

/** Lightweight pager — page size + prev/next + range text. */
function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>每页</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded border bg-background px-1 py-0.5"
          aria-label="每页条数"
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span>条 · 共 {formatNumber(total)} 条</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {formatNumber(from)}-{formatNumber(to)} / {formatNumber(total)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded border px-2 py-0.5 enabled:hover:bg-muted disabled:opacity-40"
          aria-label="上一页"
        >
          上一页
        </button>
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded border px-2 py-0.5 enabled:hover:bg-muted disabled:opacity-40"
          aria-label="下一页"
        >
          下一页
        </button>
      </div>
    </div>
  );
}


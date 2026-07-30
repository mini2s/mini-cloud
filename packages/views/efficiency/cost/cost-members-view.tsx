"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  costMembersOptions,
  fmtCost,
  formatNumber,
  useUserNameMap,
  type CostMemberSortBy,
  type CostMembersQuery,
} from "@multica/core/efficiency";
import { Input } from "@multica/ui/components/ui/input";
import { ChatUserCell } from "../components/chat-user-cell";
import { DRILLDOWN_ROW_CLASS } from "../components/drilldown-styles";
import { PCT, SortHeader, shortToken, Td, TdNum, Th, ThNum } from "../usage/shared";

// Member cost list view — third tab of the Cost Kanban. Ports the source
// CostMembersView (173 lines): paginated / sortable / searchable table of
// the dept's members' cost. Row click opens the member drill-down (per
// design decision #2, we don't navigate; we surface detail via an
// onRowClick callback owned by the parent — TODO slice 5 member detail).
//
// Sort/search behavior matches the source + the usage members-view: search
// is debounced 400ms + trimmed, sort columns are total_cost / input_cost /
// output_cost / total_tokens / request_count (CostMemberSortBy whitelist —
// cost_pct is NOT in the backend sort whitelist so it's a plain header),
// and switching dept / includeChildren / search resets to page 1.
//
// The Pager is reused verbatim from the usage members-view (same shape,
// same page-size options).

interface CostMembersViewProps {
  deptId: string;
  startDate: string;
  endDate: string;
  includeChildren: boolean;
  /** Fired with universal_id when the user clicks a row. */
  onRowClick: (uid: string) => void;
}

// Sortable column whitelist = CostMemberSortBy. cost_pct is rendered as a
// plain (non-sortable) header because the backend sort whitelist excludes it
// (matches the source's SORT_COLS comment).
const SORT_COLS: { field: CostMemberSortBy; label: string }[] = [
  { field: "total_cost", label: "各用户费用" },
  { field: "input_cost", label: "输入费用" },
  { field: "output_cost", label: "输出费用" },
  { field: "total_tokens", label: "总 Token" },
  { field: "request_count", label: "请求数" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function CostMembersView({
  deptId,
  startDate,
  endDate,
  includeChildren,
  onRowClick,
}: CostMembersViewProps) {
  const wsId = useWorkspaceId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<CostMemberSortBy>("total_cost");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { resolveName } = useUserNameMap();

  // 400ms debounce + trim — matches the source's input discipline and the
  // usage members-view.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Reset to page 1 when the scope changes (matches the source + usage).
  useEffect(() => {
    setPage(1);
  }, [deptId, includeChildren, search]);

  const q: CostMembersQuery = {
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
  const membersQ = useQuery(costMembersOptions(wsId, q));
  const rows = membersQ.data?.users ?? [];
  const total = membersQ.data?.total ?? 0;

  const handleSort = (field: CostMemberSortBy) => {
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
            部门内用户成本
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
          aria-label="搜索用户"
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
              <ThNum>费用占比</ThNum>
              <ThNum>活跃天数</ThNum>
            </tr>
          </thead>
          <tbody>
            {membersQ.error ? (
              <tr>
                <td
                  colSpan={11}
                  className="py-10 text-center text-sm text-destructive"
                >
                  加载失败：{(membersQ.error as Error).message}
                </td>
              </tr>
            ) : membersQ.isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((m, i) => {
                const uid = m.universal_id || "";
                return (
                  <tr
                    key={uid || i}
                    tabIndex={uid ? 0 : undefined}
                    onClick={uid ? () => onRowClick(uid) : undefined}
                    onKeyDown={
                      uid
                        ? (event) => {
                            if (event.key === "Enter") onRowClick(uid);
                          }
                        : undefined
                    }
                    className={
                      uid
                        ? `${DRILLDOWN_ROW_CLASS} border-b border-border/50`
                        : "border-b border-border/50"
                    }
                  >
                    <TdNum>{(page - 1) * pageSize + i + 1}</TdNum>
                    <Td>
                      <ChatUserCell
                        universalId={m.universal_id}
                        chatUsername={m.username}
                        resolveName={resolveName}
                      />
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
                    <TdNum>{`¥${fmtCost(m.total_cost)}`}</TdNum>
                    <TdNum>{`¥${fmtCost(m.input_cost)}`}</TdNum>
                    <TdNum>{`¥${fmtCost(m.output_cost)}`}</TdNum>
                    <TdNum title={formatNumber(m.total_tokens)}>
                      {shortToken(m.total_tokens)}
                    </TdNum>
                    <TdNum>{formatNumber(m.request_count)}</TdNum>
                    <TdNum>{PCT(m.cost_pct)}</TdNum>
                    <TdNum>{formatNumber(m.active_days)}</TdNum>
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
 * imported from ../usage/shared — single source of truth shared with the
 * usage views. */

/** Lightweight pager — page size + prev/next + range text. Mirrors the
 * usage members-view Pager verbatim (same shape, same page-size options). */
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

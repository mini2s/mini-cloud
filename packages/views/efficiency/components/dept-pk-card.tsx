"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  deptRankingOptions,
  deptTreeOptions,
  formatNumber,
} from "@multica/core/efficiency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import type { DeptTreeNode } from "@multica/core/efficiency";
import { useNavigation } from "../../navigation";
import { useEfficiencyGlossary } from "../i18n";
import { DRILLDOWN_ROW_CLASS } from "./drilldown-styles";
import { RatioPill } from "./ratio-pill";

// Department PK: pick a parent level from the dept tree, then rank its direct
// child departments by calendar efficiency (top 5) as a ranked list with
// gold/silver/bronze badges and ratio pills.
// Data: dept-tree (for the parent selector) + dept-tree/ranking?parent_dept_id=
// (one aggregated call returning each direct child's whole-subtree summary).
// Default ranks "whole-company first-level" (parent_dept_id empty → backend
// uses the configured root).
//
// Rows drill into the organization-focused efficiency view. The department id
// is carried in URL state so browser back/refresh can restore the selection.

interface DeptPKCardProps {
  startDate?: string;
  endDate?: string;
}

const ROOT = "__root__";

const RANK_BADGE = [
  "bg-amber-400 text-white",
  "bg-muted text-muted-foreground",
  "bg-orange-400 text-white",
];
const RANK_DEFAULT = "bg-muted text-muted-foreground";

/** Collect every node that has children, as selector options (indent shows depth). */
function collectParents(
  nodes: DeptTreeNode[],
  depth = 0,
  acc: { id: string; label: string }[] = [],
): { id: string; label: string }[] {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      acc.push({
        id: n.dept_id,
        label: `${"　".repeat(depth)}${n.dept_name}`,
      });
      collectParents(n.children, depth + 1, acc);
    }
  }
  return acc;
}

export function DeptPKCard({ startDate, endDate }: DeptPKCardProps) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { glossaryTip } = useEfficiencyGlossary();
  const treeQ = useQuery(deptTreeOptions(wsId));
  const tree = treeQ.data ?? [];
  const [parentId, setParentId] = useState<string>(ROOT);

  const parentOptions = useMemo(() => collectParents(tree), [tree]);

  // Trigger label: Base UI's Select.Value renders the raw value string unless
  // given function children (item labels aren't resolvable while the popup is
  // unmounted), which is how the ROOT sentinel "__root__" leaked into the UI.
  // trim() strips the full-width-space depth indentation used inside the list.
  const selectedLabel =
    parentId === ROOT
      ? "全公司（一级部门）"
      : (parentOptions.find((o) => o.id === parentId)?.label.trim() ??
        "全公司（一级部门）");

  // One aggregation: ROOT → parent_dept_id empty (backend default = configured
  // root, ranks "whole-company first-level"); otherwise the selected parent id.
  const rankingQ = useQuery(
    deptRankingOptions(
      wsId,
      parentId === ROOT ? undefined : parentId,
      startDate,
      endDate,
    ),
  );

  // Sort by calendar_ratio desc (nulls last), take top 5.
  const top5 = useMemo(() => {
    const rows = (rankingQ.data?.items ?? []).filter(
      (it) => it.summary?.calendar_ratio != null,
    );
    rows.sort(
      (a, b) =>
        (b.summary.calendar_ratio ?? -Infinity) -
        (a.summary.calendar_ratio ?? -Infinity),
    );
    return rows.slice(0, 5);
  }, [rankingQ.data]);

  const loading = treeQ.isLoading || rankingQ.isLoading;
  const errored = treeQ.isError || rankingQ.isError;
  const openDepartment = (deptId: string) => {
    const query = new URLSearchParams({ entity: "org", object: deptId });
    push(`${paths.metricsEfficiency()}?${query.toString()}`);
  };

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm p-5 transition-shadow hover:shadow-lg md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            部门 PK
          </h2>
          <span
            className="inline-flex cursor-help text-muted-foreground"
            title={glossaryTip("dept_efficiency")}
            aria-label={glossaryTip("dept_efficiency")}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
        </div>
        <Select value={parentId} onValueChange={(v) => setParentId(v ?? ROOT)}>
          {/* min-w fits "全公司（一级部门）" without truncation; the popup
              width tracks the trigger width (w-(--anchor-width) in the shared
              Select), so a wider trigger also keeps indented option labels
              from being clipped. max-w still caps very long dept names. */}
          <SelectTrigger size="sm" className="min-w-[12rem] max-w-[16rem]">
            <SelectValue>
              {() => <span className="truncate">{selectedLabel}</span>}
            </SelectValue>
          </SelectTrigger>
          {/* alignItemWithTrigger=false: the default aligns the *selected*
              item to the trigger, which can clip the popup off-screen; the
              common pattern (dashboard project filter) turns it off. */}
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value={ROOT}>全公司（一级部门）</SelectItem>
            {parentOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errored ? (
        <div className="flex min-h-[14rem] flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          部门数据暂不可用（需 dept-sync 服务连通）
        </div>
      ) : loading ? (
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded-md" />
          ))}
        </div>
      ) : top5.length === 0 ? (
        <div className="flex min-h-[14rem] flex-1 items-center justify-center text-sm text-muted-foreground">
          该层级暂无可计入部门数据
        </div>
      ) : (
        <ul className="flex-1 space-y-2">
          {top5.map((r, i) => {
            const badge = i < 3 ? RANK_BADGE[i] : RANK_DEFAULT;
            const sum = r.summary;
            return (
              <li key={r.dept_id}>
                <button
                  type="button"
                  onClick={() => openDepartment(r.dept_id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left ${DRILLDOWN_ROW_CLASS}`}
                  aria-label={`查看部门 ${r.dept_name} 效率详情`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${badge}`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm font-medium text-card-foreground"
                      title={r.dept_name}
                    >
                      {r.dept_name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatNumber(sum.kanban_member_count)} 人 · 需求{" "}
                      {formatNumber(sum.merged_need_count)}
                    </div>
                  </div>
                  <span className="shrink-0">
                    <RatioPill value={sum.calendar_ratio} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

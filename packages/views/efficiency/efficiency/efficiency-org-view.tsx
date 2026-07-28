"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  deptMembersOptions,
  deptOverviewOptions,
  formatDuration,
  formatNumber,
  formatV2Ratio,
  type DeptMember,
  type DeptTreeNodeWithSummary,
} from "@multica/core/efficiency";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { useNavigation } from "../../navigation";

interface EfficiencyOrgViewProps {
  startDate: string;
  endDate: string;
  initialDeptId?: string;
  selectedDeptId?: string;
  onDeptChange?: (deptId: string) => void;
}

function initialExpandedIds(nodes: DeptTreeNodeWithSummary[]): string[] {
  const ids: string[] = [];
  let firstLevel = nodes;
  const root = nodes[0];
  if (nodes.length === 1 && root?.children.length) {
    ids.push(root.dept_id);
    firstLevel = root.children;
  }
  for (const node of firstLevel) ids.push(node.dept_id);
  return ids;
}

function findNode(
  nodes: DeptTreeNodeWithSummary[],
  deptId: string,
): DeptTreeNodeWithSummary | undefined {
  for (const node of nodes) {
    if (node.dept_id === deptId) return node;
    const child = node.children.length
      ? findNode(node.children, deptId)
      : undefined;
    if (child) return child;
  }
  return undefined;
}

export function EfficiencyOrgView({
  startDate,
  endDate,
  initialDeptId = "",
  selectedDeptId,
  onDeptChange,
}: EfficiencyOrgViewProps) {
  const wsId = useWorkspaceId();
  const treeQ = useQuery(deptOverviewOptions(wsId, startDate, endDate));
  const nodes = useMemo(() => treeQ.data?.nodes ?? [], [treeQ.data?.nodes]);
  const [internalSelectedId, setInternalSelectedId] = useState(initialDeptId);
  const selectedId = selectedDeptId ?? internalSelectedId;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!nodes.length) return;
    setExpanded((current) =>
      current.size
        ? current
        : new Set(initialExpandedIds(nodes)),
    );
  }, [nodes]);

  const toggle = useCallback((deptId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }, []);

  const selected = findNode(nodes, selectedId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        左侧为权威部门树，部门右侧展示整棵子树的守恒日历提效比；选择部门可查看花名册和效率指标。
      </p>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_1fr] lg:gap-6">
        <aside className="flex max-h-[72vh] flex-col overflow-hidden rounded-lg border bg-card lg:sticky lg:top-4">
          <div className="border-b px-4 py-3 text-sm font-semibold">
            部门导航
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {treeQ.error ? (
              <div className="px-3 py-6 text-center text-sm text-destructive">
                加载失败：{(treeQ.error as Error).message}
              </div>
            ) : treeQ.isLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-7 rounded-md" />
                ))}
              </div>
            ) : !nodes.length ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                暂无部门数据
              </div>
            ) : (
              <ul role="tree" aria-label="部门效率树" className="m-0 list-none p-0">
                {nodes.map((node) => (
                  <OrgTreeNode
                    key={node.dept_id}
                    node={node}
                    depth={0}
                    selectedId={selectedId}
                    expanded={expanded}
                    onToggle={toggle}
                    onSelect={(deptId) => {
                      setInternalSelectedId(deptId);
                      onDeptChange?.(deptId);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <DeptMembersPanel
          deptId={selectedId}
          deptName={selected?.dept_name ?? ""}
          startDate={startDate}
          endDate={endDate}
        />
      </div>
    </div>
  );
}

interface OrgTreeNodeProps {
  node: DeptTreeNodeWithSummary;
  depth: number;
  selectedId: string;
  expanded: Set<string>;
  onToggle: (deptId: string) => void;
  onSelect: (deptId: string) => void;
}

const OrgTreeNode = memo(function OrgTreeNode({
  node,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: OrgTreeNodeProps) {
  const hasChildren =
    node.children.length > 0 || node.child_dept_count > 0;
  const open = expanded.has(node.dept_id);
  const selected = selectedId === node.dept_id;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={selected}
    >
      <div
        className={cn(
          "flex items-center gap-1 rounded-md py-1.5 pr-2 transition-colors",
          selected
            ? "bg-primary/10 text-primary"
            : "text-card-foreground hover:bg-muted",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.dept_id)}
            aria-label={open ? "收起" : "展开"}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.dept_id)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate" title={node.dept_name}>
            {node.dept_name}
          </span>
          {node.summary.calendar_ratio != null && (
            <span
              className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
              title={`合并需求 ${formatNumber(node.summary.merged_need_count)} · 看板成员 ${formatNumber(node.summary.kanban_member_count)}`}
            >
              {formatV2Ratio(node.summary.calendar_ratio)}
            </span>
          )}
        </button>
      </div>
      {hasChildren && open && node.children.length > 0 && (
        <ul role="group" className="m-0 list-none p-0">
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.dept_id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export function DeptMembersPanel({
  deptId,
  deptName,
  startDate,
  endDate,
  aiLabel = "含硅量",
}: {
  deptId: string;
  deptName: string;
  startDate: string;
  endDate: string;
  aiLabel?: string;
}) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const q = useQuery(
    deptMembersOptions(wsId, deptId, startDate, endDate),
  );
  const summary = q.data?.summary;
  const members = q.data?.members ?? [];

  if (!deptId) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        请在左侧选择部门以查看成员
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-destructive">
        加载失败：{(q.error as Error).message}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="成员数" value={formatNumber(summary?.member_count ?? 0)} hint={`${formatNumber(summary?.kanban_member_count ?? 0)} 人有看板数据`} />
        <Metric label="合并需求" value={formatNumber(summary?.merged_need_count ?? 0)} />
        <Metric label="实际周期" value={formatDuration(summary?.actual_calendar_min)} />
        <Metric label="日历提效" value={formatV2Ratio(summary?.calendar_ratio)} />
        <Metric label="人力提效" value={formatV2Ratio(summary?.work_ratio)} />
        <Metric label={aiLabel} value={formatV2Ratio(summary?.silica)} />
        <Metric label="Commit" value={formatNumber(summary?.commit_count ?? 0)} />
        <Metric label="代码行" value={formatNumber(summary?.commit_diff_lines ?? 0)} />
        <Metric label="费用" value={summary?.cost == null ? "-" : `¥${formatNumber(summary.cost, 2)}`} />
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="truncate text-sm font-semibold">
            {deptName || "部门"} · 成员花名册
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatNumber(members.length)} 人（含子部门）
          </span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[968px]">
            <MemberHeader aiLabel={aiLabel} />
            {q.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-7 rounded-md" />
                ))}
              </div>
            ) : members.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                该部门暂无成员
              </div>
            ) : (
              <Virtuoso
                style={{ height: "min(62vh, 560px)" }}
                data={members}
                itemContent={(_, member) => (
                  <MemberRow
                    member={member}
                    onOpen={
                      member.has_kanban_data && member.universal_id
                        ? () => push(paths.metricsUserDetail(member.universal_id))
                        : undefined
                    }
                  />
                )}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const MEMBER_GRID =
  "grid-cols-[minmax(150px,1.6fr)_96px_90px_92px_96px_88px_88px_88px_76px_92px]";

function MemberHeader({ aiLabel }: { aiLabel: string }) {
  const labels = [
    "成员",
    "工号",
    "职级",
    "合并需求",
    "实际周期",
    "日历提效",
    "人力提效",
    aiLabel,
    "Commit",
    "代码行",
  ];
  return (
    <div className={cn("grid border-b text-xs font-semibold", MEMBER_GRID)}>
      {labels.map((label, index) => (
        <div
          key={label}
          className={cn(
            "whitespace-nowrap px-3 py-2",
            index >= 3 && "text-right",
          )}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function MemberRow({
  member,
  onOpen,
}: {
  member: DeptMember;
  onOpen?: () => void;
}) {
  const value = (text: string) =>
    member.has_kanban_data ? text : "—";
  return (
    <div
      role="row"
      onClick={onOpen}
      className={cn(
        "grid min-h-11 items-center border-b text-sm last:border-0",
        MEMBER_GRID,
        onOpen && "cursor-pointer hover:bg-muted/50",
      )}
    >
      <div className="min-w-0 px-3 py-2">
        <span className="truncate" title={member.real_name}>
          {member.real_name || member.emp_no || "—"}
        </span>
        {!member.has_kanban_data && (
          <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            无活动
          </span>
        )}
      </div>
      <div className="truncate px-3 py-2">{member.emp_no || "—"}</div>
      <div className="truncate px-3 py-2">{member.position || "—"}</div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatNumber(member.merged_need_count))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatDuration(member.actual_calendar_min))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatV2Ratio(member.calendar_ratio))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatV2Ratio(member.work_ratio))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatV2Ratio(member.silica))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatNumber(member.commit_count))}
      </div>
      <div className="px-3 py-2 text-right tabular-nums">
        {value(formatNumber(member.commit_diff_lines))}
      </div>
    </div>
  );
}

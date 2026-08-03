"use client";

import { useMemo, useState } from "react";
import { GitCommitHorizontal, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  commitsListOptions,
  fmtCost,
  formatDuration,
  formatLocalTime,
  parseOrder,
  sortRows,
  tasksListOptions,
  toOrder,
  type CommitListItem,
  type TaskListItem,
  useUserNameMap,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { PageHeader } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { DateRangePicker } from "../components";
import {
  DRILLDOWN_LINK_CLASS,
  DRILLDOWN_ROW_CLASS,
} from "../components/drilldown-styles";
import { SortHeader, Td, TdNum, Th, ThNum } from "../usage/shared";

export interface ActivityListState {
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
  order: string;
  userName: string;
  org1: string;
  org2: string;
  org3: string;
  org4: string;
}

interface ActivityListPageProps {
  state: ActivityListState;
  onStateChange: (patch: Partial<ActivityListState>) => void;
}

const TASK_SERVER_FIELDS = new Set(["startTime", "diffLines", "cost"]);
const COMMIT_SERVER_FIELDS = new Set(["commitTime", "diffLines", "cost"]);

export function TaskListPage(props: ActivityListPageProps) {
  const wsId = useWorkspaceId();
  const serverOrder = serverOrderParam(props.state.order, TASK_SERVER_FIELDS);
  const query = useQuery(
    tasksListOptions(wsId, {
      startDate: props.state.startDate,
      endDate: props.state.endDate,
      page: props.state.page,
      pageSize: props.state.pageSize,
      order: serverOrder,
      userName: props.state.userName || undefined,
    }),
  );

  return (
    <ActivityListPage
      {...props}
      kind="task"
      rows={query.data?.data ?? []}
      total={query.data?.total ?? 0}
      loading={query.isLoading}
      error={query.error}
    />
  );
}

export function CommitListPage(props: ActivityListPageProps) {
  const wsId = useWorkspaceId();
  const serverOrder = serverOrderParam(
    props.state.order,
    COMMIT_SERVER_FIELDS,
  );
  const query = useQuery(
    commitsListOptions(wsId, {
      startDate: props.state.startDate,
      endDate: props.state.endDate,
      page: props.state.page,
      pageSize: props.state.pageSize,
      order: serverOrder,
    }),
  );

  return (
    <ActivityListPage
      {...props}
      kind="commit"
      rows={query.data?.data ?? []}
      total={query.data?.total ?? 0}
      loading={query.isLoading}
      error={query.error}
    />
  );
}

function ActivityListPage({
  kind,
  state,
  onStateChange,
  rows,
  total,
  loading,
  error,
}: ActivityListPageProps & {
  kind: "task" | "commit";
  rows: TaskListItem[] | CommitListItem[];
  total: number;
  loading: boolean;
  error: Error | null;
}) {
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();
  const [draftUserName, setDraftUserName] = useState(state.userName);
  const parsedOrder = useMemo(() => parseOrder(state.order), [state.order]);
  const isCommit = kind === "commit";

  const displayRows = useMemo<ActivityRow[]>(() => {
    const normalized = isCommit
      ? (rows as CommitListItem[]).map((row) =>
          commitToActivity(row, resolveName),
        )
      : (rows as TaskListItem[]).map((row) =>
          taskToActivity(row, resolveName),
        );
    const filtered = normalized.filter((row) => {
      const orgs = [state.org1, state.org2, state.org3, state.org4];
      if (
        orgs.some(Boolean) &&
        !orgs.every((org, index) => !org || row.org[index] === org)
      ) {
        return false;
      }
      if (isCommit && state.userName) {
        return row.user.toLowerCase().includes(state.userName.toLowerCase());
      }
      return true;
    });
    if (!parsedOrder || !CLIENT_FIELDS.has(parsedOrder.field)) return filtered;
    return sortRows(
      filtered,
      (row) =>
        parsedOrder.field.endsWith("RealMinutes") ? row.real : row.ancient,
      parsedOrder.desc,
    );
  }, [
    isCommit,
    parsedOrder,
    resolveName,
    rows,
    state.org1,
    state.org2,
    state.org3,
    state.org4,
    state.userName,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const serverFields = isCommit ? COMMIT_SERVER_FIELDS : TASK_SERVER_FIELDS;

  function applyUserFilter() {
    onStateChange({ userName: draftUserName.trim(), page: 1 });
  }

  function resetFilters() {
    setDraftUserName("");
    onStateChange({
      userName: "",
      org1: "",
      org2: "",
      org3: "",
      org4: "",
      order: "",
      page: 1,
    });
  }

  function onSort(field: string) {
    const next =
      !parsedOrder || parsedOrder.field !== field
        ? toOrder(field, false)
        : !parsedOrder.desc
          ? toOrder(field, true)
          : undefined;
    onStateChange({
      order: next ?? "",
      page: serverFields.has(field) ? 1 : state.page,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          {isCommit ? (
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          )}
          <h1 className="truncate text-sm font-medium">
            {isCommit ? "提交 Commit" : "任务 Task"}
          </h1>
        </div>
        <DateRangePicker
          value={[state.startDate, state.endDate]}
          onChange={([startDate, endDate]) =>
            onStateChange({ startDate, endDate, page: 1 })
          }
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <div>
            <h2 className="text-xl font-semibold">
              {isCommit ? "提交 Commit" : "任务 Task"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isCommit
                ? "按提交查看代码产出明细（代码量、耗时、费用）；提效比请看需求 / 用户 / 组织层。"
                : "按任务查看 AI 使用明细（耗时、代码量、费用）；提效比请看需求 / 用户 / 组织层。"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draftUserName}
              onChange={(event) => setDraftUserName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyUserFilter();
              }}
              placeholder="用户名"
              className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button onClick={applyUserFilter} disabled={loading}>
              查询
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              重置
            </Button>
          </div>

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">
                {isCommit ? "Commit 列表" : "Task 列表"}
              </span>
              <span className="text-xs text-muted-foreground">共 {total} 条</span>
            </div>
            {error && (
              <div className="border-b px-4 py-2 text-sm text-destructive">
                加载失败：{error.message}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <Th>{isCommit ? "Commit ID" : "Task ID"}</Th>
                    <Th>
                      <SortHeader
                        label="时间"
                        active={parsedOrder?.field === timeSortField(kind)}
                        desc={parsedOrder?.desc === true}
                        onClick={() => onSort(timeSortField(kind))}
                      />
                    </Th>
                    <Th>组织</Th>
                    <Th>用户</Th>
                    <Th>说明</Th>
                    {isCommit && <Th>仓库</Th>}
                    <ThNum>
                      <SortHeader
                        label="代码量"
                        active={parsedOrder?.field === "diffLines"}
                        desc={parsedOrder?.desc === true}
                        onClick={() => onSort("diffLines")}
                      />
                    </ThNum>
                    <ThNum>
                      <SortHeader
                        label="实际耗时"
                        active={parsedOrder?.field === realSortField(kind)}
                        desc={parsedOrder?.desc === true}
                        onClick={() => onSort(realSortField(kind))}
                      />
                    </ThNum>
                    <ThNum>
                      <SortHeader
                        label="传统耗时预估"
                        active={parsedOrder?.field === ancientSortField(kind)}
                        desc={parsedOrder?.desc === true}
                        onClick={() => onSort(ancientSortField(kind))}
                      />
                    </ThNum>
                    <ThNum>Tokens 消耗</ThNum>
                    <ThNum>费用</ThNum>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }, (_, index) => (
                      <tr key={index} className="border-b">
                        <td
                          colSpan={isCommit ? 11 : 10}
                          className="px-3 py-3"
                        >
                          <div className="h-5 animate-pulse rounded bg-muted" />
                        </td>
                      </tr>
                    ))
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isCommit ? 11 : 10}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((row) => (
                      <tr
                        key={row.id}
                        tabIndex={0}
                        onClick={() =>
                          push(
                            isCommit
                              ? paths.metricsCommitDetail(row.id)
                              : paths.metricsTaskDetail(row.id),
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            push(
                              isCommit
                                ? paths.metricsCommitDetail(row.id)
                                : paths.metricsTaskDetail(row.id),
                            );
                          }
                        }}
                        className={`${DRILLDOWN_ROW_CLASS} border-b last:border-0`}
                      >
                        <Td title={row.id}>
                          <span className="font-mono text-xs text-primary">
                            {shortId(row.id)}
                          </span>
                        </Td>
                        <Td>{formatLocalTime(row.time)}</Td>
                        <Td title={row.org.join("/")}>
                          <Ellipsis value={row.org.filter(Boolean).join("/")} />
                        </Td>
                        <Td title={row.user}>
                          {row.userId ? (
                            <button
                              type="button"
                              className={DRILLDOWN_LINK_CLASS}
                              onClick={(event) => {
                                event.stopPropagation();
                                push(paths.metricsUserDetail(row.userId!));
                              }}
                            >
                              {row.user || "-"}
                            </button>
                          ) : (
                            row.user || "-"
                          )}
                        </Td>
                        <Td title={row.description}>
                          <Ellipsis value={row.description} />
                        </Td>
                        {isCommit && (
                          <Td title={row.repoLabel}>
                            {row.repoAddr ? (
                              <button
                                type="button"
                                className={`max-w-[260px] truncate text-left ${DRILLDOWN_LINK_CLASS}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  push(
                                    paths.metricsRepoDetail(
                                      row.repoAddr!,
                                      row.repoBranch,
                                    ),
                                  );
                                }}
                              >
                                {row.repoLabel}
                              </button>
                            ) : (
                              "-"
                            )}
                          </Td>
                        )}
                        <TdNum>{row.diffLines ?? "-"}</TdNum>
                        <TdNum>{formatDuration(row.real)}</TdNum>
                        <TdNum>{formatDuration(row.ancient)}</TdNum>
                        <TdNum>{row.tokens.toLocaleString()}</TdNum>
                        <TdNum>{row.cost > 0 ? `¥${fmtCost(row.cost)}` : "-"}</TdNum>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-xs text-muted-foreground">
                第 {state.page} / {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={state.pageSize}
                  onChange={(event) =>
                    onStateChange({
                      pageSize: Number(event.target.value),
                      page: 1,
                    })
                  }
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  aria-label="每页条数"
                >
                  {[50, 100, 200, 250].map((size) => (
                    <option key={size} value={size}>
                      {size} 条/页
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.page <= 1}
                  onClick={() => onStateChange({ page: state.page - 1 })}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.page >= totalPages}
                  onClick={() => onStateChange({ page: state.page + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface ActivityRow {
  id: string;
  time?: string | null;
  org: string[];
  user: string;
  userId?: string;
  description: string;
  repoAddr?: string;
  repoBranch?: string;
  repoLabel: string;
  diffLines?: number | null;
  real?: number | null;
  ancient?: number | null;
  tokens: number;
  cost: number;
}

const CLIENT_FIELDS = new Set([
  "taskRealMinutes",
  "taskAncientMinutes",
  "commitRealMinutes",
  "commitAncientMinutes",
]);

function taskToActivity(
  row: TaskListItem,
  resolveName: (id: string) => string,
): ActivityRow {
  const userId = row.user_id || row.user_name;
  return {
    id: row.task_id,
    time: row.start_time,
    org: [row.org1 ?? "", row.org2 ?? "", row.org3 ?? "", row.org4 ?? ""],
    user: userId ? resolveName(userId) : "",
    userId,
    description: row.title || "",
    repoAddr: row.repo_addr,
    repoBranch: row.repo_branch,
    repoLabel: [row.repo_addr, row.repo_branch].filter(Boolean).join("/"),
    diffLines: row.diff_lines,
    real: row.task_real_minutes_manual ?? row.task_real_minutes,
    ancient: row.task_ancient_minutes_manual ?? row.task_ancient_minutes,
    tokens: (row.upstream_tokens || 0) + (row.downstream_tokens || 0),
    cost: row.cost || 0,
  };
}

function commitToActivity(
  row: CommitListItem,
  resolveName: (id: string) => string,
): ActivityRow {
  const userId = row.user_id || row.user_name;
  const resolved = userId ? resolveName(userId) : "";
  return {
    id: row.commit_id,
    time: row.commit_time,
    org: [row.org1 ?? "", row.org2 ?? "", row.org3 ?? "", row.org4 ?? ""],
    user:
      resolved && resolved !== userId
        ? resolved
        : row.git_user_name || row.user_name || "",
    userId,
    description: row.comment || "",
    repoAddr: row.repo_addr,
    repoBranch: row.repo_branch,
    repoLabel: [row.repo_addr, row.repo_branch].filter(Boolean).join("/"),
    diffLines: row.diff_lines,
    real: row.commit_real_minutes_manual ?? row.commit_real_minutes,
    ancient: row.commit_ancient_minutes_manual ?? row.commit_ancient_minutes,
    tokens: (row.upstream_tokens || 0) + (row.downstream_tokens || 0),
    cost: row.cost || 0,
  };
}

function serverOrderParam(
  order: string,
  allowed: Set<string>,
): string | undefined {
  const parsed = parseOrder(order);
  return parsed && allowed.has(parsed.field) ? order : undefined;
}

function timeSortField(kind: "task" | "commit") {
  return kind === "task" ? "startTime" : "commitTime";
}

function realSortField(kind: "task" | "commit") {
  return kind === "task" ? "taskRealMinutes" : "commitRealMinutes";
}

function ancientSortField(kind: "task" | "commit") {
  return kind === "task" ? "taskAncientMinutes" : "commitAncientMinutes";
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function Ellipsis({ value }: { value: string }) {
  return <span className="block max-w-[260px] truncate">{value || "-"}</span>;
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  formatLocalTime,
  formatNumber,
  formatV2Ratio,
  repoDetailOptions,
  useUserNameMap,
  type RepoCommitItem,
  type TaskListItem,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { useNavigation } from "../../navigation";
import { DRILLDOWN_LINK_CLASS } from "../components/drilldown-styles";
import { SortHeader, Th, ThNum, Td, TdNum } from "../usage/shared";
import { DetailShell } from "./detail-shell";
import { Kv, KvGrid, Panel } from "./shared";

interface WorkDirDetailProps {
  workDirId: string;
  onBack: () => void;
}

interface MatchedTask {
  task_id: string;
  user_name?: string;
  user_id?: string;
  silica?: number | null;
}

interface WorkDirCommit extends RepoCommitItem {
  silica_reason?: string;
  matched_tasks?: MatchedTask[];
}

interface Participant {
  userId: string;
  userName: string;
  taskCount: number;
  commitCount: number;
}

type CommitSortField =
  | "commitId"
  | "gitUserName"
  | "commitTime"
  | "diffLines"
  | "silica"
  | "matchedTasks";
type ParticipantSortField = "taskCount" | "commitCount";

interface SortState<T extends string> {
  field: T;
  desc: boolean;
}

export function WorkDirDetail({ workDirId, onBack }: WorkDirDetailProps) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { push } = useNavigation();
  const { resolveName } = useUserNameMap();
  const detailQ = useQuery(
    repoDetailOptions(wsId, { repoAddr: workDirId, repoBranch: "" }),
  );

  const commits = useMemo(
    () => (detailQ.data?.commits ?? []) as WorkDirCommit[],
    [detailQ.data?.commits],
  );
  const tasks: TaskListItem[] = useMemo(
    () => detailQ.data?.tasks ?? [],
    [detailQ.data?.tasks],
  );
  const summary = detailQ.data?.summary;
  const repoAddr = detailQ.data?.repo_addr || workDirId;

  const participants = useMemo<Participant[]>(() => {
    const byUser = new Map<string, Participant>();
    const nameToId = new Map<string, string>();
    for (const task of tasks) {
      const userId = task.user_id || "";
      if (!userId) continue;
      if (task.user_name) nameToId.set(task.user_name, userId);
      const current = byUser.get(userId) ?? {
        userId,
        userName: task.user_name || userId,
        taskCount: 0,
        commitCount: 0,
      };
      current.taskCount += 1;
      byUser.set(userId, current);
    }
    for (const commit of commits) {
      const userId = nameToId.get(commit.git_user_name || "");
      if (!userId) continue;
      const current = byUser.get(userId);
      if (current) current.commitCount += 1;
    }
    return Array.from(byUser.values());
  }, [commits, tasks]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commitSort, setCommitSort] =
    useState<SortState<CommitSortField> | null>(null);
  const [participantSort, setParticipantSort] =
    useState<SortState<ParticipantSortField> | null>(null);

  const sortedCommits = useMemo(
    () =>
      sortRows(commits, commitSort, (row, field) => {
        switch (field) {
          case "commitId":
            return row.commit_id;
          case "gitUserName":
            return row.git_user_name ?? null;
          case "commitTime":
            return row.commit_time
              ? new Date(row.commit_time).getTime()
              : null;
          case "diffLines":
            return row.diff_lines ?? null;
          case "silica":
            return row.silica ?? null;
          case "matchedTasks":
            return row.matched_tasks?.length ?? null;
          default:
            return null;
        }
      }),
    [commits, commitSort],
  );
  const sortedParticipants = useMemo(
    () =>
      sortRows(participants, participantSort, (row, field) =>
        field === "taskCount" ? row.taskCount : row.commitCount,
      ),
    [participantSort, participants],
  );

  function toggleCommit(commitId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(commitId)) next.delete(commitId);
      else next.add(commitId);
      return next;
    });
  }

  return (
    <DetailShell
      onBack={onBack}
      title="工作目录详情"
      subtitle={repoAddr || "-"}
      loading={detailQ.isLoading}
      error={detailQ.error}
      empty={
        !detailQ.data ? "暂无该工作目录数据" : undefined
      }
    >
      <Panel title="仓库概览">
        <KvGrid>
          <Kv label="仓库地址" wide mono>
            {detailQ.data?.repo_addr || "-"}
          </Kv>
          <Kv label="分支">{detailQ.data?.repo_branch || "-"}</Kv>
          <Kv label="用户数">-</Kv>
          <Kv label="关联 task 数">
            {summary?.task_count != null
              ? formatNumber(summary.task_count)
              : "-"}
          </Kv>
          <Kv label="关联 Commit 数">
            {summary?.commit_count != null
              ? formatNumber(summary.commit_count)
              : "-"}
          </Kv>
          <Kv label="总费用">-</Kv>
          <Kv label="传统开发时长预估">-</Kv>
        </KvGrid>
      </Panel>

      {commits.length > 0 && (
        <Panel
          title="Commit 列表"
          hint={`${commits.length} 条`}
          bodyClassName="overflow-x-auto"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="w-8 px-3 py-2" />
                <Th>
                  <SortHeader
                    label="Commit ID"
                    active={commitSort?.field === "commitId"}
                    desc={
                      commitSort?.field === "commitId" && commitSort.desc
                    }
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "commitId"),
                      )
                    }
                  />
                </Th>
                <Th>
                  <SortHeader
                    label="提交者"
                    active={commitSort?.field === "gitUserName"}
                    desc={
                      commitSort?.field === "gitUserName" && commitSort.desc
                    }
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "gitUserName"),
                      )
                    }
                  />
                </Th>
                <Th>
                  <SortHeader
                    label="提交时间"
                    active={commitSort?.field === "commitTime"}
                    desc={
                      commitSort?.field === "commitTime" && commitSort.desc
                    }
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "commitTime"),
                      )
                    }
                  />
                </Th>
                <ThNum>
                  <SortHeader
                    label="Diff 行数"
                    active={commitSort?.field === "diffLines"}
                    desc={
                      commitSort?.field === "diffLines" && commitSort.desc
                    }
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "diffLines"),
                      )
                    }
                  />
                </ThNum>
                <Th>
                  <SortHeader
                    label="AI 代码占比"
                    active={commitSort?.field === "silica"}
                    desc={commitSort?.field === "silica" && commitSort.desc}
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "silica"),
                      )
                    }
                  />
                </Th>
                <ThNum>
                  <SortHeader
                    label="关联 task 数"
                    active={commitSort?.field === "matchedTasks"}
                    desc={
                      commitSort?.field === "matchedTasks" && commitSort.desc
                    }
                    onClick={() =>
                      setCommitSort((current) =>
                        cycleSort(current, "matchedTasks"),
                      )
                    }
                  />
                </ThNum>
              </tr>
            </thead>
            <tbody>
              {sortedCommits.map((commit) => {
                const isOpen = expanded.has(commit.commit_id);
                const matchedTasks = commit.matched_tasks ?? [];
                const silica = commit.silica ?? 0;
                const width = Math.max(0, Math.min(100, silica * 100));
                return (
                  <Fragment key={commit.commit_id}>
                    <tr className="border-b text-card-foreground hover:bg-muted/50">
                      <td className="px-3 py-2 align-middle">
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => toggleCommit(commit.commit_id)}
                          aria-label={isOpen ? "收起" : "展开"}
                          aria-expanded={isOpen}
                        >
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                        </Button>
                      </td>
                      <Td>
                        <button
                          type="button"
                          onClick={() =>
                            push(paths.metricsCommitDetail(commit.commit_id))
                          }
                          className={`max-w-[180px] truncate font-mono ${DRILLDOWN_LINK_CLASS}`}
                          title={commit.commit_id}
                        >
                          {commit.commit_id}
                        </button>
                      </Td>
                      <Td>{commit.git_user_name || "-"}</Td>
                      <Td>{formatLocalTime(commit.commit_time)}</Td>
                      <TdNum>{commit.diff_lines ?? 0}</TdNum>
                      <Td>
                        <div className="flex min-w-[120px] items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${silicaBarClass(silica)}`}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                            {formatV2Ratio(commit.silica, 0)}
                          </span>
                        </div>
                      </Td>
                      <TdNum>{matchedTasks.length || "-"}</TdNum>
                    </tr>
                    {isOpen && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={7} className="px-5 py-3">
                          {commit.silica_reason && (
                            <p className="mb-2 text-xs text-muted-foreground">
                              {commit.silica_reason}
                            </p>
                          )}
                          {matchedTasks.length === 0 ? (
                            <div className="text-xs text-muted-foreground">
                              暂无关联 task
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {matchedTasks.map((task) => (
                                <div
                                  key={task.task_id}
                                  className="flex items-center gap-3 text-xs"
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      push(
                                        paths.metricsTaskDetail(task.task_id),
                                      )
                                    }
                                    className={`font-mono ${DRILLDOWN_LINK_CLASS}`}
                                  >
                                    {task.task_id}
                                  </button>
                                  <span className="text-muted-foreground">
                                    {resolveName(
                                      task.user_id || task.user_name,
                                    )}
                                  </span>
                                  <span className="tabular-nums text-muted-foreground">
                                    {formatV2Ratio(task.silica, 0)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {participants.length > 0 && (
        <Panel
          title="参与者"
          hint={`${participants.length} 人`}
          bodyClassName="overflow-x-auto"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <Th>用户名</Th>
                <ThNum>
                  <SortHeader
                    label="task 数"
                    active={participantSort?.field === "taskCount"}
                    desc={
                      participantSort?.field === "taskCount" &&
                      participantSort.desc
                    }
                    onClick={() =>
                      setParticipantSort((current) =>
                        cycleSort(current, "taskCount"),
                      )
                    }
                  />
                </ThNum>
                <ThNum>
                  <SortHeader
                    label="Commit 数"
                    active={participantSort?.field === "commitCount"}
                    desc={
                      participantSort?.field === "commitCount" &&
                      participantSort.desc
                    }
                    onClick={() =>
                      setParticipantSort((current) =>
                        cycleSort(current, "commitCount"),
                      )
                    }
                  />
                </ThNum>
              </tr>
            </thead>
            <tbody>
              {sortedParticipants.map((participant) => (
                <tr
                  key={participant.userId}
                  className="border-b text-card-foreground hover:bg-muted/50 last:border-0"
                >
                  <Td>
                    <button
                      type="button"
                      onClick={() =>
                        push(paths.metricsUserDetail(participant.userId))
                      }
                      className={DRILLDOWN_LINK_CLASS}
                    >
                      {resolveName(participant.userId)}
                    </button>
                  </Td>
                  <TdNum>{participant.taskCount}</TdNum>
                  <TdNum>{participant.commitCount}</TdNum>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </DetailShell>
  );
}

function cycleSort<T extends string>(
  current: SortState<T> | null,
  field: T,
): SortState<T> | null {
  if (!current || current.field !== field) return { field, desc: false };
  if (!current.desc) return { field, desc: true };
  return null;
}

function sortRows<Row, Field extends string>(
  rows: Row[],
  sort: SortState<Field> | null,
  value: (row: Row, field: Field) => string | number | null,
): Row[] {
  if (!sort) return rows;
  return [...rows].sort((left, right) => {
    const a = value(left, sort.field);
    const b = value(right, sort.field);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const result =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b));
    return sort.desc ? -result : result;
  });
}

function silicaBarClass(value: number): string {
  if (value >= 0.8) return "bg-success";
  if (value >= 0.5) return "bg-info";
  return "bg-warning";
}

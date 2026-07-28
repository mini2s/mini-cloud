"use client";

import { useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  fmtCost,
  formatNumber,
  formatPercent,
  userGroupDetailOptions,
  useDeleteUserGroup,
  useUserNameMap,
  useViewState,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { PageHeader } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { PeriodSelect } from "../components";
import { Td, TdNum, Th, ThNum } from "../usage/shared";

export function UserGroupDetail({ groupId }: { groupId: string }) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { resolveName } = useUserNameMap();
  const { timeRange, setTimeRange } = useViewState();
  const [startDate, endDate] = timeRange;
  const query = useQuery(
    userGroupDetailOptions(wsId, groupId, startDate, endDate),
  );
  const deleteMutation = useDeleteUserGroup();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const members = useMemo(() => query.data?.members ?? [], [query.data?.members]);
  const summary = query.data?.summary;
  const group = query.data?.group;

  async function deleteGroup() {
    await deleteMutation.mutateAsync(groupId);
    setConfirmOpen(false);
    navigation.push(`${paths.metricsEfficiency()}?entity=user`);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <UsersRound className="h-4 w-4 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">
            虚拟组：{group?.name || groupId}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelect value={startDate} onChange={setTimeRange} />
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            删除此组
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <Button variant="ghost" size="sm" onClick={navigation.back}>
            ← 返回
          </Button>

          {query.error ? (
            <div className="rounded-lg border p-8 text-center text-sm text-destructive">
              获取用户组详情失败：{(query.error as Error).message}
            </div>
          ) : (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <Metric label="成员数" value={formatNumber(members.length)} />
                <Metric
                  label="总 Task 数"
                  value={formatNumber(summary?.task_count ?? 0)}
                />
                <Metric
                  label="总 Commit 数"
                  value={formatNumber(summary?.commit_count ?? 0)}
                />
                <Metric
                  label="加权 Task 提效比"
                  value={formatPercent(summary?.task_efficiency_ratio || null)}
                />
                <Metric
                  label="加权 Commit 提效比"
                  value={formatPercent(summary?.commit_efficiency_ratio || null)}
                />
                <Metric
                  label="总费用"
                  value={summary?.cost == null ? "-" : `¥${fmtCost(summary.cost)}`}
                />
              </section>

              <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-sm font-semibold">成员明细</span>
                  <span className="text-xs text-muted-foreground">
                    提效比为百分比口径（300=300%）
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b">
                        <Th>用户名</Th>
                        <ThNum>活跃天数</ThNum>
                        <ThNum>Task 数</ThNum>
                        <ThNum>Commit 数</ThNum>
                        <Th>Task 提效比</Th>
                        <Th>Commit 提效比</Th>
                        <ThNum>费用</ThNum>
                      </tr>
                    </thead>
                    <tbody>
                      {query.isLoading ? (
                        Array.from({ length: 5 }, (_, index) => (
                          <tr key={index} className="border-b">
                            <td colSpan={7} className="px-3 py-3">
                              <div className="h-5 animate-pulse rounded bg-muted" />
                            </td>
                          </tr>
                        ))
                      ) : members.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-12 text-center text-muted-foreground"
                          >
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        members.map((member) => (
                          <tr
                            key={member.user_id}
                            onClick={() =>
                              navigation.push(
                                paths.metricsUserDetail(member.user_id),
                              )
                            }
                            className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                          >
                            <Td title={resolveName(member.user_id)}>
                              {resolveName(member.user_id)}
                            </Td>
                            <TdNum>{formatNumber(member.day_count)}</TdNum>
                            <TdNum>{formatNumber(member.task_count)}</TdNum>
                            <TdNum>{formatNumber(member.commit_count)}</TdNum>
                            <Td>
                              {formatPercent(
                                member.task_efficiency_ratio || null,
                              )}
                            </Td>
                            <Td>
                              {formatPercent(
                                member.commit_efficiency_ratio || null,
                              )}
                            </Td>
                            <TdNum>¥{fmtCost(member.cost)}</TdNum>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除虚拟组</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除虚拟组“{group?.name || groupId}”？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error && (
            <p className="text-sm text-destructive">
              删除失败：{deleteMutation.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deleteGroup();
              }}
            >
              {deleteMutation.isPending ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

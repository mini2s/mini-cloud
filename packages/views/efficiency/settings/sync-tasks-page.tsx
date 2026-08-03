"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatSyncTasksOptions,
  chatDatasourcesOptions,
  formatShanghaiDayRange,
  formatLocalTime,
  toShanghaiSyncRange,
  useCancelChatSyncTask,
  useRetryChatSyncTask,
  useSubmitChatSyncTask,
  type ChatSyncSubmitReq,
  type ChatSyncTask,
} from "@multica/core/efficiency";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { NativeSelect } from "@multica/ui/components/ui/native-select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { PageHeader } from "../../layout/page-header";
import {
  ErrorBanner,
  Section,
  SettingsField,
  Td,
  TdNum,
  Th,
  ThNum,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "error",
  retrying: "warning",
};

const ACTIVE_STATUSES = new Set(["pending", "running", "retrying"]);

function progressPercent(t: ChatSyncTask): number {
  if (!t.total_gaps) return t.status === "completed" ? 100 : 0;
  return Math.round((t.completed_gaps / t.total_gaps) * 100);
}

export function SyncTasksPage() {
  const wsId = useWorkspaceId();
  const tasksQ = useQuery(chatSyncTasksOptions(wsId));
  const dsQ = useQuery(chatDatasourcesOptions(wsId));
  const submitSync = useSubmitChatSyncTask();
  const retrySync = useRetryChatSyncTask();
  const cancelSync = useCancelChatSyncTask();

  const tasks = useMemo(() => tasksQ.data?.tasks ?? [], [tasksQ.data]);
  const enabledSources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );

  // Submit-sync form state.
  const [sourceId, setSourceId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitMessage, setSubmitMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Retry/cancel confirmation dialog.
  const [pendingAction, setPendingAction] = useState<{
    type: "retry" | "cancel";
    task: ChatSyncTask;
  } | null>(null);

  const hasActive = useMemo(
    () => tasks.some((t) => ACTIVE_STATUSES.has(t.status)),
    [tasks],
  );

  useEffect(() => {
    if (!sourceId && enabledSources.length > 0) {
      setSourceId(String(enabledSources[0]?.id));
    }
  }, [enabledSources, sourceId]);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      tasksQ.refetch();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasActive, tasksQ.refetch]);

  function handleSubmit() {
    const range = toShanghaiSyncRange(startDate, endDate);
    if (!range) {
      setSubmitMessage({
        ok: false,
        text: "请选择有效的开始和结束日期，且开始日期不能晚于结束日期",
      });
      return;
    }
    if (!sourceId) {
      setSubmitMessage({ ok: false, text: "请选择数据源" });
      return;
    }

    const payload: ChatSyncSubmitReq = {
      ...range,
      source_id: Number(sourceId),
      force: false,
    };
    setSubmitMessage(null);
    submitSync.mutate(payload, {
      onSuccess: (response) => {
        setSubmitMessage({
          ok: true,
          text: `同步任务已提交（数据源：${response.source_name || sourceId}）`,
        });
        setStartDate("");
        setEndDate("");
      },
      onError: (error) => {
        setSubmitMessage({
          ok: false,
          text: (error as Error)?.message || "提交失败",
        });
      },
    });
  }

  // Confirm a retry or cancel action via the active mutation hook.
  function confirmAction() {
    if (!pendingAction) return;
    const { type, task } = pendingAction;
    const mutation = type === "retry" ? retrySync : cancelSync;
    mutation.mutate(task.task_id, {
      onSuccess: () => setPendingAction(null),
    });
  }

  function promptAction(
    type: "retry" | "cancel",
    task: ChatSyncTask,
  ) {
    if (type === "retry") retrySync.reset();
    else cancelSync.reset();
    setPendingAction({ type, task });
  }

  // Which mutation (if any) is currently confirming, for the dialog's
  // button disabled + loading state.
  const actionPending =
    pendingAction?.type === "retry"
      ? retrySync.isPending
      : pendingAction?.type === "cancel"
        ? cancelSync.isPending
        : false;
  const actionError =
    (pendingAction?.type === "retry" ? retrySync.error : cancelSync.error) ??
    null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">同步任务</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {tasks.length} 个同步任务
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => tasksQ.refetch()}
        >
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6 lg:px-8">
          <Section title="发起数据同步">
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <SettingsField label="数据源">
                <NativeSelect
                  className="w-full"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  {enabledSources.length === 0 && (
                    <option value="">暂无启用的数据源</option>
                  )}
                  {enabledSources.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}（{d.source_type === "postgres" ? "PG" : "ES"}）
                    </option>
                  ))}
                </NativeSelect>
              </SettingsField>
              <SettingsField label="开始日期（含）">
                <Input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </SettingsField>
              <SettingsField label="结束日期（含）">
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </SettingsField>
              <div className="flex items-end">
                <Button
                  type="button"
                  disabled={submitSync.isPending}
                  onClick={handleSubmit}
                >
                  <Play className="size-3.5" />
                  {submitSync.isPending ? "提交中..." : "开始同步"}
                </Button>
              </div>
            </div>
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              按北京时间同步，开始和结束日期均包含。
            </p>
            {submitMessage ? (
              <div
                className={`px-4 pb-4 text-sm ${
                  submitMessage.ok ? "text-success" : "text-destructive"
                }`}
              >
                {submitMessage.text}
              </div>
            ) : null}
          </Section>

          <Section
            title="同步任务"
            count={tasks.length}
            rightSlot={
              hasActive ? (
                <span className="text-xs text-muted-foreground">
                  进行中任务自动刷新
                </span>
              ) : null
            }
            bodyClassName="overflow-x-auto"
          >
            {tasksQ.error ? (
              <ErrorBanner
                message={
                  (tasksQ.error as Error)?.message ||
                  "获取同步任务失败"
                }
              />
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>任务 ID</Th>
                  <Th>状态</Th>
                  <Th>数据源</Th>
                  <Th>进度</Th>
                  <Th>请求范围</Th>
                  <ThNum>处理行数</ThNum>
                  <ThNum>写入行数</ThNum>
                  <Th>错误信息</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {tasksQ.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={9} className="px-3 py-2">
                        <Skeleton className="h-6 w-full rounded" />
                      </td>
                    </tr>
                  ))
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center">
                      <span className="text-sm text-muted-foreground">
                        暂无同步任务
                      </span>
                    </td>
                  </tr>
                ) : (
                  tasks.map((t) => {
                    const isActive = ACTIVE_STATUSES.has(t.status);
                    const pct = progressPercent(t);
                    return (
                      <tr
                        key={t.task_id}
                        className="border-b last:border-0 hover:bg-muted/50"
                      >
                        <Td>
                          <span
                            className="font-mono text-xs"
                            title={t.task_id}
                          >
                            {t.task_id.slice(0, 12)}…
                          </span>
                        </Td>
                        <Td>
                          <ToneBadge tone={STATUS_TONE[t.status] ?? "neutral"}>
                            {t.status}
                          </ToneBadge>
                        </Td>
                        <Td>{t.source_name || "-"}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className={`h-full rounded-full transition-all ${
                                  t.status === "failed"
                                    ? "bg-destructive"
                                    : t.status === "completed"
                                      ? "bg-success"
                                      : "bg-primary"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {t.total_gaps
                                ? `${t.completed_gaps}/${t.total_gaps}`
                                : `${pct}%`}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap text-xs">
                            {formatShanghaiDayRange(
                              t.req_start_time,
                              t.req_end_time,
                            ) ||
                              `${formatLocalTime(t.req_start_time)} ~ ${formatLocalTime(t.req_end_time)}`}
                          </span>
                        </Td>
                        <TdNum>
                          {t.total_rows_processed?.toLocaleString() ?? "-"}
                        </TdNum>
                        <TdNum>
                          {t.total_rows_written?.toLocaleString() ?? "-"}
                        </TdNum>
                        <Td>
                          {t.error_message ? (
                            <div
                              className="max-w-[180px] truncate text-xs text-destructive"
                              title={t.error_message}
                            >
                              {t.error_message}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </Td>
                        <Td>
                          <div className="inline-flex items-center gap-1.5">
                            {t.status === "failed" && (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0"
                                onClick={() => promptAction("retry", t)}
                              >
                                重试
                              </Button>
                            )}
                            {isActive && (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-destructive"
                                onClick={() => promptAction("cancel", t)}
                              >
                                停止
                              </Button>
                            )}
                            {!isActive && t.status !== "failed" && (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <Dialog
        open={!!pendingAction}
        onOpenChange={(next) => {
          if (!next && !actionPending) {
            setPendingAction(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === "retry"
                ? "确认重试"
                : "确认停止"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-card-foreground">
            {pendingAction?.type === "retry"
              ? `确定重试任务 ${pendingAction?.task.task_id.slice(0, 12)}... 吗？`
              : `确定停止任务 ${pendingAction?.task.task_id.slice(0, 12)}... 吗？任务将标记为失败。`}
          </p>
          {actionError ? (
            <ErrorBanner
              message={
                (actionError as Error)?.message ||
                "操作失败"
              }
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingAction(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={pendingAction?.type === "cancel" ? "destructive" : "default"}
              disabled={actionPending}
              onClick={confirmAction}
            >
              {actionPending
                ? "处理中..."
                : pendingAction?.type === "retry"
                  ? "重试"
                  : "停止任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

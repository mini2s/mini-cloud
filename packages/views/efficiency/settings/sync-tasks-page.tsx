"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  chatSyncTasksOptions,
  chatDatasourcesOptions,
  formatLocalTime,
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
  NotWiredNotice,
  Section,
  SettingsField,
  Td,
  TdNum,
  Th,
  ThNum,
} from "./shared";
import { ToneBadge, type BadgeTone } from "../detail/shared";

// Settings · Sync tasks. Ports the source SyncTasks.tsx to the shared-views
// layer. The read table (task id / status / datasource / progress / range /
// rows / error) is the deliverable. The "submit sync" form + the retry/cancel
// row actions are UI-only — the chat submit/retry/cancel mutations throw
// NOT_WIRED in the mock phase, so each surfaces the NotWiredNotice instead of
// calling the backend.

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

  const tasks = useMemo(() => tasksQ.data?.tasks ?? [], [tasksQ.data]);
  const enabledSources = useMemo(
    () => (dsQ.data ?? []).filter((d) => d.is_enabled),
    [dsQ.data],
  );

  // Submit-sync form state (UI-only submit).
  const [sourceId, setSourceId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitNotice, setSubmitNotice] = useState(false);

  // Retry/cancel confirmation dialog (UI-only action).
  const [pendingAction, setPendingAction] = useState<{
    type: "retry" | "cancel";
    task: ChatSyncTask;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState(false);

  const hasActive = useMemo(
    () => tasks.some((t) => ACTIVE_STATUSES.has(t.status)),
    [tasks],
  );

  // Submit handler — UI-only in the mock phase.
  function handleSubmit() {
    setSubmitNotice(true);
  }

  function confirmAction() {
    setActionNotice(true);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader className="h-auto min-h-12 flex-wrap justify-between gap-y-1.5 px-5 py-1.5 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">Sync tasks</h1>
          <span className="truncate text-xs text-muted-foreground">
            · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => tasksQ.refetch()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          {/* Submit sync form */}
          <Section title="Start a sync">
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <SettingsField label="Datasource">
                <NativeSelect
                  className="w-full"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  {enabledSources.length === 0 && (
                    <option value="">No enabled datasource</option>
                  )}
                  {enabledSources.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name} ({d.source_type === "postgres" ? "PG" : "ES"})
                    </option>
                  ))}
                </NativeSelect>
              </SettingsField>
              <SettingsField label="Start date (inclusive)">
                <Input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </SettingsField>
              <SettingsField label="End date (inclusive)">
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </SettingsField>
              <div className="flex items-end">
                <Button type="button" onClick={handleSubmit}>
                  <Play className="size-3.5" />
                  Start sync
                </Button>
              </div>
            </div>
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Syncs run in Beijing time; both start and end dates are inclusive.
            </p>
            {submitNotice && (
              <div className="px-4 pb-4">
                <NotWiredNotice />
              </div>
            )}
          </Section>

          {/* Task list */}
          <Section
            title="Sync tasks"
            count={tasks.length}
            rightSlot={
              hasActive ? (
                <span className="text-xs text-muted-foreground">
                  Active tasks auto-refresh
                </span>
              ) : null
            }
            bodyClassName="overflow-x-auto"
          >
            {tasksQ.error ? (
              <ErrorBanner
                message={
                  (tasksQ.error as Error)?.message ||
                  "Failed to load sync tasks."
                }
              />
            ) : null}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <Th>Task ID</Th>
                  <Th>Status</Th>
                  <Th>Datasource</Th>
                  <Th>Progress</Th>
                  <Th>Requested range</Th>
                  <ThNum>Rows processed</ThNum>
                  <ThNum>Rows written</ThNum>
                  <Th>Error</Th>
                  <Th>Actions</Th>
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
                        No sync tasks yet.
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
                            {formatLocalTime(t.req_start_time)} ~{" "}
                            {formatLocalTime(t.req_end_time)}
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
                                onClick={() =>
                                  setPendingAction({ type: "retry", task: t })
                                }
                              >
                                Retry
                              </Button>
                            )}
                            {isActive && (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-destructive"
                                onClick={() =>
                                  setPendingAction({ type: "cancel", task: t })
                                }
                              >
                                Stop
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

      {/* Retry / cancel confirmation (UI-only action). */}
      <Dialog
        open={!!pendingAction}
        onOpenChange={(next) => {
          if (!next) {
            setPendingAction(null);
            setActionNotice(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === "retry"
                ? "Confirm retry"
                : "Confirm stop"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-card-foreground">
            {pendingAction?.type === "retry"
              ? `Retry task ${pendingAction?.task.task_id.slice(0, 12)}…?`
              : `Stop task ${pendingAction?.task.task_id.slice(0, 12)}…? It will be marked as failed.`}
          </p>
          {actionNotice && <NotWiredNotice />}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPendingAction(null);
                setActionNotice(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingAction?.type === "cancel" ? "destructive" : "default"}
              onClick={confirmAction}
            >
              {pendingAction?.type === "retry" ? "Retry" : "Stop task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

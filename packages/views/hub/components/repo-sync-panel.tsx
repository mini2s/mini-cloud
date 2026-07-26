"use client"

import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useT } from "@multica/views/i18n"
import {
  hubKeys,
  isHubRepoSyncActive,
  isHubSyncUnavailableError,
  normalizeHubRepoSyncStatus,
  useHubRepoSyncLogs,
  useHubRepoSyncStatus,
  useHubTriggerRepoSyncMutation,
} from "@multica/core/hub"
import type { Repository, SyncLog } from "@multica/core/types/hub"
import { Button } from "@multica/ui/components/ui/button"
import { Checkbox } from "@multica/ui/components/ui/checkbox"
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react"

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function fmtDateTime(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

/** Status badge coloring, aligned with hub's existing amber/green/red chips. */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
    case "failed":
      return "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
    case "pending":
    case "running":
    case "syncing":
    case "queued":
      return "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-400"
    default:
      return "border-border text-muted-foreground"
  }
}

/** Safety net: never poll a single triggered run longer than this. */
const TRACKING_TIMEOUT_MS = 120_000

// ── Single sync log row (expandable) ─────────────────────────────────────

function SyncLogRow({ log }: { log: SyncLog }) {
  const { t } = useT("hub")
  const [open, setOpen] = useState(false)

  const statusLabel = (() => {
    switch (log.status) {
      case "success":
        return t(($) => $.repo.sync.status_success)
      case "failed":
        return t(($) => $.repo.sync.status_failed)
      case "cancelled":
        return t(($) => $.repo.sync.status_cancelled)
      case "running":
        return t(($) => $.repo.sync.status_running)
      default:
        return log.status
    }
  })()

  const triggerLabel = (() => {
    switch (log.triggerType) {
      case "manual":
        return t(($) => $.repo.sync.trigger_manual)
      case "scheduled":
        return t(($) => $.repo.sync.trigger_scheduled)
      case "webhook":
        return t(($) => $.repo.sync.trigger_webhook)
      default:
        return log.triggerType
    }
  })()

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(log.status)}`}
        >
          {statusLabel}
        </span>
        <span className="text-muted-foreground">{triggerLabel}</span>
        <span className="text-muted-foreground">{fmtDateTime(log.startedAt)}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{fmtDuration(log.durationMs)}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/50 bg-muted/30 px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            <span>{t(($) => $.repo.sync.log_added, { count: log.addedItems })}</span>
            <span>{t(($) => $.repo.sync.log_updated, { count: log.updatedItems })}</span>
            <span>{t(($) => $.repo.sync.log_deleted, { count: log.deletedItems })}</span>
            <span>{t(($) => $.repo.sync.log_skipped, { count: log.skippedItems })}</span>
            <span className={log.failedItems > 0 ? "text-red-600 dark:text-red-400" : ""}>
              {t(($) => $.repo.sync.log_failed, { count: log.failedItems })}
            </span>
            <span>{t(($) => $.repo.sync.log_duration, { duration: fmtDuration(log.durationMs) })}</span>
          </div>
          {log.errorMessage && (
            <p className="whitespace-pre-wrap break-all rounded bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-400">
              {log.errorMessage}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

// ── Repo sync panel (FR-04) ──────────────────────────────────────────────
// Embedded in the expanded region of sync-type repos in hub-repo-list:
// status section (badge / lastSyncedAt / pendingJobs), action section
// ("立即同步" + dry-run), and recent sync logs. When the upstream backend
// does not serve the sync endpoints (404/501) the panel degrades to a
// muted hint — registry config editing stays available via EditRepoDialog
// and no error toast is produced.

export function RepoSyncPanel({ repo }: { repo: Repository }) {
  const { t } = useT("hub")
  const qc = useQueryClient()
  const [dryRun, setDryRun] = useState(false)
  // `tracking` keeps the status query polling after a manual trigger until
  // the run's terminal state is observed (or the safety timeout fires).
  const [tracking, setTracking] = useState(false)
  const [unavailableByTrigger, setUnavailableByTrigger] = useState(false)
  const sawActiveRef = useRef(false)
  const triggeredAtRef = useRef(0)

  const statusQuery = useHubRepoSyncStatus(repo.id, { polling: tracking })
  const logsQuery = useHubRepoSyncLogs(repo.id)
  const triggerMutation = useHubTriggerRepoSyncMutation()

  const unavailable =
    unavailableByTrigger ||
    isHubSyncUnavailableError(statusQuery.error) ||
    isHubSyncUnavailableError(logsQuery.error)

  const status = normalizeHubRepoSyncStatus(statusQuery.data)
  const active = isHubRepoSyncActive(status)
  const busy = active || tracking || triggerMutation.isPending

  // Stop polling once the triggered run reaches a terminal state: either we
  // observed an in-flight status first, or the latest log entry started at
  ///after the trigger moment (fast runs — e.g. dry-run — may finish between
  // polls without ever surfacing an active status).
  useEffect(() => {
    if (!tracking) return
    if (active) {
      sawActiveRef.current = true
      return
    }
    if (!status) return
    const lastStarted = status.lastLog?.startedAt ? Date.parse(status.lastLog.startedAt) : Number.NaN
    const freshTerminal = Number.isFinite(lastStarted) && lastStarted >= triggeredAtRef.current - 5000
    if (sawActiveRef.current || freshTerminal) {
      sawActiveRef.current = false
      setTracking(false)
      qc.invalidateQueries({ queryKey: hubKeys.repoSyncLogs(repo.id) })
    }
  }, [tracking, active, status, qc, repo.id])

  // Safety timeout so polling never runs forever.
  useEffect(() => {
    if (!tracking) return
    const timer = setTimeout(() => {
      sawActiveRef.current = false
      setTracking(false)
    }, TRACKING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [tracking])

  async function handleTrigger() {
    try {
      triggeredAtRef.current = Date.now()
      sawActiveRef.current = false
      await triggerMutation.mutateAsync({ repoId: repo.id, dryRun })
      setTracking(true)
      toast.success(
        t(($) => (dryRun ? $.repo.sync.dry_run_triggered_toast : $.repo.sync.triggered_toast)),
      )
    } catch (err) {
      // Endpoint missing upstream → degrade silently (panel hides actions).
      if (isHubSyncUnavailableError(err)) {
        setUnavailableByTrigger(true)
        return
      }
      toast.error(t(($) => $.repo.sync.trigger_failed), { description: errMsg(err) })
    }
  }

  if (unavailable) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        {t(($) => $.repo.sync.unavailable_hint)}
      </div>
    )
  }

  const statusLabel = (() => {
    const s = status?.syncStatus ?? "idle"
    switch (s) {
      case "success":
        return t(($) => $.repo.sync.status_success)
      case "failed":
        return t(($) => $.repo.sync.status_failed)
      case "cancelled":
        return t(($) => $.repo.sync.status_cancelled)
      case "pending":
        return t(($) => $.repo.sync.status_pending)
      case "running":
      case "syncing":
      case "queued":
        return t(($) => $.repo.sync.status_running)
      case "idle":
        return t(($) => $.repo.sync.status_idle)
      default:
        return s
    }
  })()

  return (
    <div className="mb-2 space-y-3 rounded-lg border border-border bg-card/50 p-3">
      {/* Status + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">{t(($) => $.repo.sync.title)}</span>
        {statusQuery.isLoading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(status?.syncStatus ?? "idle")}`}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              {statusLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {status?.lastSyncedAt
                ? t(($) => $.repo.sync.last_synced_at, { time: fmtDateTime(status.lastSyncedAt) })
                : t(($) => $.repo.sync.never_synced)}
            </span>
            {(status?.pendingJobs ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">
                · {t(($) => $.repo.sync.pending_jobs, { count: status?.pendingJobs ?? 0 })}
              </span>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={dryRun}
              onCheckedChange={(checked) => setDryRun(checked === true)}
              disabled={busy}
            />
            {t(($) => $.repo.sync.dry_run)}
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || statusQuery.isLoading}
            onClick={handleTrigger}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {t(($) => $.repo.sync.sync_now)}
          </Button>
        </div>
      </div>

      {/* Recent logs */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-foreground">{t(($) => $.repo.sync.logs_title)}</p>
        {logsQuery.isLoading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t(($) => $.repo.sync.logs_loading)}
          </div>
        ) : logsQuery.logs.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">{t(($) => $.repo.sync.logs_empty)}</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-md border border-border/60">
            {logsQuery.logs.map((log) => (
              <SyncLogRow key={log.id} log={log} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default RepoSyncPanel

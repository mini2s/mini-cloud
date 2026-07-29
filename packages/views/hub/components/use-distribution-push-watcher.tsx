"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@multica/core/api"
import { useAuthStore } from "@multica/core/auth"
import { hubKeys } from "@multica/core/hub"
import type { DistributionReceipt } from "@multica/core/types/hub"
import { useNavigation } from "../../navigation"
import { useWorkspacePaths } from "@multica/core/paths"
import { useT } from "../../i18n"

const POLL_INTERVAL_MS = 45_000
// Failed polls (e.g. 429 rate-limited) back off exponentially from 30s,
// doubling each consecutive failure and capping at 5min; a successful poll
// restores the normal interval.
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 300_000

/**
 * Polls the user's received capability distributions and shows a sonner toast
 * when a NEW unread push arrives — mirroring the source store's
 * `distribution-push-watcher`. The toast action navigates to the manager's
 * "我收到的推送" (received) tab.
 *
 * Detection is a client-side diff against an in-memory "seen" set: the first
 * poll baselines against the current receipts (so historical pushes never
 * re-toast); subsequent polls toast only receipts that are unread AND not yet
 * seen. Polling is skipped while the tab is hidden, and resumes immediately on
 * visibility regain. Authenticated users only.
 */
export function useDistributionPushWatcher(): void {
  const qc = useQueryClient()
  const { push } = useNavigation()
  const p = useWorkspacePaths()
  const { t } = useT("hub")
  const userId = useAuthStore((s) => s.user?.id)

  const seenRef = useRef<Set<string> | null>(null)
  const tickingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const failuresRef = useRef(0)

  // `p` is rebuilt on every render, so depending on it would restart the
  // effect — and its immediate first poll — on each re-render. The plain
  // string is compared by value and stays stable.
  const hubManagerPath = p.hubManager()

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const receivedPath = `${hubManagerPath}?tab=received`

    async function tick() {
      if (tickingRef.current) return
      if (typeof document !== "undefined" && document.hidden) return
      tickingRef.current = true
      try {
        const receipts = (await api.hubMyReceivedDistributions()) ?? []
        failuresRef.current = 0
        // Keep the manager's cache in sync so the badge reflects the latest.
        qc.setQueryData<DistributionReceipt[]>(hubKeys.distributionsReceived(), receipts)

        // First poll: baseline against the current set so historical pushes
        // never re-toast.
        if (seenRef.current === null) {
          seenRef.current = new Set(receipts.map((r) => r.id))
          return
        }

        const fresh = receipts.filter(
          (r) => r.receiptStatus === "unread" && !seenRef.current!.has(r.id),
        )
        for (const r of receipts) seenRef.current.add(r.id)
        if (fresh.length === 0) return

        if (fresh.length === 1) {
          const name = fresh[0]!.distribution?.item?.name
          toast(t(($) => $.push.toast.title), {
            description: name ?? t(($) => $.push.toast.unknownItem),
            duration: 8000,
            action: { label: t(($) => $.push.toast.view), onClick: () => push(receivedPath) },
          })
        } else {
          toast(t(($) => $.push.toast.titlePlural, { count: fresh.length }), {
            duration: 8000,
            action: { label: t(($) => $.push.toast.view), onClick: () => push(receivedPath) },
          })
        }
      } catch {
        // Network/permission errors (incl. 429) are swallowed and retried
        // with exponential backoff.
        failuresRef.current += 1
      } finally {
        tickingRef.current = false
      }
    }

    function schedule() {
      if (cancelled) return
      if (timerRef.current) clearTimeout(timerRef.current)
      const failures = failuresRef.current
      const delay =
        failures === 0
          ? POLL_INTERVAL_MS
          : Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
      timerRef.current = setTimeout(async () => {
        await tick()
        schedule()
      }, delay)
    }

    // Kick off the first poll promptly, then self-reschedule.
    tick().finally(schedule)

    function onVisible() {
      if (typeof document !== "undefined" && !document.hidden) tick()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible)
    }

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [userId, qc, push, hubManagerPath, t])
}

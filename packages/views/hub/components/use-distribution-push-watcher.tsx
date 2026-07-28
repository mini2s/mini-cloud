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

  useEffect(() => {
    if (!userId) return

    const receivedPath = `${p.hubManager()}?tab=received`

    async function tick() {
      if (tickingRef.current) return
      if (typeof document !== "undefined" && document.hidden) return
      tickingRef.current = true
      try {
        const receipts = (await api.hubMyReceivedDistributions()) ?? []
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
        // Network/permission errors are swallowed and retried next interval.
      } finally {
        tickingRef.current = false
      }
    }

    function schedule() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        await tick()
        schedule()
      }, POLL_INTERVAL_MS)
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
      if (timerRef.current) clearTimeout(timerRef.current)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [userId, qc, push, p, t])
}

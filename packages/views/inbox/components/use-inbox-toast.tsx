"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWS } from "@multica/core/realtime";
import { useNavigation } from "../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { useT } from "../../i18n";
import type { InboxNewPayload } from "@multica/core/types";

const DEDUP_WINDOW_MS = 30_000;

/**
 * Subscribes to inbox:new WS events and shows a sonner toast when:
 * - The user is NOT currently on the inbox page
 * - The notification severity is not "info"
 * - The same issue hasn't been toasted in the last 30 seconds
 *
 * Toast includes the notification title and a "View" action button that
 * navigates to the inbox page with the relevant item selected.
 */
export function useInboxToast(): void {
  const { subscribe } = useWS();
  const { pathname, push } = useNavigation();
  const p = useWorkspacePaths();
  const { t } = useT("inbox");
  const recentlyToastedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const unsub = subscribe("inbox:new", (payload: unknown) => {
      const { item } = payload as InboxNewPayload;
      if (!item) return;

      // Skip low-priority "info" notifications
      if (item.severity === "info") return;

      // Don't show toasts when the user is already on the inbox page
      const inboxPath = p.inbox();
      if (pathname === inboxPath || pathname.startsWith(inboxPath + "?")) {
        return;
      }

      // Deduplicate: skip if same issue was toasted recently
      const dedupKey = item.issue_id ?? item.id;
      const now = Date.now();

      // Evict stale entries
      const recent = recentlyToastedRef.current;
      for (const [key, timestamp] of recent) {
        if (now - timestamp > DEDUP_WINDOW_MS) {
          recent.delete(key);
        }
      }

      const lastToast = recent.get(dedupKey);
      if (lastToast && now - lastToast < DEDUP_WINDOW_MS) return;
      recent.set(dedupKey, now);

      const issueKey = item.issue_id ?? item.id;
      const navUrl = `${inboxPath}?issue=${issueKey}`;

      toast(item.title, {
        description: item.body?.slice(0, 120) ?? undefined,
        action: {
          label: t(($) => $.toast.view),
          onClick: () => push(navUrl),
        },
      });
    });

    return unsub;
  }, [subscribe, pathname, push, p, t]);
}

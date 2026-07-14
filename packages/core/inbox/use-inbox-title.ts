import { useEffect, useRef } from "react";
import { useInboxUnreadCount } from "./queries";

/**
 * Sets document.title to "(<count>) <defaultTitle>" when there are unread
 * inbox items, and restores the original title when the count drops to zero.
 * No-op during SSR (typeof document guard).
 */
export function useInboxTitle(wsId: string | null | undefined): void {
  const unreadCount = useInboxUnreadCount(wsId);
  const defaultTitleRef = useRef<string>("Multica");

  // Capture the actual default title on mount, before any unread-induced
  // changes. Next.js may have set it via metadata template resolution, so
  // reading document.title gives us the real runtime default.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.title) {
      defaultTitleRef.current = document.title;
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${defaultTitleRef.current}`;
    } else {
      document.title = defaultTitleRef.current;
    }
  }, [unreadCount]);

  // Restore default title on unmount so the tab doesn't retain a stale count
  // if this component is ever unmounted (e.g. workspace switch, logout).
  useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        document.title = defaultTitleRef.current;
      }
    };
  }, []);
}

"use client";

import { DashboardLayout } from "@multica/views/layout";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { SearchCommand, SearchTrigger } from "@multica/views/search";
import { ChatFab, ChatWindow } from "@multica/views/chat";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useInboxTitle } from "@multica/core/inbox";
import { useFaviconBadge } from "@multica/core/inbox";
import { useInboxToast } from "@multica/views/inbox";

function InboxNotificationLayer() {
  // Inbox chrome (title count, favicon badge, toast) is non-critical, so it
  // must never crash the dashboard. useWorkspaceId() throws when the
  // workspace list momentarily lacks the current slug — during a
  // WS-triggered refetch window, or after a DB reset / identity change that
  // drops the current workspace from the list — and that throw escapes to
  // the route error boundary and white-screens the whole page. Derive the id
  // without throwing; the inbox hooks accept null/undefined and no-op
  // (useInboxUnreadCount gates on `enabled: !!wsId`).
  const ws = useCurrentWorkspace();
  const wsId = ws?.id ?? null;
  useInboxTitle(wsId);
  useFaviconBadge(wsId);
  useInboxToast();
  return null;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout
      loadingIndicator={<MulticaIcon className="size-6" />}
      searchSlot={<SearchTrigger />}
      extra={
        <>
          <InboxNotificationLayer />
          <SearchCommand />
          <ChatWindow />
          <ChatFab />
        </>
      }
    >
      {children}
    </DashboardLayout>
  );
}

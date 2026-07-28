"use client";

import { DashboardLayout } from "@multica/views/layout";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { SearchCommand, SearchTrigger } from "@multica/views/search";
import { ChatFab, ChatWindow } from "@multica/views/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { useInboxTitle } from "@multica/core/inbox";
import { useFaviconBadge } from "@multica/core/inbox";
import { useInboxToast } from "@multica/views/inbox";
import { useDistributionPushWatcher } from "@multica/views/hub";

function InboxNotificationLayer() {
  const wsId = useWorkspaceId();
  useInboxTitle(wsId);
  useFaviconBadge(wsId);
  useInboxToast();
  useDistributionPushWatcher();
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

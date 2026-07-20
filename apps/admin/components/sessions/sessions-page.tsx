"use client";

import { SessionsList } from "./sessions-list";
import { SessionDetail } from "./session-detail";
import { SessionEmpty } from "./session-empty";

interface SessionsPageProps {
  activeSessionId?: string | null;
}

/**
 * Full-screen /sessions surface: 280px session list on the left, message
 * list + composer for the active session on the right. When no session is
 * selected, the right pane renders an empty placeholder.
 *
 * The parent route passes `activeSessionId` from the URL — this component
 * itself is URL-driven and stateless, which keeps it easy to reason about
 * (the chat store is synced inside SessionDetail's effect).
 */
export function SessionsPage({ activeSessionId = null }: SessionsPageProps) {
  return (
    <div className="flex h-full">
      <SessionsList activeSessionId={activeSessionId} />
      {activeSessionId ? (
        <SessionDetail sessionId={activeSessionId} />
      ) : (
        <SessionEmpty />
      )}
    </div>
  );
}

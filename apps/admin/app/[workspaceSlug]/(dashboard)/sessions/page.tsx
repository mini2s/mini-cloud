"use client";

import { SessionsPage } from "@/components/sessions/sessions-page";

/**
 * /sessions — list + detail split. No active session by default → right
 * pane renders the empty placeholder. Selecting or creating a session
 * navigates to /sessions/[id] which mounts SessionDetail.
 */
export default function Page() {
  return <SessionsPage />;
}

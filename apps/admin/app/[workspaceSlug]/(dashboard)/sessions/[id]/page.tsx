"use client";

import { use } from "react";
import { SessionsPage } from "@/components/sessions/sessions-page";

/**
 * /sessions/[id] — same split as /sessions, with `id` forwarded as the
 * active session. params is a Promise in Next 15 (async dynamic params),
 * so we unwrap with `use()` before passing down.
 */
export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SessionsPage activeSessionId={id} />;
}

import type { ChatSession } from "@multica/core/types";

export function resolveChatSessionId(
  sessions: ChatSession[],
  runtimeSessionId: string | null | undefined,
): string | null {
  if (!runtimeSessionId) return null;
  const session = sessions.find((s) => s.id === runtimeSessionId || s.session_id === runtimeSessionId);
  return session?.id ?? null;
}

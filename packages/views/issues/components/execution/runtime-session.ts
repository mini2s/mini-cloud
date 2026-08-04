"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import { isEmbeddedInCostrict, postCostrictNavigateToSession } from "@multica/core/platform";
import { useSessionPermission } from "@multica/core/workflows/queries";
import type {
  SessionPermissionResponse,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
} from "@multica/core/types";
import { useT } from "@multica/views/i18n";

/** Resolve the session id used by the shared "进入会话" entry for a node. */
export function resolveEnterSessionId(
  nodeRun: WorkflowNodeRun | null | undefined,
  runtimeSummary: WorkflowNodeRuntimeSummary | null | undefined,
): string | null {
  return nodeRun?.session_id ?? runtimeSummary?.session_id ?? null;
}

/**
 * Why the "进入会话" entry cannot open a session right now.
 * - `no_session`: the node has no bound session yet.
 * - `denied`: the runtime is private and the user may not observe it.
 * - `unavailable`: the permission check failed (session gone, network, 5xx).
 * - `pending`: the permission check is still in flight.
 */
export type EnterSessionBlockReason = "no_session" | "denied" | "unavailable" | "pending";

export function getEnterSessionBlockReason(
  sessionId: string | null,
  permission: Pick<SessionPermissionResponse, "can_observe"> | undefined,
  permissionError: unknown,
): EnterSessionBlockReason | null {
  if (!sessionId) return "no_session";
  if (permissionError) {
    return permissionError instanceof ApiError && permissionError.status === 403
      ? "denied"
      : "unavailable";
  }
  if (!permission) return "pending";
  return permission.can_observe === true ? null : "denied";
}

type IssuesTranslator = ReturnType<typeof useT<"issues">>["t"];

/** Toast the localized reason a session entry is blocked. `pending` stays silent. */
export function toastEnterSessionBlocked(t: IssuesTranslator, reason: EnterSessionBlockReason): void {
  switch (reason) {
    case "no_session":
      toast.error(t(($) => $.execution.detail_panel.open_session_missing));
      return;
    case "denied":
      toast.error(t(($) => $.execution.detail_panel.open_session_denied));
      return;
    case "unavailable":
      toast.error(t(($) => $.execution.detail_panel.open_session_unavailable));
      return;
    case "pending":
      return;
  }
}

export interface EnterSessionAction {
  sessionId: string | null;
  /** True when the session can actually be opened right now. */
  canOpenSession: boolean;
  /** True when the entry button should render; blocked clicks toast the reason. */
  showOpenSession: boolean;
  /** Attempt to open the session; toasts the reason and returns false when blocked. */
  openSession: () => boolean;
}

/**
 * Shared behavior for every "进入会话" entry: the button stays visible whenever
 * a session is bound, and a blocked click tells the user why (not their
 * session, or the session is unavailable) instead of silently hiding.
 */
export function useEnterSession(
  nodeRun: WorkflowNodeRun | null | undefined,
  runtimeSummary: WorkflowNodeRuntimeSummary | null | undefined,
): EnterSessionAction {
  const { t } = useT("issues");
  const sessionId = resolveEnterSessionId(nodeRun, runtimeSummary);
  const { data: permission, error } = useSessionPermission(sessionId);
  const embedded = isEmbeddedInCostrict();
  const canOpenSession = !!sessionId && permission?.can_observe === true && embedded;
  const showOpenSession = !!sessionId && embedded;

  const openSession = useCallback((): boolean => {
    if (!embedded) return false;
    const reason = getEnterSessionBlockReason(sessionId, permission, error);
    if (reason) {
      toastEnterSessionBlocked(t, reason);
      return false;
    }
    if (!sessionId || !postCostrictNavigateToSession({ sessionId, newTab: true })) {
      toast.error(t(($) => $.execution.detail_panel.open_session_unavailable));
      return false;
    }
    return true;
  }, [embedded, sessionId, permission, error, t]);

  return { sessionId, canOpenSession, showOpenSession, openSession };
}

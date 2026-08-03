"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import type { Issue } from "@multica/core/types";
import { useRuntimeStartDialogs, type RuntimeExtras } from "./use-runtime-start-dialogs";
import { resolveIssueMove, pickRuntimeExtras, type BoardMoveUpdates } from "./use-board-move-issue";

/**
 * Same three move rules as the board (see resolveIssueMove), but for the
 * non-drag status-change entries — the detail StatusPicker and the card
 * actions menu. Those entries already hold the full issue, so there's no
 * findIssue step; pass `commit` (usually `actions.updateField`) and the
 * current issue, and you get back `requestChange` (hand it the desired status
 * updates; it applies the rules, toasts on block, opens the runtime dialog on
 * defer) plus the runtime dialogs node to render near the entry point.
 *
 * This is what makes "change status to in_progress" behave identically
 * whether you drag the card, pick the status on the detail page, or choose it
 * from the card menu.
 */
export function useIssueStatusChange({
  wsId,
  issue,
  commit,
  assignFirstMessage,
}: {
  wsId: string;
  issue: Issue | null;
  commit: (updates: BoardMoveUpdates & Partial<RuntimeExtras>) => void;
  assignFirstMessage: string;
}): {
  requestChange: (updates: BoardMoveUpdates) => boolean;
  runtimeDialogs: ReactNode;
} {
  const { maybeSelectRuntimeThen, dialogs: runtimeDialogs } = useRuntimeStartDialogs(wsId);

  const requestChange = useCallback(
    (updates: BoardMoveUpdates): boolean => {
      const decision = resolveIssueMove(issue, updates);
      if (decision.kind === "block") {
        toast.error(assignFirstMessage);
        return false;
      }
      if (decision.kind === "defer") {
        return maybeSelectRuntimeThen(
          decision.assigneeType,
          decision.assigneeId,
          { updates: decision.updates },
          (p) => commit({ ...p.updates, ...pickRuntimeExtras(p) }),
        );
      }
      commit(decision.updates);
      return true;
    },
    [assignFirstMessage, commit, issue, maybeSelectRuntimeThen],
  );

  return { requestChange, runtimeDialogs };
}

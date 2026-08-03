"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import type { Issue, IssueAssigneeType, UpdateIssueRequest } from "@multica/core/types";
import { useRuntimeStartDialogs, type RuntimeExtras } from "./use-runtime-start-dialogs";

// Re-exported so board consumers can type their commitMove callback without a
// second import from the runtime-dialog hook.
export type { RuntimeExtras };

export type BoardMoveUpdates = Pick<
  UpdateIssueRequest,
  "status" | "assignee_type" | "assignee_id" | "position"
>;

type MoveableIssue = Pick<Issue, "status" | "assignee_type" | "assignee_id">;

export type IssueMoveDecision =
  | { kind: "block" }
  | { kind: "commit"; updates: BoardMoveUpdates }
  | {
      kind: "defer";
      updates: BoardMoveUpdates;
      assigneeType: IssueAssigneeType;
      assigneeId: string;
    };

/**
 * The three board-style move rules, as a PURE decision so every "change an
 * issue's status" entry point — board drag, detail StatusPicker, card actions
 * menu, backlog hint — resolves identically:
 *   1. an unassigned backlog issue cannot leave backlog → block
 *   2. moving back to backlog clears the assignee (folded into the returned
 *      updates)
 *   3. moving to in_progress with an assignee may need a runtime chosen first
 *      → defer (caller runs the runtime dialog, then commits)
 * The caller owns the side effects (toast on block, dialog on defer, commit
 * otherwise). `issue` may be null/undefined (rule 1 and 3 then no-op; rule 2
 * still applies, matching the board's findIssue-missed behavior).
 */
export function resolveIssueMove(
  issue: MoveableIssue | null | undefined,
  updates: BoardMoveUpdates,
): IssueMoveDecision {
  // Rule 1: an unassigned backlog issue cannot leave backlog.
  if (
    issue &&
    issue.status === "backlog" &&
    !issue.assignee_type &&
    !issue.assignee_id &&
    updates.status &&
    updates.status !== "backlog"
  ) {
    return { kind: "block" };
  }
  // Rule 2: moving back to backlog clears the assignee.
  const normalizedUpdates =
    updates.status === "backlog"
      ? { ...updates, assignee_type: null, assignee_id: null }
      : updates;
  // Rule 3: moving to in_progress with an assignee may need a runtime.
  if (
    issue &&
    normalizedUpdates.status === "in_progress" &&
    issue.assignee_type &&
    issue.assignee_id
  ) {
    return {
      kind: "defer",
      updates: normalizedUpdates,
      assigneeType: issue.assignee_type,
      assigneeId: issue.assignee_id,
    };
  }
  return { kind: "commit", updates: normalizedUpdates };
}

/** Drop undefined runtime keys so they don't overwrite the commit payload. */
export function pickRuntimeExtras(
  p: RuntimeExtras,
): Partial<RuntimeExtras> {
  return {
    ...(p.runtime_id !== undefined ? { runtime_id: p.runtime_id } : {}),
    ...(p.runtime_selection_policy !== undefined
      ? { runtime_selection_policy: p.runtime_selection_policy }
      : {}),
  };
}

/**
 * Shared kanban drop rules. Every board entry — workspace Issues, project
 * detail, My Issues — renders the same <BoardView>, so "what happens when a
 * card is dropped" must be identical across them. This hook applies the
 * shared resolveIssueMove rules plus the runtime selection dialog; each board
 * only supplies how to find the dragged issue and how to commit a move.
 *
 * Returns handleMoveIssue (pass straight to <BoardView onMoveIssue>) plus the
 * runtime dialogs node (render once near the board root).
 */
export function useBoardMoveIssue({
  wsId,
  findIssue,
  commitMove,
  assignFirstMessage,
}: {
  wsId: string;
  findIssue: (issueId: string) => Issue | undefined;
  commitMove: (issueId: string, updates: BoardMoveUpdates & Partial<RuntimeExtras>) => void;
  assignFirstMessage: string;
}): {
  handleMoveIssue: (issueId: string, updates: BoardMoveUpdates) => boolean;
  runtimeDialogs: ReactNode;
} {
  const { maybeSelectRuntimeThen, dialogs: runtimeDialogs } = useRuntimeStartDialogs(wsId);

  const handleMoveIssue = useCallback(
    (issueId: string, updates: BoardMoveUpdates): boolean => {
      const issue = findIssue(issueId);
      const decision = resolveIssueMove(issue, updates);
      if (decision.kind === "block") {
        toast.error(assignFirstMessage);
        return false;
      }
      if (decision.kind === "defer") {
        // The dialog commits on confirm; member / non-builtin commits via
        // maybeSelectRuntimeThen directly. Its boolean return propagates so
        // the no-dialog path is never double-committed.
        return maybeSelectRuntimeThen(
          decision.assigneeType,
          decision.assigneeId,
          { issueId, updates: decision.updates },
          (p) => commitMove(p.issueId, { ...p.updates, ...pickRuntimeExtras(p) }),
        );
      }
      commitMove(issueId, decision.updates);
      return true;
    },
    [assignFirstMessage, commitMove, findIssue, maybeSelectRuntimeThen],
  );

  return { handleMoveIssue, runtimeDialogs };
}

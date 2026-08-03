import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Issue } from "@multica/core/types";

// Same isolation approach as use-board-move-issue.test.tsx: the rules live in
// the pure resolveIssueMove (tested separately), so here we only verify the
// hook bridges resolveIssueMove -> commit / dialog correctly.
const scratch = vi.hoisted(() => ({
  deferredCommit: null as ((extras: Record<string, unknown>) => void) | null,
  maybeCalls: [] as Array<{ type: string | null; id: string | null }>,
}));

vi.mock("./use-runtime-start-dialogs", () => ({
  useRuntimeStartDialogs: () => ({
    maybeSelectRuntimeThen: (
      type: string | null,
      id: string | null,
      payload: Record<string, unknown>,
      commit: (p: Record<string, unknown>) => void,
    ) => {
      scratch.maybeCalls.push({ type, id });
      if (type === "workflow" || type === "squad" || type === "agent") {
        scratch.deferredCommit = (extras) => commit({ ...payload, ...extras });
        return false;
      }
      commit(payload);
      return true;
    },
    dialogs: null,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { toast } from "sonner";
import { useIssueStatusChange } from "./use-issue-status-change";
import type { BoardMoveUpdates } from "./use-board-move-issue";

const ASSIGN_FIRST = "Please assign the task first.";

function makeIssue(over: Partial<Issue> & { id: string }): Issue {
  return { status: "todo", assignee_type: null, assignee_id: null, ...over } as Issue;
}

function renderChange({ issue }: { issue: Issue | null }) {
  const commit = vi.fn();
  const result = renderHook(() =>
    useIssueStatusChange({
      wsId: "ws-1",
      issue,
      commit,
      assignFirstMessage: ASSIGN_FIRST,
    }),
  );
  return { ...result, commit };
}

describe("useIssueStatusChange", () => {
  beforeEach(() => {
    scratch.deferredCommit = null;
    scratch.maybeCalls = [];
    vi.mocked(toast.error).mockClear();
  });

  it("blocks an unassigned backlog issue leaving backlog", () => {
    const { result, commit } = renderChange({ issue: makeIssue({ id: "i1", status: "backlog" }) });
    let ret: boolean | undefined;
    act(() => {
      ret = result.current.requestChange({ status: "in_progress" } as BoardMoveUpdates);
    });
    expect(ret).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(ASSIGN_FIRST);
  });

  it("defers a workflow assignee moving to in_progress (dialog commits later)", () => {
    const { result, commit } = renderChange({
      issue: makeIssue({ id: "i1", status: "todo", assignee_type: "workflow", assignee_id: "wf1" }),
    });
    let ret: boolean | undefined;
    act(() => {
      ret = result.current.requestChange({ status: "in_progress" } as BoardMoveUpdates);
    });
    expect(ret).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    act(() => {
      scratch.deferredCommit?.({ runtime_id: "rt1", runtime_selection_policy: "idle_first" });
    });
    expect(commit).toHaveBeenCalledWith({
      status: "in_progress",
      runtime_id: "rt1",
      runtime_selection_policy: "idle_first",
    });
  });

  it("commits directly for a member assignee moving to in_progress", () => {
    const { result, commit } = renderChange({
      issue: makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" }),
    });
    let ret: boolean | undefined;
    act(() => {
      ret = result.current.requestChange({ status: "in_progress" } as BoardMoveUpdates);
    });
    expect(ret).toBe(true);
    expect(commit).toHaveBeenCalledWith({ status: "in_progress" });
  });

  it("clears assignee when moving to backlog", () => {
    const { result, commit } = renderChange({
      issue: makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" }),
    });
    act(() => {
      result.current.requestChange({ status: "backlog" } as BoardMoveUpdates);
    });
    expect(commit).toHaveBeenCalledWith({ status: "backlog", assignee_type: null, assignee_id: null });
  });
});

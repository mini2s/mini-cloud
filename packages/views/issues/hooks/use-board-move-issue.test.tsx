import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Issue } from "@multica/core/types";

// The board-move hook treats useRuntimeStartDialogs as a collaborator: it
// only needs to know whether a start "defers" (opens a dialog, returns false)
// or "commits now" (returns true). Mocking it here keeps the test focused on
// the three board rules; the dialog hook has its own test file. `scratch`
// stashes the deferred commit so a test can fire it like a real confirm.
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
      // workflow / squad / built-in agent defer (open dialog); member commits now.
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
import { useBoardMoveIssue, resolveIssueMove, type BoardMoveUpdates, type RuntimeExtras } from "./use-board-move-issue";

const ASSIGN_FIRST = "Please assign the task first.";

function makeIssue(over: Partial<Issue> & { id: string }): Issue {
  return { status: "todo", assignee_type: null, assignee_id: null, ...over } as Issue;
}

type CommitMove = (issueId: string, updates: BoardMoveUpdates & Partial<RuntimeExtras>) => void;

function renderMove({ issue }: { issue: Issue | undefined }) {
  const findIssue = vi.fn((id: string) => (issue && issue.id === id ? issue : undefined));
  const commit = vi.fn();
  const result = renderHook(() =>
    useBoardMoveIssue({
      wsId: "ws-1",
      findIssue,
      commitMove: commit as CommitMove,
      assignFirstMessage: ASSIGN_FIRST,
    }),
  );
  return { ...result, findIssue, commit };
}

describe("useBoardMoveIssue", () => {
  beforeEach(() => {
    scratch.deferredCommit = null;
    scratch.maybeCalls = [];
    vi.mocked(toast.error).mockClear();
  });

  it("rule 1 — blocks an unassigned backlog issue from leaving backlog", () => {
    const issue = makeIssue({ id: "i1", status: "backlog", assignee_type: null, assignee_id: null });
    const { result, commit } = renderMove({ issue });

    let ret: boolean | undefined;
    act(() => {
      ret = result.current.handleMoveIssue("i1", { status: "in_progress" } as BoardMoveUpdates);
    });

    expect(ret).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(ASSIGN_FIRST);
  });

  it("rule 1 — lets a backlog issue with an assignee leave backlog", () => {
    const issue = makeIssue({ id: "i1", status: "backlog", assignee_type: "member", assignee_id: "m1" });
    const { result, commit } = renderMove({ issue });

    let ret: boolean | undefined;
    act(() => {
      ret = result.current.handleMoveIssue("i1", { status: "todo" } as BoardMoveUpdates);
    });

    expect(ret).toBe(true);
    // Moving to todo preserves the assignee (rule 2 only nulls on a backlog drop).
    expect(commit).toHaveBeenCalledWith("i1", { status: "todo" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("rule 2 — clears assignee when moving back to backlog", () => {
    const issue = makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" });
    const { result, commit } = renderMove({ issue });

    act(() => {
      result.current.handleMoveIssue("i1", { status: "backlog" } as BoardMoveUpdates);
    });

    expect(commit).toHaveBeenCalledWith("i1", {
      status: "backlog",
      assignee_type: null,
      assignee_id: null,
    });
  });

  it("rule 3 — defers a workflow assignee moving to in_progress (dialog commits later)", () => {
    const issue = makeIssue({ id: "i1", status: "todo", assignee_type: "workflow", assignee_id: "wf1" });
    const { result, commit } = renderMove({ issue });

    let ret: boolean | undefined;
    act(() => {
      ret = result.current.handleMoveIssue("i1", { status: "in_progress" } as BoardMoveUpdates);
    });

    // deferred: no commit yet, returns false so BoardView rolls back the drop.
    expect(ret).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(scratch.maybeCalls).toHaveLength(1);

    // simulate the runtime dialog confirming with a chosen runtime + policy
    act(() => {
      scratch.deferredCommit?.({ runtime_id: "rt1", runtime_selection_policy: "idle_first" });
    });

    expect(commit).toHaveBeenCalledWith(
      "i1",
      expect.objectContaining({
        status: "in_progress",
        runtime_id: "rt1",
        runtime_selection_policy: "idle_first",
      }),
    );
  });

  it("rule 3 — commits directly for a member assignee moving to in_progress (no dialog)", () => {
    const issue = makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" });
    const { result, commit } = renderMove({ issue });

    let ret: boolean | undefined;
    act(() => {
      ret = result.current.handleMoveIssue("i1", { status: "in_progress" } as BoardMoveUpdates);
    });

    expect(ret).toBe(true);
    expect(commit).toHaveBeenCalledWith("i1", { status: "in_progress" });
    expect(scratch.maybeCalls).toHaveLength(1);
  });

  it("plain status move does not consult the runtime dialog", () => {
    const issue = makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" });
    const { result, commit } = renderMove({ issue });

    let ret: boolean | undefined;
    act(() => {
      ret = result.current.handleMoveIssue("i1", { status: "in_review" } as BoardMoveUpdates);
    });

    expect(ret).toBe(true);
    expect(commit).toHaveBeenCalledWith("i1", { status: "in_review" });
    expect(scratch.maybeCalls).toHaveLength(0);
  });
});

describe("resolveIssueMove (pure rules)", () => {
  it("rule 1 — blocks an unassigned backlog issue from leaving backlog", () => {
    expect(
      resolveIssueMove(makeIssue({ id: "i1", status: "backlog" }), { status: "in_progress" } as BoardMoveUpdates),
    ).toEqual({ kind: "block" });
  });

  it("rule 1 — a backlog issue WITH an assignee may leave", () => {
    expect(
      resolveIssueMove(
        makeIssue({ id: "i1", status: "backlog", assignee_type: "member", assignee_id: "m1" }),
        { status: "todo" } as BoardMoveUpdates,
      ).kind,
    ).toBe("commit");
  });

  it("rule 1 — backlog→backlog is not a leave (no block)", () => {
    expect(
      resolveIssueMove(makeIssue({ id: "i1", status: "backlog" }), { status: "backlog" } as BoardMoveUpdates).kind,
    ).toBe("commit");
  });

  it("rule 2 — clears assignee when moving to backlog", () => {
    expect(
      resolveIssueMove(
        makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" }),
        { status: "backlog" } as BoardMoveUpdates,
      ),
    ).toEqual({ kind: "commit", updates: { status: "backlog", assignee_type: null, assignee_id: null } });
  });

  it("rule 3 — defers a workflow assignee moving to in_progress", () => {
    expect(
      resolveIssueMove(
        makeIssue({ id: "i1", status: "todo", assignee_type: "workflow", assignee_id: "wf1" }),
        { status: "in_progress" } as BoardMoveUpdates,
      ),
    ).toEqual({ kind: "defer", updates: { status: "in_progress" }, assigneeType: "workflow", assigneeId: "wf1" });
  });

  it("rule 3 — commits directly when moving to in_progress without an assignee", () => {
    expect(
      resolveIssueMove(makeIssue({ id: "i1", status: "todo" }), { status: "in_progress" } as BoardMoveUpdates).kind,
    ).toBe("commit");
  });

  it("plain status move commits with unchanged updates", () => {
    expect(
      resolveIssueMove(
        makeIssue({ id: "i1", status: "todo", assignee_type: "member", assignee_id: "m1" }),
        { status: "in_review" } as BoardMoveUpdates,
      ),
    ).toEqual({ kind: "commit", updates: { status: "in_review" } });
  });

  it("null issue — still clears assignee on backlog, never blocks/defers", () => {
    expect(resolveIssueMove(null, { status: "backlog" } as BoardMoveUpdates)).toEqual({
      kind: "commit",
      updates: { status: "backlog", assignee_type: null, assignee_id: null },
    });
    expect(resolveIssueMove(null, { status: "in_progress" } as BoardMoveUpdates).kind).toBe("commit");
  });
});

import { describe, expect, it } from "vitest";
import { resolveEnterSessionId } from "./runtime-session";
import type { WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

const nodeRun = {
  session_id: "csc-session",
  split_review_chat_session_id: "split-chat",
} as WorkflowNodeRun;

const summary = {
  session_id: "summary-session",
} as WorkflowNodeRuntimeSummary;

describe("resolveEnterSessionId", () => {
  it("prefers the CSC session bound to the node run", () => {
    expect(resolveEnterSessionId(nodeRun, summary)).toBe("csc-session");
  });

  it("falls back to the CSC session in the runtime summary", () => {
    expect(resolveEnterSessionId({ ...nodeRun, session_id: null }, summary)).toBe("summary-session");
  });

  it("never treats the Multica split-review chat id as a CSC session id", () => {
    expect(resolveEnterSessionId(
      { ...nodeRun, session_id: null },
      { ...summary, session_id: null },
    )).toBeNull();
  });
});

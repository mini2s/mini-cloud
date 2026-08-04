import { describe, expect, it } from "vitest";
import { ApiError } from "@multica/core/api";
import { getEnterSessionBlockReason, resolveEnterSessionId } from "./runtime-session";
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

describe("getEnterSessionBlockReason", () => {
  it("reports no_session when the node has no bound session", () => {
    expect(getEnterSessionBlockReason(null, undefined, null)).toBe("no_session");
  });

  it("reports denied when the permission check was rejected with 403", () => {
    const error = new ApiError("forbidden", 403, "Forbidden");
    expect(getEnterSessionBlockReason("s", undefined, error)).toBe("denied");
  });

  it("reports unavailable when the permission check failed for other reasons", () => {
    const error = new ApiError("boom", 500, "Internal Server Error");
    expect(getEnterSessionBlockReason("s", undefined, error)).toBe("unavailable");
    expect(getEnterSessionBlockReason("s", undefined, new Error("network"))).toBe("unavailable");
  });

  it("reports pending while the permission check is in flight", () => {
    expect(getEnterSessionBlockReason("s", undefined, null)).toBe("pending");
  });

  it("reports denied when the loaded permission forbids observing", () => {
    expect(getEnterSessionBlockReason("s", { can_observe: false }, null)).toBe("denied");
  });

  it("returns null when the session may be opened", () => {
    expect(getEnterSessionBlockReason("s", { can_observe: true }, null)).toBeNull();
  });
});

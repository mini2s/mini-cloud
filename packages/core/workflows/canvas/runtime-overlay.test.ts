import { describe, expect, it } from "vitest";
import { getRuntimeNodePresentation } from "./runtime-overlay";
import type { RuntimeNodeOverlay } from "./types";

function overlay(status: RuntimeNodeOverlay["status"]): RuntimeNodeOverlay {
  return {
    nodeRunId: "node-run-1",
    workflowRunId: "run-1",
    status,
    retryCount: 0,
    workerOutput: null,
    criticOutput: null,
    criticComment: "",
    startedAt: null,
    completedAt: null,
    sessionId: null,
    runtimeId: null,
    deviceId: null,
  };
}

describe("getRuntimeNodePresentation", () => {
  it("marks working nodes as active and non-actionable", () => {
    expect(getRuntimeNodePresentation(overlay("working"))).toEqual({
      tone: "active",
      label: "working",
      isRunning: true,
      isAwaitingInput: false,
      actions: [],
    });
  });

  it("exposes review actions for awaiting critic nodes", () => {
    expect(getRuntimeNodePresentation(overlay("awaiting_critic")).actions).toEqual(["approve", "reject", "skip"]);
  });

  it("exposes recovery actions for blocked nodes", () => {
    expect(getRuntimeNodePresentation(overlay("blocked")).actions).toEqual(["takeover", "handback", "complete", "skip"]);
  });
});

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { getRuntimeNodePresentation } from "@multica/core/workflows/canvas";

describe("workflow runtime canvas adapter", () => {
  it("maps awaiting critic state to review actions", () => {
    const presentation = getRuntimeNodePresentation({
      nodeRunId: "nr1",
      workflowRunId: "run1",
      status: "awaiting_critic",
      retryCount: 0,
      workerOutput: null,
      criticOutput: null,
      criticComment: "",
      startedAt: null,
      completedAt: null,
      sessionId: null,
      runtimeId: null,
      deviceId: null,
    });

    expect(presentation.actions).toEqual(["approve", "reject", "skip"]);
  });
});

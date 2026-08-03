import type { OpenCodePart } from "@multica/core/conversations";
import { describe, expect, it } from "vitest";
import { projectToolPart } from "./project-tool-part";

function toolPart(
  state: Record<string, unknown>,
  overrides: Partial<OpenCodePart> = {},
): OpenCodePart {
  return {
    id: "part-1",
    type: "tool",
    tool: "bash",
    callID: "call-1",
    state,
    ...overrides,
  };
}

describe("projectToolPart", () => {
  it("uses call ID first and part ID as the stable fallback", () => {
    expect(
      projectToolPart(toolPart({ status: "pending" })),
    ).toMatchObject({ type: "tool-call", toolCallId: "call-1" });
    expect(
      projectToolPart(
        toolPart(
          { status: "pending" },
          { callID: undefined, id: "part-fallback" },
        ),
      ),
    ).toMatchObject({ type: "tool-call", toolCallId: "part-fallback" });
  });

  it("downgrades a tool with no protocol identity to a data part", () => {
    expect(
      projectToolPart(
        toolPart({ status: "pending" }, { callID: undefined, id: undefined }),
      ),
    ).toMatchObject({
      type: "data",
      name: "opencode-unsupported-part",
      data: { type: "tool" },
    });
  });

  it("keeps partial pending input in argsText without inventing args", () => {
    expect(
      projectToolPart(
        toolPart({
          status: "pending",
          input: { command: "pwd" },
          raw: '{"command":"p',
        }),
      ),
    ).toMatchObject({
      args: { command: "pwd" },
      argsText: '{"command":"p',
    });
    expect(
      projectToolPart(
        toolPart({ status: "pending", input: '{"command":"p' }),
      ),
    ).toMatchObject({
      args: {},
      argsText: '{"command":"p',
    });
  });

  it("only exposes result for terminal provider states", () => {
    expect(
      projectToolPart(toolPart({ status: "running", output: "early" })),
    ).not.toHaveProperty("result");
    expect(
      projectToolPart(toolPart({ status: "completed", output: "done" })),
    ).toMatchObject({ result: "done" });
    expect(
      projectToolPart(toolPart({ status: "error", error: "failed" })),
    ).toMatchObject({ result: "failed", isError: true });
  });

  it.each(["", 0, false, null])(
    "preserves completed falsy result %j",
    (result) => {
      const projected = projectToolPart(
        toolPart({ status: "completed", output: result }),
      );
      expect(projected).toHaveProperty("result", result);
    },
  );
});

import { describe, expect, it } from "vitest";
import { parseBashResult } from "./tool-ui-bash";

describe("parseBashResult", () => {
  it("keeps plain command output intact", () => {
    expect(parseBashResult("first\nsecond")).toEqual({
      stdout: "first\nsecond",
      stderr: "",
      rawOutput: "",
    });
  });

  it("unwraps a JSON-encoded result and exit code", () => {
    expect(
      parseBashResult(
        JSON.stringify({
          output: {
            stdout: "done",
            stderr: "warning",
            exit_code: 2,
          },
        }),
      ),
    ).toEqual({
      stdout: "done",
      stderr: "warning",
      rawOutput: "",
      exitCode: 2,
    });
  });

  it("preserves unknown structured output as readable JSON", () => {
    const parsed = parseBashResult({ output: { elapsed: 10 } });

    expect(parsed.stdout).toBe("");
    expect(parsed.stderr).toBe("");
    expect(parsed.rawOutput).toContain('"elapsed": 10');
  });
});

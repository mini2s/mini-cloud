import { describe, expect, it } from "vitest";
import { normalizeConversationFileDiff } from "./tool-diff";

describe("normalizeConversationFileDiff", () => {
  it("uses live SSE filediff metadata with camelCase input", () => {
    const diff = normalizeConversationFileDiff({
      args: {
        filePath: "/workspace/src/runtime.ts",
        oldString: "const value = 1;",
        newString: "const value = 2;",
      },
      providerMetadata: {
        filediff: {
          file: "/workspace/src/runtime.ts",
          before: "const value = 1;",
          after: "const value = 2;",
          additions: 1,
          deletions: 1,
        },
      },
    });

    expect(diff).toMatchObject({
      file: "/workspace/src/runtime.ts",
      additions: 1,
      deletions: 1,
      status: "modified",
    });
    expect(diff?.patch).toContain(
      "diff --git a/workspace/src/runtime.ts b/workspace/src/runtime.ts",
    );
    expect(diff?.patch).toContain("-const value = 1;");
    expect(diff?.patch).toContain("+const value = 2;");
  });

  it("normalizes snake_case history input and detects a created file", () => {
    const diff = normalizeConversationFileDiff({
      args: {
        file_path: "PROTOCOL_CAPTURE.md",
        content: "Fixture content",
      },
    });

    expect(diff).toMatchObject({
      file: "PROTOCOL_CAPTURE.md",
      additions: 1,
      deletions: 0,
      status: "added",
    });
    expect(diff?.patch).toContain("new file mode 100644");
    expect(diff?.patch).toContain("--- /dev/null");
    expect(diff?.patch).toContain("+Fixture content");
  });

  it("prefers an explicit provider patch over generated input diff", () => {
    const explicitPatch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    const diff = normalizeConversationFileDiff({
      args: {
        file_path: "a.ts",
        old_string: "ignored old",
        new_string: "ignored new",
      },
      providerMetadata: {
        filediff: {
          path: "a.ts",
          patch: explicitPatch,
        },
      },
    });

    expect(diff?.patch).toBe(explicitPatch);
  });
});

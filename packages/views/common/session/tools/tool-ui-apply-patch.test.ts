import { describe, expect, it } from "vitest";
import { normalizeApplyPatch } from "./tool-ui-apply-patch";

describe("normalizeApplyPatch", () => {
  it("preserves an existing unified diff", () => {
    const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts";
    expect(normalizeApplyPatch(patch)).toBe(patch);
  });

  it("converts apply_patch update and add blocks to unified diffs", () => {
    const normalized = normalizeApplyPatch(`
*** Begin Patch
*** Update File: src/a.ts
@@
-const value = 1;
+const value = 2;
*** Add File: src/b.ts
+export {};
*** End Patch
`);

    expect(normalized).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(normalized).toContain("-const value = 1;");
    expect(normalized).toContain("+const value = 2;");
    expect(normalized).toContain("diff --git a/src/b.ts b/src/b.ts");
    expect(normalized).toContain("new file mode 100644");
    expect(normalized).toContain("@@ -0,0 +1,1 @@");
    expect(normalized).toContain("+export {};");
  });

  it("returns an empty string for an empty patch", () => {
    expect(normalizeApplyPatch("  ")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import enIssues from "../locales/en/issues.json";
import zhHansIssues from "../locales/zh-Hans/issues.json";

describe("Runtime duration translations", () => {
  it("provides accessible duration labels in supported locales", () => {
    expect(enIssues.execution.card.duration_label).toBe("Duration {{duration}}");
    expect(zhHansIssues.execution.card.duration_label).toBe("耗时 {{duration}}");
  });
});

import { describe, expect, it } from "vitest";
import enIssues from "../locales/en/issues.json";
import enWorkflows from "../locales/en/workflows.json";
import zhHansIssues from "../locales/zh-Hans/issues.json";
import zhHansWorkflows from "../locales/zh-Hans/workflows.json";

describe("Split node badge translations", () => {
  it("keeps the node type label in English across supported locales", () => {
    expect(enWorkflows.panorama.card.split_badge).toBe("Split");
    expect(zhHansWorkflows.panorama.card.split_badge).toBe("Split");
    expect(enIssues.execution.card.split_badge).toBe("Split");
    expect(zhHansIssues.execution.card.split_badge).toBe("Split");
  });
});

import { describe, expect, it } from "vitest";
import { resolveToolStatus } from "./tool-ui-shared";

describe("resolveToolStatus", () => {
  it("keeps pending interactions actionable when the provider part is completed", () => {
    expect(
      resolveToolStatus({
        status: { type: "requires-action" },
        providerStatus: "completed",
        hasInteraction: true,
      }),
    ).toBe("requires-action");
  });

  it("only classifies explicitly cancelled incomplete states as cancelled", () => {
    expect(
      resolveToolStatus({
        status: { type: "incomplete", reason: "cancelled" },
      }),
    ).toBe("cancelled");
    expect(
      resolveToolStatus({
        status: { type: "incomplete", reason: "error" },
      }),
    ).toBe("error");
  });
});

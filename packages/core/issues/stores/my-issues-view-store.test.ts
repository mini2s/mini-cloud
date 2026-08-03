import { describe, expect, it } from "vitest";
import { myIssuesViewStore } from "./my-issues-view-store";

describe("myIssuesViewStore", () => {
  it("defaults to the responsible scope", () => {
    expect(myIssuesViewStore.getState().scope).toBe("responsible");
  });
});

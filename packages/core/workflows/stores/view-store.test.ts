// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { useWorkflowViewStore } from "./view-store";

describe("useWorkflowViewStore", () => {
  it("defaults to swimlane view mode", () => {
    const { viewMode } = useWorkflowViewStore.getState();
    expect(viewMode).toBe("swimlane");
  });

  it("setViewMode switches to editor", () => {
    useWorkflowViewStore.getState().setViewMode("editor");
    expect(useWorkflowViewStore.getState().viewMode).toBe("editor");
  });

  it("setViewMode switches to swimlane", () => {
    useWorkflowViewStore.getState().setViewMode("editor");
    useWorkflowViewStore.getState().setViewMode("swimlane");
    expect(useWorkflowViewStore.getState().viewMode).toBe("swimlane");
  });
});

import { describe, expect, it } from "vitest";
import { splitTasksOptions, workflowKeys } from "./queries";

describe("workflow split query keys", () => {
  it("scopes split task query keys by workspace and node run", () => {
    expect(workflowKeys.splitTasks("ws-1", "node-run-1")).toEqual([
      "workflows",
      "ws-1",
      "node-runs",
      "node-run-1",
      "split-tasks",
    ]);
    expect(splitTasksOptions("ws-1", "node-run-1").queryKey).toEqual([
      "workflows",
      "ws-1",
      "node-runs",
      "node-run-1",
      "split-tasks",
    ]);
  });
});

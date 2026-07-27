import { describe, expect, it, vi } from "vitest";
import type { Workflow } from "../types";
import {
  splitTasksOptions,
  workflowActiveListOptions,
  workflowKeys,
  workflowListOptions,
} from "./queries";

const { listWorkflows } = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
}));

vi.mock("../api", () => ({
  api: { listWorkflows },
}));

const activeInstance = {
  id: "workflow-1",
  status: "active",
  is_template: false,
} as Workflow;

const activeTemplate = {
  id: "template-1",
  status: "active",
  is_template: true,
} as Workflow;

const draftInstance = {
  id: "workflow-2",
  status: "draft",
  is_template: false,
} as Workflow;

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

describe("workflow runnable list queries", () => {
  it("requests workflow instances explicitly", async () => {
    listWorkflows.mockResolvedValue({ workflows: [], total: 0 });
    const queryFn = workflowListOptions("ws-1").queryFn;
    if (typeof queryFn !== "function") throw new Error("queryFn is not callable");

    await queryFn({} as never);

    expect(listWorkflows).toHaveBeenCalledWith("ws-1", false);
  });

  it("returns only active non-template workflows", () => {
    const select = workflowActiveListOptions("ws-1").select;
    if (!select) throw new Error("select is not defined");

    expect(select({
      workflows: [activeInstance, activeTemplate, draftInstance],
      total: 3,
    })).toEqual([activeInstance]);
  });
});

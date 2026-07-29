// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Workflow, WorkflowNodeRun, WorkflowRun } from "../types";
import {
  splitTasksOptions,
  workflowActiveListOptions,
  workflowKeys,
  workflowListOptions,
  workflowRunCanvasDefinition,
  useBatchPatchSplitTaskAssignees,
  usePatchSplitTaskAssignee,
} from "./queries";

const { batchPatchSplitTaskAssignees, listWorkflows, patchSplitTaskAssignee } = vi.hoisted(() => ({
  batchPatchSplitTaskAssignees: vi.fn(),
  listWorkflows: vi.fn(),
  patchSplitTaskAssignee: vi.fn(),
}));

vi.mock("../api", () => ({
  api: { batchPatchSplitTaskAssignees, listWorkflows, patchSplitTaskAssignee },
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

  it("patches a split assignee and refreshes the scoped cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const response = {
      tasks: [{ id: "task-1", node_run_id: "node-run-1", version: 2, assignee_type: "agent", assignee_id: "agent-1" }],
      progress: { total: 1, created: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 },
    };
    patchSplitTaskAssignee.mockResolvedValue(response);
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => usePatchSplitTaskAssignee("ws-1"), { wrapper });
    const request = { assignee_type: "agent" as const, assignee_id: "agent-1", expected_version: 1 };

    await act(async () => {
      await result.current.mutateAsync({ nodeRunId: "node-run-1", taskId: "task-1", request });
    });

    expect(patchSplitTaskAssignee).toHaveBeenCalledWith("node-run-1", "task-1", request);
    expect(queryClient.getQueryData(workflowKeys.splitTasks("ws-1", "node-run-1"))).toEqual(response);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workflowKeys.splitTasks("ws-1", "node-run-1") });
  });

  it("patches selected split assignees in one request and refreshes the scoped cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const response = {
      tasks: [
        { id: "task-1", node_run_id: "node-run-1", version: 2, assignee_type: "member", assignee_id: "member-1" },
        { id: "task-2", node_run_id: "node-run-1", version: 4, assignee_type: "member", assignee_id: "member-1" },
      ],
      progress: { total: 2, created: 0, running: 0, done: 0, failed: 0, cancelled: 0, skipped: 0 },
    };
    batchPatchSplitTaskAssignees.mockResolvedValue(response);
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useBatchPatchSplitTaskAssignees("ws-1"), { wrapper });
    const request = {
      assignee_type: "member" as const,
      assignee_id: "member-1",
      tasks: [
        { task_id: "task-1", expected_version: 1 },
        { task_id: "task-2", expected_version: 3 },
      ],
    };

    await act(async () => {
      await result.current.mutateAsync({ nodeRunId: "node-run-1", request });
    });

    expect(batchPatchSplitTaskAssignees).toHaveBeenCalledWith("node-run-1", request);
    expect(queryClient.getQueryData(workflowKeys.splitTasks("ws-1", "node-run-1"))).toEqual(response);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workflowKeys.splitTasks("ws-1", "node-run-1") });
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

describe("workflow run canvas definition", () => {
  const nodeRuns = [{
    workflow_node_id: "runtime-node",
    source_workflow_node_id: "source-node",
    node_title: "Captured title",
    node_description: "Captured description",
    worker_type: "agent",
    worker_id: null,
    critic_type: "human",
    critic_id: null,
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
  }] as WorkflowNodeRun[];

  it("builds a native run canvas only from its definition snapshot", () => {
    const run = {
      workflow_id: "workflow-1",
      definition_snapshot: {
        schema_version: 1,
        snapshot_origin: "native",
        workflow: { id: "workflow-1", workspace_id: "workspace-1", title: "Workflow" },
        nodes: [
          { id: "snapshot-node", title: "Snapshot node", description: "", position_x: 0, position_y: 0, sort_order: 0, kind: "task", worker_type: "agent", critic_type: "human" },
          { id: "snapshot-end", title: "End", description: "", position_x: 240, position_y: 0, sort_order: 1, kind: "end", worker_type: "human", critic_type: "human" },
        ],
        edges: [{ id: "edge-1", source_node_id: "snapshot-node", target_node_id: "snapshot-end" }],
        stages: [],
        roles: [],
        deliverables: [],
      },
    } as unknown as WorkflowRun;

    const canvas = workflowRunCanvasDefinition(run, nodeRuns, "Workflow node");

    expect(canvas.nodes.map((node) => node.id)).toEqual(["snapshot-node", "snapshot-end"]);
    expect(canvas.edges[0]).toMatchObject({
      source_node_id: "snapshot-node",
      target_node_id: "snapshot-end",
    });
  });

  it("falls back to generic node-run cards for a legacy run without a snapshot", () => {
    const run = { workflow_id: "workflow-1", definition_snapshot: null } as unknown as WorkflowRun;

    const canvas = workflowRunCanvasDefinition(run, nodeRuns, "Workflow node");

    expect(canvas.nodes[0]).toMatchObject({ id: "source-node", title: "Captured title" });
    expect(canvas.edges).toEqual([]);
  });
});

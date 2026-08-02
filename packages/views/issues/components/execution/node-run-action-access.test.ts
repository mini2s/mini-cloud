import { describe, expect, it } from "vitest";
import type { WorkflowNodeRun } from "@multica/core/types";
import {
  getHumanNodeRunActionAccess,
  isEditableWorkflowNodeRunStatus,
  isSkippableNodeRunStatus,
} from "./node-run-action-access";

const run = {
  id: "run-1",
  status: "worker_assigned",
  worker_type: "human",
  worker_id: "user-1",
  critic_type: "human",
  critic_id: "user-2",
} as WorkflowNodeRun;

describe("getHumanNodeRunActionAccess", () => {
  it.each([
    ["assigned worker", "user-1", "member", "worker_assigned", true, false],
    ["other member", "user-3", "member", "worker_assigned", false, false],
    ["owner override", "owner-1", "owner", "worker_assigned", true, false],
    ["assigned critic", "user-2", "member", "critic_reviewing", false, true],
    ["admin critic override", "admin-1", "admin", "awaiting_critic", false, true],
  ] as const)("resolves %s", (_name, userId, role, status, canSubmit, canReview) => {
    expect(getHumanNodeRunActionAccess({
      nodeRun: { ...run, status } as WorkflowNodeRun,
      userId,
      member: { role, status: "active" },
    })).toMatchObject({ canSubmit, canReview });
  });

  it("allows an active member to act on an unassigned human worker slot", () => {
    expect(getHumanNodeRunActionAccess({
      nodeRun: { ...run, worker_id: null },
      userId: "user-3",
      member: { role: "member", status: "active" },
    }).canSubmit).toBe(true);
  });

  it("denies inactive and unauthenticated users", () => {
    expect(getHumanNodeRunActionAccess({
      nodeRun: run,
      userId: null,
      member: null,
    })).toEqual({
      canSubmit: false,
      canReview: false,
      canSkip: false,
      isAdminOverride: false,
    });
  });
});

it.each(["pending", "format_ok", "worker_assigned", "awaiting_input", "awaiting_critic", "blocked"])(
  "marks %s as skippable",
  (status) => expect(isSkippableNodeRunStatus(status as WorkflowNodeRun["status"])).toBe(true),
);

it.each(["working", "critic_reviewing", "failed", "format_failed", "completed", "cancelled"])(
  "marks %s as not skippable",
  (status) => expect(isSkippableNodeRunStatus(status as WorkflowNodeRun["status"])).toBe(false),
);

it.each(["pending", "failed", "format_failed", "blocked"])(
  "allows editing node config while %s",
  (status) => expect(isEditableWorkflowNodeRunStatus(status as WorkflowNodeRun["status"])).toBe(true),
);

it.each(["worker_assigned", "working", "awaiting_input", "awaiting_critic", "critic_reviewing", "completed"])(
  "prevents editing node config while %s",
  (status) => expect(isEditableWorkflowNodeRunStatus(status as WorkflowNodeRun["status"])).toBe(false),
);

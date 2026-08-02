import type { MemberRole, WorkflowNodeRun } from "@multica/core/types";
export { isEditableWorkflowNodeRunStatus } from "@multica/core/workflows/node-run-status";

export interface HumanActionMember {
  role: MemberRole;
  status?: "active" | "inactive";
}

export interface HumanNodeRunActionAccess {
  canSubmit: boolean;
  canReview: boolean;
  canSkip: boolean;
  isAdminOverride: boolean;
}

const SKIPPABLE_STATUSES = new Set<WorkflowNodeRun["status"]>([
  "pending",
  "format_ok",
  "worker_assigned",
  "awaiting_input",
  "awaiting_critic",
  "blocked",
]);

export function isSkippableNodeRunStatus(status: WorkflowNodeRun["status"]): boolean {
  return SKIPPABLE_STATUSES.has(status);
}

export function getHumanNodeRunActionAccess({
  nodeRun,
  userId,
  member,
}: {
  nodeRun: WorkflowNodeRun;
  userId: string | null;
  member: HumanActionMember | null;
}): HumanNodeRunActionAccess {
  const active = userId !== null && member !== null && member.status !== "inactive";
  const isAdminOverride = active && (member.role === "owner" || member.role === "admin");
  const workerAllowed = active && (
    nodeRun.worker_id == null || nodeRun.worker_id === userId || isAdminOverride
  );
  const criticAllowed = active && (
    nodeRun.critic_id == null || nodeRun.critic_id === userId || isAdminOverride
  );
  const canSubmit = nodeRun.worker_type === "human" &&
    (nodeRun.status === "worker_assigned" || nodeRun.status === "working") &&
    workerAllowed;
  const canReview = nodeRun.critic_type === "human" &&
    (nodeRun.status === "awaiting_critic" || nodeRun.status === "critic_reviewing") &&
    criticAllowed;
  const activeActorAllowed = nodeRun.status === "awaiting_critic"
    ? criticAllowed
    : nodeRun.status === "worker_assigned" ||
        nodeRun.status === "awaiting_input" ||
        nodeRun.status === "blocked"
      ? workerAllowed
      : isAdminOverride;

  return {
    canSubmit,
    canReview,
    canSkip: isSkippableNodeRunStatus(nodeRun.status) && activeActorAllowed,
    isAdminOverride,
  };
}

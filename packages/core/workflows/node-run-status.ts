import type { NodeRunStatus, WorkflowNodeRun } from "../types";

// Status windows before which a node run's worker/critic can be patched in
// place. Mirrors the backend SetWorkflowNodeRunResolvedWorker/Critic WHERE
// clause so the editor can't race the state machine.
const WORKER_ASSIGNABLE_NODE_RUN_STATUSES = new Set<NodeRunStatus>([
  "blocked",
  "pending",
  "format_checking",
  "format_ok",
]);
const CRITIC_ASSIGNABLE_NODE_RUN_STATUSES = new Set<NodeRunStatus>([
  "blocked",
  "pending",
  "format_checking",
  "format_ok",
  "worker_assigned",
  "working",
  "awaiting_input",
  "awaiting_critic",
]);

// isNodeRunAssigneeEditable reports whether the node run's worker (or critic)
// can be edited on the card. A role is editable until the node has progressed
// past the point where that role starts executing.
export function isNodeRunAssigneeEditable(
  status: WorkflowNodeRun["status"] | undefined,
  role: "worker" | "critic",
): boolean {
  if (status == null) return false;
  return (role === "worker"
    ? WORKER_ASSIGNABLE_NODE_RUN_STATUSES
    : CRITIC_ASSIGNABLE_NODE_RUN_STATUSES
  ).has(status);
}

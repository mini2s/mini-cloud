import type { WorkflowNodeRun } from "../types";

const EDITABLE_NODE_CONFIG_STATUSES = new Set<WorkflowNodeRun["status"]>([
  "pending",
  "failed",
  "format_failed",
  "blocked",
]);

export function isEditableWorkflowNodeRunStatus(status: WorkflowNodeRun["status"] | undefined): boolean {
  return status == null || EDITABLE_NODE_CONFIG_STATUSES.has(status);
}

import type { Issue } from "../types";

const WORKFLOW_ORIGIN_TYPES = new Set(["workflow", "workflow_split"]);

export function isWorkflowOriginIssue(issue: Pick<Issue, "origin_type">) {
  return issue.origin_type ? WORKFLOW_ORIGIN_TYPES.has(issue.origin_type) : false;
}

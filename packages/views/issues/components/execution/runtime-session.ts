import type { WorkflowNodeRun, WorkflowNodeRuntimeSummary } from "@multica/core/types";

/** Resolve the session id used by the shared "进入会话" entry for a node. */
export function resolveEnterSessionId(
  nodeRun: WorkflowNodeRun | null | undefined,
  runtimeSummary: WorkflowNodeRuntimeSummary | null | undefined,
): string | null {
  return nodeRun?.session_id ?? runtimeSummary?.session_id ?? null;
}

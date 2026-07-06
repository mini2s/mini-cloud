"use client";

import { WorkflowDetailPage } from "./workflow-detail-page";

export interface WorkflowDetailShellProps {
  workflowId: string;
}

/**
 * Renders the workflow detail editor as a single-view ReactFlow DAG canvas.
 *
 * The view/edit toggle is handled internally by WorkflowDetailPage via
 * useWorkflowEditorStore.mode — there is no separate panorama/editor page switch.
 */
export function WorkflowDetailShell({ workflowId }: WorkflowDetailShellProps) {
  return <WorkflowDetailPage workflowId={workflowId} />;
}

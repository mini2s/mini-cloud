"use client";

import { WorkflowPanoramaPage } from "./overview/workflow-panorama-page";

export interface WorkflowDetailShellProps {
  workflowId: string;
}

/** Renders the unified panorama-editor view (single view, no toggle). */
export function WorkflowDetailShell({ workflowId }: WorkflowDetailShellProps) {
  return <WorkflowPanoramaPage workflowId={workflowId} />;
}

"use client";

import { use } from "react";
import { WorkflowRunDiagnosticsPage } from "@multica/views/workflows/diagnostics";

export default function Page({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = use(params);
  return <WorkflowRunDiagnosticsPage workflowId={id} runId={runId} />;
}

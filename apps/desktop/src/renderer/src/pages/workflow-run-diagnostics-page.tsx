import { useParams } from "react-router-dom";
import { WorkflowRunDiagnosticsPage } from "@multica/views/workflows/diagnostics";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function WorkflowRunDiagnostics() {
  const { id, runId } = useParams<{ id: string; runId: string }>();

  useDocumentTitle("Workflow Run Diagnostics");

  if (!id || !runId) return null;
  return <WorkflowRunDiagnosticsPage workflowId={id} runId={runId} />;
}

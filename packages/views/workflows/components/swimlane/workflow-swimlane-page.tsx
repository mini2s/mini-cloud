"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowDetailOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
} from "@multica/core/workflows/queries";
import { useNavigation } from "../../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { PageHeader } from "../../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { useT } from "../../../i18n";
import { SwimlaneCanvas } from "./swimlane-canvas";
import { NodeDetailPanel } from "../overview/node-detail-panel";
import { computeSwimlaneLayout } from "./swimlane-layout";
import type { ReactNode } from "react";

export interface WorkflowSwimlanePageProps {
  workflowId: string;
  viewToggle?: ReactNode;
}

export function WorkflowSwimlanePage({ workflowId, viewToggle }: WorkflowSwimlanePageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Data fetching — shared cache keys with overview & editor
  const {
    data: workflow,
    isLoading: workflowLoading,
    isError: workflowError,
    refetch: workflowRefetch,
  } = useQuery(workflowDetailOptions(wsId, workflowId));

  const { data: stages = [], isLoading: stagesLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );

  const { data: nodes = [], isLoading: nodesLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );

  const { data: edges = [] } = useQuery(
    workflowEdgesOptions(wsId, workflowId),
  );

  const isLoading = workflowLoading || stagesLoading || nodesLoading;

  // Compute layout
  const layout = useMemo(
    () => computeSwimlaneLayout(nodes, edges, stages),
    [nodes, edges, stages],
  );

  // ── Loading ──

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader>
          <Skeleton className="h-4 w-48" />
        </PageHeader>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="flex flex-col gap-2" data-testid="swimlane-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[260px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──

  if (workflowError || !workflow) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader>
          <Skeleton className="h-4 w-48" />
        </PageHeader>
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t(($) => $.detail.not_found)}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {t(($) => $.detail.not_found)}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigation.push(wsPaths.workflows())}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t(($) => $.detail.back_to_workflows)}
                </Button>
                <Button variant="default" size="sm" onClick={() => workflowRefetch()}>
                  {t(($) => $.overview.error_retry)}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── Normal ──

  return (
    <div className="flex flex-col h-full">
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-medium truncate">{workflow.title}</h1>
        </div>
        {viewToggle && <div className="flex items-center gap-1">{viewToggle}</div>}
      </PageHeader>

      <div className="flex-1 min-h-0">
        <SwimlaneCanvas
          layout={layout}
          nodes={nodes}
          edges={edges}
          onNodeClick={setSelectedNodeId}
        />
      </div>

      {selectedNodeId && (
        <NodeDetailPanel
          nodeId={selectedNodeId}
          nodes={nodes}
          edges={edges}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

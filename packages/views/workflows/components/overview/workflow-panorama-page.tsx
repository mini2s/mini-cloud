"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  workflowOverviewOptions,
  workflowStagesOptions,
  workflowNodesOptions,
  workflowEdgesOptions,
} from "@multica/core/workflows/queries";
import { agentListOptions, builtinPluginListOptions } from "@multica/core/workspace/queries";
import { buildCanvasModel } from "@multica/core/workflows/canvas";
import { useNavigation } from "../../../navigation";
import { useWorkspacePaths } from "@multica/core/paths";
import { PageHeader } from "../../../layout/page-header";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Button } from "@multica/ui/components/ui/button";
import { AlertCircle, ArrowLeft, PanelsTopLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@multica/ui/components/ui/alert";
import { useT } from "../../../i18n";
import { StageLaneSurface, WorkflowCanvasShell } from "../../canvas";
import {
  ArchitectureDetailPanel,
  type ArchitectureDetailPanelData,
} from "./architecture-detail-panel";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api/schemas";

export interface WorkflowPanoramaPageProps {
  workflowId: string;
  viewToggle?: ReactNode;
}

type PanoramaSelection = {
  nodeId: string;
  focus: "worker" | "critic";
};

function PanoramaSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="panorama-skeleton">
      <Skeleton className="h-8 w-64" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function WorkflowPanoramaPage({ workflowId, viewToggle }: WorkflowPanoramaPageProps) {
  const { t } = useT("workflows");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  const [selectedCard, setSelectedCard] = useState<PanoramaSelection | null>(null);

  // ── Queries ──
  const {
    data: workflow,
    isLoading: workflowLoading,
    isError: workflowError,
    refetch: workflowRefetch,
  } = useQuery(workflowOverviewOptions(wsId, workflowId));

  const { data: stages = [], isLoading: stagesLoading } = useQuery(
    workflowStagesOptions(wsId, workflowId),
  );

  const { data: nodes = [], isLoading: nodesLoading } = useQuery(
    workflowNodesOptions(wsId, workflowId),
  );

  const { data: edges = [], isLoading: edgesLoading } = useQuery(
    workflowEdgesOptions(wsId, workflowId),
  );

  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const { data: pluginsData } = useQuery(builtinPluginListOptions());

  const isLoading = workflowLoading || stagesLoading || nodesLoading || edgesLoading;

  // ── Canvas model ──
  const canvasModel = useMemo(
    () =>
      buildCanvasModel({
        stages,
        nodes,
        edges,
      }),
    [stages, nodes, edges],
  );

  // ── Derived lookups ──
  const agentLookup = useMemo(() => {
    const map = new Map<string, Agent | null>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const pluginLookup = useMemo(() => {
    const map = new Map<string, BuiltinPlugin | null>();
    const items = pluginsData?.items ?? [];
    for (const p of items) map.set(p.id, p);
    return map;
  }, [pluginsData]);

  // ── Build detail panel data ──
  const selectedPanelData: ArchitectureDetailPanelData | null = useMemo(() => {
    if (!selectedCard) return null;
    const node = nodes.find((n) => n.id === selectedCard.nodeId);
    if (!node) return null;

    if (selectedCard.focus === "critic") {
      const criticAgent = agentLookup.get(node.critic_id ?? "") ?? null;
      return { node, agent: null, plugin: null, criticAgent, focus: "critic" };
    }

    const agent = agentLookup.get(node.worker_id ?? "") ?? null;
    const plugin = agent?.plugin_id
      ? pluginLookup.get(agent.plugin_id) ?? null
      : null;
    const criticAgent = node.critic_id
      ? agentLookup.get(node.critic_id) ?? null
      : null;

    return { node, agent, plugin, criticAgent, focus: "worker" };
  }, [selectedCard, nodes, agentLookup, pluginLookup]);

  // ── Handlers ──
  const handleCardClick = (nodeId: string, focus: "worker" | "critic") => {
    setSelectedCard({ nodeId, focus });
  };

  const handleDetailClose = () => setSelectedCard(null);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <PanoramaSkeleton />
      </div>
    );
  }

  // ── Error ──
  if (workflowError || !workflow) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader><Skeleton className="h-4 w-48" /></PageHeader>
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t(($) => $.detail.not_found)}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {t(($) => $.detail.not_found)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigation.push(wsPaths.workflows())}>
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

  // ── Panorama view ──
  return (
    <div className="flex flex-col h-full">
      <PageHeader className="justify-between px-5 shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/60 text-muted-foreground">
            <PanelsTopLeft className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Workflow panorama
            </div>
            <h1 className="text-sm font-medium truncate">{workflow.title}</h1>
          </div>
        </div>
        {viewToggle && <div className="flex items-center gap-1">{viewToggle}</div>}
      </PageHeader>

      <WorkflowCanvasShell mode="readonly-definition" model={canvasModel}>
        {({ model }) => (
          <StageLaneSurface
            model={model}
            variant="definition"
            selectedNodeId={selectedCard?.nodeId ?? null}
            onNodeSelect={(nodeId) => handleCardClick(nodeId, "worker")}
          />
        )}
      </WorkflowCanvasShell>

      {selectedPanelData && (
        <ArchitectureDetailPanel
          data={selectedPanelData}
          onClose={handleDetailClose}
        />
      )}
    </div>
  );
}

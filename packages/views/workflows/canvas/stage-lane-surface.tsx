"use client";

import type { CanvasModel } from "@multica/core/workflows/canvas";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { RuntimeNodeAction } from "@multica/core/workflows/canvas";
import { useT } from "../../i18n";

export interface StageLaneSurfaceProps {
  model: CanvasModel;
  variant: "definition" | "runtime";
  selectedNodeId: string | null;
  onNodeSelect?: (nodeId: string) => void;
  onRuntimeAction?: (nodeRunId: string, action: RuntimeNodeAction) => void;
}

export function StageLaneSurface({
  model,
  variant,
  selectedNodeId,
  onNodeSelect,
  onRuntimeAction,
}: StageLaneSurfaceProps) {
  const { t } = useT("workflows");
  return (
    <div data-testid="stage-lane-surface" className="relative flex min-h-0 flex-1 flex-col overflow-auto bg-muted/30 p-3">
      <div className="flex min-w-[960px] flex-col rounded-xl border bg-background">
        {model.stages.map((stage) => {
          const stageNodes = model.nodes.filter((node) => node.stageId === stage.id || (stage.isVirtual && node.stageId === null));
          if (stage.isVirtual && stageNodes.length === 0) return null;
          return (
            <section key={stage.id} data-testid={`stage-lane-${stage.id}`} className="border-b p-3 last:border-b-0">
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{stage.name}</div>
              {stageNodes.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t(($) => $.node_dag.empty_title)}</div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {stageNodes.map((node) => (
                    <WorkflowNodeCard
                      key={node.id}
                      node={node}
                      variant={variant}
                      selected={selectedNodeId === node.id}
                      onSelect={onNodeSelect}
                      onRuntimeAction={onRuntimeAction}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

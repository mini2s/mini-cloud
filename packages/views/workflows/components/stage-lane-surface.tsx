"use client";

import { useMemo, useRef, useLayoutEffect, useState, useCallback } from "react";
import type { WorkflowNode, WorkflowEdge, WorkflowStage, WorkflowNodeRun } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { WorkflowNodeCard } from "./workflow-node-card";
import { WorkflowEdgeLayer } from "./workflow-edge-layer";

const STAGE_BG_COLORS = [
  "bg-workflow-agent/5", "bg-workflow-info/5", "bg-workflow-success/5",
  "bg-workflow-warning/5", "bg-brand/5", "bg-muted/40",
] as const;

const STAGE_LABEL_COLORS = [
  "text-workflow-agent", "text-workflow-info", "text-workflow-success",
  "text-workflow-warning", "text-brand", "text-muted-foreground",
] as const;

export interface StageLaneSurfaceProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  stages: WorkflowStage[];
  nodeRuns?: Map<string, WorkflowNodeRun>;
  density?: "compact" | "full";
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  className?: string;
}

/** Stage lane canvas for runtime and preview views. */
export function StageLaneSurface({
  nodes,
  edges,
  stages,
  nodeRuns,
  density = "compact",
  onNodeClick,
  selectedNodeId,
  className,
}: StageLaneSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, DOMRect>>(new Map());
  const nodeElementMap = useRef(new Map<string, HTMLElement>());

  // Group nodes by stage
  const nodesByStage = useMemo(() => {
    const map = new Map<string, WorkflowNode[]>();
    for (const node of nodes) {
      const sid = node.stage_id ?? "__unassigned__";
      if (!map.has(sid)) map.set(sid, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      map.get(sid)!.push(node);
    }
    return map;
  }, [nodes]);

  // Sort stages
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages],
  );

  // Measure node positions for edge overlay
  const measurePositions = useCallback(() => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const nextPos = new Map<string, DOMRect>();
    nodeElementMap.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      nextPos.set(id, new DOMRect(
        rect.left - containerRect.left + (containerRef.current?.scrollLeft ?? 0),
        rect.top - containerRect.top + (containerRef.current?.scrollTop ?? 0),
        rect.width, rect.height,
      ));
    });
    setNodePositions(nextPos);
  }, []);

  useLayoutEffect(() => {
    measurePositions();
    const observer = new ResizeObserver(() => measurePositions());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [nodes, stages, measurePositions]);

  const containerRect = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top } : { width: 0, height: 0, left: 0, top: 0 };
  }, [/* re-computed on render */]);

  // Callback ref factory
  const nodeRefs = useMemo(() => {
    const map = new Map<string, (el: HTMLElement | null) => void>();
    for (const node of nodes) {
      map.set(node.id, (el) => {
        if (el) nodeElementMap.current.set(node.id, el);
        else nodeElementMap.current.delete(node.id);
      });
    }
    return map;
  }, [nodes]);

  if (stages.length === 0 && nodes.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No stages defined yet
      </div>
    );
  }

  const unassignedNodes = nodesByStage.get("__unassigned__") ?? [];

  return (
    <div
      ref={containerRef}
      className={cn("relative bg-workflow-canvas-bg rounded-xl border border-border/60 overflow-auto", className)}
    >
      {/* Edge overlay */}
      <WorkflowEdgeLayer
        edges={edges}
        nodes={nodes}
        containerRect={containerRect}
        nodePositions={nodePositions}
        surface="stage-lane"
      />

      {/* Unassigned nodes */}
      {unassignedNodes.length > 0 && (
        <section className="border-b border-border/40 bg-muted/20 px-3 py-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground px-2">Unassigned</span>
          <div className="flex flex-wrap gap-4 mt-2 px-2">
            {unassignedNodes.map((node) => (
              <div key={node.id} ref={nodeRefs.get(node.id)}>
                <WorkflowNodeCard
                  node={node}
                  variant="runtime"
                  nodeRun={nodeRuns?.get(node.id)}
                  density={density}
                  selected={selectedNodeId === node.id}
                  onClick={onNodeClick}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stage lanes */}
      {sortedStages.map((stage) => {
        const colorIndex = Math.abs(stage.sort_order) % STAGE_BG_COLORS.length;
        const stageNodes = nodesByStage.get(stage.id) ?? [];
        const sortedNodes = [...stageNodes].sort((a, b) => a.sort_order - b.sort_order);

        return (
          <section
            key={stage.id}
            className={cn("border-y border-border/60 px-3 py-4", STAGE_BG_COLORS[colorIndex])}
          >
            <div className="flex items-start gap-4">
              <div className="flex flex-col w-28 shrink-0 pt-1 border-r border-border/50 pr-3">
                <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Stage {stage.sort_order + 1}
                </span>
                <span className={cn("mt-1 text-xs font-semibold", STAGE_LABEL_COLORS[colorIndex])}>
                  {stage.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 min-w-0">
                {sortedNodes.length === 0 ? (
                  <div className="flex h-16 items-center text-[11px] text-muted-foreground">
                    No nodes in this stage
                  </div>
                ) : (
                  sortedNodes.map((node) => (
                    <div key={node.id} ref={nodeRefs.get(node.id)}>
                      <WorkflowNodeCard
                        node={node}
                        variant="runtime"
                        nodeRun={nodeRuns?.get(node.id)}
                        density={density}
                        selected={selectedNodeId === node.id}
                        onClick={onNodeClick}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

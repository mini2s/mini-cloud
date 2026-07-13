"use client";

import { useMemo } from "react";
import { Background, Position, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import type { SplitTaskDraft } from "./split-task-list";

const COLUMN_GAP = 220;
const ROW_GAP = 112;

function getReferenceId(task: SplitTaskDraft): string {
  return task.sourceTaskId ?? task.id;
}

function getStatusTone(task: SplitTaskDraft): string {
  if (!task.sourceTaskId) return "new";
  if (!task.approved) return "discarded";
  return task.status;
}

function buildGraph(tasks: SplitTaskDraft[]): { nodes: Node[]; edges: Edge[] } {
  const visibleTasks = tasks.filter((task) => !task.deleted);
  const referenceToInternalId = new Map<string, string>();

  for (const task of visibleTasks) {
    referenceToInternalId.set(getReferenceId(task), task.id);
  }

  const dependencyMap = new Map<string, string[]>();
  for (const task of visibleTasks) {
    const resolvedDependencies = task.dependsOn
      .map((dependencyId) => referenceToInternalId.get(dependencyId))
      .filter((dependencyId): dependencyId is string => typeof dependencyId === "string");
    dependencyMap.set(task.id, resolvedDependencies);
  }

  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const getDepth = (taskId: string): number => {
    if (depthMemo.has(taskId)) return depthMemo.get(taskId)!;
    if (visiting.has(taskId)) return 0;

    visiting.add(taskId);
    const dependencies = dependencyMap.get(taskId) ?? [];
    const depth = dependencies.length === 0
      ? 0
      : Math.max(...dependencies.map((dependencyId) => getDepth(dependencyId))) + 1;
    visiting.delete(taskId);
    depthMemo.set(taskId, depth);
    return depth;
  };

  const layers = new Map<number, SplitTaskDraft[]>();
  for (const task of visibleTasks) {
    const depth = getDepth(task.id);
    const existing = layers.get(depth) ?? [];
    existing.push(task);
    layers.set(depth, existing);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const task of visibleTasks) {
    const depth = depthMemo.get(task.id) ?? 0;
    const layer = layers.get(depth) ?? [];
    const rowIndex = layer.findIndex((candidate) => candidate.id === task.id);
    const statusTone = getStatusTone(task);

    nodes.push({
      id: task.id,
      position: {
        x: depth * COLUMN_GAP,
        y: Math.max(rowIndex, 0) * ROW_GAP,
      },
      draggable: false,
      selectable: false,
      data: {
        label: (
          <div className="space-y-1 text-left">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 px-1 text-[10px] font-semibold text-muted-foreground">
                {visibleTasks.findIndex((candidate) => candidate.id === task.id) + 1}
              </span>
              <span className="truncate text-xs font-medium text-foreground">{task.title || "Untitled task"}</span>
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{statusTone}</span>
          </div>
        ),
        title: task.title || "Untitled task",
        status: statusTone,
        approved: task.approved,
        index: visibleTasks.findIndex((candidate) => candidate.id === task.id) + 1,
      },
      style: {
        width: 176,
        borderRadius: 12,
        border: statusTone === "discarded" ? "1px solid rgba(148, 163, 184, 0.6)" : "1px solid rgba(148, 163, 184, 0.35)",
        background: statusTone === "discarded" ? "rgba(248, 250, 252, 0.8)" : "rgba(255, 255, 255, 0.98)",
        color: "hsl(var(--foreground))",
        boxShadow: "0 6px 20px rgba(15, 23, 42, 0.08)",
        padding: "10px 12px",
        fontSize: 12,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    for (const dependencyId of dependencyMap.get(task.id) ?? []) {
      edges.push({
        id: `${dependencyId}->${task.id}`,
        source: dependencyId,
        target: task.id,
        animated: false,
        selectable: false,
        style: {
          stroke: "rgba(100, 116, 139, 0.8)",
          strokeWidth: 1.5,
        },
      });
    }
  }

  return { nodes, edges };
}

export interface SplitTaskDagProps {
  tasks: SplitTaskDraft[];
  className?: string;
}

export function SplitTaskDag({ tasks, className }: SplitTaskDagProps) {
  const visibleTasks = tasks.filter((task) => !task.deleted);
  const { nodes, edges } = useMemo(() => buildGraph(tasks), [tasks]);

  if (visibleTasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No task graph to display yet.</p>;
  }

  return (
    <div className={cn("h-64 overflow-hidden rounded-lg border border-border/70 bg-muted/15", className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ selectable: false }}
          nodeOrigin={[0, 0]}
        >
          <Background gap={18} size={1} color="rgba(148, 163, 184, 0.18)" />
        </ReactFlow>
      </ReactFlowProvider>

      <div className="pointer-events-none sr-only">
        {visibleTasks.map((task, index) => (
          <div key={task.id}>
            <Badge variant="secondary">{index + 1}</Badge>
            <span>{task.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

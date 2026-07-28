import { memo, type KeyboardEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { Play, Square } from "lucide-react";
import type { WorkflowBoundaryKind, WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { WorkflowCanvasNodeShell } from "../../canvas/workflow-canvas-node-shell";
import { STAGE_LINE_COLORS } from "../constants";

export interface BoundaryNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  kind: WorkflowBoundaryKind;
  stageColorIndex: number;
  addConnectedNodeLabel?: string;
  onOpen?: (nodeId: string) => void;
  onAddConnectedNode?: (nodeId: string) => void;
}

export const BOUNDARY_WIDTH = 176;
export const BOUNDARY_HEIGHT = 64;

export const BoundaryNode = memo(function BoundaryNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as BoundaryNodeData;
  const isStart = nodeData.kind === "start";
  const Icon = isStart ? Play : Square;
  const handleColorClass = STAGE_LINE_COLORS[nodeData.stageColorIndex % STAGE_LINE_COLORS.length];
  const openNode = () => nodeData.onOpen?.(nodeData.node.id);
  const addConnectedNode = () => nodeData.onAddConnectedNode?.(nodeData.node.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openNode();
  };

  return (
    <WorkflowCanvasNodeShell
      testId={`boundary-node-${id}`}
      nodeShape="pill"
      selected={selected}
      width={BOUNDARY_WIDTH}
      height={BOUNDARY_HEIGHT}
      tabIndex={0}
      ariaLabel={nodeData.node.title}
      title={nodeData.node.description || nodeData.node.title}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className="h-[64px] w-[176px]"
      contentClassName="h-full flex-row items-center gap-3 px-5"
      handleColorClassName={handleColorClass}
      handles={isStart ? ["right-source", "bottom-source"] : ["left-target"]}
      lateralHandleTop={BOUNDARY_HEIGHT / 2}
      addConnectedNodeLabel={isStart ? nodeData.addConnectedNodeLabel : undefined}
      onAddConnectedNode={isStart && nodeData.onAddConnectedNode ? addConnectedNode : undefined}
    >
      <span className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        isStart ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700",
      )}>
        <Icon className="size-4" fill="currentColor" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
        {nodeData.node.title}
      </span>
    </WorkflowCanvasNodeShell>
  );
});

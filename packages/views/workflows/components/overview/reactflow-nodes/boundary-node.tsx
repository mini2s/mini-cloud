import { memo, type KeyboardEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Play, Square } from "lucide-react";
import type { WorkflowBoundaryKind, WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { STAGE_LINE_COLORS } from "../constants";

export interface BoundaryNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  kind: WorkflowBoundaryKind;
  stageColorIndex: number;
  onOpen?: (nodeId: string) => void;
}

export const BOUNDARY_WIDTH = 176;
export const BOUNDARY_HEIGHT = 64;

export const BoundaryNode = memo(function BoundaryNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as BoundaryNodeData;
  const isStart = nodeData.kind === "start";
  const Icon = isStart ? Play : Square;
  const handleColorClass = STAGE_LINE_COLORS[nodeData.stageColorIndex % STAGE_LINE_COLORS.length];
  const openNode = () => nodeData.onOpen?.(nodeData.node.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openNode();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`boundary-node-${id}`}
      aria-label={nodeData.node.title}
      title={nodeData.node.description || nodeData.node.title}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex items-center gap-3 rounded-full border border-border bg-background px-5 text-left shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "border-primary/55 ring-2 ring-primary/15",
      )}
      style={{ width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT }}
    >
      {isStart ? (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          data-testid="boundary-handle-source"
          className={cn("!right-[3px] !bg-current opacity-0 transition-opacity group-hover:opacity-100", handleColorClass)}
        />
      ) : (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          data-testid="boundary-handle-target"
          className={cn("!left-[3px] !bg-current opacity-0 transition-opacity group-hover:opacity-100", handleColorClass)}
        />
      )}
      <span className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        isStart ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700",
      )}>
        <Icon className="size-4" fill="currentColor" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
        {nodeData.node.title}
      </span>
    </div>
  );
});

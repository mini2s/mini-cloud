import { memo, type KeyboardEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";

export interface CompactWorkerNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  stage_id: string | null;
  stageColorIndex: number;
  pluginName?: string;
  workerName?: string;
  onOpen?: (nodeId: string) => void;
}

export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  ...rest
}: NodeProps) {
  const nodeData = data as unknown as CompactWorkerNodeData;
  const selected = (rest as Record<string, unknown>).selected === true;
  const handleColorClass = STAGE_LINE_COLORS[nodeData.stageColorIndex % STAGE_LINE_COLORS.length];
  const displayName = nodeData.pluginName || nodeData.node.title || "Untitled";
  const subtitle = nodeData.workerName || "Not configured";
  const openNode = () => nodeData.onOpen?.(nodeData.node.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openNode();
  };

  return (
    <div
      data-testid={`compact-worker-${id}`}
      role="button"
      tabIndex={0}
      aria-label={`${displayName}. ${subtitle}`}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className={`
        group h-16 w-56 rounded-lg border border-slate-300/90 bg-white p-2.5
        shadow-[0_1px_2px_rgba(15,23,42,0.08)]
        transition-all duration-150
        hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]
        ${selected ? "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]" : ""}
      `}
      style={{ width: WORKER_WIDTH, height: WORKER_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} id="left"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Right} id="right"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Bottom} id="bottom"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="flex flex-col h-full min-w-0">
        <span className="text-xs font-semibold truncate text-foreground">{displayName}</span>
        <span className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</span>
      </div>
    </div>
  );
});

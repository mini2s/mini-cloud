import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";

export interface CompactWorkerNodeData {
  node: WorkflowNode;
  stage_id: string | null;
  stageColorIndex: number;
  pluginName?: string;
  workerName?: string;
}

export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  ...rest
}: NodeProps<CompactWorkerNodeData>) {
  const selected = (rest as Record<string, unknown>).selected === true;
  const handleColorClass = STAGE_LINE_COLORS[data.stageColorIndex % STAGE_LINE_COLORS.length];
  const displayName = data.pluginName || data.node.title || "Untitled";
  const subtitle = data.workerName || "Not configured";

  return (
    <div
      data-testid={`compact-worker-${id}`}
      className={`
        group h-16 w-56 rounded-lg border border-slate-300/90 bg-white p-2.5
        shadow-[0_1px_2px_rgba(15,23,42,0.08)]
        transition-all duration-150
        hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]
        ${selected ? "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]" : ""}
      `}
      style={{ width: WORKER_WIDTH, height: WORKER_HEIGHT }}
    >
      <Handle type="target" position={Position.Left}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Right}
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Bottom} id="critic"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className="flex flex-col h-full min-w-0">
        <span className="text-xs font-semibold truncate text-foreground">{displayName}</span>
        <span className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</span>
      </div>
    </div>
  );
});

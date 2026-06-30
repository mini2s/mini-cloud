import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldAlert } from "lucide-react";
import type { WorkflowNode } from "@multica/core/types";
import { CRITIC_WIDTH, CRITIC_HEIGHT } from "../constants";

export interface CriticBadgeNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  parentNodeId: string;
  criticName?: string;
}

export const CriticBadgeNode = memo(function CriticBadgeNode({
  id,
  data,
}: NodeProps) {
  const nodeData = data as unknown as CriticBadgeNodeData;

  return (
    <div
      data-testid={`critic-badge-${id}`}
      className="h-12 w-36 rounded-md border border-dashed border-border/70 bg-muted/30 p-1.5"
      style={{ width: CRITIC_WIDTH, height: CRITIC_HEIGHT }}
    >
      <Handle type="target" position={Position.Top}
        className="!bg-muted-foreground/50" />

      <div className="flex items-center gap-1.5 h-full min-w-0">
        <ShieldAlert className="h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-medium uppercase text-muted-foreground leading-none">
            Critic
          </span>
          <span className="text-xs font-semibold truncate text-foreground leading-tight">
            {nodeData.criticName || "Critic"}
          </span>
        </div>
      </div>
    </div>
  );
});

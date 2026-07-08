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
  const criticName = nodeData.criticName || "Critic";

  return (
    <div
      data-testid={`critic-badge-${id}`}
      className="h-12 w-36 rounded-lg border border-white/80 bg-gradient-to-br from-white via-slate-50/95 to-slate-100/85 p-1.5 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70"
      style={{ width: CRITIC_WIDTH, height: CRITIC_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} id="top"
        className="!border-warning/30 !bg-warning/70" />

      <div className="flex h-full min-w-0 flex-col justify-between gap-1">
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <ShieldAlert className="size-3 shrink-0 text-warning/80" strokeWidth={1.9} />
            <span className="truncate text-[12px] font-semibold leading-4 text-foreground">
              {criticName}
            </span>
          </div>
          <span className="shrink-0 rounded-full border border-slate-200/70 bg-white/70 px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase leading-none text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            Critic
          </span>
        </div>
        <div
          data-testid={`critic-badge-meta-${id}`}
          className="flex min-w-0 items-center gap-1.5 border-t border-slate-200/55 pt-1 text-[9px] font-medium leading-none text-muted-foreground"
        >
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning/70 shadow-[0_0_0_3px_rgba(245,158,11,0.10)]" />
          <span className="truncate text-slate-700">Review step</span>
        </div>
      </div>
    </div>
  );
});

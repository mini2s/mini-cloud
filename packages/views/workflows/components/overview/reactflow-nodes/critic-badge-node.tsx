import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ShieldAlert } from "lucide-react";
import type { WorkflowNode } from "@multica/core/types";
import { CRITIC_WIDTH, CRITIC_HEIGHT } from "../constants";

const HANDLE_EDGE_INSET = 3;

export interface CriticBadgeNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  parentNodeId: string;
  criticName?: string;
}

function criticTypeLabel(type: WorkflowNode["critic_type"]): string {
  if (type === "human") return "Human reviewer";
  if (type === "agent") return "Agent reviewer";
  if (type === "squad") return "Squad reviewer";
  if (type === "api") return "API reviewer";
  if (type === "role") return "Role reviewer";
  return "Reviewer";
}

export const CriticBadgeNode = memo(function CriticBadgeNode({
  id,
  data,
}: NodeProps) {
  const nodeData = data as unknown as CriticBadgeNodeData;
  const criticName = nodeData.criticName || "Reviewer";
  const reviewerType = criticTypeLabel(nodeData.node.critic_type);

  return (
    <div
      data-testid={`critic-badge-${id}`}
      className="h-12 w-36 overflow-hidden rounded-lg border border-white/80 bg-gradient-to-br from-white via-slate-50/95 to-slate-100/85 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70"
      style={{ width: CRITIC_WIDTH, height: CRITIC_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} id="top"
        className="!border-warning/30 !bg-warning/70"
        style={{ top: HANDLE_EDGE_INSET }}
      />

      <div className="flex h-full min-w-0 flex-col justify-between gap-0.5">
        <div className="flex min-w-0 items-start gap-1.5">
          <ShieldAlert
            aria-hidden="true"
            data-testid={`critic-badge-icon-${id}`}
            className="mt-0.5 size-3 shrink-0 text-warning/75"
            strokeWidth={1.9}
          />
          <span
            className="line-clamp-2 min-w-0 break-words text-[11px] font-medium leading-3 text-slate-600"
            title={criticName}
          >
            {criticName}
          </span>
        </div>
        <div
          data-testid={`critic-badge-meta-${id}`}
          className="flex min-w-0 items-center gap-1.5 border-t border-slate-200/55 pt-0.5 text-[8px] font-medium leading-[10px] text-muted-foreground"
        >
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning/70 shadow-[0_0_0_3px_rgba(245,158,11,0.10)]" />
          <span className="truncate text-slate-500">{reviewerType}</span>
        </div>
      </div>
    </div>
  );
});

import { memo, type KeyboardEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";
import { Bot, FileText, UserRound, UsersRound } from "lucide-react";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS, STAGE_COLOR_BAR_CLASSES } from "../constants";

export interface CompactWorkerNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  stage_id: string | null;
  stageColorIndex: number;
  pluginName?: string;
  workerName?: string;
  workerConfigured?: boolean;
  criticConfigured?: boolean;
  isAnnotation?: boolean;
  onOpen?: (nodeId: string) => void;
}

function workerTypeLabel(type: WorkflowNode["worker_type"]): string {
  if (type === "human") return "Human";
  if (type === "squad") return "Squad";
  if (type === "role") return "Role";
  return "Agent";
}

function WorkerIcon({ type }: { type: WorkflowNode["worker_type"] }) {
  if (type === "human") return <UserRound className="size-3 shrink-0" strokeWidth={1.8} />;
  if (type === "squad") return <UsersRound className="size-3 shrink-0" strokeWidth={1.8} />;
  if (type === "role") return <FileText className="size-3 shrink-0" strokeWidth={1.8} />;
  return <Bot className="size-3 shrink-0" strokeWidth={1.8} />;
}

export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  ...rest
}: NodeProps) {
  const nodeData = data as unknown as CompactWorkerNodeData;
  const selected = (rest as Record<string, unknown>).selected === true;
  const handleColorClass = STAGE_LINE_COLORS[nodeData.stageColorIndex % STAGE_LINE_COLORS.length];
  const barColorClass = STAGE_COLOR_BAR_CLASSES[nodeData.stageColorIndex % STAGE_COLOR_BAR_CLASSES.length];
  const displayName = nodeData.node.title || "Untitled";
  const description = nodeData.node.description?.trim();
  const isAnnotation = nodeData.isAnnotation === true;
  const ariaSubtitle = isAnnotation ? "Canvas note" : nodeData.workerName ?? nodeData.pluginName ?? workerTypeLabel(nodeData.node.worker_type);
  const workerConfigured = isAnnotation ? true : nodeData.workerConfigured ?? Boolean(nodeData.node.worker_id);
  const workerLabel = workerConfigured
    ? nodeData.workerName ?? nodeData.pluginName ?? workerTypeLabel(nodeData.node.worker_type)
    : null;
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
      aria-label={`${displayName}. ${ariaSubtitle}`}
      title={description ? `${displayName}\n${description}` : displayName}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className={`
        group h-20 w-56 rounded-lg border border-slate-300/90 border-l-4 ${barColorClass} bg-white px-2.5 py-2
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

      <div className="flex h-full min-w-0 flex-col justify-between gap-1.5">
        <div className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-4 text-foreground">{displayName}</span>
          {description ? (
            <span className="mt-1 block truncate text-[10px] leading-3 text-muted-foreground">{description}</span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
          {isAnnotation ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-slate-600">
              <FileText className="size-3 shrink-0" strokeWidth={1.8} />
              <span className="truncate">Note</span>
            </span>
          ) : workerLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-slate-600">
              <WorkerIcon type={nodeData.node.worker_type} />
              <span className="truncate">{workerLabel}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

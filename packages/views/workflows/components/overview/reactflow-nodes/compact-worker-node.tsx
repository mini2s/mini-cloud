import { memo, type KeyboardEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { parseNodeFormat, type WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Bot, FileText, GitFork, GitMerge, UserRound, UsersRound } from "lucide-react";
import { workflowNodeInfoAreaClassName, workflowNodeShapeGlyphClassName, workflowNodeShapeSurfaceClassName } from "../../../../common/workflow-node-shape";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";

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

function GatewayIcon({ kind }: { kind: "fork" | "join" | null }) {
  if (kind === "join") return <GitMerge className="size-3 shrink-0" strokeWidth={1.8} />;
  return <GitFork className="size-3 shrink-0" strokeWidth={1.8} />;
}

function gatewayLabel(kind: "fork" | "join" | null): string {
  if (kind === "join") return "Join gateway";
  if (kind === "fork") return "Fork gateway";
  return "Gateway";
}

export const CompactWorkerNode = memo(function CompactWorkerNode({
  id,
  data,
  ...rest
}: NodeProps) {
  const nodeData = data as unknown as CompactWorkerNodeData;
  const selected = (rest as Record<string, unknown>).selected === true;
  const handleColorClass = STAGE_LINE_COLORS[nodeData.stageColorIndex % STAGE_LINE_COLORS.length];
  const displayName = nodeData.node.title || "Untitled";
  const description = nodeData.node.description?.trim();
  const nodeFormat = parseNodeFormat(nodeData.node.format_schema);
  const nodeShape = nodeFormat.shape;
  const isAnnotation = nodeData.isAnnotation === true || nodeFormat.kind === "annotation";
  const isGateway = nodeFormat.kind === "gateway";
  const gatewayText = gatewayLabel(nodeFormat.gateway_kind);
  const ariaSubtitle = isAnnotation ? "Canvas note" : isGateway ? gatewayText : nodeData.workerName ?? nodeData.pluginName ?? workerTypeLabel(nodeData.node.worker_type);
  const workerConfigured = isAnnotation || isGateway ? true : nodeData.workerConfigured ?? Boolean(nodeData.node.worker_id);
  const workerLabel = isGateway
    ? gatewayText
    : workerConfigured
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
      data-node-shape={nodeShape}
      role="button"
      tabIndex={0}
      aria-label={`${displayName}. ${ariaSubtitle}`}
      title={description ? `${displayName}\n${description}` : displayName}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative h-20 w-56 transition-all duration-150 hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected && "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]",
      )}
      style={{ width: WORKER_WIDTH, height: WORKER_HEIGHT }}
    >
      <div
        aria-hidden="true"
        data-node-shape-surface="true"
        className={cn(
          "pointer-events-none absolute inset-0 border border-slate-300/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150",
          workflowNodeShapeSurfaceClassName(nodeShape),
          "group-hover:border-primary/45 group-hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]",
          selected && "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]",
        )}
      />
      <Handle type="target" position={Position.Left} id="left"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Right} id="right"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <Handle type="source" position={Position.Bottom} id="bottom"
        className={`!bg-current ${handleColorClass} opacity-0 group-hover:opacity-100 transition-opacity`} />

      <div className={cn("relative z-10 flex h-full min-w-0 flex-col justify-between gap-1.5", workflowNodeInfoAreaClassName(nodeShape))}>
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            {nodeShape !== "rectangle" ? (
              <span
                aria-hidden="true"
                data-node-shape-glyph={nodeShape}
                className={cn(
                  "size-2.5 shrink-0 border border-primary/45 bg-primary/10",
                  workflowNodeShapeGlyphClassName(nodeShape),
                )}
              />
            ) : null}
            <span className="block truncate text-[13px] font-semibold leading-4 text-foreground">{displayName}</span>
          </span>
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
          ) : isGateway ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-slate-600">
              <GatewayIcon kind={nodeFormat.gateway_kind} />
              <span className="truncate">{workerLabel}</span>
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

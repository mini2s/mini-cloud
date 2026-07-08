import { memo, type KeyboardEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { parseNodeFormat, type WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Bot, FileText, GitFork, GitMerge, UserRound, UsersRound } from "lucide-react";
import { workflowNodeInfoAreaClassName, workflowNodeShapeGlyphClassName } from "../../../../common/workflow-node-shape";
import { WorkflowCanvasNodeShell } from "../../canvas/workflow-canvas-node-shell";
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
    <WorkflowCanvasNodeShell
      testId={`compact-worker-${id}`}
      nodeShape={nodeShape}
      selected={selected}
      width={WORKER_WIDTH}
      height={WORKER_HEIGHT}
      tabIndex={0}
      ariaLabel={`${displayName}. ${ariaSubtitle}`}
      title={description ? `${displayName}\n${description}` : displayName}
      onDoubleClick={openNode}
      onKeyDown={handleKeyDown}
      className="h-20 w-56"
      contentClassName={cn("h-full justify-between gap-1.5", workflowNodeInfoAreaClassName(nodeShape))}
      handleColorClassName={handleColorClass}
      handles={["left-target", "right-source", "bottom-source"]}
      lateralHandleTop={WORKER_HEIGHT / 2}
    >
        <span className="min-w-0">
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
        </span>
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
    </WorkflowCanvasNodeShell>
  );
});

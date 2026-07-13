import { memo, type KeyboardEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { parseNodeFormat, type WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Bot, FileText, GitFork, GitMerge, UserRound, UsersRound } from "lucide-react";
import { workflowNodeInfoAreaClassName, workflowNodeShapeGlyphClassName } from "../../../../common/workflow-node-shape";
import { WorkflowCanvasNodeShell } from "../../canvas/workflow-canvas-node-shell";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";
import { SplitNodeCard } from "../../split/split-node-card";

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
  onAddConnectedNode?: (nodeId: string) => void;
  addConnectedNodeLabel?: string;
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

function nodeBadgeLabel({
  isAnnotation,
  isGateway,
  workerType,
}: {
  isAnnotation: boolean;
  isGateway: boolean;
  workerType: WorkflowNode["worker_type"];
}): string {
  if (isAnnotation) return "Note";
  if (isGateway) return "Logic";
  return workerTypeLabel(workerType);
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
  const isSplit = nodeFormat.kind === "split";
  const gatewayText = gatewayLabel(nodeFormat.gateway_kind);
  const ariaSubtitle = isAnnotation
    ? "Canvas note"
    : isGateway
      ? gatewayText
      : isSplit
        ? "Task split node"
        : nodeData.workerName ?? nodeData.pluginName ?? workerTypeLabel(nodeData.node.worker_type);
  const workerConfigured = isAnnotation || isGateway || isSplit ? true : nodeData.workerConfigured ?? Boolean(nodeData.node.worker_id);
  const workerLabel = isGateway
    ? gatewayText
    : isSplit
    ? null
    : workerConfigured
    ? nodeData.workerName ?? nodeData.pluginName ?? workerTypeLabel(nodeData.node.worker_type)
    : null;
  const badgeLabel = nodeBadgeLabel({
    isAnnotation,
    isGateway,
    workerType: nodeData.node.worker_type,
  });
  const metadataLabel = isAnnotation
    ? "Canvas note"
    : isSplit
    ? "Task split"
    : workerLabel ?? workerTypeLabel(nodeData.node.worker_type);
  const openNode = () => nodeData.onOpen?.(nodeData.node.id);
  const addConnectedNode = () => nodeData.onAddConnectedNode?.(nodeData.node.id);
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
      className="h-[104px] w-[240px]"
      contentClassName={cn("h-full justify-between gap-2.5", workflowNodeInfoAreaClassName(nodeShape))}
      handleColorClassName={handleColorClass}
      handles={["left-target", "right-source", "bottom-source"]}
      lateralHandleTop={WORKER_HEIGHT / 2}
      addConnectedNodeLabel={nodeData.addConnectedNodeLabel}
      onAddConnectedNode={nodeData.onAddConnectedNode ? addConnectedNode : undefined}
    >
      {isSplit ? (
        <SplitNodeCard
          title={displayName}
          config={nodeFormat.split_config}
          status="editing"
          className="h-full w-full min-h-0 border-0 bg-transparent p-0 shadow-none"
        />
      ) : (
        <>
        <span className="min-w-0">
          <span className="flex min-w-0 items-start justify-between gap-2">
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
            <span
              data-testid={`compact-worker-node-badge-${id}`}
              className="shrink-0 rounded-full border border-border/55 bg-background/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase leading-none text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              {badgeLabel}
            </span>
          </span>
          {description ? (
            <span className="mt-1 block truncate text-[10px] leading-3 text-muted-foreground">{description}</span>
          ) : null}
        </span>
        <div
          data-testid={`compact-worker-node-meta-${id}`}
          className="flex min-w-0 items-center gap-1.5 border-t border-border/45 pt-2 text-[10px] leading-4 text-muted-foreground"
        >
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--success)] shadow-[0_0_0_3px_rgba(34,197,94,0.12)]" />
          <span className="truncate font-medium text-foreground/80">{metadataLabel}</span>
          {workerConfigured ? (
            <span className="shrink-0 text-muted-foreground/75">Configured</span>
          ) : null}
          {isAnnotation ? (
            <FileText className="size-3 shrink-0 text-muted-foreground/75" strokeWidth={1.8} />
          ) : isGateway ? (
            <GatewayIcon kind={nodeFormat.gateway_kind} />
          ) : workerLabel ? (
            <WorkerIcon type={nodeData.node.worker_type} />
          ) : null}
        </div>
        </>
      )}
    </WorkflowCanvasNodeShell>
  );
});

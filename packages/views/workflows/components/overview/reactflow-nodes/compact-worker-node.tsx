import { memo, type KeyboardEvent } from "react";
import type { NodeProps } from "@xyflow/react";
import { parseNodeFormat, type WorkflowNode } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { FileText, GitFork, GitMerge } from "lucide-react";
import { workflowNodeInfoAreaClassName, workflowNodeShapeGlyphClassName } from "../../../../common/workflow-node-shape";
import {
  WorkflowActorSlot,
  type WorkflowActorIdentity,
} from "../../../../common/workflow-actor-slots";
import { WorkflowCanvasNodeShell } from "../../canvas/workflow-canvas-node-shell";
import { WORKER_WIDTH, WORKER_HEIGHT, STAGE_LINE_COLORS } from "../constants";
import { useT } from "../../../../i18n";

export interface CompactWorkerNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  stage_id: string | null;
  stageColorIndex: number;
  pluginName?: string;
  workerName?: string;
  criticName?: string;
  workerIdentity?: WorkflowActorIdentity | null;
  criticIdentity?: WorkflowActorIdentity | null;
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
  const { t } = useT("workflows");
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
  const metadataLabel = isAnnotation
    ? "Canvas note"
    : isSplit
    ? "Task split"
    : workerLabel ?? workerTypeLabel(nodeData.node.worker_type);
  const splitConfig = nodeFormat.split_config;
  const splitMode = splitConfig?.mode ?? "barrier";
  const splitConcurrency = splitConfig?.max_concurrency ?? 5;
  const splitMaxFailures = splitConfig?.max_failures ?? 0;
  const splitPolicySummary = splitMode === "pipeline"
    ? t(($) => $.panorama.card.split_pipeline_policy_summary, { concurrency: splitConcurrency })
    : t(($) => $.panorama.card.split_policy_summary, {
        concurrency: splitConcurrency,
        maxFailures: splitMaxFailures,
      });
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
      className="h-[152px] w-[296px]"
      contentClassName={cn("h-full justify-between gap-2", workflowNodeInfoAreaClassName(nodeShape))}
      handleColorClassName={handleColorClass}
      handles={["left-target", "right-source", "bottom-source"]}
      lateralHandleTop={WORKER_HEIGHT / 2}
      addConnectedNodeLabel={nodeData.addConnectedNodeLabel}
      onAddConnectedNode={nodeData.onAddConnectedNode ? addConnectedNode : undefined}
    >
      <>
        <span className="min-w-0">
          <span className="flex min-w-0 items-start gap-2">
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
              <span className="block min-w-0 break-words text-[13px] font-semibold leading-4 text-foreground line-clamp-2">{displayName}</span>
            </span>
          </span>
          {description ? (
            <span className="mt-1 block break-words text-[10px] leading-3 text-muted-foreground line-clamp-2">{description}</span>
          ) : null}
        </span>
        {isSplit ? (
          <div
            data-testid={`compact-worker-node-meta-${id}`}
            className="grid grid-rows-[12px_42px] gap-y-1 border-t border-border/45 pt-2"
          >
            <div className="grid row-span-2 min-w-0 grid-rows-subgrid gap-1">
              <span className="block text-[9px] font-bold uppercase leading-3 text-muted-foreground">
                {t(($) => $.panorama.card.split_policy_label)}
              </span>
              <span className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4">
                <span
                  aria-hidden="true"
                  className="mt-[5px] size-1.5 shrink-0 rounded-full bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold leading-4 text-foreground/85">{splitMode}</span>
                  <span className="block text-[10px] leading-3 text-muted-foreground line-clamp-2">{splitPolicySummary}</span>
                </span>
              </span>
            </div>
          </div>
        ) : isAnnotation || isGateway ? (
          <div
            data-testid={`compact-worker-node-meta-${id}`}
            className="flex min-w-0 items-center gap-1.5 border-t border-border/45 pt-2 text-[10px] leading-4 text-muted-foreground"
          >
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--success)] shadow-[0_0_0_3px_rgba(34,197,94,0.12)]" />
            <span className="min-w-0 break-words font-medium text-foreground/80 line-clamp-2">{metadataLabel}</span>
            {workerConfigured ? (
              <span className="shrink-0 text-muted-foreground/75">Configured</span>
            ) : null}
            {isAnnotation ? (
              <FileText className="size-3 shrink-0 text-muted-foreground/75" strokeWidth={1.8} />
            ) : (
              <GatewayIcon kind={nodeFormat.gateway_kind} />
            )}
          </div>
        ) : (
          <div
            data-testid={`compact-worker-node-meta-${id}`}
            className="grid grid-cols-2 grid-rows-[12px_42px] gap-x-2 gap-y-1 border-t border-border/45 pt-2"
          >
            <WorkflowActorSlot
              testId={`compact-worker-node-worker-role-${id}`}
              slot="worker"
              label={t(($) => $.panorama.card.worker_label)}
              identity={nodeData.workerIdentity}
              fallback={t(($) => $.panorama.card.actor_not_configured)}
              state={workerConfigured ? "configured" : "missing"}
            />
            <WorkflowActorSlot
              testId={`compact-worker-node-critic-role-${id}`}
              slot="critic"
              label={t(($) => $.panorama.card.critic_label)}
              identity={nodeData.criticIdentity}
              fallback={t(($) => $.panorama.card.actor_optional)}
              state={nodeData.criticConfigured === true ? "configured" : "optional"}
            />
          </div>
        )}
        </>
    </WorkflowCanvasNodeShell>
  );
});

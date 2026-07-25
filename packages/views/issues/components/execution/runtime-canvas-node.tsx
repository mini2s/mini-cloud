"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronLeft } from "lucide-react";
import type {
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeRuntimeSummary,
  WorkflowRuntimeDisplayStatus,
} from "@multica/core/types";
import { parseNodeFormat } from "@multica/core/types";
import { BoundaryNode, CriticBadgeNode } from "../../../workflows/components/overview/reactflow-nodes";
import {
  RuntimeNodeCard,
  RUNTIME_CHILD_ISSUE_NODE_HEIGHT,
  RUNTIME_CHILD_ISSUE_NODE_WIDTH,
  RUNTIME_NODE_HEIGHT,
  RUNTIME_SPLIT_NODE_HEIGHT,
  type RuntimeNodeDeliverableSummary,
} from "./runtime-node-card";
import { useT } from "@multica/views/i18n";
import type { WorkflowActorIdentity } from "../../../common/workflow-actor-slots";

export const RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH = RUNTIME_CHILD_ISSUE_NODE_WIDTH;
export const RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT = RUNTIME_CHILD_ISSUE_NODE_HEIGHT;
export const RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP = 96;
export const RUNTIME_SPLIT_SUBFLOW_ROW_GAP = 32;
export const RUNTIME_SPLIT_SUBFLOW_X_PADDING = 24;
export const RUNTIME_SPLIT_SUBFLOW_HEADER_HEIGHT = 56;
export const RUNTIME_SPLIT_SUBFLOW_MIN_HEIGHT = 180;
export const RUNTIME_SPLIT_SUBFLOW_MIN_WIDTH = 560;

function subflowEdgeTestId(edge: RuntimeSplitSubflowDependency): string {
  return `runtime-split-subflow-edge-${edge.sourceNodeId}-${edge.targetNodeId}`;
}

export interface RuntimeCanvasNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  nodeRun: WorkflowNodeRun | null;
  runtimeSummary: WorkflowNodeRuntimeSummary | null;
  nowMs?: number;
  workerName: string | null;
  criticName: string | null;
  workerIdentity?: WorkflowActorIdentity | null;
  criticIdentity?: WorkflowActorIdentity | null;
  onOpen: (nodeId: string) => void;
  onOpenSession?: (nodeId: string) => Promise<boolean>;
  deliverables?: RuntimeNodeDeliverableSummary[];
  isRuntimeFocus?: boolean;
  isSplitExpanded?: boolean;
  splitChildCount?: number;
  onSplitNodeToggle?: (nodeId: string) => void;
}

export interface RuntimeSplitSubflowChildIssue {
  nodeId: string;
  issueId: string;
  title: string;
  description: string;
  displayStatus: WorkflowRuntimeDisplayStatus;
  displayStatusLabel: string;
  workerName: string | null;
  issueIdentifier: string;
  progressLabel: string;
  level: number;
  rowIndex: number;
  dependencyNodeIds: string[];
  workflowNode: WorkflowNode;
  runtimeSummary: WorkflowNodeRuntimeSummary;
}

export interface RuntimeSplitSubflowDependency {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface RuntimeSplitSubflowData extends Record<string, unknown> {
  splitNodeId: string;
  parentTitle: string;
  childIssues: RuntimeSplitSubflowChildIssue[];
  dependencyEdges: RuntimeSplitSubflowDependency[];
  onOpenChild: (nodeId: string) => void;
  onCollapse?: (nodeId: string) => void;
}

export const RuntimeCanvasNode = memo(function RuntimeCanvasNode({
  id,
  data,
}: NodeProps) {
  const nodeData = data as RuntimeCanvasNodeData;
  const nodeHeight = parseNodeFormat(nodeData.node.format_schema).kind === "split"
    ? RUNTIME_SPLIT_NODE_HEIGHT
    : RUNTIME_NODE_HEIGHT;

  return (
    <div data-testid={`runtime-canvas-node-${id}`} className="relative">
      <RuntimeNodeCard
        node={nodeData.node}
        nodeRun={nodeData.nodeRun}
        workerName={nodeData.workerName}
        criticName={nodeData.criticName}
        workerIdentity={nodeData.workerIdentity}
        criticIdentity={nodeData.criticIdentity}
        onClick={nodeData.onOpen}
        onOpenSession={nodeData.onOpenSession}
        deliverables={nodeData.deliverables}
        runtimeSummary={nodeData.runtimeSummary}
        nowMs={nodeData.nowMs}
        isRuntimeFocus={nodeData.isRuntimeFocus === true}
        isSplitExpanded={nodeData.isSplitExpanded}
        splitChildCount={nodeData.splitChildCount}
        onSplitNodeToggle={nodeData.onSplitNodeToggle}
        handles={["left-target", "right-source", "bottom-source"]}
        lateralHandleTop={nodeHeight / 2}
      />
    </div>
  );
});

export const RuntimeSplitSubflowNode = memo(function RuntimeSplitSubflowNode({
  id,
  data,
}: NodeProps) {
  const nodeData = data as RuntimeSplitSubflowData;
  const { t } = useT("issues");
  const levels = [...new Set(nodeData.childIssues.map((child) => child.level))].sort((a, b) => a - b);
  const childIssuesByLevel = levels.map((level) =>
    nodeData.childIssues
      .filter((child) => child.level === level)
      .sort((a, b) => a.rowIndex - b.rowIndex),
  );
  const childById = new Map(nodeData.childIssues.map((child) => [child.nodeId, child]));
  const edgeWidth = Math.max(1, childIssuesByLevel.length) * RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH +
    Math.max(0, childIssuesByLevel.length - 1) * RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP;
  const maxRows = Math.max(1, ...childIssuesByLevel.map((group) => group.length));
  const edgeHeight = maxRows * RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT +
    Math.max(0, maxRows - 1) * RUNTIME_SPLIT_SUBFLOW_ROW_GAP;
  const safeMarkerId = `${id.replace(/[^a-zA-Z0-9_-]/g, "-")}-subflow-arrow`;
  const collapseLabel = t(($) => $.execution.card.split_child_collapse);
  const edgePath = (edge: RuntimeSplitSubflowDependency) => {
    const source = childById.get(edge.sourceNodeId);
    const target = childById.get(edge.targetNodeId);
    if (!source || !target) return "";
    const x1 = source.level * (RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH + RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP) +
      RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH;
    const y1 = source.rowIndex * (RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT + RUNTIME_SPLIT_SUBFLOW_ROW_GAP) +
      RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT / 2;
    const x2 = target.level * (RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH + RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP);
    const y2 = target.rowIndex * (RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT + RUNTIME_SPLIT_SUBFLOW_ROW_GAP) +
      RUNTIME_SPLIT_SUBFLOW_CARD_HEIGHT / 2;
    const midX = x1 + Math.max(12, (x2 - x1) / 2);
    return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  };

  return (
    <div
      data-testid={`runtime-split-subflow-${id}`}
      className="relative min-h-[180px] rounded-lg border border-border/60 bg-background/70 p-3 text-left shadow-sm"
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-current text-slate-300 opacity-80"
        style={{ left: 3, top: RUNTIME_NODE_HEIGHT / 2 }}
      />
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {nodeData.parentTitle}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
            {t(($) => $.execution.card.split_child_count, { count: nodeData.childIssues.length })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded-full border border-border/80 bg-background px-2 py-1 text-[10px] font-semibold text-muted-foreground shadow-sm">
            {nodeData.childIssues.length}
          </span>
          {nodeData.onCollapse ? (
            <button
              type="button"
              aria-label={collapseLabel}
              title={collapseLabel}
              data-testid="runtime-split-subflow-collapse"
              className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary/40 bg-background text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.10)] transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                nodeData.onCollapse?.(nodeData.splitNodeId);
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="relative"
        style={{
          width: edgeWidth,
          minHeight: edgeHeight,
        }}
      >
        {nodeData.dependencyEdges.length > 0 ? (
          <svg
            data-testid="runtime-split-subflow-edge-layer"
            className="pointer-events-none absolute inset-0 z-0 overflow-visible text-blue-500"
            width={edgeWidth}
            height={edgeHeight}
            viewBox={`0 0 ${edgeWidth} ${edgeHeight}`}
            aria-hidden
          >
            <defs>
              <marker
                id={safeMarkerId}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {nodeData.dependencyEdges.map((edge) => {
              const path = edgePath(edge);
              if (!path) return null;
              return (
                <path
                  key={`${edge.sourceNodeId}:${edge.targetNodeId}`}
                  data-testid={subflowEdgeTestId(edge)}
                  className="text-blue-500"
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.75}
                  strokeOpacity={0.78}
                  markerEnd={`url(#${safeMarkerId})`}
                />
              );
            })}
          </svg>
        ) : null}
        <div
          className="relative z-10 grid"
          style={{
            gridTemplateColumns: `repeat(${Math.max(childIssuesByLevel.length, 1)}, ${RUNTIME_SPLIT_SUBFLOW_CARD_WIDTH}px)`,
            columnGap: RUNTIME_SPLIT_SUBFLOW_COLUMN_GAP,
          }}
        >
          {childIssuesByLevel.map((group, levelIndex) => (
            <div
              key={levels[levelIndex]}
              className="min-w-0"
              style={{ display: "grid", rowGap: RUNTIME_SPLIT_SUBFLOW_ROW_GAP }}
            >
              {group.map((child) => (
                <div
                  key={child.nodeId}
                  data-testid={`runtime-split-subflow-child-${child.nodeId}`}
                  className="nodrag nopan relative z-10"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <RuntimeNodeCard
                    node={child.workflowNode}
                    nodeRun={null}
                    workerName={child.workerName}
                    criticName={null}
                    childIssueSummary={{
                      identifier: child.issueIdentifier,
                      workflowName: child.workerName,
                      progressLabel: child.progressLabel,
                    }}
                    runtimeSummary={child.runtimeSummary}
                    onClick={nodeData.onOpenChild}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const runtimeCanvasNodeTypes = {
  runtimeNode: RuntimeCanvasNode,
  runtimeSplitSubflow: RuntimeSplitSubflowNode,
  criticBadge: CriticBadgeNode,
  boundary: BoundaryNode,
};

import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeShape } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import { Plus } from "lucide-react";
import { workflowNodeShapeSurfaceClassName } from "../../../common/workflow-node-shape";

export type WorkflowCanvasNodeHandle = "left-target" | "right-source" | "bottom-source";

interface WorkflowCanvasNodeShellProps {
  as?: "div" | "button";
  testId: string;
  nodeShape: NodeShape;
  selected?: boolean;
  width: number;
  height?: number;
  minHeight?: number;
  title?: string;
  ariaLabel?: string;
  tabIndex?: number;
  className?: string;
  contentClassName?: string;
  surfaceClassName?: string;
  handleColorClassName?: string;
  handles?: WorkflowCanvasNodeHandle[];
  lateralHandleTop?: number;
  addConnectedNodeLabel?: string;
  elementRef?: (el: HTMLButtonElement | null) => void;
  onClick?: () => void;
  onAddConnectedNode?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

function AddConnectedNodeTooltip() {
  return (
    <span
      aria-hidden="true"
      data-testid="workflow-canvas-add-connected-node-tooltip"
      className={cn(
        "pointer-events-none absolute left-7 top-1/2 z-30 flex -translate-y-1/2 translate-x-1 items-center whitespace-nowrap rounded-md border border-border/80 bg-popover/95 px-2 py-1",
        "text-[10px] leading-none text-popover-foreground opacity-0 shadow-[0_10px_24px_rgba(15,23,42,0.14)] ring-1 ring-white/70 backdrop-blur",
        "transition-all duration-150 group-hover/add-port:translate-x-0 group-hover/add-port:opacity-100 group-focus-visible/add-port:translate-x-0 group-focus-visible/add-port:opacity-100",
      )}
    >
      <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rotate-45 border-b border-l border-border/80 bg-popover" />
      <span className="relative flex flex-col gap-0.5">
        <span className="font-semibold">Drag to connect</span>
        <span className="text-[9px] font-medium text-muted-foreground">Click to add node</span>
      </span>
    </span>
  );
}

export function WorkflowCanvasNodeShell({
  as = "div",
  testId,
  nodeShape,
  selected = false,
  width,
  height,
  minHeight,
  title,
  ariaLabel,
  tabIndex,
  className,
  contentClassName,
  surfaceClassName,
  handleColorClassName = "text-slate-300",
  handles = [],
  lateralHandleTop,
  addConnectedNodeLabel,
  elementRef,
  onClick,
  onAddConnectedNode,
  onDoubleClick,
  onKeyDown,
  children,
}: WorkflowCanvasNodeShellProps) {
  const style: CSSProperties = {
    width,
    ...(height != null ? { height } : {}),
    ...(minHeight != null ? { minHeight } : {}),
  };
  const rootClassName = cn(
    "group relative flex min-w-0 flex-col text-left transition-all duration-150 hover:-translate-y-0.5",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    selected && "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]",
    className,
  );
  const handleAddConnectedNodeClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onAddConnectedNode) return;
    event.stopPropagation();
    onAddConnectedNode();
  };
  const handleAddConnectedNodeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onAddConnectedNode) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onAddConnectedNode();
  };
  const simpleHandleClassName = cn(
    "!bg-current opacity-0 transition-opacity group-hover:opacity-100",
    handleColorClassName,
    !onAddConnectedNode && "!cursor-default",
  );
  const body = (
    <>
      <span
        aria-hidden="true"
        data-node-shape-surface="true"
        className={cn(
          "pointer-events-none absolute inset-0 border border-white/80 bg-gradient-to-br from-white via-slate-50/95 to-slate-100/85 shadow-[0_14px_32px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/70 transition-all duration-150",
          workflowNodeShapeSurfaceClassName(nodeShape),
          "group-hover:border-white group-hover:ring-primary/20 group-hover:shadow-[0_18px_38px_rgba(37,99,235,0.14)]",
          selected && "border-white shadow-[0_18px_38px_rgba(37,99,235,0.16)] ring-2 ring-primary/20",
          surfaceClassName,
        )}
      />
      {handles.includes("left-target") ? (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className={simpleHandleClassName}
          style={lateralHandleTop != null ? { top: lateralHandleTop } : undefined}
        />
      ) : null}
      {handles.includes("right-source") ? (
        onAddConnectedNode ? (
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            aria-label={addConnectedNodeLabel}
            role="button"
            tabIndex={0}
            onClick={handleAddConnectedNodeClick}
            onKeyDown={handleAddConnectedNodeKeyDown}
            className={cn(
              "group/add-port !z-20 !h-6 !w-6 !overflow-visible !rounded-full !border !border-primary/35 !bg-background !text-primary !shadow-[0_10px_24px_rgba(37,99,235,0.18)]",
              "opacity-0 transition-all group-hover:opacity-100 hover:!border-primary/60 hover:!bg-primary hover:!text-primary-foreground",
            )}
            style={lateralHandleTop != null ? { top: lateralHandleTop } : undefined}
          >
            <Plus className="pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2" strokeWidth={2} />
            <AddConnectedNodeTooltip />
          </Handle>
        ) : (
          <Handle
            type="source"
            position={Position.Right}
            id="right"
            className={simpleHandleClassName}
            style={lateralHandleTop != null ? { top: lateralHandleTop } : undefined}
          />
        )
      ) : null}
      {handles.includes("bottom-source") ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          className={simpleHandleClassName}
        />
      ) : null}
      <div className={cn("relative z-10 flex min-w-0 flex-col", contentClassName)}>
        {children}
      </div>
    </>
  );

  if (as === "button") {
    return (
      <button
        type="button"
        data-testid={testId}
        data-workflow-canvas-node-shell="true"
        data-node-shape={nodeShape}
        ref={elementRef}
        aria-label={ariaLabel}
        aria-pressed={selected}
        title={title}
        onClick={onClick}
        className={rootClassName}
        style={style}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      data-testid={testId}
      data-workflow-canvas-node-shell="true"
      data-node-shape={nodeShape}
      role="button"
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      title={title}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={rootClassName}
      style={style}
    >
      {body}
    </div>
  );
}

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeShape } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
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
  elementRef?: (el: HTMLButtonElement | null) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
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
  elementRef,
  onClick,
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
  const body = (
    <>
      <span
        aria-hidden="true"
        data-node-shape-surface="true"
        className={cn(
          "pointer-events-none absolute inset-0 border border-slate-300/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-150",
          workflowNodeShapeSurfaceClassName(nodeShape),
          "group-hover:border-primary/45 group-hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]",
          selected && "border-primary/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.15)]",
          surfaceClassName,
        )}
      />
      {handles.includes("left-target") ? (
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          className={cn("!bg-current opacity-0 transition-opacity group-hover:opacity-100", handleColorClassName)}
          style={lateralHandleTop != null ? { top: lateralHandleTop } : undefined}
        />
      ) : null}
      {handles.includes("right-source") ? (
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          className={cn("!bg-current opacity-0 transition-opacity group-hover:opacity-100", handleColorClassName)}
          style={lateralHandleTop != null ? { top: lateralHandleTop } : undefined}
        />
      ) : null}
      {handles.includes("bottom-source") ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          className={cn("!bg-current opacity-0 transition-opacity group-hover:opacity-100", handleColorClassName)}
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

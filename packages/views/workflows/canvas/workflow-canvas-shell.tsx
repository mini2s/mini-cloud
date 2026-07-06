"use client";

import type { ReactNode } from "react";
import type { CanvasMode, CanvasModel } from "@multica/core/workflows/canvas";

export interface CanvasCapabilities {
  canEditDefinition: boolean;
  canMoveNodes: boolean;
  canConnectNodes: boolean;
  canDeleteElements: boolean;
  canRunActions: boolean;
}

export interface WorkflowCanvasShellRenderArgs {
  model: CanvasModel;
  mode: CanvasMode;
  capabilities: CanvasCapabilities;
}

export interface WorkflowCanvasShellProps {
  mode: CanvasMode;
  model: CanvasModel;
  children: (args: WorkflowCanvasShellRenderArgs) => ReactNode;
}

export function getCanvasCapabilities(mode: CanvasMode): CanvasCapabilities {
  return {
    canEditDefinition: mode === "edit",
    canMoveNodes: mode === "edit",
    canConnectNodes: mode === "edit",
    canDeleteElements: mode === "edit",
    canRunActions: mode === "readonly-runtime",
  };
}

export function WorkflowCanvasShell({ mode, model, children }: WorkflowCanvasShellProps) {
  return (
    <div data-testid="workflow-canvas-shell" data-mode={mode} className="relative flex h-full min-h-0 flex-1">
      {children({ mode, model, capabilities: getCanvasCapabilities(mode) })}
    </div>
  );
}

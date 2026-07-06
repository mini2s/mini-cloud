"use client";

import type { ReactNode } from "react";
import { cn } from "@multica/ui/lib/utils";

export interface WorkflowCanvasShellProps {
  children: ReactNode;
  topBar?: ReactNode;
  leftPanel?: ReactNode;
  inspector?: ReactNode;
  bottomBar?: ReactNode;
  className?: string;
}

/**
 * Shared canvas shell for workflow editor and runtime views.
 * Provides the four-zone layout: top bar, left panel, main canvas, right inspector, bottom bar.
 */
export function WorkflowCanvasShell({
  children,
  topBar,
  leftPanel,
  inspector,
  bottomBar,
  className,
}: WorkflowCanvasShellProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Top bar */}
      {topBar && (
        <div className="shrink-0">{topBar}</div>
      )}

      {/* Main area: left panel | canvas | inspector */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel (NodePanel) */}
        {leftPanel}

        {/* Canvas */}
        <div className="flex-1 min-w-0 relative">
          {children}
        </div>

        {/* Right inspector */}
        {inspector}
      </div>

      {/* Bottom bar (PreflightBar / GlobalNotificationBar) */}
      {bottomBar && (
        <div className="shrink-0">{bottomBar}</div>
      )}
    </div>
  );
}

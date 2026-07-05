"use client";

import type { CanvasPreflightIssue } from "@multica/core/workflows/canvas";
import { Button } from "@multica/ui/components/ui/button";

export interface PreflightBarProps {
  issues: CanvasPreflightIssue[];
  onIssueClick: (issue: CanvasPreflightIssue) => void;
}

export function PreflightBar({ issues, onIssueClick }: PreflightBarProps) {
  if (issues.length === 0) {
    return (
      <div className="border-t bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        Ready to publish
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t bg-red-50 px-3 py-2">
      <span className="shrink-0 text-sm font-medium text-red-700">{issues.length} issue(s)</span>
      {issues.map((issue, index) => (
        <Button
          key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 border-red-200 bg-white text-xs text-red-700"
          onClick={() => onIssueClick(issue)}
        >
          {issue.message}
        </Button>
      ))}
    </div>
  );
}

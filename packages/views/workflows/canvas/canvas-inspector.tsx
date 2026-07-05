"use client";

import type { ReactNode } from "react";
import { Button } from "@multica/ui/components/ui/button";

export interface CanvasInspectorProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function CanvasInspector({ title, onClose, children }: CanvasInspectorProps) {
  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l bg-background">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </aside>
  );
}

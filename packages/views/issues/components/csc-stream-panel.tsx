"use client";

import { useEffect, useRef } from "react";
import { useT } from "@multica/views/i18n";
import { useTaskStream } from "@multica/core/issues";
import { Card, CardContent, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import { cn } from "@multica/ui/lib/utils";
import type { TaskStreamItem } from "@multica/core/issues";

interface CSCStreamPanelProps {
  issueId: string;
  className?: string;
}

export function CSCStreamPanel({ issueId, className }: CSCStreamPanelProps) {
  const { t } = useT("issues");
  const { items } = useTaskStream(issueId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [items.length]);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {t(($) => $.detail.section_csc_stream)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <div className="h-96 overflow-y-auto px-4 pb-4">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Waiting for CSC agent output…
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <StreamItem key={`${item.task_id}:${item.seq}`} item={item} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StreamItem({ item }: { item: TaskStreamItem }) {
  switch (item.type) {
    case "text":
      return (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {item.content}
        </div>
      );
    case "thinking":
      return (
        <details className="rounded-md border bg-muted/50 p-2 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Thinking
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
            {item.content}
          </p>
        </details>
      );
    case "tool_use":
      return (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-sm dark:border-blue-900 dark:bg-blue-950">
          <div className="font-medium">Tool: {item.tool}</div>
          {item.input && (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-white/50 p-1 text-xs dark:bg-black/20">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          )}
        </div>
      );
    case "tool_result":
      return (
        <div className="rounded-md border border-green-200 bg-green-50 p-2 text-sm dark:border-green-900 dark:bg-green-950">
          <div className="font-medium">Result: {item.tool}</div>
          {item.output && (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-white/50 p-1 text-xs dark:bg-black/20">
              {item.output}
            </pre>
          )}
        </div>
      );
    case "status":
      return (
        <div className="text-xs text-muted-foreground">
          Status: {item.status}
        </div>
      );
    case "error":
      return (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          Error: {item.content}
        </div>
      );
    case "log":
      return (
        <div className="text-xs text-muted-foreground">
          [{item.level ?? "log"}] {item.content}
        </div>
      );
    default:
      return (
        <div className="whitespace-pre-wrap text-sm text-muted-foreground">
          {item.content}
        </div>
      );
  }
}

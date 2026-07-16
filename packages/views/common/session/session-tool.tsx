"use client";

import { useMemo, useState } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { Check, ChevronRight, CircleAlert, Loader2, Terminal } from "lucide-react";
import { useT } from "../../i18n";

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function SessionTool({
  toolName,
  args,
  result,
  status,
  isError,
}: ToolCallMessagePartProps) {
  const { t } = useT("chat");
  const [open, setOpen] = useState(false);
  const input = useMemo(() => formatValue(args), [args]);
  const output = useMemo(() => formatValue(result), [result]);
  const running = status.type === "running";
  const failed = isError || status.type === "incomplete";
  const StatusIcon = running ? Loader2 : failed ? CircleAlert : Check;
  const statusLabel = running
    ? t(($) => $.session.tool_running)
    : failed
      ? t(($) => $.session.tool_error)
      : t(($) => $.session.tool_complete);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 rounded-lg border bg-muted/20">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={
          open
            ? t(($) => $.session.tool_collapse, { tool: toolName })
            : t(($) => $.session.tool_expand, { tool: toolName })
        }
      >
        <ChevronRight
          className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90")}
        />
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono font-medium">{toolName}</span>
        <span className={cn("inline-flex items-center gap-1 text-muted-foreground", failed && "text-destructive")}>
          <StatusIcon className={cn("size-3.5", running && "animate-spin motion-reduce:animate-none")} />
          {statusLabel}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <div className="max-h-56 space-y-3 overflow-y-auto overscroll-contain text-xs">
          {input && (
            <div className="space-y-1">
              <div className="font-medium text-muted-foreground">{t(($) => $.session.tool_input)}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5">{input}</pre>
            </div>
          )}
          {output && (
            <div className="space-y-1">
              <div className="font-medium text-muted-foreground">{t(($) => $.session.tool_output)}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5">{output}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

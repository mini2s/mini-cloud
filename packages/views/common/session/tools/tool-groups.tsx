"use client";

import { useAuiState } from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import { Brain, ChevronRight } from "lucide-react";
import {
  memo,
  useState,
  type PropsWithChildren,
} from "react";
import { useT } from "../../../i18n";

type GroupedPart = {
  indices: readonly number[];
};

export const ChainOfThoughtGroup = memo(function ChainOfThoughtGroup({
  children,
}: PropsWithChildren) {
  return <div className="space-y-1">{children}</div>;
});

export const ToolGroup = memo(function ToolGroup({
  children,
  group,
}: PropsWithChildren<{ group: GroupedPart }>) {
  const startIndex = group.indices[0] ?? 0;
  const endIndex = group.indices.at(-1) ?? startIndex;
  const textBefore = useAuiState((state) => {
    const parts = state.message.parts;
    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const type = parts[index]?.type;
      if (type === "data") continue;
      return type === "text";
    }
    return false;
  });
  const textAfter = useAuiState((state) => {
    const parts = state.message.parts;
    for (let index = endIndex + 1; index < parts.length; index += 1) {
      const type = parts[index]?.type;
      if (type === "data") continue;
      return type === "text";
    }
    return false;
  });

  return (
    <div
      className={cn(
        "space-y-1",
        textBefore && "mt-4",
        textAfter && "mb-4",
      )}
    >
      {children}
    </div>
  );
});

export const ReasoningGroup = memo(function ReasoningGroup({
  children,
  group,
}: PropsWithChildren<{ group: GroupedPart }>) {
  const { t } = useT("chat");
  const startIndex = group.indices[0] ?? 0;
  const endIndex = group.indices.at(-1) ?? startIndex;
  const running = useAuiState((state) => {
    if (state.message.status?.type !== "running") return false;
    const lastIndex = state.message.parts.length - 1;
    return lastIndex >= startIndex && lastIndex <= endIndex;
  });
  const [open, setOpen] = useState(running);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="text-sm text-muted-foreground"
    >
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md py-1 text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Brain className="size-3.5" />
        {running
          ? t(($) => $.session.reasoning_running)
          : t(($) => $.session.reasoning)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mt-1 space-y-1 border-l pl-3 text-xs leading-5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

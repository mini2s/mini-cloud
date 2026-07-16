"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState,
  type ReasoningMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { Button } from "@multica/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { Brain, Check, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { SessionTool } from "./session-tool";

function MarkdownPart() {
  return (
    <MarkdownTextPrimitive
      className="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      smooth
    />
  );
}

function ReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const { t } = useT("chat");
  const [open, setOpen] = useState(status.type === "running");
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 text-sm text-muted-foreground">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md py-1 text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        <Brain className="size-3.5" />
        {status.type === "running"
          ? t(($) => $.session.reasoning_running)
          : t(($) => $.session.reasoning)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mt-1 border-l pl-3 text-xs leading-5 whitespace-pre-wrap">{text}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AssistantMessage() {
  const { t } = useT("chat");
  const status = useAuiState((state) => state.message.status);
  return (
    <MessagePrimitive.Root className="group/message relative w-full px-1">
      <div className="min-w-0 text-sm leading-6">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownPart,
            Reasoning: ReasoningPart,
            tools: { Fallback: SessionTool },
          }}
        />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
        {status?.type === "incomplete" && status.reason === "cancelled" && (
          <div className="mt-2 text-xs text-muted-foreground">{t(($) => $.session.cancelled)}</div>
        )}
      </div>
      <ActionBarPrimitive.Root
        hideWhenRunning
        className="mt-1 flex h-7 items-center opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
      >
        <ActionBarPrimitive.Copy asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t(($) => $.session.copy)}>
            <AuiIf condition={(state) => state.message.isCopied}>
              <Check className="size-3.5" />
            </AuiIf>
            <AuiIf condition={(state) => !state.message.isCopied}>
              <Copy className="size-3.5" />
            </AuiIf>
          </Button>
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end px-1">
      <div className="max-w-[82%] rounded-2xl bg-muted px-3.5 py-2 text-sm">
        <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

export function SessionMessage() {
  const role = useAuiState((state) => state.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
}

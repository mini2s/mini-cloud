"use client";

import {
  ActionBarPrimitive,
  AuiIf,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { Button } from "@multica/ui/components/ui/button";
import { Check, Copy, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { FallbackTool } from "./tools/conversation-tools";
import {
  ChainOfThoughtGroup,
  ReasoningGroup,
  ToolGroup,
} from "./tools/tool-groups";

function MarkdownPart() {
  return (
    <MarkdownTextPrimitive
      className="prose prose-sm dark:prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      smooth
    />
  );
}

const groupMessageParts = groupPartByType({
  reasoning: ["group-chain-of-thought", "group-reasoning"],
  "tool-call": ["group-chain-of-thought", "group-tool"],
  "standalone-tool-call": [],
} as const);

function AssistantMessage() {
  const { t } = useT("chat");
  const status = useAuiState((state) => state.message.status);
  return (
    <MessagePrimitive.Root className="group/message relative w-full px-1">
      <div className="min-w-0 text-sm leading-6">
        <MessagePrimitive.GroupedParts groupBy={groupMessageParts}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chain-of-thought":
                return (
                  <ChainOfThoughtGroup>{children}</ChainOfThoughtGroup>
                );
              case "group-reasoning":
                return <ReasoningGroup group={part}>{children}</ReasoningGroup>;
              case "group-tool":
                return <ToolGroup group={part}>{children}</ToolGroup>;
              case "text":
                return <MarkdownPart />;
              case "reasoning":
                return (
                  <div className="whitespace-pre-wrap">{part.text}</div>
                );
              case "tool-call":
                return part.toolUI ?? <FallbackTool {...part} />;
              case "indicator":
                return (
                  <div
                    className="inline-flex items-center py-1 text-muted-foreground"
                    role="status"
                    aria-label={t(($) => $.session.reasoning_running)}
                  >
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  </div>
                );
              case "data":
              case "source":
              case "image":
              case "file":
              case "audio":
                return null;
            }
            return null;
          }}
        </MessagePrimitive.GroupedParts>
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

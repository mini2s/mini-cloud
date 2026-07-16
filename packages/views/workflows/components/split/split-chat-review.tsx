"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LoaderCircle, Send } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { cn } from "@multica/ui/lib/utils";
import { chatMessagesOptions, pendingChatTaskOptions } from "@multica/core/chat/queries";
import type { AgentTask, ChatMessage, ChatPendingTask } from "@multica/core/types";
import { useT } from "@multica/views/i18n";
import { CommentInput } from "../../../issues/components/comment-input";
import { InlineTranscriptPanel } from "../../../issues/components/execution-log/inline-transcript-panel";

interface SplitChatReviewProps {
  issueId?: string;
  chatSessionId?: string | null;
  disabled?: boolean;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
}

function useSuggestions() {
  const { t } = useT("workflows");
  return [
    t(($) => $.detail_panel.split_chat_suggestion_add_security),
    t(($) => $.detail_panel.split_chat_suggestion_merge),
    t(($) => $.detail_panel.split_chat_suggestion_restore),
  ];
}

function SplitInlineComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
}) {
  const { t } = useT("workflows");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (nextContent = content) => {
    const trimmed = nextContent.trim();
    if (!trimmed || disabled || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      setContent("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-background/95 p-2 shadow-sm">
      <textarea
        className="min-h-24 w-full resize-none rounded-sm bg-transparent px-1 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={t(($) => $.detail_panel.split_chat_adjustment_aria)}
        placeholder={t(($) => $.detail_panel.split_chat_adjustment_placeholder)}
        value={content}
        disabled={disabled || isSubmitting}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex justify-end border-t border-border/60 pt-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || isSubmitting || content.trim().length === 0}
          onClick={() => void submit()}
        >
          <Send className="mr-1.5 size-3.5" />
          {isSubmitting ? t(($) => $.detail_panel.split_chat_sending) : t(($) => $.detail_panel.split_chat_send)}
        </Button>
      </div>
    </div>
  );
}

function taskFromChatMessage(message: ChatMessage): AgentTask {
  return {
    id: message.task_id ?? "",
    agent_id: "",
    runtime_id: "",
    issue_id: "",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: message.created_at,
    chat_session_id: message.chat_session_id,
  };
}

function taskFromPendingTask(task: NonNullable<ChatPendingTask>, chatSessionId: string): AgentTask {
  return {
    id: task.task_id ?? "",
    agent_id: "",
    runtime_id: "",
    issue_id: "",
    status: task.status === "queued" ? "queued" : "running",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "",
    chat_session_id: chatSessionId,
  };
}

function SplitChatHistory({
  messages,
  isPending,
}: {
  messages: ChatMessage[];
  isPending: boolean;
}) {
  const { t } = useT("workflows");

  if (messages.length === 0) return null;

  return (
    <div data-testid="split-chat-history" className="space-y-3 border-y border-border/60 py-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">
          {t(($) => $.detail_panel.split_chat_agent_transcript)}
        </h4>
        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
          {messages.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "assistant" ? "justify-start" : "justify-end",
            )}
          >
            <div
              data-testid={`split-chat-message-${message.id}`}
              className={cn(
                "max-w-[92%] px-3 py-1.5 text-sm",
                message.role === "assistant"
                  ? "border-l-2 border-border/80 text-foreground"
                  : "border-r-2 border-primary/40 text-right text-foreground",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex items-center gap-2",
                  message.role === "assistant" ? "justify-start" : "justify-end",
                )}
              >
                <span className="text-[11px] font-medium text-muted-foreground">
                  {message.role === "assistant" ? t(($) => $.detail_panel.split_chat_role_agent) : t(($) => $.detail_panel.split_chat_role_you)}
                </span>
                <span className="text-[10px] text-muted-foreground/80">{message.created_at}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground">{message.content}</p>
              {message.role === "assistant" && message.task_id ? (
                <div className="mt-2 border-t border-border/60 pt-2 text-left">
                  <InlineTranscriptPanel
                    task={taskFromChatMessage(message)}
                    isLive={isPending}
                    defaultOpen={isPending}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SplitChatReview({
  issueId,
  chatSessionId,
  disabled = false,
  onSubmit,
}: SplitChatReviewProps) {
  const { t } = useT("workflows");
  const suggestions = useSuggestions();
  const [processOpen, setProcessOpen] = useState(false);
  const { data: messages = [] } = useQuery(chatMessagesOptions(chatSessionId ?? ""));
  const { data: pendingTask } = useQuery(pendingChatTaskOptions(chatSessionId ?? ""));
  const isAgentRunning = !!pendingTask?.task_id;
  const hasHistory = messages.length > 0 || isAgentRunning;

  return (
    <div className="pb-20 pr-14">
      <div
        data-testid="split-chat-workbench"
        className="overflow-hidden rounded-lg border bg-background/80 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2" aria-live="polite">
            {isAgentRunning ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
            ) : null}
            <span className="truncate text-sm font-medium text-foreground">
              {isAgentRunning
                ? t(($) => $.detail_panel.split_chat_agent_thinking)
                : t(($) => $.detail_panel.split_chat_ready_title)}
            </span>
            {isAgentRunning ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {pendingTask?.status === "queued"
                  ? t(($) => $.detail_panel.split_chat_queued)
                  : t(($) => $.detail_panel.split_chat_live_badge)}
              </Badge>
            ) : null}
          </div>
          {isAgentRunning && pendingTask?.task_id ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs"
              aria-expanded={processOpen}
              onClick={() => setProcessOpen((open) => !open)}
            >
              {processOpen ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              {processOpen
                ? t(($) => $.detail_panel.split_chat_hide_process)
                : t(($) => $.detail_panel.split_chat_view_process)}
            </Button>
          ) : null}
        </div>

        <div className="space-y-3 p-3">
          <SplitChatHistory messages={messages} isPending={isAgentRunning} />

          {isAgentRunning && pendingTask?.task_id && processOpen ? (
            <div className="rounded-md border bg-muted/15 px-3 py-2">
              <InlineTranscriptPanel
                task={taskFromPendingTask(pendingTask, chatSessionId ?? "")}
                isLive
                defaultOpen={false}
              />
            </div>
          ) : null}

          {!hasHistory ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void onSubmit(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}

          {issueId ? (
            <div aria-disabled={disabled || undefined}>
              <CommentInput
                issueId={issueId}
                onSubmit={onSubmit}
                disabled={disabled}
                variant="split-review"
                placeholder={t(($) => $.detail_panel.split_chat_adjustment_placeholder)}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t(($) => $.detail_panel.split_chat_non_workflow_hint)}
              </p>
            </div>
          ) : (
            <>
              <SplitInlineComposer disabled={disabled} onSubmit={onSubmit} />
              <p className="text-[11px] text-muted-foreground">
                {t(($) => $.detail_panel.split_chat_non_workflow_hint)}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

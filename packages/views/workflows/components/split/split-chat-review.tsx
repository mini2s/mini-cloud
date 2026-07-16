"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Send } from "lucide-react";
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
    <div className="space-y-2 rounded-lg border bg-background/70 p-2">
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
              className={cn(
                "max-w-[92%] rounded-lg px-3 py-2 text-sm shadow-sm ring-1",
                message.role === "assistant"
                  ? "rounded-tl-sm bg-muted/45 text-foreground ring-border/70"
                  : "rounded-tr-sm bg-primary/10 text-foreground ring-primary/15",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {message.role === "assistant" ? t(($) => $.detail_panel.split_chat_role_agent) : t(($) => $.detail_panel.split_chat_role_you)}
                </span>
                <span className="text-[10px] text-muted-foreground/80">{message.created_at}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-foreground">{message.content}</p>
              {message.role === "assistant" && message.task_id ? (
                <div className="mt-2 rounded-md border bg-background/75 px-2 py-1.5">
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
  const { data: messages = [] } = useQuery(chatMessagesOptions(chatSessionId ?? ""));
  const { data: pendingTask } = useQuery(pendingChatTaskOptions(chatSessionId ?? ""));
  const isAgentRunning = !!pendingTask?.task_id;
  const hasHistory = messages.length > 0 || isAgentRunning;

  return (
    <div className="space-y-3 pb-20 pr-14">
      <SplitChatHistory messages={messages} isPending={isAgentRunning} />

      {isAgentRunning ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2"
          aria-live="polite"
        >
          <LoaderCircle className="size-3.5 animate-spin text-amber-600" />
          <span className="text-sm font-medium text-foreground">{t(($) => $.detail_panel.split_chat_agent_thinking)}</span>
          {pendingTask?.status === "queued" ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">{t(($) => $.detail_panel.split_chat_queued)}</Badge>
          ) : null}
        </div>
      ) : null}

      {isAgentRunning && pendingTask?.task_id ? (
        <div className="rounded-lg border bg-muted/20 px-3 py-2">
          <InlineTranscriptPanel
            task={taskFromPendingTask(pendingTask, chatSessionId ?? "")}
            isLive
            defaultOpen
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
          <p className="mb-2 text-[11px] text-muted-foreground">
            {t(($) => $.detail_panel.split_chat_non_workflow_hint)}
          </p>
          <CommentInput
            issueId={issueId}
            onSubmit={onSubmit}
            disabled={disabled}
            variant="split-review"
            placeholder={t(($) => $.detail_panel.split_chat_adjustment_placeholder)}
          />
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t(($) => $.detail_panel.split_chat_non_workflow_hint)}
          </p>
          <SplitInlineComposer disabled={disabled} onSubmit={onSubmit} />
        </>
      )}
    </div>
  );
}

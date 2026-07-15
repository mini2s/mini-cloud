"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Badge } from "@multica/ui/components/ui/badge";
import { chatMessagesOptions, pendingChatTaskOptions } from "@multica/core/chat/queries";
import type { AgentTask, ChatMessage } from "@multica/core/types";
import { CommentInput } from "../../../issues/components/comment-input";
import { InlineTranscriptPanel } from "../../../issues/components/execution-log/inline-transcript-panel";

interface SplitChatReviewProps {
  issueId?: string;
  chatSessionId?: string | null;
  disabled?: boolean;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
}

const SUGGESTIONS = [
  "添加一个安全审计子 issue",
  "合并第 2 个和第 3 个",
  "恢复到最初生成的草案",
];

function SplitInlineComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
}) {
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
    <div className="rounded-lg border bg-background p-2">
      <textarea
        className="min-h-20 w-full resize-none rounded-sm bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="输入调整要求"
        placeholder="输入调整要求…"
        value={content}
        disabled={disabled || isSubmitting}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={disabled || isSubmitting || content.trim().length === 0}
          onClick={() => void submit()}
        >
          <Send className="mr-1.5 size-3.5" />
          {isSubmitting ? "发送中…" : "发送"}
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

function SplitChatHistory({
  messages,
  isPending,
}: {
  messages: ChatMessage[];
  isPending: boolean;
}) {
  if (messages.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Agent transcript</h4>
        <Badge variant="outline">{messages.length}</Badge>
      </div>
      <div className="space-y-2">
        {messages.map((message) => (
          <div key={message.id} className="rounded-md border bg-background px-2.5 py-2">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant={message.role === "assistant" ? "secondary" : "outline"}>
                {message.role === "assistant" ? "Agent" : "You"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{message.created_at}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-snug text-foreground">{message.content}</p>
            {message.role === "assistant" && message.task_id ? (
              <InlineTranscriptPanel
                task={taskFromChatMessage(message)}
                isLive={isPending}
                defaultOpen={isPending}
              />
            ) : null}
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
  const { data: messages = [] } = useQuery(chatMessagesOptions(chatSessionId ?? ""));
  const { data: pendingTask } = useQuery(pendingChatTaskOptions(chatSessionId ?? ""));
  const isAgentRunning = !!(pendingTask?.task_id);
  const hasHistory = messages.length > 0 || isAgentRunning;

  return (
    <div className="space-y-2">
      <SplitChatHistory messages={messages} isPending={isAgentRunning} />

      {/* Agent thinking indicator — shown while a split chat task is in-flight */}
      {isAgentRunning ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">Agent 正在思考…</span>
          {pendingTask?.status === "queued" ? (
            <Badge variant="outline" className="text-xs">排队中</Badge>
          ) : null}
        </div>
      ) : null}

      {!hasHistory ? (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
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
        <div aria-disabled={disabled} className={disabled ? "pointer-events-none opacity-60" : undefined}>
          <CommentInput issueId={issueId} onSubmit={onSubmit} />
        </div>
      ) : (
        <SplitInlineComposer disabled={disabled} onSubmit={onSubmit} />
      )}
    </div>
  );
}

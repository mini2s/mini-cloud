"use client";

import { useState, useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface WorkflowAiPanelProps {
  workflowId: string;
  disabled?: boolean;
}

export function WorkflowAiPanel({ workflowId, disabled }: WorkflowAiPanelProps) {
  const { t } = useT("ai");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, agentId: string) => {
      // Add user message locally
      const userMsg: ChatMessage = { role: "user", content: input };
      const history = [...messages, userMsg];
      setMessages(history);

      // Send to backend with full chat history for multi-turn context
      await mutation.mutateAsync({
        contextType: "workflow",
        contextId: workflowId,
        userInput: input,
        mode: "chat",
        agentId: agentId || undefined,
        messages: history,
      });

      // The actual agent response comes via WS events (workflow:updated)
      // We don't add a fake assistant message — the canvas refresh is the response
    },
    [workflowId, messages, mutation],
  );

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {/* Chat message history */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto px-1">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-sm ${msg.role === "user" ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="font-medium text-xs text-muted-foreground">
                {msg.role === "user" ? t($ => $.you) : t($ => $.agent)}:
              </span>{" "}
              {msg.content}
            </div>
          ))}
        </div>
      )}
      <AiInputCore
        mode="chat"
        placeholder={t($ => $.workflow_placeholder)}
        showAgentSelector
        onSubmit={handleSubmit}
        disabled={disabled || mutation.isPending}
      />
    </div>
  );
}

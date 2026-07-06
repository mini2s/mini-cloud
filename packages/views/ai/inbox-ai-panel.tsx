"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../i18n";

interface InboxAiPanelProps {
  disabled?: boolean;
}

export function InboxAiPanel({ disabled }: InboxAiPanelProps) {
  const { t } = useT("ai");
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, agentId: string) => {
      await mutation.mutateAsync({
        contextType: "inbox",
        contextId: "", // inbox queries don't need a specific entity ID
        userInput: input,
        mode: "command",
        agentId: agentId || undefined,
      });
    },
    [mutation],
  );

  return (
    <AiInputCore
      mode="command"
      placeholder={t($ => $.inbox_placeholder)}
      showAgentSelector={false}
      onSubmit={handleSubmit}
      disabled={disabled || mutation.isPending}
    />
  );
}

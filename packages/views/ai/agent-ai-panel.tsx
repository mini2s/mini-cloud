"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../i18n";

interface AgentAiPanelProps {
  disabled?: boolean;
}

export function AgentAiPanel({ disabled }: AgentAiPanelProps) {
  const { t } = useT("ai");
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, _agentId: string) => {
      await mutation.mutateAsync({
        contextType: "agent",
        contextId: "", // agent creation doesn't need a pre-existing entity ID
        userInput: input,
        mode: "command",
      });
    },
    [mutation],
  );

  return (
    <AiInputCore
      mode="command"
      placeholder={t($ => $.agent_placeholder)}
      showAgentSelector
      onSubmit={handleSubmit}
      disabled={disabled || mutation.isPending}
    />
  );
}

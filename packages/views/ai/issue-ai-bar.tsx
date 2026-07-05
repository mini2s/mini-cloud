"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { parseIssueCommand } from "@multica/core/ai/issue-commands";

interface IssueAiBarProps {
  issueId: string;
  /** Called with the parsed intent BEFORE the API call, for optimistic updates. */
  onOptimisticIntent?: (intent: ReturnType<typeof parseIssueCommand>) => void;
  disabled?: boolean;
}

export function IssueAiBar({ issueId, onOptimisticIntent, disabled }: IssueAiBarProps) {
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, _agentId: string) => {
      // Parse intent locally for optimistic update
      const intent = parseIssueCommand(input);

      // Apply optimistic update BEFORE the API call
      if (intent.type !== "unknown") {
        onOptimisticIntent?.(intent);
      }

      // Fire API call — the agent handles the actual mutation
      await mutation.mutateAsync({
        contextType: "issue",
        contextId: issueId,
        userInput: input,
        mode: "command",
      });
    },
    [issueId, mutation, onOptimisticIntent],
  );

  return (
    <div className="flex flex-col gap-1">
      <AiInputCore
        mode="command"
        placeholder="Command the AI…"
        showAgentSelector={false}
        onSubmit={handleSubmit}
        disabled={disabled || mutation.isPending}
      />
      {mutation.isError && (
        <p className="text-xs text-destructive px-1">
          Command failed. Try again.
        </p>
      )}
    </div>
  );
}

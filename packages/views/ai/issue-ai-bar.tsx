"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { parseIssueCommand } from "@multica/core/ai/issue-commands";
import { useCommandTaskListener } from "@multica/core/ai/task-listener";

interface IssueAiBarProps {
  issueId: string;
  /** Called with the parsed intent BEFORE the API call, for optimistic updates. */
  onOptimisticIntent?: (intent: ReturnType<typeof parseIssueCommand>) => void;
  disabled?: boolean;
}

export function IssueAiBar({ issueId, onOptimisticIntent, disabled }: IssueAiBarProps) {
  const mutation = useSubmitCommand();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);

  // Listen for task completion/failure events for the active command task
  useCommandTaskListener(taskId, {
    onFailed: () => {
      // Rollback optimistic update by re-fetching issue data
      queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
    },
  });

  const handleSubmit = useCallback(
    async (input: string, _agentId: string) => {
      // Parse intent locally for optimistic update
      const intent = parseIssueCommand(input);

      // Apply optimistic update BEFORE the API call
      if (intent.type !== "unknown") {
        onOptimisticIntent?.(intent);
      }

      // Fire API call — the agent handles the actual mutation
      const result = await mutation.mutateAsync({
        contextType: "issue",
        contextId: issueId,
        userInput: input,
        mode: "command",
      });

      // Track task_id so we can react to task:completed / task:failed events
      if (result?.task_id) {
        setTaskId(result.task_id);
      }
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

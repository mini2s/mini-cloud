"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memo, useMemo } from "react";
import {
  ConversationToolEntryProvider,
  useConversationToolBridge,
  useConversationToolEntry,
} from "../runtime/conversation-tool-bridge";
import {
  PermissionCard,
  normalizePermissionRequest,
} from "./permission-card";
import {
  QuestionCard,
  normalizeQuestionRequest,
} from "./question-card";

export function withConversationToolInteractions<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(
  BaseComponent: ToolCallMessagePartComponent<TArgs, TResult>,
): ToolCallMessagePartComponent<TArgs, TResult> {
  const Wrapped: ToolCallMessagePartComponent<TArgs, TResult> = memo(
    (props) => {
      const bridge = useConversationToolBridge();
      const directEntry = useConversationToolEntry(props.toolCallId);
      const entry = useMemo(
        () =>
          directEntry ??
          [...(bridge?.toolsByCallId.values() ?? [])].find(
            (candidate) =>
              candidate.callId === props.toolCallId ||
              candidate.partId === props.toolCallId,
          ),
        [bridge, directEntry, props.toolCallId],
      );
      const normalizedQuestions = useMemo(
        () =>
          (entry?.questions ?? []).flatMap((question) => {
            const normalized = normalizeQuestionRequest(question);
            return normalized ? [normalized] : [];
          }),
        [entry?.questions],
      );
      const permissions = entry?.permissions ?? [];
      const normalizedPermissions = permissions.flatMap((permission) => {
        const normalized = normalizePermissionRequest(permission);
        return normalized ? [normalized] : [];
      });

      return (
        <ConversationToolEntryProvider entry={entry}>
          <div className="space-y-3">
            <BaseComponent {...props} />
            {normalizedPermissions.map((request) => (
              <PermissionCard
                key={request.id}
                request={request}
                canInteract={bridge?.canInteract ?? false}
                onRespond={(decision) =>
                  bridge
                    ? bridge.respondToPermission(request.id, decision)
                    : Promise.reject(
                        new Error("Conversation runtime is unavailable."),
                      )
                }
              />
            ))}
            {normalizedQuestions.map((request) => (
              <QuestionCard
                key={request.id}
                request={request}
                canInteract={bridge?.canInteract ?? false}
                onSubmit={(answers) =>
                  bridge
                    ? bridge.replyToQuestion(request.id, answers)
                    : Promise.reject(
                        new Error("Conversation runtime is unavailable."),
                      )
                }
                onReject={() =>
                  bridge
                    ? bridge.rejectQuestion(request.id)
                    : Promise.reject(
                        new Error("Conversation runtime is unavailable."),
                      )
                }
              />
            ))}
          </div>
        </ConversationToolEntryProvider>
      );
    },
  );

  Wrapped.displayName = `withConversationToolInteractions(${BaseComponent.displayName || BaseComponent.name || "Tool"})`;
  return Wrapped;
}

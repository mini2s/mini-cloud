"use client";

import { useMemo } from "react";
import {
  PermissionCard,
  normalizePermissionRequest,
} from "../tools/permission-card";
import {
  QuestionCard,
  normalizeQuestionRequest,
} from "../tools/question-card";
import { useConversationToolBridge } from "./conversation-tool-bridge";

export function ConversationInteractionFallback() {
  const bridge = useConversationToolBridge();
  const question = useMemo(
    () =>
      bridge?.unassignedQuestions
        .map(normalizeQuestionRequest)
        .find((request) => request !== undefined),
    [bridge?.unassignedQuestions],
  );
  const permission = useMemo(
    () =>
      bridge?.unassignedPermissions
        .map(normalizePermissionRequest)
        .find((request) => request !== undefined),
    [bridge?.unassignedPermissions],
  );

  if (!bridge || (!question && !permission)) return null;

  return (
    <div data-testid="conversation-interaction-fallback">
      {question ? (
        <QuestionCard
          request={question}
          canInteract={bridge.canInteract}
          onSubmit={(answers) => bridge.replyToQuestion(question.id, answers)}
          onReject={() => bridge.rejectQuestion(question.id)}
        />
      ) : permission ? (
        <PermissionCard
          request={permission}
          canInteract={bridge.canInteract}
          onRespond={(decision) =>
            bridge.respondToPermission(permission.id, decision)
          }
        />
      ) : null}
    </div>
  );
}

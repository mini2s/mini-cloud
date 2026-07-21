import type { OpenCodePart, OpenCodeRecord } from "../types";
import type {
  ConversationQuestionResponse,
  ConversationRuntimeState,
  ConversationTaskState,
} from "./state";

function asRecord(value: unknown): OpenCodeRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as OpenCodeRecord)
    : undefined;
}

function interactionCallId(value: OpenCodeRecord): string | undefined {
  const tool = asRecord(value.tool);
  return typeof tool?.callID === "string" ? tool.callID : undefined;
}

function matchesTool(
  value: OpenCodeRecord,
  identities: ReadonlySet<string>,
): boolean {
  const callId = interactionCallId(value);
  return callId !== undefined && identities.has(callId);
}

const QUESTION_TOOL_NAMES = new Set([
  "question",
  "ask_question",
  "askuserquestion",
  "ask_user_question",
  "ask_user_questions",
  "request_user_input",
  "requestuserinput",
]);

function isQuestionToolName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    QUESTION_TOOL_NAMES.has(value.toLowerCase())
  );
}

function normalizedQuestionList(value: unknown): unknown {
  if (!Array.isArray(value)) return [];
  return value.map((rawQuestion) => {
    const question = asRecord(rawQuestion) ?? {};
    const options = Array.isArray(question.options)
      ? question.options.map((rawOption) => {
          const option = asRecord(rawOption) ?? {};
          return {
            label: typeof option.label === "string" ? option.label : "",
            description:
              typeof option.description === "string"
                ? option.description
                : undefined,
          };
        })
      : undefined;
    const normalizedQuestion: OpenCodeRecord = {};

    if (typeof question.header === "string") {
      normalizedQuestion.header = question.header;
    }
    if (typeof question.question === "string") {
      normalizedQuestion.question = question.question;
    }
    if (options !== undefined) {
      normalizedQuestion.options = options;
    }

    return normalizedQuestion;
  });
}

function matchesQuestionPayload(
  value: OpenCodeRecord,
  providerState: OpenCodeRecord | undefined,
  toolName: unknown,
): boolean {
  if (!isQuestionToolName(toolName)) return false;
  if (interactionCallId(value) !== undefined) return false;
  const input = asRecord(providerState?.input);
  if (!Array.isArray(value.questions) || !Array.isArray(input?.questions)) {
    return false;
  }
  return (
    JSON.stringify(normalizedQuestionList(value.questions)) ===
    JSON.stringify(normalizedQuestionList(input.questions))
  );
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function findTask(
  tasks: Readonly<Record<string, ConversationTaskState>>,
  identities: ReadonlySet<string>,
): ConversationTaskState | undefined {
  return Object.values(tasks).find(
    (task) =>
      (task.toolUseID !== undefined && identities.has(task.toolUseID)) ||
      identities.has(task.taskID),
  );
}

export type ConversationToolEntry = {
  toolCallId: string;
  callId?: string;
  partId?: string;
  messageId: string;
  toolName: string;
  part: OpenCodePart;
  providerState?: OpenCodeRecord;
  progress: readonly string[];
  permissions: readonly OpenCodeRecord[];
  questions: readonly OpenCodeRecord[];
  questionResponses: readonly ConversationQuestionResponse[];
  task?: ConversationTaskState;
};

export type ConversationToolSelection = {
  toolsByCallId: ReadonlyMap<string, ConversationToolEntry>;
  unassignedPermissions: readonly OpenCodeRecord[];
  unassignedQuestions: readonly OpenCodeRecord[];
};

export function selectConversationTools(
  state: ConversationRuntimeState,
): ConversationToolSelection {
  const permissions = Object.values(state.permissions);
  const questions = Object.values(state.questions);
  const questionResponses = Object.values(state.questionResponses);
  const assignedPermissions = new Set<OpenCodeRecord>();
  const assignedQuestions = new Set<OpenCodeRecord>();
  const assignedQuestionResponses = new Set<ConversationQuestionResponse>();
  const toolsByCallId = new Map<string, ConversationToolEntry>();

  for (const messageId of state.messageOrder) {
    const message = state.messagesById[messageId];
    if (!message) continue;

    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      const callId =
        typeof part.callID === "string" && part.callID.length > 0
          ? part.callID
          : undefined;
      const partId =
        typeof part.id === "string" && part.id.length > 0 ? part.id : undefined;
      const toolCallId = callId ?? partId;
      if (!toolCallId) continue;

      const identities = new Set(
        [toolCallId, callId, partId].filter(
          (value): value is string => value !== undefined,
        ),
      );
      const providerState = asRecord(part.state);
      const toolPermissions = permissions.filter((permission) => {
        if (assignedPermissions.has(permission)) return false;
        const matches = matchesTool(permission, identities);
        if (matches) assignedPermissions.add(permission);
        return matches;
      });
      const toolQuestions = questions.filter((question) => {
        if (assignedQuestions.has(question)) return false;
        const matches =
          matchesTool(question, identities) ||
          matchesQuestionPayload(question, providerState, part.tool);
        if (matches) assignedQuestions.add(question);
        return matches;
      });
      const toolQuestionResponses = questionResponses.filter((response) => {
        if (assignedQuestionResponses.has(response)) return false;
        const matches =
          matchesTool(response.request, identities) ||
          matchesQuestionPayload(response.request, providerState, part.tool);
        if (matches) assignedQuestionResponses.add(response);
        return matches;
      });
      const progress = [
        ...stringArray(providerState?.progress),
        ...[...identities].flatMap((identity) => [
          ...stringArray(state.partProgress[identity]),
          ...(state.toolProgress[identity]
            ? [state.toolProgress[identity]]
            : []),
        ]),
      ];
      const task = findTask(state.tasks, identities);

      toolsByCallId.set(toolCallId, {
        toolCallId,
        ...(callId ? { callId } : {}),
        ...(partId ? { partId } : {}),
        messageId,
        toolName: typeof part.tool === "string" ? part.tool : "unknown",
        part,
        ...(providerState ? { providerState } : {}),
        progress: [...new Set(progress)].slice(-10),
        permissions: toolPermissions,
        questions: toolQuestions,
        questionResponses: toolQuestionResponses,
        ...(task ? { task } : {}),
      });
    }
  }

  return {
    toolsByCallId,
    unassignedPermissions: permissions.filter(
      (permission) => !assignedPermissions.has(permission),
    ),
    unassignedQuestions: questions.filter(
      (question) => !assignedQuestions.has(question),
    ),
  };
}

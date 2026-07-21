import type {
  OpenCodeMessageInfo,
  OpenCodeMessageWithParts,
  OpenCodePart,
  OpenCodePromptPart,
  OpenCodeRecord,
  OpenCodeRuntimeEvent,
  OpenCodeSessionStatus,
  OpenCodeTaskSnapshot,
  OpenCodeTaskUsage,
} from "../types";
import type {
  ConversationQuestionResponse,
  ConversationSessionError,
  ConversationTaskState,
  PendingOpenCodeMessage,
  ConversationRuntimeState,
  StoredOpenCodeMessage,
} from "./state";

const MAX_UNHANDLED_EVENTS = 50;

function asRecord(value: unknown): OpenCodeRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as OpenCodeRecord)
    : undefined;
}

function asRecordArray(value: unknown): OpenCodeRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is OpenCodeRecord =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function recordId(value: OpenCodeRecord): string | undefined {
  if (typeof value.id === "string") return value.id;
  if (typeof value.requestID === "string") return value.requestID;
  return undefined;
}

function recordSessionId(value: OpenCodeRecord): string | undefined {
  if (typeof value.sessionID === "string") return value.sessionID;
  return typeof value.session_id === "string" ? value.session_id : undefined;
}

function indexRecords(
  records: readonly OpenCodeRecord[],
  conversationId: string,
) {
  const indexed: Record<string, OpenCodeRecord> = {};
  for (const record of records) {
    if (recordSessionId(record) !== conversationId) continue;
    const id = recordId(record);
    if (id) indexed[id] = record;
  }
  return indexed;
}

function createdAt(message: StoredOpenCodeMessage): number {
  const value = message.info?.time?.created;
  return typeof value === "number" ? value : 0;
}

function sortMessageIds(
  messagesById: Readonly<Record<string, StoredOpenCodeMessage>>,
) {
  return Object.keys(messagesById).sort((left, right) => {
    const byTime = createdAt(messagesById[left]!) - createdAt(messagesById[right]!);
    return byTime || left.localeCompare(right);
  });
}

function mergeMessageInfo(
  previous: OpenCodeMessageInfo | undefined,
  next: OpenCodeMessageInfo,
): OpenCodeMessageInfo {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    time: {
      ...(previous.time ?? {}),
      ...(next.time ?? {}),
      ...(next.time?.created === undefined &&
      previous.time?.created !== undefined
        ? { created: previous.time.created }
        : {}),
    },
  };
}

function mergeToolPart(previous: OpenCodePart, next: OpenCodePart): OpenCodePart {
  if (previous.type !== "tool" || next.type !== "tool") return next;
  const previousState = asRecord(previous.state);
  const nextState = asRecord(next.state);
  if (
    previousState?.output === undefined ||
    nextState?.output !== undefined
  ) {
    return next;
  }
  return {
    ...next,
    state: { ...(nextState ?? {}), output: previousState.output },
  };
}

function upsertPart(
  parts: readonly OpenCodePart[],
  part: OpenCodePart,
): readonly OpenCodePart[] {
  const indexById = part.id
    ? parts.findIndex((candidate) => candidate.id === part.id)
    : -1;
  const indexByCallId =
    indexById === -1 &&
    part.type === "tool" &&
    typeof part.callID === "string"
      ? parts.findIndex(
          (candidate) =>
            candidate.type === "tool" &&
            part.callID === candidate.callID,
        )
      : -1;
  const index = indexById !== -1 ? indexById : indexByCallId;
  if (index === -1) return [...parts, part];
  const normalizedPart =
    indexById === -1 && parts[index]?.id
      ? { ...part, id: parts[index].id }
      : part;
  const next = [...parts];
  next[index] = mergeToolPart(parts[index]!, normalizedPart);
  return next;
}

function applyPartDelta(
  part: OpenCodePart,
  field: string,
  delta: string,
): OpenCodePart | null {
  if (
    field === "text" &&
    (part.type === "text" || part.type === "reasoning")
  ) {
    return {
      ...part,
      text: `${typeof part.text === "string" ? part.text : ""}${delta}`,
    };
  }

  if (field === "input" && part.type === "tool") {
    const state = asRecord(part.state) ?? {};
    return {
      ...part,
      state: {
        ...state,
        input: `${typeof state.input === "string" ? state.input : ""}${delta}`,
      },
    };
  }
  return {
    ...part,
    [field]: `${typeof part[field] === "string" ? part[field] : ""}${delta}`,
  };
}

function removeRecord<T>(records: Readonly<Record<string, T>>, id: string) {
  if (!(id in records)) return records;
  const next = { ...records };
  delete next[id];
  return next;
}

function normalizeQuestionAnswers(
  value: unknown,
): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((answer) =>
    Array.isArray(answer)
      ? answer.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function recordQuestionResponse({
  state,
  id,
  request,
  response,
}: {
  state: ConversationRuntimeState;
  id: string;
  request?: OpenCodeRecord;
  response:
    | { type: "answered"; answers?: unknown }
    | { type: "rejected" };
}): ConversationRuntimeState {
  const existing = state.questionResponses[id];
  const resolvedRequest = request ?? state.questions[id] ?? existing?.request;
  const questions = removeRecord(state.questions, id);
  if (!resolvedRequest) return { ...state, questions };

  const normalizedAnswers =
    response.type === "answered"
      ? normalizeQuestionAnswers(response.answers) ?? existing?.answers
      : undefined;
  const resolved: ConversationQuestionResponse = {
    request: resolvedRequest,
    state: response.type,
    ...(normalizedAnswers ? { answers: normalizedAnswers } : {}),
    respondedAt: Date.now(),
  };
  return {
    ...state,
    questions,
    questionResponses: {
      ...state.questionResponses,
      [id]: resolved,
    },
  };
}

function normalizeSessionError(
  properties: OpenCodeRecord,
): ConversationSessionError {
  const source =
    typeof properties.error === "object" && properties.error !== null
      ? { ...(properties.error as OpenCodeRecord) }
      : {};
  const normalized: ConversationSessionError = { ...source };

  const stringFields = ["subtype", "level", "message"] as const;
  for (const field of stringFields) {
    const sourceValue = source[field];
    const value =
      typeof sourceValue === "string"
        ? sourceValue
        : field === "message" && typeof properties.error === "string"
          ? properties.error
          : field === "message" && typeof properties.message === "string"
            ? properties.message
            : undefined;
    if (typeof value === "string") normalized[field] = value;
    else delete normalized[field];
  }

  const numberFields = [
    "retryInMs",
    "retryAttempt",
    "maxRetries",
  ] as const;
  for (const field of numberFields) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[field] = value;
    } else {
      delete normalized[field];
    }
  }
  return normalized;
}

function normalizeTaskUsage(value: unknown): OpenCodeTaskUsage | undefined {
  const usage = asRecord(value);
  if (
    typeof usage?.total_tokens !== "number" ||
    typeof usage.tool_uses !== "number" ||
    typeof usage.duration_ms !== "number"
  ) {
    return undefined;
  }
  return {
    total_tokens: usage.total_tokens,
    tool_uses: usage.tool_uses,
    duration_ms: usage.duration_ms,
  };
}

function normalizeTaskStatus(
  value: unknown,
): ConversationTaskState["status"] {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
    ? value
    : "completed";
}

function indexTasks(
  tasks: readonly OpenCodeTaskSnapshot[],
): Record<string, ConversationTaskState> {
  const indexed: Record<string, ConversationTaskState> = {};
  for (const task of tasks) {
    indexed[task.taskID] = {
      taskID: task.taskID,
      ...(task.toolUseID !== undefined ? { toolUseID: task.toolUseID } : {}),
      status: normalizeTaskStatus(task.status),
      description: task.description ?? "",
      ...(task.taskType !== undefined ? { taskType: task.taskType } : {}),
      ...(task.summary !== undefined ? { summary: task.summary } : {}),
      ...(task.usage !== undefined ? { usage: task.usage } : {}),
      startTime: task.startTime ?? Date.now(),
      ...(task.endTime !== undefined ? { endTime: task.endTime } : {}),
    };
  }
  return indexed;
}

function appendUnhandled(
  state: ConversationRuntimeState,
  event: OpenCodeRuntimeEvent,
): ConversationRuntimeState {
  return {
    ...state,
    unhandledEvents: [
      ...state.unhandledEvents,
      {
        type: event.type,
        properties: event.properties,
        seenAt: Date.now(),
      },
    ].slice(-MAX_UNHANDLED_EVENTS),
  };
}

export type ConversationRuntimeSnapshot = {
  conversation: OpenCodeRecord | null;
  messages: readonly OpenCodeMessageWithParts[];
  status: OpenCodeSessionStatus | null;
  permissions: readonly OpenCodeRecord[];
  questions: readonly OpenCodeRecord[];
  todo: readonly OpenCodeRecord[];
  tasks: readonly OpenCodeTaskSnapshot[] | null;
  diff: readonly OpenCodeRecord[];
};

export type ConversationRuntimeAction =
  | { type: "load-started" }
  | { type: "snapshot-loaded"; snapshot: ConversationRuntimeSnapshot }
  | { type: "load-failed"; error: unknown }
  | { type: "event"; event: OpenCodeRuntimeEvent }
  | {
      type: "pending-message-added";
      message: PendingOpenCodeMessage;
    }
  | { type: "pending-message-failed"; id: string; error: unknown }
  | {
      type: "question-response-recorded";
      id: string;
      request?: OpenCodeRecord;
      response:
        | { type: "answered"; answers: readonly unknown[] }
        | { type: "rejected" };
    }
  | { type: "run-cancelling" }
  | { type: "run-idle" }
  | { type: "run-failed"; error: unknown }
  | { type: "stream-reconnected"; at: number };

export type ConversationRuntimeReduceResult = {
  state: ConversationRuntimeState;
  needsRefresh: boolean;
};

export function reduceConversationRuntimeState(
  state: ConversationRuntimeState,
  action: ConversationRuntimeAction,
): ConversationRuntimeReduceResult {
  switch (action.type) {
    case "load-started":
      return {
        state: {
          ...state,
          loadState:
            state.loadState.type === "ready"
              ? state.loadState
              : { type: "loading" },
        },
        needsRefresh: false,
      };
    case "snapshot-loaded": {
      const messagesById: Record<string, StoredOpenCodeMessage> = {};
      for (const message of action.snapshot.messages) {
        const previous = state.messagesById[message.info.id];
        messagesById[message.info.id] = {
          info: mergeMessageInfo(previous?.info, message.info),
          parts: message.parts.reduce<readonly OpenCodePart[]>(
            (parts, part) => upsertPart(parts, part),
            [],
          ),
        };
      }
      const questions = indexRecords(
        action.snapshot.questions,
        state.conversationId,
      );
      for (const id of Object.keys(state.questionResponses)) {
        delete questions[id];
      }
      return {
        state: {
          ...state,
          conversation: action.snapshot.conversation,
          loadState: { type: "ready" },
          status: action.snapshot.status,
          runState:
            action.snapshot.status?.type === "busy" ||
            action.snapshot.status?.type === "retry"
              ? { type: "streaming" }
              : { type: "idle" },
          messagesById,
          messageOrder: sortMessageIds(messagesById),
          permissions: indexRecords(
            action.snapshot.permissions,
            state.conversationId,
          ),
          questions,
          todo: action.snapshot.todo,
          tasks:
            action.snapshot.tasks === null
              ? state.tasks
              : indexTasks(action.snapshot.tasks),
          diff: action.snapshot.diff,
          sync: { ...state.sync, lastSnapshotAt: Date.now() },
        },
        needsRefresh: false,
      };
    }
    case "load-failed":
      return {
        state: {
          ...state,
          loadState: { type: "error", error: action.error },
        },
        needsRefresh: false,
      };
    case "pending-message-added":
      return {
        state: {
          ...state,
          runState: { type: "streaming" },
          pendingMessages: {
            ...state.pendingMessages,
            [action.message.id]: action.message,
          },
        },
        needsRefresh: false,
      };
    case "pending-message-failed":
      if (!state.pendingMessages[action.id]) {
        return {
          state: {
            ...state,
            runState: { type: "error", error: action.error },
          },
          needsRefresh: false,
        };
      }
      return {
        state: {
          ...state,
          runState: { type: "error", error: action.error },
          pendingMessages: {
            ...state.pendingMessages,
            [action.id]: {
              ...state.pendingMessages[action.id]!,
              status: "failed",
              error: action.error,
            },
          },
        },
        needsRefresh: false,
      };
    case "question-response-recorded":
      return {
        state: recordQuestionResponse({
          state,
          id: action.id,
          request: action.request,
          response: action.response,
        }),
        needsRefresh: false,
      };
    case "run-cancelling":
      return {
        state: { ...state, runState: { type: "cancelling" } },
        needsRefresh: false,
      };
    case "run-idle":
      return {
        state: { ...state, runState: { type: "idle" } },
        needsRefresh: false,
      };
    case "run-failed":
      return {
        state: { ...state, runState: { type: "error", error: action.error } },
        needsRefresh: false,
      };
    case "stream-reconnected":
      return {
        state: {
          ...state,
          sync: { ...state.sync, lastReconnectAt: action.at },
        },
        needsRefresh: true,
      };
    case "event":
      break;
  }

  const event = action.event;
  const withEventTime: ConversationRuntimeState = {
    ...state,
    sync: { ...state.sync, lastEventAt: Date.now() },
  };
  const properties = event.properties;

  switch (event.type) {
    case "server.connected":
    case "server.heartbeat":
      return { state: withEventTime, needsRefresh: false };
    case "session.status": {
      const status = asRecord(properties.status) as
        | OpenCodeSessionStatus
        | undefined;
      if (!status || typeof status.type !== "string") {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      return {
        state: {
          ...withEventTime,
          status,
          runState:
            status.type === "busy" || status.type === "retry"
              ? { type: "streaming" }
              : { type: "idle" },
        },
        needsRefresh: false,
      };
    }
    case "session.idle":
      return {
        state: {
          ...withEventTime,
          status: { type: "idle" },
          runState: { type: "idle" },
        },
        needsRefresh: false,
      };
    case "session.error": {
      const error = normalizeSessionError(properties);
      return {
        state: {
          ...withEventTime,
          runState: { type: "error", error },
          sessionError: error,
        },
        needsRefresh: false,
      };
    }
    case "session.compacted":
      return {
        state: {
          ...withEventTime,
          sync: { ...withEventTime.sync, lastCompactionAt: Date.now() },
        },
        needsRefresh: true,
      };
    case "session.created":
    case "session.updated": {
      const info = asRecord(properties.info);
      return {
        state: info
          ? { ...withEventTime, conversation: info }
          : appendUnhandled(withEventTime, event),
        needsRefresh: false,
      };
    }
    case "session.deleted":
      return {
        state: { ...withEventTime, conversation: null },
        needsRefresh: false,
      };
    case "message.updated": {
      const info = asRecord(properties.info) as OpenCodeMessageInfo | undefined;
      if (!info || typeof info.id !== "string" || typeof info.role !== "string") {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      const messagesById = {
        ...withEventTime.messagesById,
        [info.id]: {
          info: mergeMessageInfo(withEventTime.messagesById[info.id]?.info, info),
          parts: withEventTime.messagesById[info.id]?.parts ?? [],
        },
      };
      let pendingMessages = withEventTime.pendingMessages;
      let sessionError = withEventTime.sessionError;
      let runState = withEventTime.runState;
      if (info.role === "user") {
        sessionError = null;
        if (runState.type === "error") {
          runState =
            withEventTime.status?.type === "busy" ||
            withEventTime.status?.type === "retry"
              ? { type: "streaming" }
              : { type: "idle" };
        }
        const firstPendingId = Object.values(pendingMessages)
          .sort((left, right) => left.createdAt - right.createdAt)[0]?.id;
        if (firstPendingId) {
          pendingMessages = { ...pendingMessages };
          delete (pendingMessages as Record<string, PendingOpenCodeMessage>)[
            firstPendingId
          ];
        }
      }
      return {
        state: {
          ...withEventTime,
          messagesById,
          messageOrder: sortMessageIds(messagesById),
          pendingMessages,
          sessionError,
          runState,
        },
        needsRefresh: false,
      };
    }
    case "message.removed": {
      if (typeof properties.messageID !== "string") {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      const messagesById = { ...withEventTime.messagesById };
      delete messagesById[properties.messageID];
      return {
        state: {
          ...withEventTime,
          messagesById,
          messageOrder: sortMessageIds(messagesById),
        },
        needsRefresh: false,
      };
    }
    case "message.part.updated": {
      const part = asRecord(properties.part) as OpenCodePart | undefined;
      const messageId =
        typeof part?.messageID === "string" ? part.messageID : undefined;
      if (!part || typeof part.type !== "string" || !messageId) {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      const previous = withEventTime.messagesById[messageId] ?? { parts: [] };
      const partState = asRecord(part.state);
      let partProgress = withEventTime.partProgress;
      if (part.type === "tool" && typeof part.callID === "string") {
        if (
          partState?.status === "completed" ||
          partState?.status === "error"
        ) {
          partProgress = removeRecord(partProgress, part.callID);
        } else if (Array.isArray(partState?.progress)) {
          const progress = partState.progress.filter(
            (item): item is string => typeof item === "string",
          );
          partProgress = {
            ...partProgress,
            [part.callID]: progress.slice(-10),
          };
        }
      }
      let todo = withEventTime.todo;
      const input = asRecord(partState?.input);
      if (
        part.type === "tool" &&
        part.tool === "todowrite" &&
        Array.isArray(input?.todos)
      ) {
        todo = asRecordArray(input.todos);
      }
      const messagesById = {
        ...withEventTime.messagesById,
        [messageId]: {
          ...previous,
          parts: upsertPart(previous.parts, part),
        },
      };
      return {
        state: {
          ...withEventTime,
          messagesById,
          messageOrder: sortMessageIds(messagesById),
          partProgress,
          todo,
        },
        needsRefresh: false,
      };
    }
    case "message.part.delta": {
      const { messageID, partID, field, delta } = properties;
      if (
        typeof messageID !== "string" ||
        typeof partID !== "string" ||
        typeof field !== "string" ||
        typeof delta !== "string"
      ) {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      const message = withEventTime.messagesById[messageID];
      const index = message?.parts.findIndex((part) => part.id === partID) ?? -1;
      if (!message || index === -1) {
        return { state: withEventTime, needsRefresh: true };
      }
      const nextPart = applyPartDelta(message.parts[index]!, field, delta);
      if (!nextPart) return { state: withEventTime, needsRefresh: true };
      const parts = [...message.parts];
      parts[index] = nextPart;
      return {
        state: {
          ...withEventTime,
          messagesById: {
            ...withEventTime.messagesById,
            [messageID]: { ...message, parts },
          },
        },
        needsRefresh: false,
      };
    }
    case "message.part.removed": {
      const { messageID, partID } = properties;
      if (typeof messageID !== "string" || typeof partID !== "string") {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      const message = withEventTime.messagesById[messageID];
      if (!message) return { state: withEventTime, needsRefresh: false };
      return {
        state: {
          ...withEventTime,
          messagesById: {
            ...withEventTime.messagesById,
            [messageID]: {
              ...message,
              parts: message.parts.filter((part) => part.id !== partID),
            },
          },
        },
        needsRefresh: false,
      };
    }
    case "permission.asked": {
      const id = recordId(properties);
      return {
        state: id
          ? {
              ...withEventTime,
              permissions: { ...withEventTime.permissions, [id]: properties },
            }
          : appendUnhandled(withEventTime, event),
        needsRefresh: false,
      };
    }
    case "permission.replied": {
      const id =
        typeof properties.requestID === "string"
          ? properties.requestID
          : recordId(properties);
      return {
        state: id
          ? {
              ...withEventTime,
              permissions: removeRecord(withEventTime.permissions, id),
            }
          : appendUnhandled(withEventTime, event),
        needsRefresh: false,
      };
    }
    case "question.asked": {
      const id = recordId(properties);
      if (!id) {
        return {
          state: appendUnhandled(withEventTime, event),
          needsRefresh: false,
        };
      }
      if (withEventTime.questionResponses[id]) {
        return { state: withEventTime, needsRefresh: false };
      }
      return {
        state: {
          ...withEventTime,
          questions: { ...withEventTime.questions, [id]: properties },
        },
        needsRefresh: false,
      };
    }
    case "question.replied":
    case "question.rejected": {
      const id =
        typeof properties.requestID === "string"
          ? properties.requestID
          : recordId(properties);
      return {
        state: id
          ? recordQuestionResponse({
              state: withEventTime,
              id,
              response:
                event.type === "question.replied"
                  ? { type: "answered", answers: properties.answers }
                  : { type: "rejected" },
            })
          : appendUnhandled(withEventTime, event),
        needsRefresh: false,
      };
    }
    case "todo.updated":
      return {
        state: {
          ...withEventTime,
          todo: asRecordArray(properties.todos),
        },
        needsRefresh: false,
      };
    case "session.diff":
      return {
        state: {
          ...withEventTime,
          diff: asRecordArray(properties.diff),
        },
        needsRefresh: false,
      };
    case "tool.progress": {
      const toolUseId =
        typeof properties.toolUseID === "string"
          ? properties.toolUseID
          : typeof properties.parentToolUseID === "string"
            ? properties.parentToolUseID
            : undefined;
      if (!toolUseId || typeof properties.data !== "string") {
        return { state: withEventTime, needsRefresh: false };
      }
      return {
        state: {
          ...withEventTime,
          toolProgress: {
            ...withEventTime.toolProgress,
            [toolUseId]: `${withEventTime.toolProgress[toolUseId] ?? ""}${properties.data}`,
          },
        },
        needsRefresh: false,
      };
    }
    case "task.started": {
      if (typeof properties.taskID !== "string") {
        return { state: withEventTime, needsRefresh: false };
      }
      return {
        state: {
          ...withEventTime,
          tasks: {
            ...withEventTime.tasks,
            [properties.taskID]: {
              taskID: properties.taskID,
              ...(typeof properties.toolUseID === "string"
                ? { toolUseID: properties.toolUseID }
                : {}),
              status: "running",
              description:
                typeof properties.description === "string"
                  ? properties.description
                  : "",
              ...(typeof properties.taskType === "string"
                ? { taskType: properties.taskType }
                : {}),
              startTime: Date.now(),
            },
          },
        },
        needsRefresh: false,
      };
    }
    case "task.progress": {
      if (typeof properties.taskID !== "string") {
        return { state: withEventTime, needsRefresh: false };
      }
      const existing = withEventTime.tasks[properties.taskID];
      if (!existing) return { state: withEventTime, needsRefresh: false };
      const usage = normalizeTaskUsage(properties.usage);
      return {
        state: {
          ...withEventTime,
          tasks: {
            ...withEventTime.tasks,
            [properties.taskID]: {
              ...existing,
              ...(typeof properties.description === "string" &&
              properties.description
                ? { description: properties.description }
                : {}),
              ...(typeof properties.summary === "string" && properties.summary
                ? { summary: properties.summary }
                : {}),
              ...(usage ? { usage } : {}),
            },
          },
        },
        needsRefresh: false,
      };
    }
    case "task.completed": {
      if (typeof properties.taskID !== "string") {
        return { state: withEventTime, needsRefresh: false };
      }
      const existing = withEventTime.tasks[properties.taskID];
      const usage = normalizeTaskUsage(properties.usage);
      const endTime = Date.now();
      return {
        state: {
          ...withEventTime,
          tasks: {
            ...withEventTime.tasks,
            [properties.taskID]: {
              taskID: properties.taskID,
              ...(typeof properties.toolUseID === "string"
                ? { toolUseID: properties.toolUseID }
                : existing?.toolUseID !== undefined
                  ? { toolUseID: existing.toolUseID }
                  : {}),
              status:
                properties.status === "completed" ||
                properties.status === "failed" ||
                properties.status === "stopped"
                  ? properties.status
                  : "completed",
              description: existing?.description ?? "",
              ...(existing?.taskType !== undefined
                ? { taskType: existing.taskType }
                : {}),
              ...(typeof properties.summary === "string"
                ? { summary: properties.summary }
                : existing?.summary !== undefined
                  ? { summary: existing.summary }
                  : {}),
              ...(usage
                ? { usage }
                : existing?.usage
                  ? { usage: existing.usage }
                  : {}),
              startTime: existing?.startTime ?? endTime,
              endTime,
            },
          },
        },
        needsRefresh: false,
      };
    }
    default:
      return {
        state: appendUnhandled(withEventTime, event),
        needsRefresh: false,
      };
  }
}

export function createPendingMessage(
  conversationId: string,
  parts: readonly OpenCodePromptPart[],
): PendingOpenCodeMessage {
  const createdAt = Date.now();
  return {
    id: `${conversationId}:pending:${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    parts,
    status: "pending",
  };
}

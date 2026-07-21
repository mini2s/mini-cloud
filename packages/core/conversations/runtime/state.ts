import type {
  OpenCodeMessageInfo,
  OpenCodePart,
  OpenCodePromptPart,
  OpenCodeRecord,
  OpenCodeSessionStatus,
  OpenCodeTaskUsage,
} from "../types";

export type ConversationRuntimeLoadState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready" }
  | { type: "error"; error: unknown };

export type ConversationRuntimeRunState =
  | { type: "idle" }
  | { type: "streaming" }
  | { type: "cancelling" }
  | { type: "error"; error: unknown };

export type StoredOpenCodeMessage = {
  info?: OpenCodeMessageInfo;
  parts: readonly OpenCodePart[];
};

export type PendingOpenCodeMessage = {
  id: string;
  createdAt: number;
  parts: readonly OpenCodePromptPart[];
  status: "pending" | "failed";
  error?: unknown;
};

export type ConversationSessionError = OpenCodeRecord & {
  subtype?: string;
  level?: string;
  message?: string;
  retryInMs?: number;
  retryAttempt?: number;
  maxRetries?: number;
};

export type ConversationTaskState = {
  taskID: string;
  toolUseID?: string;
  status: "running" | "completed" | "failed" | "stopped";
  description: string;
  taskType?: string;
  summary?: string;
  usage?: OpenCodeTaskUsage;
  startTime: number;
  endTime?: number;
};

export type ConversationQuestionResponse = {
  request: OpenCodeRecord;
  state: "answered" | "rejected";
  answers?: readonly (readonly string[])[];
  respondedAt: number;
};

export type ConversationRuntimeState = {
  conversationId: string;
  conversation: OpenCodeRecord | null;
  loadState: ConversationRuntimeLoadState;
  runState: ConversationRuntimeRunState;
  sessionError: ConversationSessionError | null;
  status: OpenCodeSessionStatus | null;
  messageOrder: readonly string[];
  messagesById: Readonly<Record<string, StoredOpenCodeMessage>>;
  pendingMessages: Readonly<Record<string, PendingOpenCodeMessage>>;
  permissions: Readonly<Record<string, OpenCodeRecord>>;
  questions: Readonly<Record<string, OpenCodeRecord>>;
  questionResponses: Readonly<Record<string, ConversationQuestionResponse>>;
  todo: readonly OpenCodeRecord[];
  tasks: Readonly<Record<string, ConversationTaskState>>;
  toolProgress: Readonly<Record<string, string>>;
  partProgress: Readonly<Record<string, readonly string[]>>;
  diff: readonly OpenCodeRecord[];
  unhandledEvents: readonly {
    type: string;
    properties: OpenCodeRecord;
    seenAt: number;
  }[];
  sync: {
    lastSnapshotAt?: number;
    lastEventAt?: number;
    lastReconnectAt?: number;
    lastCompactionAt?: number;
  };
};

export function createConversationRuntimeState(
  conversationId: string,
): ConversationRuntimeState {
  return {
    conversationId,
    conversation: null,
    loadState: { type: "idle" },
    runState: { type: "idle" },
    sessionError: null,
    status: null,
    messageOrder: [],
    messagesById: {},
    pendingMessages: {},
    permissions: {},
    questions: {},
    questionResponses: {},
    todo: [],
    tasks: {},
    toolProgress: {},
    partProgress: {},
    diff: [],
    unhandledEvents: [],
    sync: {},
  };
}

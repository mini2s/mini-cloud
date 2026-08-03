import type {
  OpenCodeConversation,
  OpenCodeMessageWithParts,
  OpenCodePromptPart,
  OpenCodeRecord,
  OpenCodeRuntimeEvent,
  OpenCodeSessionStatus,
  OpenCodeTaskSnapshot,
} from "../../types";

export type CloudProxyTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export type OpenCodeEventStream = {
  stream: AsyncIterable<OpenCodeRuntimeEvent>;
  close: () => void;
};

export type CloudProxyClient = {
  key: string;
  baseUrl: string;
  directory: string;
  conversation: {
    list: (
      input?: {
        directory?: string;
        roots?: boolean;
        archived?: boolean;
        search?: string;
        limit?: number;
      },
      signal?: AbortSignal,
    ) => Promise<OpenCodeConversation[]>;
    create: (
      input?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<OpenCodeConversation>;
    get: (conversationId: string, signal?: AbortSignal) => Promise<OpenCodeRecord | null>;
    update: (
      conversationId: string,
      input: { title: string },
      signal?: AbortSignal,
    ) => Promise<OpenCodeConversation>;
    delete: (conversationId: string, signal?: AbortSignal) => Promise<void>;
    messages: (
      conversationId: string,
      input?: { limit?: number },
      signal?: AbortSignal,
    ) => Promise<OpenCodeMessageWithParts[]>;
    status: (signal?: AbortSignal) => Promise<Record<string, OpenCodeSessionStatus>>;
    promptAsync: (
      conversationId: string,
      input: { parts: readonly OpenCodePromptPart[] },
      signal?: AbortSignal,
    ) => Promise<unknown>;
    abort: (conversationId: string, signal?: AbortSignal) => Promise<unknown>;
    todo: (conversationId: string, signal?: AbortSignal) => Promise<OpenCodeRecord[]>;
    tasks: (
      conversationId: string,
      signal?: AbortSignal,
    ) => Promise<OpenCodeTaskSnapshot[]>;
  };
  permission: {
    list: (signal?: AbortSignal) => Promise<OpenCodeRecord[]>;
    respond: (
      requestId: string,
      input: { decision: "once" | "always" | "reject" },
      signal?: AbortSignal,
    ) => Promise<unknown>;
  };
  question: {
    list: (signal?: AbortSignal) => Promise<OpenCodeRecord[]>;
    reply: (
      requestId: string,
      input: { answers: readonly unknown[] },
      signal?: AbortSignal,
    ) => Promise<unknown>;
    reject: (requestId: string, signal?: AbortSignal) => Promise<unknown>;
  };
  event: {
    stream: (signal?: AbortSignal) => Promise<OpenCodeEventStream>;
  };
};

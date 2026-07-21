import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CloudProxyClient,
  OpenCodeRecord,
  OpenCodeRuntimeEvent,
  ConversationRuntimeState,
} from "..";
import { createConversationRuntimeState } from "./state";
import { conversationKeys } from "../query-keys";
import { ConversationRuntimeController } from "./controller";
import {
  disposeSharedOpenCodeEventSources,
  STREAM_RECONNECTED_EVENT_TYPE,
} from "../clients/cloud-proxy/sse/shared-event-source";

class EventHub {
  private readonly listeners = new Set<() => void>();
  private readonly values: OpenCodeRuntimeEvent[] = [];

  push(event: OpenCodeRuntimeEvent) {
    this.values.push(event);
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }

  stream(signal: AbortSignal): AsyncIterable<OpenCodeRuntimeEvent> {
    const values = this.values;
    const listeners = this.listeners;
    return {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            while (index >= values.length && !signal.aborted) {
              await new Promise<void>((resolve) => {
                const wake = () => {
                  signal.removeEventListener("abort", wake);
                  resolve();
                };
                listeners.add(wake);
                signal.addEventListener("abort", wake, { once: true });
              });
            }
            if (signal.aborted) return { done: true, value: undefined };
            return { done: false, value: values[index++]! };
          },
        };
      },
    };
  }
}

function createFakeClient(
  hub: EventHub,
  calls: string[],
): CloudProxyClient {
  return {
    key: "https://multica.test/proxy\n/workspace",
    baseUrl: "https://multica.test/proxy",
    directory: "/workspace",
    conversation: {
      get: vi.fn(async () => {
        calls.push("get");
        return { id: "conversation-1" };
      }),
      messages: vi.fn(async () => {
        calls.push("messages");
        return [];
      }),
      status: vi.fn(async () => {
        calls.push("status");
        return { "conversation-1": { type: "idle" } };
      }),
      promptAsync: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      todo: vi.fn(async () => []),
      tasks: vi.fn(async () => []),
    },
    permission: {
      list: vi.fn(async () => []),
      respond: vi.fn(async () => undefined),
    },
    question: {
      list: vi.fn(async () => []),
      reply: vi.fn(async () => undefined),
      reject: vi.fn(async () => undefined),
    },
    event: {
      stream: vi.fn(async (signal) => {
        calls.push("stream");
        const effectiveSignal = signal ?? new AbortController().signal;
        return {
          stream: hub.stream(effectiveSignal),
          close: () => undefined,
        };
      }),
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

afterEach(() => {
  disposeSharedOpenCodeEventSources();
  vi.restoreAllMocks();
});

describe("ConversationRuntimeController", () => {
  it("subscribes before loading the REST snapshot and filters other conversations", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );

    await controller.start();

    expect(calls[0]).toBe("stream");
    expect(client.conversation.messages).toHaveBeenCalledWith(
      "conversation-1",
      { limit: 200 },
      expect.any(AbortSignal),
    );
    hub.push({
      type: "message.updated",
      sessionId: "conversation-other",
      properties: {
        info: {
          id: "other-message",
          role: "assistant",
          sessionID: "conversation-other",
        },
      },
      raw: undefined,
    });
    hub.push({
      type: "message.updated",
      sessionId: "conversation-1",
      properties: {
        info: {
          id: "own-message",
          role: "assistant",
          sessionID: "conversation-1",
        },
      },
      raw: undefined,
    });

    await vi.waitFor(() => {
      const state = queryClient.getQueryData<ConversationRuntimeState>(queryKey);
      expect(state?.messageOrder).toEqual(["own-message"]);
    });
    controller.dispose();
  });

  it("shares one physical workspace stream across conversation controllers", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const queryClient = new QueryClient();
    const first = new ConversationRuntimeController(
      queryClient,
      conversationKeys.state(client.baseUrl, client.directory, "conversation-1"),
      client,
      "conversation-1",
    );
    const second = new ConversationRuntimeController(
      queryClient,
      conversationKeys.state(client.baseUrl, client.directory, "conversation-2"),
      client,
      "conversation-2",
    );

    await Promise.all([first.start(), second.start()]);

    expect(client.event.stream).toHaveBeenCalledTimes(1);
    first.dispose();
    second.dispose();
  });

  it("buffers conversation events until the initial snapshot is committed", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    let resolveMessages:
      | ((messages: []) => void)
      | undefined;
    client.conversation.messages = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );

    const starting = controller.start();
    await vi.waitFor(() => {
      expect(resolveMessages).toBeTypeOf("function");
    });
    hub.push({
      type: "message.updated",
      sessionId: "conversation-1",
      properties: {
        info: {
          id: "message-during-load",
          role: "assistant",
          sessionID: "conversation-1",
        },
      },
      raw: undefined,
    });
    resolveMessages?.([]);
    await starting;

    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey)?.messageOrder,
    ).toEqual(["message-during-load"]);
    controller.dispose();
  });

  it("aborts an in-flight snapshot and ignores its late completion after dispose", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const conversation = createDeferred<OpenCodeRecord | null>();
    const messages = createDeferred<[]>();
    const statuses = createDeferred<Record<string, { type: string }>>();
    const permissions = createDeferred<OpenCodeRecord[]>();
    const questions = createDeferred<OpenCodeRecord[]>();
    const todo = createDeferred<OpenCodeRecord[]>();
    const tasks = createDeferred<[]>();
    const signals: AbortSignal[] = [];
    const captureSignal = (signal?: AbortSignal) => {
      if (!signal) throw new Error("Expected snapshot abort signal");
      signals.push(signal);
    };
    client.conversation.get = vi.fn((_conversationId, signal) => {
      captureSignal(signal);
      return conversation.promise;
    });
    client.conversation.messages = vi.fn((_conversationId, _input, signal) => {
      captureSignal(signal);
      return messages.promise;
    });
    client.conversation.status = vi.fn((signal) => {
      captureSignal(signal);
      return statuses.promise;
    });
    client.permission.list = vi.fn((signal) => {
      captureSignal(signal);
      return permissions.promise;
    });
    client.question.list = vi.fn((signal) => {
      captureSignal(signal);
      return questions.promise;
    });
    client.conversation.todo = vi.fn((_conversationId, signal) => {
      captureSignal(signal);
      return todo.promise;
    });
    client.conversation.tasks = vi.fn((_conversationId, signal) => {
      captureSignal(signal);
      return tasks.promise;
    });
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );

    const starting = controller.start();
    await vi.waitFor(() => expect(signals).toHaveLength(7));
    controller.dispose();

    expect(signals.every((signal) => signal === signals[0])).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    conversation.resolve({ id: "conversation-1" });
    messages.resolve([]);
    statuses.resolve({ "conversation-1": { type: "idle" } });
    permissions.resolve([{ id: "permission-late" }]);
    questions.resolve([{ id: "question-late" }]);
    todo.resolve([{ id: "todo-late" }]);
    tasks.resolve([]);
    await starting;

    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey),
    ).toMatchObject({
      conversation: null,
      loadState: { type: "loading" },
      messageOrder: [],
      permissions: {},
      questions: {},
      todo: [],
      sync: {},
    });
  });

  it("reconciles after compaction and exposes real send/cancel actions", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );
    await controller.start();

    await controller.send([{ type: "text", text: "hello" }]);
    await controller.cancel();
    expect(client.conversation.promptAsync).toHaveBeenCalledWith(
      "conversation-1",
      { parts: [{ type: "text", text: "hello" }] },
    );
    expect(client.conversation.abort).toHaveBeenCalledWith("conversation-1");

    hub.push({
      type: "session.compacted",
      sessionId: "conversation-1",
      properties: { sessionID: "conversation-1" },
      raw: undefined,
    });
    await vi.waitFor(() => {
      expect(client.conversation.messages).toHaveBeenCalledTimes(2);
    });

    hub.push({
      type: STREAM_RECONNECTED_EVENT_TYPE,
      properties: {},
      raw: undefined,
    });
    await vi.waitFor(() => {
      expect(client.conversation.messages).toHaveBeenCalledTimes(3);
    });
    controller.dispose();
  });

  it("uses the proxy permission decision contract", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const controller = new ConversationRuntimeController(
      new QueryClient(),
      conversationKeys.state(
        client.baseUrl,
        client.directory,
        "conversation-1",
      ),
      client,
      "conversation-1",
    );

    await controller.respondToPermission("permission-1", "always");

    expect(client.permission.respond).toHaveBeenCalledWith("permission-1", {
      decision: "always",
    });
    controller.dispose();
  });

  it("forwards question replies and rejections through the proxy client", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    queryClient.setQueryData<ConversationRuntimeState>(queryKey, {
      ...createConversationRuntimeState("conversation-1"),
      questions: {
        "question-1": {
          id: "question-1",
          tool: { callID: "call-question-1" },
        },
        "question-2": {
          id: "question-2",
          tool: { callID: "call-question-2" },
        },
      },
    });
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );

    await controller.replyToQuestion("question-1", [["Continue"]]);
    await controller.rejectQuestion("question-2");

    expect(client.question.reply).toHaveBeenCalledWith("question-1", {
      answers: [["Continue"]],
    });
    expect(client.question.reject).toHaveBeenCalledWith("question-2");
    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey)
        ?.questionResponses,
    ).toMatchObject({
      "question-1": {
        state: "answered",
        answers: [["Continue"]],
      },
      "question-2": {
        state: "rejected",
      },
    });
    controller.dispose();
  });

  it("does not block the core snapshot when tasks fail to load", async () => {
    const calls: string[] = [];
    const hub = new EventHub();
    const client = createFakeClient(hub, calls);
    client.conversation.tasks = vi.fn(async () => {
      throw new Error("tasks unavailable");
    });
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const controller = new ConversationRuntimeController(
      queryClient,
      queryKey,
      client,
      "conversation-1",
    );

    await controller.start();

    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey)?.loadState,
    ).toEqual({ type: "ready" });
    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey)?.tasks,
    ).toEqual({});
    controller.dispose();
  });
});

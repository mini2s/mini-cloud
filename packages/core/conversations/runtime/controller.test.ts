import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CloudProxyClient,
  OpenCodeRuntimeEvent,
  ConversationRuntimeState,
} from "..";
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
      diff: vi.fn(async () => []),
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

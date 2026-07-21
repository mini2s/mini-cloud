import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudProxyClient } from "../clients/cloud-proxy";
import { disposeSharedOpenCodeEventSources } from "../clients/cloud-proxy";
import { conversationKeys } from "../query-keys";
import { ConversationRuntimeController } from "./controller";
import type { ConversationRuntimeState } from "./state";
import {
  acquireSharedConversationRuntimeController,
  disposeSharedConversationRuntimeControllers,
  SHARED_CONVERSATION_RUNTIME_DISPOSE_DELAY_MS,
} from "./shared-controller";

afterEach(() => {
  disposeSharedConversationRuntimeControllers();
  disposeSharedOpenCodeEventSources();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function idleStream(signal: AbortSignal): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<never>>((resolve) => {
            if (signal.aborted) {
              resolve({ done: true, value: undefined });
              return;
            }
            signal.addEventListener(
              "abort",
              () => resolve({ done: true, value: undefined }),
              { once: true },
            );
          }),
      };
    },
  };
}

describe("shared conversation runtime controller", () => {
  it("reuses one controller across a release and immediate reacquire", async () => {
    vi.useFakeTimers();
    const start = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const createController = vi.fn(
      () =>
        ({ start, dispose }) as unknown as ConversationRuntimeController,
    );
    const queryClient = new QueryClient();
    const client = { key: "proxy\n/workspace" } as CloudProxyClient;
    const input = {
      queryClient,
      queryKey: ["conversations", "state", "conversation-1"],
      client,
      conversationId: "conversation-1",
      createController,
    };

    const probeLease = acquireSharedConversationRuntimeController(input);
    probeLease.release();
    const committedLease = acquireSharedConversationRuntimeController(input);
    await committedLease.started;

    expect(createController).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    committedLease.release();
    await vi.advanceTimersByTimeAsync(
      SHARED_CONVERSATION_RUNTIME_DISPOSE_DELAY_MS - 1,
    );
    expect(dispose).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("loads one REST snapshot across a StrictMode-style reacquire", async () => {
    vi.useFakeTimers();
    const client = {
      key: "https://multica.test/proxy\n/workspace",
      baseUrl: "https://multica.test/proxy",
      directory: "/workspace",
      conversation: {
        get: vi.fn(async () => ({ id: "conversation-1" })),
        messages: vi.fn(async () => []),
        status: vi.fn(async () => ({
          "conversation-1": { type: "idle" },
        })),
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
        stream: vi.fn(async (signal?: AbortSignal) => {
          const effectiveSignal = signal ?? new AbortController().signal;
          return {
            stream: idleStream(effectiveSignal),
            close: () => undefined,
          };
        }),
      },
    } satisfies CloudProxyClient;
    const queryClient = new QueryClient();
    const queryKey = conversationKeys.state(
      client.baseUrl,
      client.directory,
      "conversation-1",
    );
    const input = {
      queryClient,
      queryKey,
      client,
      conversationId: "conversation-1",
      createController: () =>
        new ConversationRuntimeController(
          queryClient,
          queryKey,
          client,
          "conversation-1",
        ),
    };

    const probeLease = acquireSharedConversationRuntimeController(input);
    probeLease.release();
    const committedLease = acquireSharedConversationRuntimeController(input);
    await committedLease.started;

    expect(client.conversation.get).toHaveBeenCalledTimes(1);
    expect(client.conversation.messages).toHaveBeenCalledTimes(1);
    expect(client.conversation.status).toHaveBeenCalledTimes(1);
    expect(client.permission.list).toHaveBeenCalledTimes(1);
    expect(client.question.list).toHaveBeenCalledTimes(1);
    expect(client.conversation.todo).toHaveBeenCalledTimes(1);
    expect(client.conversation.tasks).toHaveBeenCalledTimes(1);
    expect(client.event.stream).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData<ConversationRuntimeState>(queryKey)?.loadState,
    ).toEqual({ type: "ready" });

    committedLease.release();
    await vi.advanceTimersByTimeAsync(
      SHARED_CONVERSATION_RUNTIME_DISPOSE_DELAY_MS,
    );
  });
});

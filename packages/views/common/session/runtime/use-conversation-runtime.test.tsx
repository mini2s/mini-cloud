import "@testing-library/jest-dom/vitest";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { createConversationRuntimeState } from "@multica/core/conversations";
import { I18nProvider } from "@multica/core/i18n/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enChat from "../../../locales/en/chat.json";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  cancel: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@multica/core/conversations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@multica/core/conversations")>();
  return {
    ...actual,
    ConversationRuntimeController: class {
      constructor(
        private readonly queryClient: QueryClient,
        private readonly queryKey: readonly unknown[],
        _client: unknown,
        private readonly conversationId: string,
      ) {}

      start() {
        mocks.start();
        this.queryClient.setQueryData(this.queryKey, {
          ...createConversationRuntimeState(this.conversationId),
          loadState: { type: "ready" },
        });
        return Promise.resolve();
      }

      send(parts: unknown) {
        mocks.send(parts);
        this.queryClient.setQueryData(
          this.queryKey,
          (state: ReturnType<typeof createConversationRuntimeState> | undefined) => ({
            ...(state ?? createConversationRuntimeState(this.conversationId)),
            runState: { type: "streaming" },
          }),
        );
        return Promise.resolve();
      }

      cancel() {
        mocks.cancel();
        this.queryClient.setQueryData(
          this.queryKey,
          (state: ReturnType<typeof createConversationRuntimeState> | undefined) => ({
            ...(state ?? createConversationRuntimeState(this.conversationId)),
            runState: { type: "idle" },
          }),
        );
        return Promise.resolve();
      }

      dispose() {
        mocks.dispose();
      }
    },
  };
});

import type { CloudProxyClient } from "@multica/core/conversations";
import { SessionThread } from "../session-thread";
import { SessionRuntimeStateProvider } from "../session-runtime-state";
import { useConversationRuntime } from "./use-conversation-runtime";

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

const descriptor = {
  conversationId: "conversation-1",
  proxyBaseUrl: "https://multica.test/proxy",
  workspaceDirectory: "/workspace",
};
const fakeClient = {} as CloudProxyClient;

function Harness() {
  const { runtime, runtimeState } = useConversationRuntime({
    descriptor,
    client: fakeClient,
    mode: "control",
  });
  return (
    <SessionRuntimeStateProvider value={runtimeState}>
      <AssistantRuntimeProvider runtime={runtime}>
        <SessionThread mode="control" onTakeover={vi.fn()} />
      </AssistantRuntimeProvider>
    </SessionRuntimeStateProvider>
  );
}

beforeEach(() => {
  mocks.send.mockReset();
  mocks.cancel.mockReset();
  mocks.start.mockReset();
  mocks.dispose.mockReset();
});

describe("useConversationRuntime", () => {
  it("maps assistant-ui send and cancel actions to the conversation runtime controller", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = render(
      <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </I18nProvider>,
    );

    const input = await screen.findByRole("textbox", {
      name: "Live session message",
    });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "Inspect the runtime");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(mocks.send).toHaveBeenCalledWith([
      { type: "text", text: "Inspect the runtime" },
    ]);
    queryClient.setQueryData(
      [
        "conversations",
        "state",
        descriptor.proxyBaseUrl,
        descriptor.workspaceDirectory,
        descriptor.conversationId,
      ],
      (state: ReturnType<typeof createConversationRuntimeState> | undefined) => ({
        ...(state ?? createConversationRuntimeState(descriptor.conversationId)),
        loadState: { type: "ready" },
        runState: { type: "streaming" },
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Stop generating" }),
    );
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));

    rendered.unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});

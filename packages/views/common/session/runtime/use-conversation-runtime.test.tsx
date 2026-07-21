import "@testing-library/jest-dom/vitest";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { createConversationRuntimeState } from "@multica/core/conversations";
import { I18nProvider } from "@multica/core/i18n/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enChat from "../../../locales/en/chat.json";

const mocks = vi.hoisted(() => ({
  nextControllerId: 0,
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
      private readonly id = ++mocks.nextControllerId;

      constructor(
        private readonly queryClient: QueryClient,
        private readonly queryKey: readonly unknown[],
        _client: unknown,
        private readonly conversationId: string,
      ) {}

      start() {
        mocks.start(this.id);
        this.queryClient.setQueryData(this.queryKey, {
          ...createConversationRuntimeState(this.conversationId),
          loadState: { type: "ready" },
        });
        return Promise.resolve();
      }

      send(parts: unknown) {
        mocks.send(this.id, parts);
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
        mocks.cancel(this.id);
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
        mocks.dispose(this.id);
      }
    },
  };
});

import {
  disposeSharedConversationRuntimeControllers,
  type CloudProxyClient,
} from "@multica/core/conversations";
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
  mocks.nextControllerId = 0;
  mocks.send.mockReset();
  mocks.cancel.mockReset();
  mocks.start.mockReset();
  mocks.dispose.mockReset();
});

afterEach(() => {
  disposeSharedConversationRuntimeControllers();
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

    const controllerId = mocks.start.mock.calls[0]?.[0];
    expect(controllerId).toEqual(expect.any(Number));
    expect(mocks.send).toHaveBeenCalledWith(controllerId, [
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
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith(controllerId),
    );

    rendered.unmount();
    await waitFor(() =>
      expect(mocks.dispose).toHaveBeenCalledWith(controllerId),
    );
  });

  it("shares one controller across the StrictMode effect replay", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = render(
      <StrictMode>
        <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
          <QueryClientProvider client={queryClient}>
            <Harness />
          </QueryClientProvider>
        </I18nProvider>
      </StrictMode>,
    );

    const input = await screen.findByRole("textbox", {
      name: "Live session message",
    });
    await waitFor(() => expect(input).toBeEnabled());
    expect(mocks.start).toHaveBeenCalledTimes(1);

    const controllerId = mocks.start.mock.calls[0]?.[0];
    expect(controllerId).toEqual(expect.any(Number));
    expect(mocks.dispose).not.toHaveBeenCalled();

    rendered.unmount();
    await waitFor(() =>
      expect(mocks.dispose).toHaveBeenCalledWith(controllerId),
    );
  });
});

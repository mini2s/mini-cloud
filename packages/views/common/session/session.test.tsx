import {
  AssistantRuntimeProvider,
  Tools,
  type AppendMessage,
  type ThreadMessageLike,
  useAui,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import enChat from "../../locales/en/chat.json";
import { SessionRuntimeStateProvider } from "./session-runtime-state";
import { conversationToolToolkit } from "./tools/toolkit";
import { Session } from "./session";

const TEST_RESOURCES = { en: { chat: enChat } };
const TEST_MESSAGES: ThreadMessageLike[] = [
  {
    id: "assistant-1",
    role: "assistant",
    content: [{ type: "text", text: "Runtime message" }],
    status: { type: "complete", reason: "stop" },
  },
];

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

function TestRuntimeProvider({
  children,
  onNew,
  messages = TEST_MESSAGES,
}: PropsWithChildren<{
  onNew: (message: AppendMessage) => Promise<void>;
  messages?: ThreadMessageLike[];
}>) {
  const runtime = useExternalStoreRuntime({
    messages,
    isLoading: false,
    isRunning: false,
    isDisabled: false,
    isSendDisabled: false,
    onNew,
    onCancel: async () => undefined,
    convertMessage: (message) => message,
  });
  const aui = useAui({
    tools: Tools({ toolkit: conversationToolToolkit }),
  });

  return (
    <SessionRuntimeStateProvider
      value={{
        isLoading: false,
        isRunning: false,
        isCancelling: false,
      }}
    >
      <AssistantRuntimeProvider aui={aui} runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </SessionRuntimeStateProvider>
  );
}

function renderSession({
  mode,
  onTakeover = vi.fn(),
  onNew = async () => undefined,
  messages,
}: {
  mode: "observe" | "control";
  onTakeover?: () => void;
  onNew?: (message: AppendMessage) => Promise<void>;
  messages?: ThreadMessageLike[];
}) {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <TestRuntimeProvider onNew={onNew} messages={messages}>
        <Session mode={mode} active onTakeover={onTakeover} />
      </TestRuntimeProvider>
    </I18nProvider>,
  );
}

describe("Session", () => {
  it("renders runtime messages and keeps observe mode read-only", async () => {
    const onTakeover = vi.fn();
    const user = userEvent.setup();
    renderSession({ mode: "observe", onTakeover });

    expect(screen.getByText("Runtime message")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Live session message" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Take over session" }),
    );
    expect(onTakeover).toHaveBeenCalledOnce();
  });

  it("forwards control-mode messages to the injected runtime", async () => {
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>(
      async () => undefined,
    );
    const user = userEvent.setup();
    renderSession({ mode: "control", onNew });

    const input = screen.getByRole("textbox", {
      name: "Live session message",
    });
    await user.type(input, "Summarize the next step");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onNew).toHaveBeenCalledOnce());
    expect(onNew.mock.calls[0]?.[0].content).toEqual([
      { type: "text", text: "Summarize the next step" },
    ]);
  });

  it("uses toolkit aliases and falls back for unknown provider tools", async () => {
    renderSession({
      mode: "observe",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "read-1",
              toolName: "read",
              args: { file_path: "/workspace/README.md" },
              argsText: '{"file_path":"/workspace/README.md"}',
              result: "fixture",
            },
            {
              type: "tool-call",
              toolCallId: "question-1",
              toolName: "askuserquestion",
              args: {
                questions: [
                  {
                    header: "Continue",
                    question: "Continue with the fixture?",
                  },
                ],
              },
              argsText: "{}",
            },
            {
              type: "tool-call",
              toolCallId: "unknown-1",
              toolName: "custom_provider_tool",
              args: { value: "fixture" },
              argsText: '{"value":"fixture"}',
              result: "done",
            },
          ],
          status: { type: "complete", reason: "stop" },
        },
      ],
    });

    expect(await screen.findByText("Read")).toBeVisible();
    expect(screen.getByText("/workspace/README.md")).toBeVisible();
    expect(screen.getByText("Question")).toBeVisible();
    expect(screen.getByText("Continue with the fixture?")).toBeVisible();
    expect(screen.getByText("custom_provider_tool")).toBeVisible();
  });
});

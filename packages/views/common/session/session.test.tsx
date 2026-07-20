import {
  AssistantRuntimeProvider,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import enChat from "../../locales/en/chat.json";
import { SessionRuntimeStateProvider } from "./session-runtime-state";
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
}: PropsWithChildren<{
  onNew: (message: AppendMessage) => Promise<void>;
}>) {
  const runtime = useExternalStoreRuntime({
    messages: TEST_MESSAGES,
    isLoading: false,
    isRunning: false,
    isDisabled: false,
    isSendDisabled: false,
    onNew,
    onCancel: async () => undefined,
    convertMessage: (message) => message,
  });

  return (
    <SessionRuntimeStateProvider
      value={{
        isLoading: false,
        isRunning: false,
        isCancelling: false,
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </SessionRuntimeStateProvider>
  );
}

function renderSession({
  mode,
  onTakeover = vi.fn(),
  onNew = async () => undefined,
}: {
  mode: "observe" | "control";
  onTakeover?: () => void;
  onNew?: (message: AppendMessage) => Promise<void>;
}) {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <TestRuntimeProvider onNew={onNew}>
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
});

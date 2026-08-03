import { createConversationRuntimeState } from "@multica/core/conversations";
import { I18nProvider } from "@multica/core/i18n/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enChat from "../../../locales/en/chat.json";
import { ConversationInteractionFallback } from "../runtime/conversation-interaction-fallback";
import { ConversationToolBridgeProvider } from "../runtime/conversation-tool-bridge";
import { EditTool, QuestionTool } from "./conversation-tools";
import { normalizePermissionRequest } from "./permission-card";

function renderPermissionTool({
  canInteract,
  respondToPermission,
}: {
  canInteract: boolean;
  respondToPermission: (
    requestId: string,
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
}) {
  const initial = createConversationRuntimeState("conversation-1");
  const state = {
    ...initial,
    messageOrder: ["message-1"],
    messagesById: {
      "message-1": {
        info: {
          id: "message-1",
          sessionID: "conversation-1",
          role: "assistant" as const,
        },
        parts: [
          {
            id: "part-edit-1",
            messageID: "message-1",
            sessionID: "conversation-1",
            type: "tool",
            tool: "edit",
            callID: "call-edit-1",
            state: {
              status: "running",
              input: {
                filePath: "/workspace/README.md",
                content: "Fixture content",
              },
            },
          },
        ],
      },
    },
    permissions: {
      "permission-edit-1": {
        id: "permission-edit-1",
        sessionID: "conversation-1",
        permission: "edit",
        patterns: ["/workspace/README.md"],
        metadata: {
          input: {
            filePath: "/workspace/README.md",
            content: "Fixture content",
          },
        },
        tool: {
          callID: "call-edit-1",
          messageID: "message-1",
        },
      },
    },
  };

  render(
    <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
      <ConversationToolBridgeProvider
        state={state}
        canInteract={canInteract}
        respondToPermission={respondToPermission}
        replyToQuestion={async () => undefined}
        rejectQuestion={async () => undefined}
      >
        <EditTool
          type="tool-call"
          toolCallId="call-edit-1"
          toolName="edit"
          args={{
            filePath: "/workspace/README.md",
            content: "Fixture content",
          }}
          argsText='{"filePath":"/workspace/README.md","content":"Fixture content"}'
          status={{ type: "running" }}
          addResult={() => undefined}
          resume={() => undefined}
          respondToApproval={() => undefined}
        />
      </ConversationToolBridgeProvider>
    </I18nProvider>,
  );
}

function renderQuestionTool(
  replyToQuestion: (
    requestId: string,
    answers: readonly unknown[],
  ) => Promise<void>,
  includeToolIdentity = true,
) {
  const initial = createConversationRuntimeState("conversation-1");
  const questions = [
    {
      header: "Continue",
      question: "Continue with the fixture?",
      multiple: false,
      custom: false,
      options: [
        {
          label: "Continue",
          description: "Continue the scenario.",
        },
      ],
    },
  ];
  const state = {
    ...initial,
    messageOrder: ["message-1"],
    messagesById: {
      "message-1": {
        info: {
          id: "message-1",
          sessionID: "conversation-1",
          role: "assistant" as const,
        },
        parts: [
          {
            id: "part-question-1",
            messageID: "message-1",
            sessionID: "conversation-1",
            type: "tool",
            tool: "askuserquestion",
            callID: "call-question-1",
            state: { status: "running", input: { questions } },
          },
        ],
      },
    },
    questions: {
      "question-1": {
        id: "question-1",
        sessionID: "conversation-1",
        questions,
        ...(includeToolIdentity
          ? {
              tool: {
                callID: "call-question-1",
                messageID: "message-1",
              },
            }
          : {}),
      },
    },
  };

  render(
    <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
      <ConversationToolBridgeProvider
        state={state}
        canInteract
        respondToPermission={async () => undefined}
        replyToQuestion={replyToQuestion}
        rejectQuestion={async () => undefined}
      >
        <QuestionTool
          type="tool-call"
          toolCallId="call-question-1"
          toolName="askuserquestion"
          args={{ questions }}
          argsText={JSON.stringify({ questions })}
          status={{ type: "running" }}
          addResult={() => undefined}
          resume={() => undefined}
          respondToApproval={() => undefined}
        />
        <ConversationInteractionFallback />
      </ConversationToolBridgeProvider>
    </I18nProvider>,
  );
}

function renderAnsweredQuestionTool(source: "metadata" | "runtime") {
  const initial = createConversationRuntimeState("conversation-1");
  const questions = [
    {
      header: "Continue",
      question: "Continue with the fixture?",
      multiple: false,
      custom: false,
      options: [],
    },
  ];
  const state = {
    ...initial,
    ...(source === "runtime"
      ? {
          questionResponses: {
            "question-1": {
              request: {
                id: "question-1",
                sessionID: "conversation-1",
                questions,
                tool: {
                  callID: "call-question-1",
                  messageID: "message-1",
                },
              },
              state: "answered" as const,
              answers: [["Continue"]],
              respondedAt: 1,
            },
          },
        }
      : {}),
    messageOrder: ["message-1"],
    messagesById: {
      "message-1": {
        info: {
          id: "message-1",
          sessionID: "conversation-1",
          role: "assistant" as const,
        },
        parts: [
          {
            id: "part-question-1",
            messageID: "message-1",
            sessionID: "conversation-1",
            type: "tool",
            tool: "askuserquestion",
            callID: "call-question-1",
            state: {
              status: "completed",
              input: { questions },
              ...(source === "metadata"
                ? { metadata: { answers: [["Continue"]] } }
                : {}),
            },
          },
        ],
      },
    },
  };

  render(
    <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
      <ConversationToolBridgeProvider
        state={state}
        canInteract
        respondToPermission={async () => undefined}
        replyToQuestion={async () => undefined}
        rejectQuestion={async () => undefined}
      >
        <QuestionTool
          type="tool-call"
          toolCallId="call-question-1"
          toolName="askuserquestion"
          args={{ questions }}
          argsText={JSON.stringify({ questions })}
          status={{ type: "complete" }}
          addResult={() => undefined}
          resume={() => undefined}
          respondToApproval={() => undefined}
        />
      </ConversationToolBridgeProvider>
    </I18nProvider>,
  );
}

describe("conversation tool interactions", () => {
  it("normalizes the captured permission.asked payload", () => {
    expect(
      normalizePermissionRequest({
        type: "permission.asked",
        id: "permission-edit-1",
        sessionID: "conversation-1",
        permission: "edit",
        patterns: ["/workspace/README.md"],
        metadata: {
          input: {
            filePath: "/workspace/README.md",
            content: "Fixture content",
          },
        },
        tool: {
          callID: "call-edit-1",
          messageID: "message-1",
        },
      }),
    ).toEqual({
      id: "permission-edit-1",
      permission: "edit",
      title: "",
      patterns: ["/workspace/README.md"],
      toolInput: {
        filePath: "/workspace/README.md",
        content: "Fixture content",
      },
    });
  });

  it("associates a permission by callID and forwards the selected decision", async () => {
    const user = userEvent.setup();
    const respondToPermission = vi.fn(async () => undefined);
    renderPermissionTool({ canInteract: true, respondToPermission });

    expect(screen.getByText("/workspace/README.md")).toBeVisible();
    expect(screen.getByText(/Fixture content/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(respondToPermission).toHaveBeenCalledWith(
        "permission-edit-1",
        "once",
      ),
    );
  });

  it("does not expose permission controls in observe mode", () => {
    renderPermissionTool({
      canInteract: false,
      respondToPermission: vi.fn(async () => undefined),
    });

    expect(
      screen.queryByRole("button", { name: "Allow once" }),
    ).not.toBeInTheDocument();
  });

  it("associates captured questions by callID and forwards proxy answers", async () => {
    const user = userEvent.setup();
    const replyToQuestion = vi.fn(async () => undefined);
    renderQuestionTool(replyToQuestion);

    await user.click(screen.getByRole("radio", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(replyToQuestion).toHaveBeenCalledWith("question-1", [
        ["Continue"],
      ]),
    );
  });

  it("associates a question by payload without duplicating it in the fallback", () => {
    renderQuestionTool(async () => undefined, false);

    expect(
      screen.getAllByText("Continue with the fixture?"),
    ).toHaveLength(2);
    expect(
      screen.queryByTestId("conversation-interaction-fallback"),
    ).not.toBeInTheDocument();
  });

  it("renders answers restored from completed question metadata", () => {
    renderAnsweredQuestionTool("metadata");

    expect(screen.getAllByText("Continue with the fixture?")).toHaveLength(2);
    expect(screen.getByText("Continue")).toBeVisible();
    expect(
      screen.queryByText(enChat.session.tools.question.answer_required),
    ).not.toBeInTheDocument();
  });

  it("renders answers recorded by the runtime response action", () => {
    renderAnsweredQuestionTool("runtime");

    expect(screen.getByText("Continue")).toBeVisible();
  });
});

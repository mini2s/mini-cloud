import { createConversationRuntimeState } from "@multica/core/conversations";
import { I18nProvider } from "@multica/core/i18n/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enChat from "../../../locales/en/chat.json";
import { ConversationInteractionFallback } from "./conversation-interaction-fallback";
import { ConversationToolBridgeProvider } from "./conversation-tool-bridge";

const questions = [
  {
    header: "Continue",
    question: "Continue with the fallback fixture?",
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

function renderFallback({
  withQuestion = false,
  canInteract = true,
  respondToPermission = vi.fn(async () => undefined),
  replyToQuestion = vi.fn(async () => undefined),
  rejectQuestion = vi.fn(async () => undefined),
}: {
  withQuestion?: boolean;
  canInteract?: boolean;
  respondToPermission?: (
    requestId: string,
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  replyToQuestion?: (
    requestId: string,
    answers: readonly unknown[],
  ) => Promise<void>;
  rejectQuestion?: (requestId: string) => Promise<void>;
} = {}) {
  const initial = createConversationRuntimeState("conversation-1");
  const state = {
    ...initial,
    permissions: {
      "permission-1": {
        id: "permission-1",
        permission: "bash",
        patterns: ["pnpm test"],
      },
    },
    ...(withQuestion
      ? {
          questions: {
            "question-1": {
              id: "question-1",
              questions,
            },
          },
        }
      : {}),
  };

  render(
    <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
      <ConversationToolBridgeProvider
        state={state}
        canInteract={canInteract}
        respondToPermission={respondToPermission}
        replyToQuestion={replyToQuestion}
        rejectQuestion={rejectQuestion}
      >
        <ConversationInteractionFallback />
      </ConversationToolBridgeProvider>
    </I18nProvider>,
  );
}

describe("ConversationInteractionFallback", () => {
  it("renders an unassigned permission and forwards its decision", async () => {
    const user = userEvent.setup();
    const respondToPermission = vi.fn(async () => undefined);
    renderFallback({ respondToPermission });

    expect(screen.getByText("pnpm test")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(respondToPermission).toHaveBeenCalledWith("permission-1", "once"),
    );
  });

  it("prioritizes a question over an unassigned permission", async () => {
    const user = userEvent.setup();
    const replyToQuestion = vi.fn(async () => undefined);
    renderFallback({ withQuestion: true, replyToQuestion });

    expect(
      screen.getByText("Continue with the fallback fixture?"),
    ).toBeVisible();
    expect(screen.queryByText("pnpm test")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(replyToQuestion).toHaveBeenCalledWith("question-1", [
        ["Continue"],
      ]),
    );
  });

  it("keeps fallback interactions read-only in observe mode", () => {
    renderFallback({ canInteract: false });

    expect(screen.getByText("pnpm test")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Allow once" }),
    ).not.toBeInTheDocument();
  });

  it("forwards a question rejection", async () => {
    const user = userEvent.setup();
    const rejectQuestion = vi.fn(async () => undefined);
    renderFallback({ withQuestion: true, rejectQuestion });

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(rejectQuestion).toHaveBeenCalledWith("question-1"),
    );
  });
});

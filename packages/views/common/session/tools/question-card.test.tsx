import { I18nProvider } from "@multica/core/i18n/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enChat from "../../../locales/en/chat.json";
import {
  QuestionCard,
  normalizeQuestionRequest,
} from "./question-card";

const QUESTION_PAYLOAD = {
  type: "question.asked",
  id: "question-1",
  sessionID: "conversation-1",
  questions: [
    {
      header: "Continue",
      question: "Continue with the fixture write?",
      multiple: false,
      custom: false,
      options: [
        {
          label: "Continue",
          description: "Continue to the write scenario.",
        },
        {
          label: "Stop",
          description: "Stop without writing.",
        },
      ],
    },
  ],
};

function renderQuestion(
  canInteract: boolean,
  onSubmit = vi.fn(async () => undefined),
) {
  const request = normalizeQuestionRequest(QUESTION_PAYLOAD);
  if (!request) throw new Error("Question fixture did not normalize.");
  const onReject = vi.fn(async () => undefined);
  render(
    <I18nProvider locale="en" resources={{ en: { chat: enChat } }}>
      <QuestionCard
        request={request}
        canInteract={canInteract}
        onSubmit={onSubmit}
        onReject={onReject}
      />
    </I18nProvider>,
  );
  return { onReject, onSubmit };
}

describe("QuestionCard", () => {
  it("normalizes the captured question.asked payload", () => {
    expect(normalizeQuestionRequest(QUESTION_PAYLOAD)).toEqual({
      id: "question-1",
      questions: [
        {
          header: "Continue",
          question: "Continue with the fixture write?",
          multiple: false,
          custom: false,
          options: [
            {
              label: "Continue",
              description: "Continue to the write scenario.",
            },
            {
              label: "Stop",
              description: "Stop without writing.",
            },
          ],
        },
      ],
    });
  });

  it("submits answers using the proxy array-of-arrays shape", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    renderQuestion(true, onSubmit);

    await user.click(screen.getByRole("radio", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([["Continue"]]),
    );
    expect(screen.getByText("Answer submitted")).toBeInTheDocument();
  });

  it("keeps observe mode read-only", () => {
    renderQuestion(false);

    expect(screen.getByText("Take over the session to answer.")).toBeVisible();
    expect(screen.getByRole("radio", { name: /Continue/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  });
});

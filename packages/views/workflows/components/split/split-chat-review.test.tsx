// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import { SplitChatReview } from "./split-chat-review";

const mocks = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  isLoading: false,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled }: { enabled?: boolean }) => ({
    data: enabled === false ? [] : mocks.messages,
    isLoading: mocks.isLoading,
  }),
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatMessagesOptions: (sessionId: string) => ({
    queryKey: ["chat", "messages", sessionId],
    enabled: !!sessionId,
  }),
}));

vi.mock("../../../issues/components/comment-input", () => ({
  CommentInput: ({
    onSubmit,
    disabled,
  }: {
    onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onSubmit("删除第 3 个子 issue", ["att-1"])}
    >
      Submit comment input
    </button>
  ),
}));

vi.mock("../../../issues/components/execution-log/inline-transcript-panel", () => ({
  InlineTranscriptPanel: () => <div data-testid="inline-transcript-panel" />,
}));

describe("SplitChatReview", () => {
  beforeEach(() => {
    mocks.messages = [];
    mocks.isLoading = false;
  });

  it("renders split chat history from the review chat session", () => {
    mocks.messages = [
      {
        id: "msg-1",
        chat_session_id: "chat-1",
        role: "user",
        content: "添加一个安全审计子 issue",
        task_id: null,
        created_at: "2026-07-15T00:00:00Z",
      },
      {
        id: "msg-2",
        chat_session_id: "chat-1",
        role: "assistant",
        content: "已更新草案，新增安全审计。",
        task_id: "task-1",
        created_at: "2026-07-15T00:00:01Z",
      },
    ];

    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    expect(screen.getByText("添加一个安全审计子 issue")).toBeInTheDocument();
    expect(screen.getByText("已更新草案，新增安全审计。")).toBeInTheDocument();
    expect(screen.getByText("Agent transcript")).toBeInTheDocument();
  });

  it("submits natural language adjustments through CommentInput with attachments", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Submit comment input" }));

    expect(onSubmit).toHaveBeenCalledWith("删除第 3 个子 issue", ["att-1"]);
  });
});

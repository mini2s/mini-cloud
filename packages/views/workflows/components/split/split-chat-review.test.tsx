// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import { SplitChatReview } from "./split-chat-review";

const mocks = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  isLoading: false,
  pendingTask: {} as { task_id?: string; status?: string },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[]; enabled?: boolean }) => {
    const isPendingTask = queryKey[0] === "chat" && queryKey[1] === "pending-task";
    if (isPendingTask) {
      return { data: mocks.pendingTask, isLoading: false };
    }

    const sessionId = queryKey[2] as string | undefined;
    return {
      data: !sessionId ? [] : mocks.messages,
      isLoading: mocks.isLoading,
    };
  },
}));

vi.mock("@multica/core/chat/queries", () => ({
  chatMessagesOptions: (sessionId: string) => ({
    queryKey: ["chat", "messages", sessionId],
    enabled: !!sessionId,
  }),
  pendingChatTaskOptions: (sessionId: string) => ({
    queryKey: ["chat", "pending-task", sessionId],
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
      onClick={() => void onSubmit("Delete child issue 3", ["att-1"])}
    >
      Submit comment input
    </button>
  ),
}));

vi.mock("../../../issues/components/execution-log/inline-transcript-panel", () => ({
  InlineTranscriptPanel: ({
    task,
    isLive,
    defaultOpen,
  }: {
    task: { id: string };
    isLive?: boolean;
    defaultOpen?: boolean;
  }) => (
    <div
      data-testid="inline-transcript-panel"
      data-task-id={task.id}
      data-live={String(isLive)}
      data-default-open={String(defaultOpen)}
    />
  ),
}));

describe("SplitChatReview", () => {
  beforeEach(() => {
    mocks.messages = [];
    mocks.isLoading = false;
    mocks.pendingTask = {};
  });

  it("renders split chat history from the review chat session", () => {
    mocks.messages = [
      {
        id: "msg-1",
        chat_session_id: "chat-1",
        role: "user",
        content: "Add a security review child issue",
        task_id: null,
        created_at: "2026-07-15T00:00:00Z",
      },
      {
        id: "msg-2",
        chat_session_id: "chat-1",
        role: "assistant",
        content: "Draft updated with a new security review item.",
        task_id: "task-1",
        created_at: "2026-07-15T00:00:01Z",
      },
    ];

    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    expect(screen.getByText("Add a security review child issue")).toBeInTheDocument();
    expect(screen.getByText("Draft updated with a new security review item.")).toBeInTheDocument();
    expect(screen.getByText("Agent transcript")).toBeInTheDocument();
  });

  it("submits natural language adjustments through CommentInput with attachments", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Submit comment input" }));

    expect(onSubmit).toHaveBeenCalledWith("Delete child issue 3", ["att-1"]);
  });

  it("shows the live transcript while a split chat task is pending", () => {
    mocks.pendingTask = {
      task_id: "123e4567-e89b-12d3-a456-426614174000",
      status: "running",
    };

    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    const transcript = screen.getByTestId("inline-transcript-panel");
    expect(transcript).toHaveAttribute("data-task-id", "123e4567-e89b-12d3-a456-426614174000");
    expect(transcript).toHaveAttribute("data-live", "true");
    expect(transcript).toHaveAttribute("data-default-open", "true");
  });
});

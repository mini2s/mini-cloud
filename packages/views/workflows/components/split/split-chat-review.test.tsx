// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@multica/core/types";
import { SplitChatReview } from "./split-chat-review";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: Record<string, unknown>) => string,
      values?: Record<string, string | number>,
    ) => {
      const detailPanel = {
        split_chat_adjustment_aria: "Adjustment request",
        split_chat_adjustment_placeholder: "Describe the adjustment...",
        split_chat_send: "Send",
        split_chat_sending: "Sending...",
        split_chat_agent_transcript: "Agent transcript",
        split_chat_role_agent: "Agent",
        split_chat_role_you: "You",
        split_chat_agent_thinking: "Agent is thinking...",
        split_chat_queued: "Queued",
        split_chat_ready_title: "Ready for adjustment",
        split_chat_live_badge: "Live",
        split_chat_view_process: "View process",
        split_chat_hide_process: "Hide process",
        split_chat_non_workflow_hint: "Workflow changes use the row selector, not chat.",
        split_chat_suggestion_add_security: "Add a security review child issue",
        split_chat_suggestion_merge: "Merge task 2 and task 3",
        split_chat_suggestion_restore: "Restore the original draft",
      };
      const template = selector({ detail_panel: detailPanel });
      if (values) {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values[key] ?? ""));
      }
      return template;
    },
  }),
}));

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
    variant,
  }: {
    onSubmit: (content: string, attachmentIds?: string[]) => Promise<void>;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button
      type="button"
      data-variant={variant}
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

  it("renders chat messages as a lightweight stream without filled gray blocks", () => {
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

    const stream = screen.getByTestId("split-chat-history");
    expect(stream.className).not.toContain("bg-background/70");

    for (const messageId of ["msg-1", "msg-2"]) {
      const message = screen.getByTestId(`split-chat-message-${messageId}`);
      expect(message.className).not.toContain("bg-muted");
      expect(message.className).not.toContain("bg-primary/10");
      expect(message.className).not.toContain("shadow-sm");
      expect(message.className).not.toContain("rounded-lg");
    }
  });

  it("submits natural language adjustments through CommentInput with attachments", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Submit comment input" }));

    expect(onSubmit).toHaveBeenCalledWith("Delete child issue 3", ["att-1"]);
  });

  it("uses the compact split composer without changing the default issue composer", () => {
    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Submit comment input" })).toHaveAttribute(
      "data-variant",
      "split-review",
    );
  });

  it("keeps the live transcript collapsed behind a process control while a split chat task is pending", async () => {
    mocks.pendingTask = {
      task_id: "123e4567-e89b-12d3-a456-426614174000",
      status: "running",
    };

    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    expect(screen.getByTestId("split-chat-workbench")).toBeInTheDocument();
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByTestId("inline-transcript-panel")).not.toBeInTheDocument();

    const processButton = screen.getByRole("button", { name: "View process" });
    expect(processButton).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(processButton);

    const transcript = screen.getByTestId("inline-transcript-panel");
    expect(transcript).toHaveAttribute("data-task-id", "123e4567-e89b-12d3-a456-426614174000");
    expect(transcript).toHaveAttribute("data-live", "true");
    expect(transcript).toHaveAttribute("data-default-open", "false");
    expect(screen.getByRole("button", { name: "Hide process" })).toHaveAttribute("aria-expanded", "true");
  });

  it("disables the comment input while a split chat task is pending", () => {
    mocks.pendingTask = {
      task_id: "123e4567-e89b-12d3-a456-426614174000",
      status: "running",
    };

    render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" disabled onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Submit comment input" })).toBeDisabled();
  });

  it("reserves bottom-right space for the global chat launcher", () => {
    const { container } = render(<SplitChatReview issueId="issue-1" chatSessionId="chat-1" onSubmit={vi.fn()} />);

    expect(container.firstElementChild).toHaveClass("pb-20", "pr-14");
  });
});

import { describe, expect, it } from "vitest";
import { createConversationRuntimeState } from "@multica/core/conversations";
import { toThreadMessageLike } from "./to-thread-message-like";

describe("toThreadMessageLike", () => {
  it("projects text, reasoning, files, tools, and unsupported parts", () => {
    const state = createConversationRuntimeState("conversation-1");
    const next = {
      ...state,
      runState: { type: "streaming" as const },
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: "conversation-1",
            time: { created: 10 },
          },
          parts: [
            { id: "text-1", type: "text", text: "hello" },
            {
              id: "reasoning-1",
              type: "reasoning",
              text: "[REDACTED]thinking",
            },
            {
              id: "tool-1",
              type: "tool",
              callID: "call-1",
              tool: "read",
              state: {
                status: "completed",
                input: { path: "README.md" },
                output: "done",
              },
            },
            { id: "custom-1", type: "step-start", snapshot: "abc" },
          ],
        },
      },
    };

    const messages = toThreadMessageLike(next);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      status: { type: "running" },
    });
    expect(messages[0]?.content).toMatchObject([
      { type: "text", text: "hello" },
      { type: "reasoning", text: "thinking" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "README.md" },
        result: "done",
      },
      {
        type: "data",
        name: "opencode-unsupported-part",
        data: { type: "step-start" },
      },
    ]);
  });

  it("projects errors, pending interactions, and optimistic messages", () => {
    const state = createConversationRuntimeState("conversation-1");
    const messages = toThreadMessageLike({
      ...state,
      messageOrder: ["assistant-1", "user-1", "assistant-2"],
      messagesById: {
        "assistant-1": {
          info: {
            id: "assistant-1",
            role: "assistant",
            error: { data: { message: "failed" } },
            time: { created: 10 },
          },
          parts: [],
        },
        "user-1": {
          info: {
            id: "user-1",
            role: "user",
            time: { created: 15 },
          },
          parts: [{ id: "user-text", type: "text", text: "continue" }],
        },
        "assistant-2": {
          info: {
            id: "assistant-2",
            role: "assistant",
            time: { created: 20 },
          },
          parts: [
            {
              id: "tool-1",
              type: "tool",
              callID: "call-1",
              tool: "question",
              state: { status: "running", input: {} },
            },
          ],
        },
      },
      questions: {
        "question-1": {
          id: "question-1",
          sessionID: "conversation-1",
          tool: { callID: "call-1" },
        },
      },
      pendingMessages: {
        "pending-1": {
          id: "pending-1",
          createdAt: 30,
          status: "pending",
          parts: [{ type: "text", text: "next" }],
        },
      },
    });

    expect(messages.map((message) => message.status)).toMatchObject([
      { type: "incomplete", reason: "error", error: "failed" },
      undefined,
      { type: "requires-action", reason: "tool-calls" },
      undefined,
    ]);
    expect(messages[3]).toMatchObject({
      id: "pending-1",
      role: "user",
      content: [{ type: "text", text: "next" }],
    });
  });

  it("merges consecutive assistant messages and deduplicates repeated tool calls", () => {
    const state = createConversationRuntimeState("conversation-1");
    const messages = toThreadMessageLike({
      ...state,
      messageOrder: ["assistant-1", "assistant-2"],
      messagesById: {
        "assistant-1": {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: 10 },
          },
          parts: [
            { id: "text-1", type: "text", text: "first" },
            {
              id: "tool-old",
              type: "tool",
              callID: "call-1",
              tool: "read",
              state: { status: "running", input: {} },
            },
          ],
        },
        "assistant-2": {
          info: {
            id: "assistant-2",
            role: "assistant",
            finish: "stop",
            time: { created: 20 },
          },
          parts: [
            {
              id: "tool-new",
              type: "tool",
              callID: "call-1",
              tool: "read",
              state: { status: "completed", output: "duplicate" },
            },
            { id: "text-2", type: "text", text: "second" },
          ],
        },
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-2",
      role: "assistant",
      status: { type: "complete" },
    });
    expect(messages[0]?.content).toHaveLength(3);
    expect(messages[0]?.content[1]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-1",
      result: "duplicate",
    });
  });
});

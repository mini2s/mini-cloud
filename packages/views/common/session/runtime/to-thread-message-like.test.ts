import { describe, expect, it } from "vitest";
import {
  createConversationRuntimeState,
  createPendingMessage,
  reduceConversationRuntimeState,
} from "@multica/core/conversations";
import { toThreadMessageLike } from "./to-thread-message-like";

describe("toThreadMessageLike", () => {
  it("projects one user message after a REST snapshot reconciles its optimistic copy", () => {
    const pending = {
      ...createPendingMessage("conversation-1", [
        { type: "text" as const, text: "hello" },
      ]),
      id: "pending-1",
      createdAt: 100,
    };
    let state = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      { type: "pending-message-added", message: pending },
    ).state;
    state = reduceConversationRuntimeState(state, {
      type: "snapshot-loaded",
      snapshot: {
        conversation: null,
        messages: [
          {
            info: {
              id: "server-user-1",
              role: "user",
              time: { created: 110 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "server-user-1",
                type: "text",
                text: "hello",
              },
            ],
          },
        ],
        status: null,
        permissions: [],
        questions: [],
        todo: [],
        tasks: [],
      },
    }).state;

    expect(toThreadMessageLike(state)).toMatchObject([
      {
        id: "server-user-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ]);
  });

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

  it("does not keep the previous assistant running after a new user message is pending", () => {
    const state = createConversationRuntimeState("conversation-1");
    const messages = toThreadMessageLike({
      ...state,
      runState: { type: "streaming" },
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: 10 },
          },
          parts: [{ id: "text-1", type: "text", text: "previous reply" }],
        },
      },
      pendingMessages: {
        "pending-user-1": {
          id: "pending-user-1",
          createdAt: 20,
          status: "pending",
          parts: [{ type: "text", text: "next question" }],
        },
      },
    });

    expect(messages).toMatchObject([
      {
        id: "assistant-1",
        role: "assistant",
        status: { type: "incomplete", reason: "other" },
      },
      {
        id: "pending-user-1",
        role: "user",
      },
    ]);
  });

  it("does not keep the previous assistant running after the REST user message arrives", () => {
    const state = createConversationRuntimeState("conversation-1");
    const messages = toThreadMessageLike({
      ...state,
      runState: { type: "streaming" },
      messageOrder: ["assistant-1", "user-1"],
      messagesById: {
        "assistant-1": {
          info: {
            id: "assistant-1",
            role: "assistant",
            time: { created: 10 },
          },
          parts: [{ id: "text-1", type: "text", text: "previous reply" }],
        },
        "user-1": {
          info: {
            id: "user-1",
            role: "user",
            time: { created: 20 },
          },
          parts: [{ id: "text-2", type: "text", text: "next question" }],
        },
      },
    });

    expect(messages[0]).toMatchObject({
      id: "assistant-1",
      status: { type: "incomplete", reason: "other" },
    });
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

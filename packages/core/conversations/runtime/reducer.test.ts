import { describe, expect, it } from "vitest";
import type { OpenCodeRuntimeEvent } from "../types";
import {
  reduceConversationRuntimeState,
  type ConversationRuntimeSnapshot,
} from "./reducer";
import { createConversationRuntimeState } from "./state";

function event(
  type: string,
  properties: Record<string, unknown>,
): OpenCodeRuntimeEvent {
  return {
    type,
    properties,
    sessionId: "conversation-1",
    raw: { type, properties },
  };
}

function snapshot(
  input: Partial<ConversationRuntimeSnapshot> = {},
): ConversationRuntimeSnapshot {
  return {
    conversation: null,
    messages: [],
    status: null,
    permissions: [],
    questions: [],
    todo: [],
    tasks: [],
    diff: [],
    ...input,
  };
}

describe("reduceConversationRuntimeState", () => {
  it("merges message metadata without losing its creation time", () => {
    const initial = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      {
        type: "snapshot-loaded",
        snapshot: {
          conversation: null,
          messages: [
            {
              info: {
                id: "message-1",
                sessionID: "conversation-1",
                role: "assistant",
                time: { created: 10 },
              },
              parts: [],
            },
          ],
          status: null,
          permissions: [],
          questions: [],
          todo: [],
          tasks: [],
          diff: [],
        },
      },
    ).state;

    const result = reduceConversationRuntimeState(initial, {
      type: "event",
      event: event("message.updated", {
        info: {
          id: "message-1",
          sessionID: "conversation-1",
          role: "assistant",
          finish: "stop",
          time: { completed: 20 },
        },
      }),
    }).state;

    expect(result.messagesById["message-1"]?.info?.time).toEqual({
      created: 10,
      completed: 20,
    });
  });

  it("treats snapshot parts and message membership as final REST truth", () => {
    let state = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      {
        type: "snapshot-loaded",
        snapshot: snapshot({
          messages: [
            {
              info: {
                id: "message-later",
                role: "assistant",
                time: { created: 20 },
              },
              parts: [
                {
                  id: "tool-old",
                  messageID: "message-later",
                  type: "tool",
                  callID: "call-1",
                  state: { status: "running", output: "stale" },
                },
                {
                  id: "text-removed",
                  messageID: "message-later",
                  type: "text",
                  text: "remove me",
                },
              ],
            },
            {
              info: {
                id: "message-removed",
                role: "user",
                time: { created: 5 },
              },
              parts: [],
            },
          ],
        }),
      },
    ).state;

    state = reduceConversationRuntimeState(state, {
      type: "snapshot-loaded",
      snapshot: snapshot({
        messages: [
          {
            info: {
              id: "message-earlier",
              role: "user",
              time: { created: 10 },
            },
            parts: [],
          },
          {
            info: {
              id: "message-later",
              role: "assistant",
              time: { completed: 30 },
            },
            parts: [
              {
                id: "tool-new",
                messageID: "message-later",
                type: "tool",
                callID: "call-1",
                state: { status: "completed", output: "fresh" },
              },
              {
                id: "tool-duplicate",
                messageID: "message-later",
                type: "tool",
                callID: "call-1",
                state: { status: "completed", output: "latest" },
              },
            ],
          },
        ],
      }),
    }).state;

    expect(state.messageOrder).toEqual(["message-earlier", "message-later"]);
    expect(state.messagesById["message-removed"]).toBeUndefined();
    expect(state.messagesById["message-later"]?.info?.time).toEqual({
      created: 20,
      completed: 30,
    });
    expect(state.messagesById["message-later"]?.parts).toHaveLength(1);
    expect(state.messagesById["message-later"]?.parts[0]).toMatchObject({
      id: "tool-new",
      state: { output: "latest" },
    });
  });

  it("matches tool updates by callID and preserves omitted output", () => {
    let state = createConversationRuntimeState("conversation-1");
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "part-old",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "tool",
          callID: "call-1",
          state: { status: "completed", output: "result" },
        },
      }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "part-new",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "tool",
          callID: "call-1",
          state: { status: "completed", input: { path: "README.md" } },
        },
      }),
    }).state;

    expect(state.messagesById["message-1"]?.parts).toHaveLength(1);
    expect(state.messagesById["message-1"]?.parts[0]).toMatchObject({
      id: "part-old",
      state: {
        status: "completed",
        input: { path: "README.md" },
        output: "result",
      },
    });
  });

  it("applies text and tool input deltas and requests refresh without a base", () => {
    let state = createConversationRuntimeState("conversation-1");
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "text-1",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "text",
          text: "hel",
        },
      }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.delta", {
        messageID: "message-1",
        partID: "text-1",
        field: "text",
        delta: "lo",
      }),
    }).state;
    expect(state.messagesById["message-1"]?.parts[0]?.text).toBe("hello");

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "tool-1",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "tool",
          callID: "call-1",
          state: { status: "pending", input: '{"path":"' },
        },
      }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.delta", {
        messageID: "message-1",
        partID: "tool-1",
        field: "input",
        delta: 'README.md"}',
      }),
    }).state;
    expect(
      (
        state.messagesById["message-1"]?.parts[1]?.state as {
          input?: string;
        }
      )?.input,
    ).toBe('{"path":"README.md"}');

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "text-1",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "text",
          text: "corrected",
        },
      }),
    }).state;
    expect(state.messagesById["message-1"]?.parts[0]?.text).toBe("corrected");

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.removed", {
        messageID: "message-1",
        partID: "tool-1",
      }),
    }).state;
    expect(state.messagesById["message-1"]?.parts).toHaveLength(1);

    const missing = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.delta", {
        messageID: "missing",
        partID: "missing",
        field: "text",
        delta: "x",
      }),
    });
    expect(missing.needsRefresh).toBe(true);
  });

  it("handles removals and bounds unknown extension diagnostics", () => {
    let state = createConversationRuntimeState("conversation-1");
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.updated", {
        info: {
          id: "message-1",
          role: "assistant",
          sessionID: "conversation-1",
        },
      }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.removed", { messageID: "message-1" }),
    }).state;
    expect(state.messageOrder).toEqual([]);

    for (let index = 0; index < 60; index += 1) {
      state = reduceConversationRuntimeState(state, {
        type: "event",
        event: event("host.git.status.changed", { index }),
      }).state;
    }
    expect(state.unhandledEvents).toHaveLength(50);
  });

  it("marks compaction and reconnect as requiring reconciliation", () => {
    const state = createConversationRuntimeState("conversation-1");
    expect(
      reduceConversationRuntimeState(state, {
        type: "event",
        event: event("session.compacted", {}),
      }).needsRefresh,
    ).toBe(true);
    expect(
      reduceConversationRuntimeState(state, {
        type: "stream-reconnected",
        at: 100,
      }).needsRefresh,
    ).toBe(true);
  });

  it("loads task snapshots and applies task lifecycle events like app-ai-native", () => {
    let state = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      {
        type: "snapshot-loaded",
        snapshot: snapshot({
          tasks: [
            {
              taskID: "snapshot-task",
              status: "unexpected",
              description: "Existing task",
              taskType: "research",
              startTime: 10,
            },
          ],
        }),
      },
    ).state;
    expect(state.tasks["snapshot-task"]).toEqual({
      taskID: "snapshot-task",
      status: "completed",
      description: "Existing task",
      taskType: "research",
      startTime: 10,
    });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("task.started", {
        taskID: "task-1",
        description: "Inspect runtime",
        taskType: "analysis",
      }),
    }).state;
    const startTime = state.tasks["task-1"]?.startTime;
    expect(state.tasks["task-1"]).toMatchObject({
      taskID: "task-1",
      status: "running",
      description: "Inspect runtime",
      taskType: "analysis",
    });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("task.progress", {
        taskID: "missing-task",
        description: "must not create",
      }),
    }).state;
    expect(state.tasks["missing-task"]).toBeUndefined();

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("task.progress", {
        taskID: "task-1",
        description: "Inspect reducers",
        summary: "Halfway",
        usage: {
          total_tokens: 100,
          tool_uses: 2,
          duration_ms: 300,
        },
      }),
    }).state;
    expect(state.tasks["task-1"]).toMatchObject({
      status: "running",
      description: "Inspect reducers",
      summary: "Halfway",
      usage: {
        total_tokens: 100,
        tool_uses: 2,
        duration_ms: 300,
      },
      startTime,
    });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("task.completed", {
        taskID: "task-1",
        status: "unknown",
      }),
    }).state;
    expect(state.tasks["task-1"]).toMatchObject({
      status: "completed",
      description: "Inspect reducers",
      taskType: "analysis",
      summary: "Halfway",
      usage: {
        total_tokens: 100,
        tool_uses: 2,
        duration_ms: 300,
      },
      startTime,
      endTime: expect.any(Number),
    });

    const beforeMalformed = state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("task.started", { description: "missing task ID" }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("tool.progress", { toolUseID: "call-2" }),
    }).state;
    expect(state.tasks).toEqual(beforeMalformed.tasks);
    expect(state.toolProgress).toEqual(beforeMalformed.toolProgress);

    state = reduceConversationRuntimeState(state, {
      type: "snapshot-loaded",
      snapshot: snapshot({ tasks: null }),
    }).state;
    expect(state.tasks["task-1"]?.summary).toBe("Halfway");
  });

  it("accumulates tool progress and mirrors tool part progress and todos", () => {
    let state = createConversationRuntimeState("conversation-1");
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("tool.progress", {
        parentToolUseID: "call-1",
        data: "first",
      }),
    }).state;
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("tool.progress", {
        toolUseID: "call-1",
        parentToolUseID: "ignored",
        data: " second",
      }),
    }).state;
    expect(state.toolProgress).toEqual({ "call-1": "first second" });

    const progress = Array.from({ length: 12 }, (_, index) => `step-${index}`);
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "todo-part",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "tool",
          tool: "todowrite",
          callID: "call-1",
          state: {
            status: "running",
            progress,
            input: {
              todos: [
                { id: "todo-1", content: "Verify runtime", status: "pending" },
              ],
            },
          },
        },
      }),
    }).state;
    expect(state.partProgress["call-1"]).toEqual(progress.slice(-10));
    expect(state.todo).toEqual([
      { id: "todo-1", content: "Verify runtime", status: "pending" },
    ]);

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.part.updated", {
        part: {
          id: "todo-part",
          messageID: "message-1",
          sessionID: "conversation-1",
          type: "tool",
          tool: "todowrite",
          callID: "call-1",
          state: { status: "completed" },
        },
      }),
    }).state;
    expect(state.partProgress["call-1"]).toBeUndefined();
  });

  it("tracks loading, running, idle, and error lifecycle states", () => {
    let state = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      { type: "load-started" },
    ).state;
    expect(state.loadState).toEqual({ type: "loading" });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.status", {
        sessionID: "conversation-1",
        status: { type: "busy" },
      }),
    }).state;
    expect(state.runState).toEqual({ type: "streaming" });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.idle", { sessionID: "conversation-1" }),
    }).state;
    expect(state.runState).toEqual({ type: "idle" });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.error", {
        sessionID: "conversation-1",
        error: { message: "failed" },
      }),
    }).state;
    expect(state.runState).toEqual({
      type: "error",
      error: { message: "failed" },
    });

    state = reduceConversationRuntimeState(state, {
      type: "load-failed",
      error: new Error("snapshot failed"),
    }).state;
    expect(state.loadState.type).toBe("error");
  });

  it("normalizes session errors and only clears them on a new user message", () => {
    let state = createConversationRuntimeState("conversation-1");
    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.error", {
        error: {
          subtype: "provider",
          level: "error",
          message: "Retrying",
          retryInMs: 1_000,
          retryAttempt: 2,
          maxRetries: 3,
          providerCode: "RATE_LIMIT",
        },
      }),
    }).state;

    expect(state.sessionError).toEqual({
      subtype: "provider",
      level: "error",
      message: "Retrying",
      retryInMs: 1_000,
      retryAttempt: 2,
      maxRetries: 3,
      providerCode: "RATE_LIMIT",
    });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.status", { status: { type: "idle" } }),
    }).state;
    expect(state.sessionError?.message).toBe("Retrying");

    state = reduceConversationRuntimeState(state, {
      type: "snapshot-loaded",
      snapshot: snapshot(),
    }).state;
    expect(state.sessionError?.message).toBe("Retrying");

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.updated", {
        info: {
          id: "assistant-1",
          role: "assistant",
          sessionID: "conversation-1",
        },
      }),
    }).state;
    expect(state.sessionError?.message).toBe("Retrying");

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("message.updated", {
        info: {
          id: "user-1",
          role: "user",
          sessionID: "conversation-1",
        },
      }),
    }).state;
    expect(state.sessionError).toBeNull();
  });

  it("normalizes string errors and falls back to the event message", () => {
    let state = reduceConversationRuntimeState(
      createConversationRuntimeState("conversation-1"),
      {
        type: "event",
        event: event("session.error", { error: "provider failed" }),
      },
    ).state;
    expect(state.sessionError).toEqual({ message: "provider failed" });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.error", { message: "fallback message" }),
    }).state;
    expect(state.sessionError).toEqual({ message: "fallback message" });

    state = reduceConversationRuntimeState(state, {
      type: "event",
      event: event("session.error", {
        error: {
          message: 42,
          retryInMs: "soon",
          extra: true,
        },
        message: "valid fallback",
      }),
    }).state;
    expect(state.sessionError).toEqual({
      extra: true,
      message: "valid fallback",
    });
  });
});

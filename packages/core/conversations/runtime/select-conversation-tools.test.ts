import { describe, expect, it } from "vitest";
import { selectConversationTools } from "./select-conversation-tools";
import { createConversationRuntimeState } from "./state";

describe("selectConversationTools", () => {
  it("indexes provider state and interactions by call ID", () => {
    const state = createConversationRuntimeState("conversation-1");
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-1",
              messageID: "assistant-1",
              type: "tool",
              tool: "edit",
              callID: "call-1",
              state: {
                status: "running",
                progress: ["Preparing"],
                metadata: { filediff: { file: "README.md" } },
              },
            },
          ],
        },
      },
      permissions: {
        "permission-1": {
          id: "permission-1",
          tool: { callID: "call-1" },
        },
      },
      questions: {
        "question-1": {
          id: "question-1",
          tool: { callID: "call-1" },
        },
      },
      questionResponses: {
        "question-answered": {
          request: {
            id: "question-answered",
            tool: { callID: "call-1" },
          },
          state: "answered",
          answers: [["Continue"]],
          respondedAt: 1,
        },
      },
      partProgress: { "call-1": ["Writing"] },
      toolProgress: { "call-1": "50%" },
    });

    expect(selection.toolsByCallId.get("call-1")).toMatchObject({
      toolCallId: "call-1",
      callId: "call-1",
      partId: "part-1",
      messageId: "assistant-1",
      toolName: "edit",
      providerState: {
        status: "running",
        metadata: { filediff: { file: "README.md" } },
      },
      progress: ["Preparing", "Writing", "50%"],
      permissions: [{ id: "permission-1" }],
      questions: [{ id: "question-1" }],
      questionResponses: [
        {
          state: "answered",
          answers: [["Continue"]],
        },
      ],
    });
  });

  it("falls back to part ID and preserves unassigned interactions", () => {
    const state = createConversationRuntimeState("conversation-1");
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-1",
              messageID: "assistant-1",
              type: "tool",
              tool: "read",
              state: { status: "completed" },
            },
            {
              messageID: "assistant-1",
              type: "tool",
              tool: "broken",
              state: { status: "pending" },
            },
          ],
        },
      },
      questions: {
        "question-1": { id: "question-1", questions: [] },
      },
    });

    expect([...selection.toolsByCallId.keys()]).toEqual(["part-1"]);
    expect(selection.unassignedQuestions).toEqual([
      { id: "question-1", questions: [] },
    ]);
  });

  it("associates questions and responses by payload when callID is absent", () => {
    const state = createConversationRuntimeState("conversation-1");
    const questions = [
      {
        header: "Continue",
        question: "Continue with the fixture?",
        options: [
          {
            label: "Continue",
            description: "Continue the scenario.",
          },
        ],
      },
    ];
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-question-1",
              messageID: "assistant-1",
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
          questions,
        },
      },
      questionResponses: {
        "question-answered": {
          request: {
            id: "question-answered",
            questions,
          },
          state: "answered",
          answers: [["Continue"]],
          respondedAt: 1,
        },
      },
    });

    expect(
      selection.toolsByCallId.get("call-question-1")?.questions,
    ).toEqual([{ id: "question-1", questions }]);
    expect(
      selection.toolsByCallId.get("call-question-1")?.questionResponses,
    ).toMatchObject([
      {
        state: "answered",
        answers: [["Continue"]],
      },
    ]);
    expect(selection.unassignedQuestions).toEqual([]);
  });

  it("does not reassign a question with a mismatched explicit callID", () => {
    const state = createConversationRuntimeState("conversation-1");
    const questions = [
      {
        header: "Continue",
        question: "Continue with the fixture?",
        options: [],
      },
    ];
    const request = {
      id: "question-1",
      questions,
      tool: { callID: "call-missing" },
    };
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-question-1",
              messageID: "assistant-1",
              type: "tool",
              tool: "askuserquestion",
              callID: "call-question-1",
              state: { status: "running", input: { questions } },
            },
          ],
        },
      },
      questions: { "question-1": request },
    });

    expect(
      selection.toolsByCallId.get("call-question-1")?.questions,
    ).toEqual([]);
    expect(selection.unassignedQuestions).toEqual([request]);
  });

  it("does not associate a question payload with a non-question tool", () => {
    const state = createConversationRuntimeState("conversation-1");
    const questions = [
      {
        header: "Continue",
        question: "Continue with the fixture?",
        options: [],
      },
    ];
    const request = { id: "question-1", questions };
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-bash-1",
              messageID: "assistant-1",
              type: "tool",
              tool: "bash",
              callID: "call-bash-1",
              state: { status: "running", input: { questions } },
            },
          ],
        },
      },
      questions: { "question-1": request },
    });

    expect(selection.toolsByCallId.get("call-bash-1")?.questions).toEqual([]);
    expect(selection.unassignedQuestions).toEqual([request]);
  });

  it("associates task progress through the provider tool-use ID", () => {
    const state = createConversationRuntimeState("conversation-1");
    const selection = selectConversationTools({
      ...state,
      messageOrder: ["assistant-1"],
      messagesById: {
        "assistant-1": {
          info: { id: "assistant-1", role: "assistant" },
          parts: [
            {
              id: "part-task",
              messageID: "assistant-1",
              type: "tool",
              tool: "task",
              callID: "call-task",
              state: { status: "running" },
            },
          ],
        },
      },
      tasks: {
        "task-1": {
          taskID: "task-1",
          toolUseID: "call-task",
          status: "running",
          description: "Inspect runtime",
          startTime: 1,
        },
      },
    });

    expect(selection.toolsByCallId.get("call-task")?.task).toMatchObject({
      taskID: "task-1",
      status: "running",
    });
  });
});

"use client";

import { defineToolkit } from "@assistant-ui/react";
import {
  ApplyPatchTool,
  BashTool,
  EditTool,
  GlobTool,
  GrepTool,
  QuestionTool,
  ReadTool,
  TaskTool,
  WebFetchTool,
  WebSearchTool,
} from "./conversation-tools";

export const conversationToolToolkit = defineToolkit({
  read: { type: "backend", render: ReadTool },
  edit: { type: "backend", render: EditTool },
  write: { type: "backend", render: EditTool },
  bash: { type: "backend", render: BashTool },
  grep: { type: "backend", render: GrepTool },
  glob: { type: "backend", render: GlobTool },
  websearch: { type: "backend", render: WebSearchTool },
  webSearch: { type: "backend", render: WebSearchTool },
  web_search: { type: "backend", render: WebSearchTool },
  webfetch: { type: "backend", render: WebFetchTool },
  webFetch: { type: "backend", render: WebFetchTool },
  web_fetch: { type: "backend", render: WebFetchTool },
  apply_patch: { type: "backend", render: ApplyPatchTool },
  applypatch: { type: "backend", render: ApplyPatchTool },
  question: { type: "backend", render: QuestionTool },
  ask_question: { type: "backend", render: QuestionTool },
  askuserquestion: { type: "backend", render: QuestionTool },
  ask_user_question: { type: "backend", render: QuestionTool },
  ask_user_questions: { type: "backend", render: QuestionTool },
  request_user_input: { type: "backend", render: QuestionTool },
  requestUserInput: { type: "backend", render: QuestionTool },
  requestuserinput: { type: "backend", render: QuestionTool },
  task: { type: "backend", render: TaskTool },
  agent: { type: "backend", render: TaskTool },
});

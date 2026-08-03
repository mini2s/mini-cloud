"use client";

import { withConversationToolInteractions } from "./tool-interactions";
import { ApplyPatchTool as ApplyPatchToolBase } from "./tool-ui-apply-patch";
import { BashTool as BashToolBase } from "./tool-ui-bash";
import {
  EditInline,
  FallbackTool as FallbackToolBase,
  GlobInline,
  GrepInline,
  QuestionInline,
  ReadInline,
  TaskInline,
  WebFetchInline,
  WebSearchInline,
} from "./tool-ui-inline";

export const ReadTool = withConversationToolInteractions(ReadInline);
export const EditTool = withConversationToolInteractions(EditInline);
export const BashTool = withConversationToolInteractions(BashToolBase);
export const GrepTool = withConversationToolInteractions(GrepInline);
export const GlobTool = withConversationToolInteractions(GlobInline);
export const WebSearchTool =
  withConversationToolInteractions(WebSearchInline);
export const WebFetchTool = withConversationToolInteractions(WebFetchInline);
export const ApplyPatchTool =
  withConversationToolInteractions(ApplyPatchToolBase);
export const QuestionTool =
  withConversationToolInteractions(QuestionInline);
export const TaskTool = withConversationToolInteractions(TaskInline);
export const FallbackTool =
  withConversationToolInteractions(FallbackToolBase);

export type IssueConversationSession = {
  conversationId: string;
  workspaceDirectory: string;
  proxyBaseUrl: string;
};

export type OpenCodeRecord = Record<string, unknown>;

export type OpenCodeMessageInfo = OpenCodeRecord & {
  id: string;
  sessionID?: string;
  role: string;
  time?: OpenCodeRecord & {
    created?: number;
    completed?: number;
  };
  error?: unknown;
  finish?: string;
};

export type OpenCodePart = OpenCodeRecord & {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: string;
  callID?: string;
};

export type OpenCodeMessageWithParts = {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
};

export type OpenCodeSessionStatus = OpenCodeRecord & {
  type: string;
};

export type OpenCodeTaskUsage = {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
};

export type OpenCodeTaskSnapshot = OpenCodeRecord & {
  taskID: string;
  toolUseID?: string;
  status?: string;
  description?: string;
  taskType?: string;
  summary?: string;
  usage?: OpenCodeTaskUsage;
  startTime?: number;
  endTime?: number;
};

export type OpenCodePromptPart =
  | { type: "text"; text: string }
  | {
      type: "file";
      filename: string;
      mime: string;
      url: string;
    };

export type OpenCodeRuntimeEvent = {
  type: string;
  properties: OpenCodeRecord;
  directory?: string;
  sessionId?: string;
  raw: unknown;
};

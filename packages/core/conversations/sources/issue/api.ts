import { api } from "../../../api";
import { parseWithFallback } from "../../../api/schema";
import type { IssueConversationSession } from "../../types";
import {
  IssueConversationSessionResponseSchema,
  type IssueConversationSessionResponse,
} from "./schemas";

export class IssueConversationSessionProtocolError extends Error {
  constructor() {
    super("Issue conversation session response is invalid");
    this.name = "IssueConversationSessionProtocolError";
  }
}

export async function fetchIssueConversationSession(
  workspaceId: string,
  issueId: string,
): Promise<IssueConversationSession> {
  const raw = await api.getIssueConversationSession(workspaceId, issueId);
  const parsed = parseWithFallback<IssueConversationSessionResponse | null>(
    raw,
    IssueConversationSessionResponseSchema,
    null,
    {
      endpoint:
        "GET /api/workspaces/:workspaceId/issues/:issueId/session",
    },
  );

  if (!parsed) throw new IssueConversationSessionProtocolError();

  return {
    conversationId: parsed.conversation_id,
    workspaceDirectory: parsed.workspace_directory,
    proxyBaseUrl: parsed.proxy_base_url,
  };
}

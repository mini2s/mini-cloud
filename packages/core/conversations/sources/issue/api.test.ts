import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../../../api";
import type { ApiClient } from "../../../api/client";
import {
  fetchIssueConversationSession,
  IssueConversationSessionProtocolError,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});
describe("fetchIssueConversationSession", () => {
  it("maps the issue session response to the public descriptor", async () => {
    const getIssueConversationSession = vi.fn().mockResolvedValue({
      conversation_id: "conversation-1",
      workspace_directory: "/workspace/project",
      proxy_base_url: "/cloud-api/cloud/device/device-1/proxy",
    });
    setApiInstance({
      getIssueConversationSession,
    } as unknown as ApiClient);

    await expect(
      fetchIssueConversationSession("workspace-1", "issue-1"),
    ).resolves.toEqual({
      conversationId: "conversation-1",
      workspaceDirectory: "/workspace/project",
      proxyBaseUrl: "/cloud-api/cloud/device/device-1/proxy",
    });
    expect(getIssueConversationSession).toHaveBeenCalledWith(
      "workspace-1",
      "issue-1",
    );
  });

  it("fails closed when a required response field is missing", async () => {
    setApiInstance({
      getIssueConversationSession: vi.fn().mockResolvedValue({
        conversation_id: "conversation-1",
        proxy_base_url: "/proxy",
      }),
    } as unknown as ApiClient);

    await expect(
      fetchIssueConversationSession("workspace-1", "issue-1"),
    ).rejects.toBeInstanceOf(IssueConversationSessionProtocolError);
  });
});

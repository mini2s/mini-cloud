import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../../../api";
import type { ApiClient } from "../../../api/client";
import { issueConversationSessionOptions } from "./queries";

afterEach(() => {
  vi.restoreAllMocks();
});
describe("issueConversationSessionOptions", () => {
  it("reuses the persisted issue mapping instead of refetching on every mount", async () => {
    const getIssueConversationSession = vi.fn().mockResolvedValue({
      conversation_id: "conversation-1",
      workspace_directory: "/workspace",
      proxy_base_url: "/proxy",
    });
    setApiInstance({
      getIssueConversationSession,
    } as unknown as ApiClient);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const options = issueConversationSessionOptions(
      "workspace-1",
      "issue-1",
    );

    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery(options);

    expect(getIssueConversationSession).toHaveBeenCalledTimes(1);
    expect(options.queryKey).toEqual([
      "conversations",
      "issue-session",
      "workspace-1",
      "issue-1",
    ]);
  });
});

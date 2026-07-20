"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { conversationKeys } from "../../query-keys";
import { fetchIssueConversationSession } from "./api";

export function issueConversationSessionOptions(
  workspaceId: string,
  issueId: string,
) {
  return queryOptions({
    queryKey: conversationKeys.issueSession(workspaceId, issueId),
    queryFn: () => fetchIssueConversationSession(workspaceId, issueId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export function useIssueConversationSession(
  workspaceId: string,
  issueId: string,
  enabled: boolean,
) {
  return useQuery({
    ...issueConversationSessionOptions(workspaceId, issueId),
    enabled: enabled && workspaceId.length > 0 && issueId.length > 0,
  });
}

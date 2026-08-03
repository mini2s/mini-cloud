import { queryOptions } from "@tanstack/react-query";
import { conversationKeys } from "../query-keys";
import { createConversationRuntimeState } from "./state";

export function conversationRuntimeStateOptions(input: {
  proxyBaseUrl: string;
  workspaceDirectory: string;
  conversationId: string;
}) {
  return queryOptions({
    queryKey: conversationKeys.state(
      input.proxyBaseUrl,
      input.workspaceDirectory,
      input.conversationId,
    ),
    queryFn: () => Promise.resolve(createConversationRuntimeState(input.conversationId)),
    initialData: () => createConversationRuntimeState(input.conversationId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
  });
}

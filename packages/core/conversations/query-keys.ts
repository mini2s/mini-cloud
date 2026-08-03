export const conversationKeys = {
  all: ["conversations"] as const,
  issueSession: (workspaceId: string, issueId: string) =>
    [...conversationKeys.all, "issue-session", workspaceId, issueId] as const,
  workspaceList: (
    proxyBaseUrl: string,
    workspaceDirectory: string,
  ) =>
    [
      ...conversationKeys.all,
      "workspace-list",
      proxyBaseUrl,
      workspaceDirectory,
    ] as const,
  state: (
    proxyBaseUrl: string,
    workspaceDirectory: string,
    conversationId: string,
  ) =>
    [
      ...conversationKeys.all,
      "state",
      proxyBaseUrl,
      workspaceDirectory,
      conversationId,
    ] as const,
};

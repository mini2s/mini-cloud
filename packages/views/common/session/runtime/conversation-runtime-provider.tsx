"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  createCloudProxyClient,
  type IssueConversationSession,
} from "@multica/core/conversations";
import { api } from "@multica/core/api";
import { useMemo, type PropsWithChildren } from "react";
import type { SessionMode } from "../session";
import { SessionRuntimeStateProvider } from "../session-runtime-state";
import { useConversationRuntime } from "./use-conversation-runtime";

export function ConversationRuntimeProvider({
  descriptor,
  mode,
  onError,
  children,
}: PropsWithChildren<{
  descriptor: IssueConversationSession;
  mode: SessionMode;
  onError?: (error: unknown) => void;
}>) {
  const client = useMemo(
    () =>
      createCloudProxyClient({
        baseUrl: descriptor.proxyBaseUrl,
        directory: descriptor.workspaceDirectory,
        transport: (url, init) => api.requestRaw(url, init),
        onProtocolError: (error) => {
          console.warn("[session] Invalid cloud proxy event", error);
        },
      }),
    [descriptor.proxyBaseUrl, descriptor.workspaceDirectory],
  );
  const { runtime, runtimeState } = useConversationRuntime({
    descriptor,
    client,
    mode,
    onError,
  });

  return (
    <SessionRuntimeStateProvider value={runtimeState}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </SessionRuntimeStateProvider>
  );
}

"use client";

import {
  AssistantRuntimeProvider,
  Tools,
  useAui,
} from "@assistant-ui/react";
import {
  createCloudProxyClient,
  type IssueConversationSession,
} from "@multica/core/conversations";
import { api } from "@multica/core/api";
import { useMemo, type PropsWithChildren } from "react";
import type { SessionMode } from "../session";
import { SessionRuntimeStateProvider } from "../session-runtime-state";
import { conversationToolToolkit } from "../tools/toolkit";
import { ConversationToolBridgeProvider } from "./conversation-tool-bridge";
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
  const { runtime, runtimeState, state, actions } = useConversationRuntime({
    descriptor,
    client,
    mode,
    onError,
  });
  const aui = useAui({
    tools: Tools({ toolkit: conversationToolToolkit }),
  });

  return (
    <ConversationToolBridgeProvider
      state={state}
      canInteract={mode === "control"}
      respondToPermission={actions.respondToPermission}
      replyToQuestion={actions.replyToQuestion}
      rejectQuestion={actions.rejectQuestion}
    >
      <SessionRuntimeStateProvider value={runtimeState}>
        <AssistantRuntimeProvider aui={aui} runtime={runtime}>
          {children}
        </AssistantRuntimeProvider>
      </SessionRuntimeStateProvider>
    </ConversationToolBridgeProvider>
  );
}

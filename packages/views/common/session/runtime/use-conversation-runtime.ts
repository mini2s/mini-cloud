"use client";

import {
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import {
  ConversationRuntimeController,
  conversationRuntimeStateOptions,
  type IssueConversationSession,
  type OpenCodePromptPart,
} from "@multica/core/conversations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type { SessionMode } from "../session";
import type { CloudProxyClient } from "@multica/core/conversations";
import { toThreadMessageLike } from "./to-thread-message-like";

function toPromptParts(message: AppendMessage): OpenCodePromptPart[] {
  return [
    ...message.content,
    ...(message.attachments?.flatMap((attachment) => attachment.content ?? []) ??
      []),
  ].flatMap<OpenCodePromptPart>((part) => {
    if (part.type === "text") {
      return part.text.trim()
        ? [{ type: "text", text: part.text }]
        : [];
    }
    if (part.type === "image") {
      const image = part as {
        image: string;
        filename?: string;
        mimeType?: string;
      };
      return [
        {
          type: "file",
          filename: image.filename ?? "image",
          mime:
            image.mimeType ??
            image.image.match(/^data:([^;,]+)[;,]/)?.[1] ??
            "image/png",
          url: image.image,
        },
      ];
    }
    if (part.type === "file") {
      return [
        {
          type: "file",
          filename: part.filename ?? "file",
          mime: part.mimeType,
          url: part.data,
        },
      ];
    }
    return [];
  });
}

export function useConversationRuntime({
  descriptor,
  client,
  mode,
  onError,
}: {
  descriptor: IssueConversationSession;
  client: CloudProxyClient;
  mode: SessionMode;
  onError?: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(
    () =>
      conversationRuntimeStateOptions({
        proxyBaseUrl: descriptor.proxyBaseUrl,
        workspaceDirectory: descriptor.workspaceDirectory,
        conversationId: descriptor.conversationId,
      }),
    [
      descriptor.conversationId,
      descriptor.proxyBaseUrl,
      descriptor.workspaceDirectory,
    ],
  );
  const { data: state } = useQuery(options);
  const controller = useMemo(
    () =>
      new ConversationRuntimeController(
        queryClient,
        options.queryKey,
        client,
        descriptor.conversationId,
      ),
    [client, descriptor.conversationId, options.queryKey, queryClient],
  );

  useEffect(() => {
    void controller.start().catch(onError);
    return () => controller.dispose();
  }, [controller, onError]);

  const messages = useMemo(() => toThreadMessageLike(state), [state]);
  const isLoading =
    state.loadState.type === "idle" || state.loadState.type === "loading";
  const loadError =
    state.loadState.type === "error" ? state.loadState.error : undefined;
  const isCancelling = state.runState.type === "cancelling";
  const isRunning =
    state.runState.type === "streaming" ||
    isCancelling ||
    state.status?.type === "busy" ||
    state.status?.type === "retry";

  const runtime = useExternalStoreRuntime({
    messages,
    isLoading,
    isRunning,
    isDisabled: isLoading || loadError !== undefined,
    isSendDisabled:
      mode !== "control" ||
      isLoading ||
      loadError !== undefined ||
      isRunning,
    convertMessage: (message) => message,
    onNew: async (message) => {
      const parts = toPromptParts(message);
      if (parts.length === 0) return;
      try {
        await controller.send(parts);
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    onCancel: async () => {
      try {
        await controller.cancel();
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    unstable_capabilities: { copy: true },
  });
  const retry = useCallback(() => {
    void controller.refresh().catch(onError);
  }, [controller, onError]);

  return {
    runtime,
    state,
    runtimeState: {
      isLoading,
      isRunning,
      isCancelling,
      error: loadError,
      retry,
    },
  };
}

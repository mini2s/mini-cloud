"use client";

import {
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import {
  acquireSharedConversationRuntimeController,
  ConversationRuntimeController,
  conversationRuntimeStateOptions,
  type ConversationRuntimeControllerLease,
  type IssueConversationSession,
  type OpenCodePromptPart,
} from "@multica/core/conversations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SessionMode } from "../session";
import type { CloudProxyClient } from "@multica/core/conversations";
import { toThreadMessageLike } from "./to-thread-message-like";

const RUNTIME_NOT_ACTIVE_MESSAGE = "Conversation runtime is not active";

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
  const leaseRef = useRef<ConversationRuntimeControllerLease | null>(null);

  const getController = useCallback(() => {
    const lease = leaseRef.current;
    if (!lease) throw new Error(RUNTIME_NOT_ACTIVE_MESSAGE);
    return lease.controller;
  }, []);

  useEffect(() => {
    const lease = acquireSharedConversationRuntimeController({
      queryClient,
      queryKey: options.queryKey,
      client,
      conversationId: descriptor.conversationId,
      createController: () =>
        new ConversationRuntimeController(
          queryClient,
          options.queryKey,
          client,
          descriptor.conversationId,
        ),
    });
    leaseRef.current = lease;
    void lease.started.catch((error) => {
      if (leaseRef.current === lease) onError?.(error);
    });
    return () => {
      if (leaseRef.current === lease) leaseRef.current = null;
      lease.release();
    };
  }, [
    client,
    descriptor.conversationId,
    onError,
    options.queryKey,
    queryClient,
  ]);

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
        await getController().send(parts);
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    onCancel: async () => {
      try {
        await getController().cancel();
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    unstable_capabilities: { copy: true },
  });
  const retry = useCallback(() => {
    try {
      void getController().refresh().catch(onError);
    } catch (error) {
      onError?.(error);
    }
  }, [getController, onError]);
  const respondToPermission = useCallback(
    async (
      requestId: string,
      decision: "once" | "always" | "reject",
    ) => {
      try {
        await getController().respondToPermission(requestId, decision);
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    [getController, onError],
  );
  const replyToQuestion = useCallback(
    async (requestId: string, answers: readonly unknown[]) => {
      try {
        await getController().replyToQuestion(requestId, answers);
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    [getController, onError],
  );
  const rejectQuestion = useCallback(
    async (requestId: string) => {
      try {
        await getController().rejectQuestion(requestId);
      } catch (error) {
        onError?.(error);
        throw error;
      }
    },
    [getController, onError],
  );

  return {
    runtime,
    state,
    actions: {
      respondToPermission,
      replyToQuestion,
      rejectQuestion,
    },
    runtimeState: {
      isLoading,
      isRunning,
      isCancelling,
      error: loadError,
      retry,
    },
  };
}

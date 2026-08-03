"use client";

import {
  selectConversationTools,
  type ConversationRuntimeState,
  type ConversationToolEntry,
  type ConversationToolSelection,
} from "@multica/core/conversations";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

export type ConversationToolBridge = ConversationToolSelection & {
  canInteract: boolean;
  respondToPermission: (
    requestId: string,
    decision: "once" | "always" | "reject",
  ) => Promise<void>;
  replyToQuestion: (
    requestId: string,
    answers: readonly unknown[],
  ) => Promise<void>;
  rejectQuestion: (requestId: string) => Promise<void>;
};

const ConversationToolBridgeContext =
  createContext<ConversationToolBridge | null>(null);
const ConversationToolEntryContext =
  createContext<ConversationToolEntry | null>(null);

export function useConversationToolBridge(): ConversationToolBridge | null {
  return useContext(ConversationToolBridgeContext);
}

export function useConversationToolEntry(
  toolCallId?: string,
): ConversationToolEntry | undefined {
  const bridge = useConversationToolBridge();
  return toolCallId ? bridge?.toolsByCallId.get(toolCallId) : undefined;
}

export function useCurrentConversationToolEntry():
  | ConversationToolEntry
  | undefined {
  return useContext(ConversationToolEntryContext) ?? undefined;
}

export function ConversationToolEntryProvider({
  entry,
  children,
}: PropsWithChildren<{ entry?: ConversationToolEntry }>) {
  return (
    <ConversationToolEntryContext.Provider value={entry ?? null}>
      {children}
    </ConversationToolEntryContext.Provider>
  );
}

export function ConversationToolBridgeProvider({
  state,
  canInteract,
  respondToPermission,
  replyToQuestion,
  rejectQuestion,
  children,
}: PropsWithChildren<{
  state: ConversationRuntimeState;
  canInteract: boolean;
  respondToPermission: ConversationToolBridge["respondToPermission"];
  replyToQuestion: ConversationToolBridge["replyToQuestion"];
  rejectQuestion: ConversationToolBridge["rejectQuestion"];
}>) {
  const selection = useMemo(() => selectConversationTools(state), [state]);
  const value = useMemo<ConversationToolBridge>(
    () => ({
      ...selection,
      canInteract,
      respondToPermission,
      replyToQuestion,
      rejectQuestion,
    }),
    [
      canInteract,
      rejectQuestion,
      replyToQuestion,
      respondToPermission,
      selection,
    ],
  );

  return (
    <ConversationToolBridgeContext.Provider value={value}>
      {children}
    </ConversationToolBridgeContext.Provider>
  );
}

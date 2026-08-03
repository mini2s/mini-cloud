"use client";

import {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";

export type SessionRuntimeState = {
  isLoading: boolean;
  isRunning: boolean;
  isCancelling: boolean;
  error?: unknown;
  retry?: () => void;
};

const SessionRuntimeStateContext =
  createContext<SessionRuntimeState | null>(null);

export function SessionRuntimeStateProvider({
  value,
  children,
}: PropsWithChildren<{ value: SessionRuntimeState }>) {
  return (
    <SessionRuntimeStateContext.Provider value={value}>
      {children}
    </SessionRuntimeStateContext.Provider>
  );
}

export function useSessionRuntimeState(): SessionRuntimeState {
  const state = useContext(SessionRuntimeStateContext);
  if (!state) {
    throw new Error(
      "useSessionRuntimeState must be used inside a session runtime provider",
    );
  }
  return state;
}

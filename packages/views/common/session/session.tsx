"use client";

import { FixtureSessionRuntimeProvider } from "./fixture-session-runtime";
import { SessionThread } from "./session-thread";

export type SessionMode = "observe" | "control";

export interface SessionProps {
  sessionId: string;
  mode: SessionMode;
  active: boolean;
  onTakeover: () => void;
}

export function Session({ sessionId, mode, active, onTakeover }: SessionProps) {
  return (
    <FixtureSessionRuntimeProvider key={sessionId} sessionId={sessionId} mode={mode}>
      <section
        data-testid="session"
        data-session-id={sessionId}
        data-active={active}
        aria-hidden={!active || undefined}
        className="mt-4 flex h-[clamp(420px,60vh,680px)] min-h-0 flex-col overflow-hidden rounded-xl border bg-background"
      >
        <SessionThread mode={mode} onTakeover={onTakeover} />
      </section>
    </FixtureSessionRuntimeProvider>
  );
}

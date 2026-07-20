"use client";

import { SessionThread } from "./session-thread";

export type SessionMode = "observe" | "control";

export interface SessionProps {
  mode: SessionMode;
  active: boolean;
  onTakeover: () => void;
}

export function Session({
  mode,
  active,
  onTakeover,
}: SessionProps) {
  return (
    <section
      data-testid="session"
      data-active={active}
      aria-hidden={!active || undefined}
      className="mt-4 flex h-[clamp(420px,60vh,680px)] min-h-0 flex-col overflow-hidden rounded-xl border bg-background"
    >
      <SessionThread mode={mode} onTakeover={onTakeover} />
    </section>
  );
}

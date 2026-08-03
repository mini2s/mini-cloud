"use client";

import { SessionThread } from "./session-thread";
import { cn } from "@multica/ui/lib/utils";

export type SessionMode = "observe" | "control";

export interface SessionProps {
  mode: SessionMode;
  active: boolean;
  onTakeover: () => void;
  className?: string;
}

export function Session({
  mode,
  active,
  onTakeover,
  className,
}: SessionProps) {
  return (
    <section
      data-testid="session"
      data-active={active}
      aria-hidden={!active || undefined}
      className={cn(
        "mt-4 flex h-[clamp(420px,60vh,680px)] min-h-0 flex-col overflow-hidden rounded-xl border bg-background",
        className,
      )}
    >
      <SessionThread mode={mode} onTakeover={onTakeover} />
    </section>
  );
}

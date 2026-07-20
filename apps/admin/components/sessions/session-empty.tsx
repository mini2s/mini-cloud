import { MessageSquare } from "lucide-react";

/**
 * Right-pane placeholder for /sessions when no session is selected.
 * Mirrors the empty-state pattern used by other admin split views.
 */
export function SessionEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquare className="size-10" />
      <p>Select a session, or create a new one to get started.</p>
    </div>
  );
}

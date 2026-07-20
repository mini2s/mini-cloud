"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { chatSessionsOptions } from "@multica/core/chat/queries";
import {
  useCreateChatSession,
  useDeleteChatSession,
} from "@multica/core/chat/mutations";
import { useChatStore } from "@multica/core/chat";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { useAuthStore } from "@multica/core/auth";
import { canAssignAgent } from "@multica/views/issues/components";
import { createLogger } from "@multica/core/logger";
import { cn } from "@multica/ui/lib/utils";
import { Button } from "@multica/ui/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { toast } from "sonner";

const logger = createLogger("admin.sessions.list");

interface SessionsListProps {
  activeSessionId: string | null;
}

/**
 * Left rail of the /sessions page: lists chat sessions for the current
 * workspace with quick create + delete. Mirrors ChatWindow's SessionDropdown
 * data flow (single chatSessionsOptions query) but as a vertical list.
 *
 * Create requires an `agent_id` (server rejects null). We resolve the agent
 * the same way ChatWindow does — stored preference (`useChatStore.selectedAgentId`)
 * falling back to the first available agent for this user — so the New
 * button works out of the box without requiring a separate agent picker.
 */
export function SessionsList({ activeSessionId }: SessionsListProps) {
  const router = useRouter();
  const wsId = useWorkspaceId();
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: sessions = [], isLoading } = useQuery(
    chatSessionsOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  // Resolve agent preference exactly like ChatWindow: stored → first available.
  // Reads via getState() at click time so a stale closure never races the
  // latest user choice. availableAgents mirrors chat-window.tsx:118-122.
  const user = useAuthStore((s) => s.user);
  const resolveAgentId = (): string | null => {
    const { selectedAgentId } = useChatStore.getState();
    const currentMember = members.find((m) => m.user_id === user?.id);
    const memberRole = currentMember?.role;
    const availableAgents = agents.filter(
      (a) => !a.archived_at && canAssignAgent(a, user?.id, memberRole),
    );
    const activeAgent =
      availableAgents.find((a) => a.id === selectedAgentId) ??
      availableAgents[0] ??
      null;
    return activeAgent?.id ?? null;
  };

  const handleNew = () => {
    const agentId = resolveAgentId();
    if (!agentId) {
      logger.warn("createSession aborted: no assignable agent");
      toast.error("No assignable agent in this workspace.");
      return;
    }
    createSession.mutate(
      { agent_id: agentId, title: undefined },
      {
        onSuccess: (session) => {
          // Sync chat store so ChatInput's draft/agent picks follow the URL.
          useChatStore.getState().setActiveSession(session.id);
          useChatStore.getState().setSelectedAgentId(session.agent_id);
          router.push(`/sessions/${session.id}`);
        },
        onError: (err) => {
          logger.error("createSession.error", err);
          toast.error("Failed to create session.");
        },
      },
    );
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const deletingActive = pendingDelete === activeSessionId;
    deleteSession.mutate(pendingDelete, {
      onSuccess: () => {
        // Clear the chat store pointer if we just deleted the active session
        // so ChatInput isn't left pointing at a tombstone.
        if (deletingActive) {
          useChatStore.getState().setActiveSession(null);
          router.push("/sessions");
        }
        setPendingDelete(null);
      },
      onError: (err) => {
        logger.error("deleteSession.error", err);
        toast.error("Failed to delete session.");
      },
    });
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Sessions</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleNew}
          disabled={createSession.isPending}
        >
          {createSession.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Plus className="size-4" /> New
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-3 text-sm text-muted-foreground">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No sessions yet.
          </div>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={cn(
                    "group flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent",
                    s.id === activeSessionId && "bg-accent",
                  )}
                  onClick={() => router.push(`/sessions/${s.id}`)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {s.title || "Untitled session"}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete session"
                    className="hidden size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(s.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All messages in this session will
              be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

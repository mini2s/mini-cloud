"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import {
  chatKeys,
  chatMessagesOptions,
  chatSessionOptions,
  pendingChatTaskOptions,
} from "@multica/core/chat/queries";
import {
  useDeleteChatSession,
  useMarkChatSessionRead,
  useUpdateChatSession,
} from "@multica/core/chat/mutations";
import { useChatStore } from "@multica/core/chat";
import { useWorkspaceId } from "@multica/core/hooks";
import { api } from "@multica/core/api";
import { createLogger } from "@multica/core/logger";
import type { ChatMessage, ChatPendingTask } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { ChatInput, ChatMessageList } from "@multica/views/chat";
import { toast } from "sonner";

const logger = createLogger("admin.sessions.detail");

interface SessionDetailProps {
  sessionId: string;
}

/**
 * Right pane of /sessions/[id]: header with editable title + delete, message
 * list, and composer. ChatMessageList + ChatInput are reused verbatim from
 * @multica/views/chat — same components ChatWindow mounts in the FAB.
 *
 * `handleSend` is a simplified copy of ChatWindow.handleSend: sessionId is
 * known from the URL so the `ensureSession` lazy-create branch is dropped.
 * The optimistic message + pending-task seed pattern is preserved so the UX
 * (instant bubble + StatusPill ticking) matches the FAB.
 *
 * Simplifications vs ChatWindow:
 *   - No ensureSession / no new-session code path.
 *   - No handleStop / onStop (Phase 1 — cancelTaskById exists but wiring it
 *     here is out of scope).
 *   - No focus mode / context anchor — plain text only.
 *   - availability is passed as undefined; ChatMessageList keeps StatusPill
 *     copy neutral (the "agent may be offline" hint is a ChatWindow nicety).
 *   - No onUploadFile — attachments via this surface are out of scope.
 */
export function SessionDetail({ sessionId }: SessionDetailProps) {
  const router = useRouter();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const updateSession = useUpdateChatSession();
  const deleteSession = useDeleteChatSession();
  const markRead = useMarkChatSessionRead();

  // Sync URL → chat-store so ChatInput (which keys drafts on activeSessionId)
  // reads the right slot. Matches ChatWindow's behavior where selecting a
  // session always publishes the id. markRead fires on entry to clear the
  // unread badge — same trigger as chat-window.tsx:181-187.
  useEffect(() => {
    setActiveSession(sessionId);
    markRead.mutate(sessionId);
    // markRead ref is stable per its mutation impl; setActiveSession is
    // zustand-bound and stable too. Re-running on sessionId change is the
    // only intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const sessionQuery = useQuery(chatSessionOptions(wsId, sessionId));
  const messagesQuery = useQuery(chatMessagesOptions(sessionId));
  const pendingTaskQuery = useQuery(pendingChatTaskOptions(sessionId));

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const startEdit = () => {
    setTitleDraft(sessionQuery.data?.title ?? "");
    setIsEditingTitle(true);
  };

  const saveEdit = () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      // Empty title → revert; backend requires a non-empty string per
      // useUpdateChatSession's mutationFn signature.
      setIsEditingTitle(false);
      return;
    }
    updateSession.mutate(
      { sessionId, title: trimmed },
      {
        onSuccess: () => setIsEditingTitle(false),
        onError: (err) => {
          logger.error("updateSession.error", err);
          toast.error("Failed to rename session.");
        },
      },
    );
  };

  const handleDelete = () => {
    deleteSession.mutate(sessionId, {
      onSuccess: () => {
        setActiveSession(null);
        router.push("/sessions");
      },
      onError: (err) => {
        logger.error("deleteSession.error", err);
        toast.error("Failed to delete session.");
      },
    });
  };

  // ─── handleSend ──────────────────────────────────────────────────────
  // Simplified from ChatWindow.handleSend at packages/views/chat/components/
  // chat-window.tsx:262. Drops: activeAgent check, focus mode, ensureSession,
  // setActiveSession (sessionId already known here). Adds rollback on send
  // failure so the user sees their message disappear if the POST errors — a
  // small improvement over the canonical impl which leaves the optimistic
  // bubble stranded on error.
  const handleSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!content.trim() && !attachmentIds?.length) return;

      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content,
        task_id: null,
        created_at: sentAt,
      };
      // Seed cache BEFORE the HTTP roundtrip so the user sees their message
      // instantly and the StatusPill mounts ticking. Matches ChatWindow's
      // "optimistic burst" ordering.
      qc.setQueryData<ChatMessage[]>(
        chatKeys.messages(sessionId),
        (old) => (old ? [...old, optimistic] : [optimistic]),
      );
      qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
        task_id: `optimistic-${optimistic.id}`,
        status: "queued",
        created_at: sentAt,
      });

      try {
        const result = await api.sendChatMessage(
          sessionId,
          content,
          attachmentIds,
        );
        logger.info("sendChatMessage.success", {
          sessionId,
          messageId: result.message_id,
          taskId: result.task_id,
        });
        // Replace the optimistic task_id with the server's real one so WS
        // task:message / task:completed handlers can match against it. Also
        // snap created_at to the server-authoritative time so the elapsed
        // timer doesn't drift by the request RTT.
        qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), {
          task_id: result.task_id,
          status: "queued",
          created_at: result.created_at,
        });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
      } catch (err) {
        logger.error("sendChatMessage.error", err);
        // Roll back the optimistic message + pending task so the user knows
        // the send failed. ChatWindow doesn't do this; we improve on it.
        // Note: setQueryData requires an Updater that returns the cache shape
        // (ChatPendingTask | undefined) — passing `null` trips tsc. Return
        // undefined explicitly via the functional form so the cache is cleared
        // rather than set to a null sentinel.
        qc.setQueryData<ChatMessage[]>(
          chatKeys.messages(sessionId),
          (old) => (old ? old.filter((m) => m.id !== optimistic.id) : old),
        );
        qc.setQueryData<ChatPendingTask | undefined>(
          chatKeys.pendingTask(sessionId),
          () => undefined,
        );
        toast.error("Failed to send message.");
        throw err;
      }
    },
    [sessionId, qc],
  );

  const title = sessionQuery.data?.title || "Untitled session";
  const isRunning =
    pendingTaskQuery.data?.status === "running" ||
    pendingTaskQuery.data?.status === "queued";

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        {isEditingTitle ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              autoFocus
            />
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
          </div>
        ) : (
          <h1 className="flex-1 truncate text-sm font-semibold">{title}</h1>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={startEdit}
            aria-label="Rename session"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={deleteSession.isPending}
            aria-label="Delete session"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ChatMessageList
          messages={messagesQuery.data ?? []}
          pendingTask={pendingTaskQuery.data}
          // Pass undefined — per-agent presence tracking isn't wired on this
          // surface; StatusPill copy stays neutral (the "offline" hint is a
          // ChatWindow-only nicety).
          availability={undefined}
        />
      </div>

      <div className="border-t">
        <ChatInput onSend={handleSend} isRunning={isRunning} />
      </div>
    </section>
  );
}

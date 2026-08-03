import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { CloudProxyClient } from "../clients/cloud-proxy";
import type {
  OpenCodePromptPart,
  OpenCodeRecord,
  OpenCodeRuntimeEvent,
  OpenCodeTaskSnapshot,
} from "../types";
import {
  createPendingMessage,
  reduceConversationRuntimeState,
  type ConversationRuntimeAction,
} from "./reducer";
import {
  getSharedOpenCodeEventSource,
  STREAM_RECONNECTED_EVENT_TYPE,
} from "../clients/cloud-proxy/sse/shared-event-source";
import {
  createConversationRuntimeState,
  type ConversationRuntimeState,
} from "./state";

export const MESSAGE_INITIAL_LIMIT = 200;

export class ConversationRuntimeController {
  private unsubscribeFromEvents: (() => void) | null = null;
  private snapshotController: AbortController | null = null;
  private refreshPromise: Promise<void> | null = null;
  private bufferedEvents: OpenCodeRuntimeEvent[] = [];
  private buffering = false;
  private disposed = false;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly queryKey: QueryKey,
    private readonly client: CloudProxyClient,
    private readonly conversationId: string,
  ) {
    if (!this.queryClient.getQueryData(this.queryKey)) {
      this.queryClient.setQueryData(
        this.queryKey,
        createConversationRuntimeState(conversationId),
      );
    }
  }

  getState(): ConversationRuntimeState {
    return (
      this.queryClient.getQueryData<ConversationRuntimeState>(this.queryKey) ??
      createConversationRuntimeState(this.conversationId)
    );
  }

  async start() {
    if (this.disposed || this.unsubscribeFromEvents) return;
    this.buffering = true;
    this.bufferedEvents = [];
    this.unsubscribeFromEvents = getSharedOpenCodeEventSource(
      this.client,
    ).subscribe((event) => {
      if (this.buffering) {
        if (
          event.type === STREAM_RECONNECTED_EVENT_TYPE ||
          event.sessionId === this.conversationId
        ) {
          this.bufferedEvents.push(event);
        }
        return;
      }
      this.handleEvent(event);
    });

    try {
      await this.refresh();
    } finally {
      this.replayBufferedEvents();
    }
  }

  async refresh() {
    if (this.disposed) return;
    if (this.refreshPromise) return this.refreshPromise;
    const ownsBuffer = !this.buffering;
    if (ownsBuffer) {
      this.buffering = true;
      this.bufferedEvents = [];
    }
    const refresh = this.loadSnapshot().finally(() => {
      if (this.refreshPromise === refresh) this.refreshPromise = null;
      if (ownsBuffer) this.replayBufferedEvents();
    });
    this.refreshPromise = refresh;
    return refresh;
  }

  async send(parts: readonly OpenCodePromptPart[]) {
    if (this.disposed || parts.length === 0) return;
    const pending = createPendingMessage(this.conversationId, parts);
    this.dispatch({ type: "pending-message-added", message: pending });
    try {
      await this.client.conversation.promptAsync(this.conversationId, {
        parts,
      });
    } catch (error) {
      this.dispatch({
        type: "pending-message-failed",
        id: pending.id,
        error,
      });
      throw error;
    }
  }

  async cancel() {
    if (this.disposed) return;
    this.dispatch({ type: "run-cancelling" });
    try {
      await this.client.conversation.abort(this.conversationId);
      this.dispatch({ type: "run-idle" });
    } catch (error) {
      this.dispatch({ type: "run-failed", error });
      throw error;
    }
  }

  async respondToPermission(
    requestId: string,
    decision: "once" | "always" | "reject",
  ) {
    await this.client.permission.respond(requestId, { decision });
  }

  async replyToQuestion(requestId: string, answers: readonly unknown[]) {
    const request =
      this.getState().questions[requestId] ??
      this.getState().questionResponses[requestId]?.request;
    await this.client.question.reply(requestId, { answers });
    this.dispatch({
      type: "question-response-recorded",
      id: requestId,
      ...(request ? { request } : {}),
      response: { type: "answered", answers },
    });
  }

  async rejectQuestion(requestId: string) {
    const request =
      this.getState().questions[requestId] ??
      this.getState().questionResponses[requestId]?.request;
    await this.client.question.reject(requestId);
    this.dispatch({
      type: "question-response-recorded",
      id: requestId,
      ...(request ? { request } : {}),
      response: { type: "rejected" },
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.snapshotController?.abort();
    this.snapshotController = null;
    this.unsubscribeFromEvents?.();
    this.unsubscribeFromEvents = null;
    this.bufferedEvents = [];
  }

  private dispatch(action: ConversationRuntimeAction) {
    let needsRefresh = false;
    this.queryClient.setQueryData<ConversationRuntimeState>(
      this.queryKey,
      (current) => {
        const result = reduceConversationRuntimeState(
          current ?? createConversationRuntimeState(this.conversationId),
          action,
        );
        needsRefresh = result.needsRefresh;
        return result.state;
      },
    );
    if (needsRefresh) void this.refresh();
  }

  private handleEvent(event: OpenCodeRuntimeEvent) {
    if (event.type === STREAM_RECONNECTED_EVENT_TYPE) {
      this.dispatch({ type: "stream-reconnected", at: Date.now() });
      return;
    }
    if (event.sessionId !== this.conversationId) return;
    this.dispatch({ type: "event", event });
  }

  private replayBufferedEvents() {
    this.buffering = false;
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const [index, event] of buffered.entries()) {
      if (this.buffering) {
        this.bufferedEvents.push(...buffered.slice(index));
        break;
      }
      this.handleEvent(event);
    }
  }

  private async loadSnapshot() {
    this.snapshotController?.abort();
    const controller = new AbortController();
    this.snapshotController = controller;
    this.dispatch({ type: "load-started" });

    try {
      const optional = async <T>(
        label: string,
        request: Promise<T>,
        fallback: T,
      ) => {
        try {
          return await request;
        } catch (error) {
          if (!controller.signal.aborted) {
            console.warn(`[conversations] Failed to load ${label}`, error);
          }
          return fallback;
        }
      };
      const [
        conversation,
        messages,
        statuses,
        permissions,
        questions,
        todo,
        tasks,
      ] = await Promise.all([
        this.client.conversation.get(this.conversationId, controller.signal),
        this.client.conversation.messages(
          this.conversationId,
          { limit: MESSAGE_INITIAL_LIMIT },
          controller.signal,
        ),
        this.client.conversation.status(controller.signal),
        optional(
          "permissions",
          this.client.permission.list(controller.signal),
          [],
        ),
        optional(
          "questions",
          this.client.question.list(controller.signal),
          [],
        ),
        optional(
          "todo",
          this.client.conversation.todo(
            this.conversationId,
            controller.signal,
          ),
          [],
        ),
        optional<OpenCodeTaskSnapshot[] | null>(
          "tasks",
          this.client.conversation.tasks(
            this.conversationId,
            controller.signal,
          ),
          null,
        ),
      ]);
      if (controller.signal.aborted || this.disposed) return;
      this.dispatch({
        type: "snapshot-loaded",
        snapshot: {
          conversation,
          messages,
          status: statuses[this.conversationId] ?? null,
          permissions: normalizeRecordList(permissions),
          questions: normalizeRecordList(questions),
          todo,
          tasks,
        },
      });
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return;
      this.dispatch({ type: "load-failed", error });
      throw error;
    } finally {
      if (this.snapshotController === controller) {
        this.snapshotController = null;
      }
    }
  }
}

function normalizeRecordList(value: unknown): OpenCodeRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is OpenCodeRecord =>
        typeof item === "object" && item !== null,
    );
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as OpenCodeRecord;
  for (const key of ["permissions", "questions"]) {
    if (Array.isArray(record[key])) return normalizeRecordList(record[key]);
  }
  return [];
}

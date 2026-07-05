"use client";

import { useEffect, useRef } from "react";
import { useWS } from "../realtime/provider";
import type { TaskCompletedPayload, TaskFailedPayload } from "../types";

interface CommandTaskCallbacks {
  /** Called when the task completes successfully. */
  onCompleted?: (result: TaskCompletedPayload) => void;
  /** Called when the task fails. */
  onFailed?: (error: string) => void;
}

/**
 * Listens for task:completed / task:failed WS events for a specific command task.
 * Used by all AI wrappers to get feedback after POST /api/commands.
 *
 * The hook uses a ref for callbacks to avoid re-subscribing on every render,
 * while always invoking the latest callback version.
 */
export function useCommandTaskListener(
  taskId: string | null,
  callbacks: CommandTaskCallbacks,
) {
  const { subscribe } = useWS();
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (!taskId) return;

    const unsubCompleted = subscribe("task:completed", (payload) => {
      const data = payload as TaskCompletedPayload;
      if (data?.task_id === taskId) {
        cbRef.current.onCompleted?.(data);
      }
    });

    const unsubFailed = subscribe("task:failed", (payload) => {
      const data = payload as TaskFailedPayload & { error?: string };
      if (data?.task_id === taskId) {
        cbRef.current.onFailed?.(data?.error ?? "Task failed");
      }
    });

    return () => {
      unsubCompleted();
      unsubFailed();
    };
  }, [taskId, subscribe]);
}

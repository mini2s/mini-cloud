"use client";

import { useCallback, useState } from "react";
import type { WSEventType } from "../types";
import type { TaskStreamPayload } from "../types/events";
import { useWSEvent } from "../realtime/hooks";

export interface TaskStreamItem extends TaskStreamPayload {}

/**
 * Subscribe to real-time task:stream events for a given issue.
 * Returns the accumulated items and a reset function.
 */
export function useTaskStream(issueId: string | undefined) {
  const [items, setItems] = useState<TaskStreamItem[]>([]);

  const handleEvent = useCallback(
    (payload: unknown) => {
      if (!issueId) return;
      const item = payload as TaskStreamPayload;
      if (item.issue_id !== issueId) return;
      setItems((prev) => {
        const key = `${item.task_id}:${item.seq}`;
        if (prev.some((p) => `${p.task_id}:${p.seq}` === key)) {
          return prev;
        }
        return [...prev, item];
      });
    },
    [issueId]
  );

  useWSEvent("task:stream" as WSEventType, handleEvent);

  const reset = useCallback(() => setItems([]), []);

  return { items, reset };
}

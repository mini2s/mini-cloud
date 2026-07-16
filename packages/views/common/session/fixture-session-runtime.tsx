"use client";

import {
  AssistantRuntimeProvider,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useT } from "../../i18n";
import type { SessionMode } from "./session";

const HYDRATION_DELAY_MS = 250;
const STREAM_DELAYS_MS = [220, 520, 860] as const;

type FixtureState = {
  isLoading: boolean;
  isRunning: boolean;
  isCancelling: boolean;
};

const FixtureStateContext = createContext<FixtureState | null>(null);

export function useFixtureSessionState(): FixtureState {
  const state = useContext(FixtureStateContext);
  if (!state) {
    throw new Error("useFixtureSessionState must be used inside FixtureSessionRuntimeProvider");
  }
  return state;
}

function getMessageText(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function FixtureSessionRuntimeProvider({
  sessionId,
  mode,
  children,
}: PropsWithChildren<{ sessionId: string; mode: SessionMode }>) {
  const { t } = useT("chat");
  const sequenceRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const runTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const nextId = useCallback(
    (kind: string) => `${sessionId}:fixture:${kind}:${++sequenceRef.current}`,
    [sessionId],
  );

  const clearTimers = useCallback((timers: Set<ReturnType<typeof setTimeout>>) => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }, []);

  const schedule = useCallback(
    (callback: () => void, delay: number, runTimer = false) => {
      const collection = runTimer ? runTimersRef.current : timersRef.current;
      const timer = setTimeout(() => {
        collection.delete(timer);
        callback();
      }, delay);
      collection.add(timer);
      return timer;
    },
    [],
  );

  const initialMessages = useMemo<ThreadMessageLike[]>(
    () => [
      {
        id: `${sessionId}:fixture:user:initial`,
        role: "user",
        content: [{ type: "text", text: t(($) => $.session.fixture.user_request) }],
      },
      {
        id: `${sessionId}:fixture:assistant:initial`,
        role: "assistant",
        content: [
          { type: "reasoning", text: t(($) => $.session.fixture.reasoning) },
          { type: "text", text: t(($) => $.session.fixture.summary) },
          {
            type: "tool-call",
            toolCallId: `${sessionId}:fixture:tool:read`,
            toolName: "read",
            argsText: JSON.stringify({ path: t(($) => $.session.fixture.read_path) }),
            result: t(($) => $.session.fixture.read_result),
          },
          {
            type: "tool-call",
            toolCallId: `${sessionId}:fixture:tool:metadata`,
            toolName: "fixture_metadata",
            argsText: JSON.stringify({ sessionId }),
            result: t(($) => $.session.fixture.unknown_result),
          },
          {
            type: "tool-call",
            toolCallId: `${sessionId}:fixture:tool:search-error`,
            toolName: "search",
            argsText: JSON.stringify({ query: "Session runtime" }),
            result: t(($) => $.session.fixture.failed_result),
            isError: true,
          },
        ],
        status: { type: "complete", reason: "stop" },
      },
    ],
    [sessionId, t],
  );

  useEffect(() => {
    const timers = timersRef.current;
    const runTimers = runTimersRef.current;
    sequenceRef.current = 0;
    setMessages([]);
    setIsLoading(true);
    setIsRunning(false);
    setIsCancelling(false);

    schedule(() => {
      setMessages(initialMessages);
      setIsLoading(false);
    }, HYDRATION_DELAY_MS);

    return () => {
      clearTimers(timers);
      clearTimers(runTimers);
    };
  }, [clearTimers, initialMessages, schedule]);

  const handleNew = useCallback(
    async (message: AppendMessage) => {
      if (mode !== "control" || isLoading || isRunning) return;
      const text = getMessageText(message);
      if (!text) return;

      const userId = nextId("user");
      const assistantId = nextId("assistant");
      const toolCallId = nextId("tool");
      setIsRunning(true);
      setIsCancelling(false);
      setMessages((current) => [
        ...current,
        { id: userId, role: "user", content: [{ type: "text", text }] },
        {
          id: assistantId,
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: t(($) => $.session.fixture.stream_reasoning),
            },
          ],
          status: { type: "running" },
        },
      ]);

      schedule(
        () => {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: [
                      ...(Array.isArray(item.content) ? item.content : []),
                      {
                        type: "text" as const,
                        text: t(($) => $.session.fixture.stream_intro),
                      },
                    ],
                  }
                : item,
            ),
          );
        },
        STREAM_DELAYS_MS[0],
        true,
      );

      schedule(
        () => {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: [
                      ...(Array.isArray(item.content) ? item.content : []),
                      {
                        type: "tool-call" as const,
                        toolCallId,
                        toolName: "bash",
                        argsText: JSON.stringify({ command: "pnpm --filter @multica/views typecheck" }),
                      },
                    ],
                  }
                : item,
            ),
          );
        },
        STREAM_DELAYS_MS[1],
        true,
      );

      schedule(
        () => {
          setMessages((current) =>
            current.map((item) => {
              if (item.id !== assistantId) return item;
              const content = Array.isArray(item.content) ? item.content : [];
              return {
                ...item,
                content: [
                  ...content.map((part) =>
                    part.type === "tool-call" && part.toolCallId === toolCallId
                      ? {
                          ...part,
                          result: t(($) => $.session.fixture.stream_tool_output),
                        }
                      : part,
                  ),
                  {
                    type: "text" as const,
                    text: t(($) => $.session.fixture.stream_done),
                  },
                ],
                status: { type: "complete" as const, reason: "stop" as const },
              };
            }),
          );
          setIsRunning(false);
        },
        STREAM_DELAYS_MS[2],
        true,
      );
    },
    [isLoading, isRunning, mode, nextId, schedule, t],
  );

  const handleCancel = useCallback(async () => {
    if (!isRunning || isCancelling) return;
    setIsCancelling(true);
    clearTimers(runTimersRef.current);
    setMessages((current) =>
      current.map((item) =>
        item.role === "assistant" && item.status?.type === "running"
          ? {
              ...item,
              status: { type: "incomplete" as const, reason: "cancelled" as const },
            }
          : item,
      ),
    );

    await new Promise<void>((resolve) => {
      schedule(() => {
        setIsRunning(false);
        setIsCancelling(false);
        resolve();
      }, 180);
    });
  }, [clearTimers, isCancelling, isRunning, schedule]);

  const runtime = useExternalStoreRuntime({
    messages,
    isLoading,
    isRunning,
    isDisabled: isLoading,
    isSendDisabled: mode !== "control" || isLoading || isRunning,
    onNew: handleNew,
    onCancel: handleCancel,
    unstable_capabilities: { copy: true },
    convertMessage: (message) => message,
  });

  const state = useMemo(
    () => ({ isLoading, isRunning, isCancelling }),
    [isCancelling, isLoading, isRunning],
  );

  return (
    <FixtureStateContext.Provider value={state}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </FixtureStateContext.Provider>
  );
}

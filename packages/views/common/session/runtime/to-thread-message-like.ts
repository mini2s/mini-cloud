import type {
  OpenCodePart,
  ConversationRuntimeState,
  StoredOpenCodeMessage,
} from "@multica/core/conversations";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { projectToolPart } from "./project-tool-part";

type ContentPart = Exclude<ThreadMessageLike["content"], string>[number];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function projectPart(part: OpenCodePart): ContentPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: typeof part.text === "string" ? part.text : "",
      };
    case "reasoning":
      return {
        type: "reasoning",
        text:
          typeof part.text === "string"
            ? part.text.replaceAll("[REDACTED]", "")
            : "",
      };
    case "file": {
      const mime =
        typeof part.mime === "string"
          ? part.mime
          : "application/octet-stream";
      const url = typeof part.url === "string" ? part.url : "";
      const filename =
        typeof part.filename === "string" ? part.filename : "file";
      return mime.startsWith("image/")
        ? { type: "image", image: url, filename }
        : { type: "file", data: url, filename, mimeType: mime };
    }
    case "tool":
      return projectToolPart(part);
    default:
      return {
        type: "data",
        name: "opencode-unsupported-part",
        data: {
          type: part.type,
          raw: (() => {
            try {
              return JSON.stringify(part);
            } catch {
              return String(part);
            }
          })(),
        },
      };
  }
}

function hasPendingInteraction(
  state: ConversationRuntimeState,
  message: StoredOpenCodeMessage,
) {
  const callIds = new Set(
    message.parts.flatMap((part) =>
      part.type === "tool" && typeof part.callID === "string"
        ? [part.callID]
        : [],
    ),
  );
  if (callIds.size === 0) return false;
  return [...Object.values(state.permissions), ...Object.values(state.questions)]
    .some((request) => {
      const tool = asRecord(request.tool);
      return typeof tool?.callID === "string" && callIds.has(tool.callID);
    });
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const record = asRecord(error);
  const data = asRecord(record?.data);
  if (typeof data?.message === "string") return data.message;
  if (typeof record?.message === "string") return record.message;
  if (typeof record?.name === "string") return record.name;
  return "OpenCode run failed";
}

function projectServerMessage(
  state: ConversationRuntimeState,
  message: StoredOpenCodeMessage,
  isLastAssistant: boolean,
): ThreadMessageLike | null {
  const info = message.info;
  if (!info || (info.role !== "user" && info.role !== "assistant")) return null;
  const created =
    typeof info.time?.created === "number" ? info.time.created : Date.now();
  const content = message.parts.map(projectPart);
  const metadata = {
    custom: {
      opencode: {
        originalMessage: info,
        parts: message.parts,
      },
    },
  };

  if (info.role === "user") {
    return {
      id: info.id,
      role: "user",
      createdAt: new Date(created),
      content,
      metadata,
    };
  }

  let status: ThreadMessageLike["status"];
  if (hasPendingInteraction(state, message)) {
    status = { type: "requires-action", reason: "tool-calls" };
  } else if (info.error) {
    status = {
      type: "incomplete",
      reason: "error",
      error: errorMessage(info.error),
    };
  } else if (
    !info.finish &&
    isLastAssistant &&
    (state.runState.type === "streaming" ||
      state.runState.type === "cancelling" ||
      state.status?.type === "busy" ||
      state.status?.type === "retry")
  ) {
    status = { type: "running" };
  } else if (!info.finish) {
    status = { type: "incomplete", reason: "other" };
  } else {
    status = { type: "complete", reason: "stop" };
  }

  return {
    id: info.id,
    role: "assistant",
    createdAt: new Date(created),
    content,
    status,
    metadata,
  };
}

function mergeHistoricalToolPart(
  previous: OpenCodePart,
  next: OpenCodePart,
): OpenCodePart {
  if (previous.type !== "tool" || next.type !== "tool") return next;
  const previousState = asRecord(previous.state);
  const nextState = asRecord(next.state);
  return {
    ...next,
    ...(previous.id && previous.callID === next.callID
      ? { id: previous.id }
      : {}),
    ...(previousState || nextState
      ? { state: { ...(previousState ?? {}), ...(nextState ?? {}) } }
      : {}),
  };
}

function mergeHistoricalParts(
  previous: readonly OpenCodePart[],
  next: readonly OpenCodePart[],
): readonly OpenCodePart[] {
  const merged = [...previous];
  for (const part of next) {
    const indexById = part.id
      ? merged.findIndex((candidate) => candidate.id === part.id)
      : -1;
    const indexByCallId =
      indexById === -1 &&
      part.type === "tool" &&
      typeof part.callID === "string"
        ? merged.findIndex(
            (candidate) =>
              candidate.type === "tool" &&
              candidate.callID === part.callID,
          )
        : -1;
    const index = indexById !== -1 ? indexById : indexByCallId;
    if (index === -1) {
      merged.push(part);
    } else {
      merged[index] = mergeHistoricalToolPart(merged[index]!, part);
    }
  }
  return merged;
}

function mergeConsecutiveAssistantMessages(
  messages: readonly StoredOpenCodeMessage[],
) {
  const merged: StoredOpenCodeMessage[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (
      previous?.info?.role === "assistant" &&
      message.info?.role === "assistant"
    ) {
      merged[merged.length - 1] = {
        info: message.info,
        parts: mergeHistoricalParts(previous.parts, message.parts),
      };
      continue;
    }
    merged.push(message);
  }
  return merged;
}

export function toThreadMessageLike(
  state: ConversationRuntimeState,
): ThreadMessageLike[] {
  const orderedMessages = mergeConsecutiveAssistantMessages(
    state.messageOrder.flatMap((id) => {
      const message = state.messagesById[id];
      return message ? [message] : [];
    }),
  );
  const lastMessage = orderedMessages.at(-1);
  const activeAssistantId =
    Object.keys(state.pendingMessages).length === 0 &&
    lastMessage?.info?.role === "assistant"
      ? lastMessage.info.id
      : undefined;
  const serverMessages = orderedMessages.flatMap((message) => {
    const projected = projectServerMessage(
      state,
      message,
      message.info?.id === activeAssistantId,
    );
    return projected ? [projected] : [];
  });
  const pendingMessages = Object.values(state.pendingMessages)
    .sort((left, right) => left.createdAt - right.createdAt)
    .map<ThreadMessageLike>((pending) => ({
      id: pending.id,
      role: "user",
      createdAt: new Date(pending.createdAt),
      content: pending.parts.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : part.mime.startsWith("image/")
            ? {
                type: "image" as const,
                image: part.url,
                filename: part.filename,
              }
            : {
                type: "file" as const,
                data: part.url,
                filename: part.filename,
                mimeType: part.mime,
              },
      ),
      metadata: {
        custom: {
          opencode: {
            pending: true,
            error:
              pending.status === "failed"
                ? errorMessage(pending.error)
                : undefined,
          },
        },
      },
    }));

  return [...serverMessages, ...pendingMessages].sort((left, right) => {
    const leftTime =
      left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
    const rightTime =
      right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
    return leftTime - rightTime;
  });
}

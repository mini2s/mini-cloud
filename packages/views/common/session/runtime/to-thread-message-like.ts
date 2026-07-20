import type {
  OpenCodePart,
  ConversationRuntimeState,
  StoredOpenCodeMessage,
} from "@multica/core/conversations";
import type { ThreadMessageLike } from "@assistant-ui/react";

type ContentPart = Exclude<ThreadMessageLike["content"], string>[number];
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseToolInput(value: unknown): {
  args: JsonObject;
  argsText: string;
} {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return { args: toJsonObject(parsed), argsText: value };
    } catch {
      return { args: {}, argsText: value };
    }
  }
  const args = toJsonObject(value);
  return { args, argsText: JSON.stringify(args) };
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  const record = asRecord(value);
  if (!record) return String(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, toJsonValue(item)]),
  );
}

function toJsonObject(value: unknown): JsonObject {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, toJsonValue(item)]),
  );
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
    case "tool": {
      const state = asRecord(part.state);
      const { args, argsText } = parseToolInput(state?.input);
      const failed = state?.status === "error";
      return {
        type: "tool-call",
        toolCallId:
          typeof part.callID === "string"
            ? part.callID
            : part.id ?? "unknown-tool-call",
        toolName: typeof part.tool === "string" ? part.tool : "unknown",
        args,
        argsText,
        result: failed ? state?.error : state?.output,
        isError: failed,
      };
    }
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
      const partIds = new Set(
        previous.parts.flatMap((part) => (part.id ? [part.id] : [])),
      );
      const callIds = new Set(
        previous.parts.flatMap((part) =>
          part.type === "tool" && typeof part.callID === "string"
            ? [part.callID]
            : [],
        ),
      );
      const uniqueParts = message.parts.filter(
        (part) =>
          !(part.id && partIds.has(part.id)) &&
          !(
            part.type === "tool" &&
            typeof part.callID === "string" &&
            callIds.has(part.callID)
          ),
      );
      merged[merged.length - 1] = {
        info: message.info,
        parts: [...previous.parts, ...uniqueParts],
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
  const lastAssistantId = [...orderedMessages]
    .reverse()
    .find((message) => message.info?.role === "assistant")?.info?.id;
  const serverMessages = orderedMessages.flatMap((message) => {
    const projected = projectServerMessage(
      state,
      message,
      message.info?.id === lastAssistantId,
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

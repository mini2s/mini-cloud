import type { OpenCodePart } from "@multica/core/conversations";
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

function serializePart(part: OpenCodePart): string {
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

export function projectMalformedToolPart(part: OpenCodePart): ContentPart {
  return {
    type: "data",
    name: "opencode-unsupported-part",
    data: {
      type: part.type,
      raw: serializePart(part),
    },
  };
}

export function projectToolPart(part: OpenCodePart): ContentPart {
  const callId =
    typeof part.callID === "string" && part.callID.length > 0
      ? part.callID
      : undefined;
  const partId =
    typeof part.id === "string" && part.id.length > 0 ? part.id : undefined;
  const toolCallId = callId ?? partId;
  if (!toolCallId) return projectMalformedToolPart(part);

  const state = asRecord(part.state);
  const status = state?.status;
  const { args, argsText: inputText } = parseToolInput(state?.input);
  const argsText =
    status === "pending" && typeof state?.raw === "string"
      ? state.raw
      : inputText;
  const base = {
    type: "tool-call" as const,
    toolCallId,
    toolName:
      typeof part.tool === "string" && part.tool.length > 0
        ? part.tool
        : "unknown",
    args,
    argsText,
  };

  if (status === "error") {
    return {
      ...base,
      result: state?.error,
      isError: true,
    };
  }
  if (status === "completed") {
    return {
      ...base,
      result: state?.output,
    };
  }
  return base;
}

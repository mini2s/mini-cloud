import type { OpenCodeRuntimeEvent } from "../../../types";
import {
  OpenCodeCanonicalEventSchema,
  OpenCodeWrappedEventSchema,
} from "../schemas";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractSessionId(
  type: string,
  properties: Record<string, unknown>,
): string | undefined {
  if (typeof properties.sessionID === "string") return properties.sessionID;

  const part = asRecord(properties.part);
  if (typeof part?.sessionID === "string") return part.sessionID;

  const info = asRecord(properties.info);
  if (typeof info?.sessionID === "string") return info.sessionID;
  if (
    ["session.created", "session.updated", "session.deleted"].includes(type) &&
    typeof info?.id === "string"
  ) {
    return info.id;
  }
  return undefined;
}

export function normalizeOpenCodeEvent(
  value: unknown,
): OpenCodeRuntimeEvent | null {
  const wrapped = OpenCodeWrappedEventSchema.safeParse(value);
  if (wrapped.success) {
    const { directory, payload } = wrapped.data;
    return {
      type: payload.type,
      properties: payload.properties,
      ...(directory ? { directory } : {}),
      sessionId: extractSessionId(payload.type, payload.properties),
      raw: value,
    };
  }

  const canonical = OpenCodeCanonicalEventSchema.safeParse(value);
  if (!canonical.success) return null;
  return {
    type: canonical.data.type,
    properties: canonical.data.properties,
    sessionId: extractSessionId(
      canonical.data.type,
      canonical.data.properties,
    ),
    raw: value,
  };
}

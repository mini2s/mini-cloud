import { parseWithFallback } from "../../../api/schema";
import type {
  OpenCodeMessageWithParts,
  OpenCodeRecord,
  OpenCodeRuntimeEvent,
  OpenCodeSessionStatus,
  OpenCodeTaskSnapshot,
} from "../../types";
import {
  OpenCodeMessagesSchema,
  OpenCodeOptionalRecordSchema,
  OpenCodeRecordArraySchema,
  OpenCodeStatusMapSchema,
  OpenCodeTaskSnapshotArraySchema,
} from "./schemas";
import { normalizeOpenCodeEvent } from "./sse/normalize-event";
import { parseServerSentEvents } from "./sse/parser";
import type {
  CloudProxyClient,
  CloudProxyTransport,
} from "./types";

export class CloudProxyHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CloudProxyHttpError";
  }
}

function asErrorRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTransportError(error: unknown): unknown {
  if (error instanceof CloudProxyHttpError) return error;
  const source = asErrorRecord(error);
  if (typeof source.status !== "number") return error;
  const body = asErrorRecord(source.body);
  const nested = asErrorRecord(body.error);
  const details = Object.keys(nested).length > 0 ? nested : body;
  return new CloudProxyHttpError(
    source.status,
    typeof details.code === "string" ? details.code : "UNKNOWN",
    typeof details.message === "string"
      ? details.message
      : typeof body.error === "string"
        ? body.error
        : error instanceof Error
          ? error.message
          : `Cloud proxy request failed: ${source.status}`,
  );
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.href;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "ok" in parsed &&
      "data" in parsed
    ) {
      return (parsed as { data?: unknown }).data;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function readArrayPayload(raw: unknown, key: string): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return raw;
  return (raw as Record<string, unknown>)[key] ?? raw;
}

async function assertResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const raw = await readJson(response.clone());
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  throw new CloudProxyHttpError(
    response.status,
    typeof nested.code === "string" ? nested.code : "UNKNOWN",
    typeof nested.message === "string"
      ? nested.message
      : typeof nested.error === "string"
        ? nested.error
        : `Cloud proxy request failed: ${response.status}`,
  );
}

export function createCloudProxyClient({
  baseUrl,
  directory,
  transport,
  onProtocolError,
}: {
  baseUrl: string;
  directory: string;
  transport: CloudProxyTransport;
  onProtocolError?: (error: unknown) => void;
}): CloudProxyClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    "X-Workspace-Directory": encodeURIComponent(directory),
  };

  const request = async (
    method: string,
    path: string,
    options?: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      signal?: AbortSignal;
      accept?: string;
    },
  ) => {
    let response: Response;
    try {
      response = await transport(
        buildUrl(normalizedBaseUrl, path, options?.query),
        {
          method,
          credentials: "include",
          headers: {
            ...headers,
            ...(options?.accept ? { Accept: options.accept } : {}),
          },
          ...(options?.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
          ...(options?.signal ? { signal: options.signal } : {}),
        },
      );
    } catch (error) {
      throw normalizeTransportError(error);
    }
    return assertResponse(response);
  };

  const requestJson = async (
    method: string,
    path: string,
    options?: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      signal?: AbortSignal;
    },
  ) => readJson(await request(method, path, options));

  return {
    key: `${normalizedBaseUrl}\n${directory}`,
    baseUrl: normalizedBaseUrl,
    directory,
    conversation: {
      async get(conversationId, signal) {
        const raw = await requestJson(
          "GET",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
          { signal },
        );
        return parseWithFallback<OpenCodeRecord | null>(
          raw,
          OpenCodeOptionalRecordSchema,
          null,
          { endpoint: "GET /api/v1/conversations/:id" },
        );
      },
      async messages(conversationId, input, signal) {
        const raw = await requestJson(
          "GET",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
          { query: input, signal },
        );
        return parseWithFallback<OpenCodeMessageWithParts[]>(
          raw,
          OpenCodeMessagesSchema,
          [],
          { endpoint: "GET /api/v1/conversations/:id/messages" },
        );
      },
      async status(signal) {
        const raw = await requestJson(
          "GET",
          "/api/v1/conversations/status",
          { signal },
        );
        return parseWithFallback<Record<string, OpenCodeSessionStatus>>(
          raw,
          OpenCodeStatusMapSchema,
          {},
          { endpoint: "GET /api/v1/conversations/status" },
        );
      },
      promptAsync(conversationId, input, signal) {
        return requestJson(
          "POST",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/prompt/async`,
          { body: input, signal },
        );
      },
      abort(conversationId, signal) {
        return requestJson(
          "POST",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/abort`,
          { body: {}, signal },
        );
      },
      async todo(conversationId, signal) {
        const raw = await requestJson(
          "GET",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/todo`,
          { signal },
        );
        return parseWithFallback<OpenCodeRecord[]>(
          raw,
          OpenCodeRecordArraySchema,
          [],
          { endpoint: "GET /api/v1/conversations/:id/todo" },
        );
      },
      async tasks(conversationId, signal) {
        const raw = await requestJson(
          "GET",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/tasks`,
          { signal },
        );
        return parseWithFallback<OpenCodeTaskSnapshot[]>(
          readArrayPayload(raw, "tasks"),
          OpenCodeTaskSnapshotArraySchema,
          [],
          { endpoint: "GET /api/v1/conversations/:id/tasks" },
        );
      },
      async diff(conversationId, signal) {
        const raw = await requestJson(
          "GET",
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/diff`,
          { signal },
        );
        return parseWithFallback<OpenCodeRecord[]>(
          raw,
          OpenCodeRecordArraySchema,
          [],
          { endpoint: "GET /api/v1/conversations/:id/diff" },
        );
      },
    },
    permission: {
      async list(signal) {
        const raw = await requestJson("GET", "/api/v1/permissions", {
          signal,
        });
        return parseWithFallback<OpenCodeRecord[]>(
          readArrayPayload(raw, "permissions"),
          OpenCodeRecordArraySchema,
          [],
          { endpoint: "GET /api/v1/permissions" },
        );
      },
      respond(requestId, input, signal) {
        return requestJson(
          "POST",
          `/api/v1/permissions/${encodeURIComponent(requestId)}/reply`,
          { body: input, signal },
        );
      },
    },
    question: {
      async list(signal) {
        const raw = await requestJson("GET", "/api/v1/questions", {
          signal,
        });
        return parseWithFallback<OpenCodeRecord[]>(
          readArrayPayload(raw, "questions"),
          OpenCodeRecordArraySchema,
          [],
          { endpoint: "GET /api/v1/questions" },
        );
      },
      reply(requestId, input, signal) {
        return requestJson(
          "POST",
          `/api/v1/questions/${encodeURIComponent(requestId)}/reply`,
          { body: input, signal },
        );
      },
      reject(requestId, signal) {
        return requestJson(
          "POST",
          `/api/v1/questions/${encodeURIComponent(requestId)}/reject`,
          { body: {}, signal },
        );
      },
    },
    event: {
      async stream(signal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        const response = await request("GET", "/api/v1/events", {
          accept: "text/event-stream",
          signal: controller.signal,
        });
        if (!response.body) {
          throw new CloudProxyHttpError(
            response.status,
            "EMPTY_STREAM",
            "Cloud proxy event stream has no response body",
          );
        }

        const stream = (async function* (): AsyncGenerator<OpenCodeRuntimeEvent> {
          try {
            for await (const frame of parseServerSentEvents(response.body!)) {
              let parsed: unknown;
              try {
                parsed = JSON.parse(frame.data);
              } catch (error) {
                onProtocolError?.(error);
                continue;
              }
              const event = normalizeOpenCodeEvent(parsed);
              if (!event) {
                onProtocolError?.(
                  new Error("Invalid OpenCode event payload"),
                );
                continue;
              }
              yield event;
            }
          } finally {
            signal?.removeEventListener("abort", abort);
          }
        })();

        return {
          stream,
          close: () => controller.abort(),
        };
      },
    },
  };
}

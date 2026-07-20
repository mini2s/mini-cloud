import { describe, expect, it, vi } from "vitest";
import {
  createCloudProxyClient,
  CloudProxyHttpError,
} from "./create-cloud-proxy-client";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createCloudProxyClient", () => {
  it("uses the cs-cloud conversation paths and directory header", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(undefined))
      .mockResolvedValueOnce(jsonResponse(undefined));
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace/with spaces",
      transport,
    });

    await client.conversation.messages("conversation/1", { limit: 50 });
    await client.conversation.promptAsync("conversation/1", {
      parts: [{ type: "text", text: "hello" }],
    });
    await client.conversation.abort("conversation/1");

    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/conversations/conversation%2F1/messages?limit=50",
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Directory": "%2Fworkspace%2Fwith%20spaces",
      },
    });
    expect(transport.mock.calls[1]?.[0]).toContain(
      "/api/v1/conversations/conversation%2F1/prompt/async",
    );
    expect(transport.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ parts: [{ type: "text", text: "hello" }] }),
    );
    expect(transport.mock.calls[2]?.[0]).toContain(
      "/api/v1/conversations/conversation%2F1/abort",
    );
  });

  it("degrades malformed message responses to an empty snapshot", async () => {
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport: vi.fn().mockResolvedValue(jsonResponse({ messages: null })),
    });

    await expect(
      client.conversation.messages("conversation-1"),
    ).resolves.toEqual([]);
  });

  it("accepts both array and named wrapper interaction responses", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ permissions: [{ id: "permission-1" }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ questions: [{ id: "question-1" }] }),
      );
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
    });

    await expect(client.permission.list()).resolves.toEqual([
      { id: "permission-1" },
    ]);
    await expect(client.question.list()).resolves.toEqual([
      { id: "question-1" },
    ]);
  });

  it("parses wrapped tasks and degrades malformed task responses", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          tasks: [
            {
              taskID: "task-1",
              status: "running",
              description: "Inspect runtime",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tasks: [{ taskID: null, status: 42 }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ tasks: [] }));
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
    });

    await expect(
      client.conversation.tasks("conversation-1"),
    ).resolves.toEqual([
      {
        taskID: "task-1",
        status: "running",
        description: "Inspect runtime",
      },
    ]);
    await expect(
      client.conversation.tasks("conversation-1"),
    ).resolves.toEqual([]);
    await expect(
      client.conversation.tasks("conversation-1"),
    ).resolves.toEqual([]);
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/conversations/conversation-1/tasks",
    );
  });

  it("sends the app-ai-native permission decision payload", async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse(undefined));
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
    });

    await client.permission.respond("permission/1", {
      decision: "reject",
    });

    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/permissions/permission%2F1/reply",
    );
    expect(transport.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ decision: "reject" }),
    );
  });

  it("loads the global status map from the conversation status route", async () => {
    const transport = vi.fn().mockResolvedValue(
      jsonResponse({
        "conversation-1": { type: "busy" },
      }),
    );
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
    });

    await expect(client.conversation.status()).resolves.toEqual({
      "conversation-1": { type: "busy" },
    });
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/conversations/status",
    );
  });

  it("turns proxy error envelopes into one typed HTTP error", async () => {
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "SESSION_NOT_FOUND", message: "Gone" },
          }),
          { status: 404 },
        ),
      ),
    });

    await expect(
      client.conversation.messages("conversation-1"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CloudProxyHttpError>>({
        name: "CloudProxyHttpError",
        status: 404,
        code: "SESSION_NOT_FOUND",
        message: "Gone",
      }),
    );
  });

  it("normalizes authenticated transport errors to the same client error", async () => {
    const transportError = Object.assign(new Error("API error: 403"), {
      status: 403,
      body: {
        error: { code: "DEVICE_OFFLINE", message: "Device is offline" },
      },
    });
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport: vi.fn().mockRejectedValue(transportError),
    });

    await expect(client.conversation.status()).rejects.toMatchObject({
      name: "CloudProxyHttpError",
      status: 403,
      code: "DEVICE_OFFLINE",
      message: "Device is offline",
    });
  });

  it("decodes wrapped and raw SSE events and reports malformed JSON", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"directory":"/workspace","payload":{"type":"session.idle","properties":{"sessionID":"conversation-1"}}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: malformed\n\ndata: {"type":"server.heartbeat","properties":{}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const onProtocolError = vi.fn();
    const transport = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
      onProtocolError,
    });

    const subscription = await client.event.stream();
    const events = [];
    for await (const event of subscription.stream) events.push(event);

    expect(events).toMatchObject([
      { type: "session.idle", sessionId: "conversation-1" },
      { type: "server.heartbeat" },
    ]);
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/events",
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "text/event-stream",
        "X-Workspace-Directory": "%2Fworkspace",
      },
    });
  });
});

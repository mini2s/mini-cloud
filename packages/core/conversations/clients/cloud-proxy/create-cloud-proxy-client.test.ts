import { describe, expect, it, vi } from "vitest";
import {
  createCloudProxyClient,
  CloudProxyContentTypeError,
  CloudProxyHttpError,
} from "./create-cloud-proxy-client";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createCloudProxyClient", () => {
  it("lists and mutates conversations through the collection contract", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          conversations: [
            {
              id: "conversation-1",
              title: "Migration",
              time: { created: 10, updated: 20 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "conversation-2", title: "New session" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "conversation-2", title: "Renamed" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createCloudProxyClient({
      baseUrl: "/cloud-api/cloud/device/device-1/proxy",
      directory: "/workspace",
      transport,
    });

    await expect(
      client.conversation.list({ roots: true, limit: 50 }),
    ).resolves.toEqual([
      {
        id: "conversation-1",
        title: "Migration",
        time: { created: 10, updated: 20 },
      },
    ]);
    await expect(
      client.conversation.create({ title: "New session" }),
    ).resolves.toMatchObject({ id: "conversation-2" });
    await expect(
      client.conversation.update("conversation-2", { title: "Renamed" }),
    ).resolves.toMatchObject({ title: "Renamed" });
    await expect(
      client.conversation.delete("conversation-2"),
    ).resolves.toBeUndefined();

    expect(transport.mock.calls.map((call) => call[0])).toEqual([
      "/cloud-api/cloud/device/device-1/proxy/api/v1/conversations?roots=true&limit=50",
      "/cloud-api/cloud/device/device-1/proxy/api/v1/conversations",
      "/cloud-api/cloud/device/device-1/proxy/api/v1/conversations/conversation-2",
      "/cloud-api/cloud/device/device-1/proxy/api/v1/conversations/conversation-2",
    ]);
    expect(transport.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "New session" }),
    });
    expect(transport.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(transport.mock.calls[3]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("degrades malformed conversation lists at the API boundary", async () => {
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport: vi.fn().mockResolvedValue(
        jsonResponse({ conversations: [{ id: null, title: 42 }] }),
      ),
    });

    await expect(client.conversation.list()).resolves.toEqual([]);
  });

  it("rejects an HTML frontend fallback instead of treating it as empty JSON", async () => {
    const onProtocolError = vi.fn();
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport: vi.fn().mockResolvedValue(
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html;charset=utf-8" },
        }),
      ),
      onProtocolError,
    });

    await expect(client.conversation.list()).rejects.toEqual(
      expect.objectContaining<Partial<CloudProxyContentTypeError>>({
        name: "CloudProxyContentTypeError",
        contentType: "text/html;charset=utf-8",
      }),
    );
    expect(onProtocolError).toHaveBeenCalledTimes(1);
  });

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

  it("sends captured question answers using an array for each question", async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse(undefined));
    const client = createCloudProxyClient({
      baseUrl: "https://multica.example.test/proxy",
      directory: "/workspace",
      transport,
    });

    await client.question.reply("question/1", {
      answers: [["Continue"], ["First", "Second"]],
    });

    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://multica.example.test/proxy/api/v1/questions/question%2F1/reply",
    );
    expect(transport.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        answers: [["Continue"], ["First", "Second"]],
      }),
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

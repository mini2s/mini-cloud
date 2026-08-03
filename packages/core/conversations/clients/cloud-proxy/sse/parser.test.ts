import { describe, expect, it } from "vitest";
import { parseServerSentEvents } from "./parser";

function streamChunks(chunks: readonly string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: readonly string[]) {
  const frames = [];
  for await (const frame of parseServerSentEvents(streamChunks(chunks))) {
    frames.push(frame);
  }
  return frames;
}

describe("parseServerSentEvents", () => {
  it("handles arbitrary chunks, CRLF, metadata, and multiple data lines", async () => {
    await expect(
      collect([
        "id: 7\r",
        "\nevent: message\r\ndata: {\"a\":",
        "1}\r\ndata: tail\r\nretry: 2500\r\n\r\n",
      ]),
    ).resolves.toEqual([
      {
        id: "7",
        event: "message",
        data: "{\"a\":1}\ntail",
        retry: 2500,
      },
    ]);
  });

  it("flushes an unterminated final frame at EOF", async () => {
    await expect(collect(["data: one\n\n", "data: two"])).resolves.toEqual([
      { data: "one" },
      { data: "two" },
    ]);
  });

  it("handles multiple events in one chunk and ignores comments", async () => {
    await expect(
      collect([": heartbeat\n\ndata: first\n\ndata: second\n\n"]),
    ).resolves.toEqual([{ data: "first" }, { data: "second" }]);
  });

  it("preserves UTF-8 characters when chunks split at every byte", async () => {
    const bytes = new TextEncoder().encode('data: {"text":"你好"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const frames = [];
    for await (const frame of parseServerSentEvents(body)) frames.push(frame);
    expect(frames).toEqual([{ data: '{"text":"你好"}' }]);
  });
});

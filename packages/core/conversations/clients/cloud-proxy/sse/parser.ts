export type ServerSentEventFrame = {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
};

function parseFrame(rawFrame: string): ServerSentEventFrame | null {
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of rawFrame.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "data":
        data.push(value);
        break;
      case "event":
        event = value;
        break;
      case "id":
        if (!value.includes("\0")) id = value;
        break;
      case "retry": {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) retry = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (data.length === 0) return null;
  return {
    data: data.join("\n"),
    ...(event !== undefined ? { event } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(retry !== undefined ? { retry } : {}),
  };
}

function takeFrame(buffer: string): { frame: string; rest: string } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  if (!match || match.index === undefined) return null;
  return {
    frame: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEventFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const next = takeFrame(buffer);
        if (!next) break;
        buffer = next.rest;
        const frame = parseFrame(next.frame);
        if (frame) yield frame;
      }
    }

    buffer += decoder.decode();
    while (true) {
      const next = takeFrame(buffer);
      if (!next) break;
      buffer = next.rest;
      const frame = parseFrame(next.frame);
      if (frame) yield frame;
    }

    if (buffer.length > 0) {
      const frame = parseFrame(buffer);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

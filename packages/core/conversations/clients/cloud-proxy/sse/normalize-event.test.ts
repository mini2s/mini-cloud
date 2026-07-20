import { describe, expect, it } from "vitest";
import { normalizeOpenCodeEvent } from "./normalize-event";

describe("normalizeOpenCodeEvent", () => {
  it("normalizes wrapped and raw events", () => {
    expect(
      normalizeOpenCodeEvent({
        directory: "/workspace",
        payload: {
          type: "message.part.updated",
          properties: { part: { sessionID: "session-1" } },
        },
      }),
    ).toMatchObject({
      directory: "/workspace",
      type: "message.part.updated",
      sessionId: "session-1",
    });
    expect(
      normalizeOpenCodeEvent({
        type: "message.updated",
        properties: { info: { sessionID: "session-2" } },
      }),
    ).toMatchObject({
      type: "message.updated",
      sessionId: "session-2",
    });
  });

  it("uses info.id only for session lifecycle events", () => {
    expect(
      normalizeOpenCodeEvent({
        type: "session.updated",
        properties: { info: { id: "session-1" } },
      })?.sessionId,
    ).toBe("session-1");
    expect(
      normalizeOpenCodeEvent({
        type: "message.updated",
        properties: { info: { id: "message-1" } },
      })?.sessionId,
    ).toBeUndefined();
  });

  it("reads sessionID from direct, part, and info properties", () => {
    expect(
      normalizeOpenCodeEvent({
        type: "session.status",
        properties: { sessionID: "session-direct" },
      })?.sessionId,
    ).toBe("session-direct");
    expect(
      normalizeOpenCodeEvent({
        type: "message.part.updated",
        properties: { part: { sessionID: "session-part" } },
      })?.sessionId,
    ).toBe("session-part");
    expect(
      normalizeOpenCodeEvent({
        type: "message.updated",
        properties: { info: { sessionID: "session-info" } },
      })?.sessionId,
    ).toBe("session-info");
  });

  it("keeps unknown extension events observable", () => {
    expect(
      normalizeOpenCodeEvent({
        type: "host.git.changed",
        properties: { sessionID: "session-1", branch: "main" },
      }),
    ).toMatchObject({
      type: "host.git.changed",
      sessionId: "session-1",
      properties: { branch: "main" },
    });
  });

  it("rejects malformed event payloads", () => {
    expect(normalizeOpenCodeEvent({ type: 123, properties: {} })).toBeNull();
    expect(normalizeOpenCodeEvent(null)).toBeNull();
  });
});

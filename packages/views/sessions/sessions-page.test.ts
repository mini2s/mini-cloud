import { describe, expect, it } from "vitest";
import type { OpenCodeConversation } from "@multica/core/conversations";
import { sessionGroupKey } from "./sessions-page";

function session(updated: number): OpenCodeConversation {
  return { id: String(updated), time: { created: updated, updated } };
}

describe("workspace session grouping", () => {
  const now = new Date(2026, 7, 3, 12, 0, 0).getTime();

  it("groups sessions from the current day", () => {
    expect(
      sessionGroupKey(session(new Date(2026, 7, 3, 8, 0, 0).getTime()), now),
    ).toBe("today");
  });

  it("groups recent sessions from earlier days into this week", () => {
    expect(
      sessionGroupKey(session(new Date(2026, 7, 1, 8, 0, 0).getTime()), now),
    ).toBe("this_week");
  });

  it("groups sessions older than seven days", () => {
    expect(
      sessionGroupKey(session(new Date(2026, 6, 20, 8, 0, 0).getTime()), now),
    ).toBe("older");
  });
});

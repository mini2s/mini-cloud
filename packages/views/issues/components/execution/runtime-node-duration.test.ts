import { describe, expect, it } from "vitest";
import {
  formatRuntimeDuration,
  resolveRuntimeDurationSeconds,
} from "./runtime-node-duration";

describe("formatRuntimeDuration", () => {
  it.each([
    [45, "45s"],
    [150, "2m 30s"],
    [3 * 3600 + 17 * 60, "3h 17m"],
    [2 * 86400 + 5 * 3600, "2d 5h"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatRuntimeDuration(seconds)).toBe(expected);
  });
});

describe("resolveRuntimeDurationSeconds", () => {
  it("prefers the server summary for a completed node", () => {
    expect(resolveRuntimeDurationSeconds({
      summarySeconds: 90,
      startedAt: "2026-07-25T10:00:00Z",
      completedAt: "2026-07-25T10:05:00Z",
      nowMs: Date.parse("2026-07-25T10:10:00Z"),
    })).toBe(90);
  });

  it("falls back to completed timestamps when the summary is missing", () => {
    expect(resolveRuntimeDurationSeconds({
      summarySeconds: null,
      startedAt: "2026-07-25T10:00:00Z",
      completedAt: "2026-07-25T10:02:30Z",
      nowMs: Date.parse("2026-07-25T10:10:00Z"),
    })).toBe(150);
  });

  it("uses the shared current time for a node that is still running", () => {
    expect(resolveRuntimeDurationSeconds({
      summarySeconds: null,
      startedAt: "2026-07-25T10:00:00Z",
      completedAt: null,
      nowMs: Date.parse("2026-07-25T10:01:40Z"),
    })).toBe(100);
  });

  it.each([
    { summarySeconds: null, startedAt: null, completedAt: null, nowMs: 0 },
    { summarySeconds: null, startedAt: "invalid", completedAt: null, nowMs: 0 },
    { summarySeconds: -1, startedAt: null, completedAt: null, nowMs: 0 },
    { summarySeconds: null, startedAt: "2026-07-25T10:01:00Z", completedAt: null, nowMs: Date.parse("2026-07-25T10:00:00Z") },
  ])("returns null for invalid duration input %#", (input) => {
    expect(resolveRuntimeDurationSeconds(input)).toBeNull();
  });
});

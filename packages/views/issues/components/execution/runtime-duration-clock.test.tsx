import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeDurationClock } from "./runtime-duration-clock";

describe("useRuntimeDurationClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-25T10:00:00Z");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes one shared time value every ten seconds while active", () => {
    const { result } = renderHook(() => useRuntimeDurationClock(true));
    expect(result.current).toBe(Date.parse("2026-07-25T10:00:00Z"));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current).toBe(Date.parse("2026-07-25T10:00:10Z"));
  });

  it("does not create a timer when no node has a running duration", () => {
    renderHook(() => useRuntimeDurationClock(false));
    expect(vi.getTimerCount()).toBe(0);
  });
});

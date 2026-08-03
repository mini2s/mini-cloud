import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useCountUp } from "./use-count-up";

// Real timers throughout: the roll is driven by requestAnimationFrame and
// performance.now, both of which fake timers distort. Durations are kept
// short (60–200ms) so the suite stays fast. test/setup.ts stubs matchMedia
// with matches: false, so motion is allowed unless a test overrides it.

describe("useCountUp", () => {
  afterEach(() => {
    cleanup();
  });

  it("lands exactly on the target after the duration", async () => {
    const { result } = renderHook(() => useCountUp(100, 60));
    await waitFor(() => expect(result.current).toBe(100));
  });

  it("passes through intermediate values while rolling", async () => {
    const seen = new Set<number>();
    const { result } = renderHook(() => {
      const value = useCountUp(1000, 200);
      seen.add(value);
      return value;
    });
    await waitFor(() => expect(result.current).toBe(1000));
    const intermediates = [...seen].filter((v) => v > 0 && v < 1000);
    expect(intermediates.length).toBeGreaterThan(0);
  });

  it("returns the target immediately when reduced motion is requested", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useCountUp(42, 1200));
      expect(result.current).toBe(42);
    } finally {
      window.matchMedia = original;
    }
  });

  it("returns 0 for a non-finite target", () => {
    const { result } = renderHook(() => useCountUp(Number.NaN, 60));
    expect(result.current).toBe(0);
  });

  it("re-rolls when the target changes", async () => {
    const { result, rerender } = renderHook(
      ({ target }) => useCountUp(target, 60),
      { initialProps: { target: 50 } },
    );
    await waitFor(() => expect(result.current).toBe(50));
    rerender({ target: 200 });
    await waitFor(() => expect(result.current).toBe(200));
  });
});

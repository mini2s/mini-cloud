import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudProxyClient } from "../types";
import {
  disposeSharedOpenCodeEventSources,
  getSharedOpenCodeEventSource,
} from "./shared-event-source";

function idleStream(signal: AbortSignal): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<never>>((resolve) => {
            if (signal.aborted) {
              resolve({ done: true, value: undefined });
              return;
            }
            signal.addEventListener(
              "abort",
              () => resolve({ done: true, value: undefined }),
              { once: true },
            );
          }),
      };
    },
  };
}

afterEach(() => {
  disposeSharedOpenCodeEventSources();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared OpenCode event source", () => {
  it("shares by proxy and directory and keeps the stream until the last release", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const eventStream = vi.fn(async (signal?: AbortSignal) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      signals.push(effectiveSignal);
      return {
        stream: idleStream(effectiveSignal),
        close: () => undefined,
      };
    });
    const firstClient = {
      key: "proxy\n/workspace-a",
      event: { stream: eventStream },
    } as unknown as CloudProxyClient;
    const secondDirectoryClient = {
      key: "proxy\n/workspace-b",
      event: { stream: eventStream },
    } as unknown as CloudProxyClient;

    const source = getSharedOpenCodeEventSource(firstClient);
    const releaseFirst = source.subscribe(() => undefined);
    const releaseSecond = source.subscribe(() => undefined);
    const releaseOtherDirectory = getSharedOpenCodeEventSource(
      secondDirectoryClient,
    ).subscribe(() => undefined);
    await Promise.resolve();

    expect(eventStream).toHaveBeenCalledTimes(2);
    releaseFirst();
    await vi.advanceTimersByTimeAsync(300);
    expect(signals[0]?.aborted).toBe(false);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(251);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    releaseOtherDirectory();
    await vi.advanceTimersByTimeAsync(251);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("survives a StrictMode-style release/remount and disposes after the grace period", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const eventStream = vi.fn(async (signal?: AbortSignal) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      signals.push(effectiveSignal);
      return {
        stream: idleStream(effectiveSignal),
        close: () => undefined,
      };
    });
    const client = {
      key: "proxy\n/workspace",
      event: { stream: eventStream },
    } as unknown as CloudProxyClient;
    const source = getSharedOpenCodeEventSource(client);

    const releaseFirst = source.subscribe(() => undefined);
    await Promise.resolve();
    expect(eventStream).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(100);
    const releaseSecond = source.subscribe(() => undefined);
    await Promise.resolve();
    expect(eventStream).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(251);
    expect(signals[0]?.aborted).toBe(true);

    const replacement = getSharedOpenCodeEventSource(client);
    const releaseReplacement = replacement.subscribe(() => undefined);
    await Promise.resolve();
    expect(eventStream).toHaveBeenCalledTimes(2);
    releaseReplacement();
  });

  it("reconnects when the stream misses the heartbeat liveness window", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const signals: AbortSignal[] = [];
    const eventStream = vi.fn(async (signal?: AbortSignal) => {
      const effectiveSignal = signal ?? new AbortController().signal;
      signals.push(effectiveSignal);
      return {
        stream: idleStream(effectiveSignal),
        close: () => undefined,
      };
    });
    const client = {
      key: "proxy\n/liveness",
      event: { stream: eventStream },
    } as unknown as CloudProxyClient;
    const release = getSharedOpenCodeEventSource(client).subscribe(
      () => undefined,
    );
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(31_001);

    expect(signals[0]?.aborted).toBe(true);
    expect(eventStream).toHaveBeenCalledTimes(2);
    release();
  });

  it("backs off failed connection attempts exponentially", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const eventStream = vi.fn().mockRejectedValue(new Error("offline"));
    const client = {
      key: "proxy\n/backoff",
      event: { stream: eventStream },
    } as unknown as CloudProxyClient;
    const release = getSharedOpenCodeEventSource(client).subscribe(
      () => undefined,
    );
    await Promise.resolve();
    expect(eventStream).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(eventStream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(eventStream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(eventStream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(eventStream).toHaveBeenCalledTimes(3);
    release();
  });
});

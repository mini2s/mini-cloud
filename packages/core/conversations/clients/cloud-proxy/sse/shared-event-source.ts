import type { CloudProxyClient } from "../types";
import type { OpenCodeRuntimeEvent } from "../../../types";

export const STREAM_RECONNECTED_EVENT_TYPE = "stream.reconnected";

type Listener = (event: OpenCodeRuntimeEvent) => void;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const LIVENESS_TIMEOUT_MS = 30_000;
const DISPOSE_DELAY_MS = 250;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

class SharedOpenCodeEventSource {
  private readonly listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private connectionPromise: Promise<void> | null = null;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private hadConnection = false;
  private nextReconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;

  constructor(
    private readonly client: CloudProxyClient,
    private readonly onDispose: () => void,
  ) {}

  subscribe(listener: Listener) {
    if (this.stopped) {
      throw new Error("OpenCode event source has been disposed");
    }
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.listeners.add(listener);
    this.connect();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners.delete(listener);
      if (this.listeners.size !== 0 || this.disposeTimer) return;
      this.disposeTimer = setTimeout(() => {
        this.disposeTimer = null;
        if (this.listeners.size === 0) this.dispose();
      }, DISPOSE_DELAY_MS);
    };
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.listeners.clear();
    this.onDispose();
  }

  private emit(event: OpenCodeRuntimeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[conversations] Event listener failed", error);
      }
    }
  }

  private connect() {
    if (this.stopped || this.connectionPromise) return;
    const connection = this.run().finally(() => {
      if (this.connectionPromise === connection) {
        this.connectionPromise = null;
        if (!this.stopped && this.listeners.size > 0) this.connect();
      }
    });
    this.connectionPromise = connection;
  }

  private async run() {
    while (!this.stopped && this.listeners.size > 0) {
      const abortController = new AbortController();
      this.abortController = abortController;
      let livenessTimer: ReturnType<typeof setTimeout> | null = null;
      let connected = false;

      const resetLiveness = () => {
        if (livenessTimer) clearTimeout(livenessTimer);
        livenessTimer = setTimeout(
          () => abortController.abort(),
          LIVENESS_TIMEOUT_MS,
        );
      };

      try {
        const subscription = await this.client.event.stream(
          abortController.signal,
        );
        connected = true;
        this.nextReconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        if (this.hadConnection) {
          this.emit({
            type: STREAM_RECONNECTED_EVENT_TYPE,
            properties: {},
            raw: undefined,
          });
        }
        this.hadConnection = true;
        resetLiveness();

        for await (const event of subscription.stream) {
          if (this.stopped || abortController.signal.aborted) break;
          resetLiveness();
          this.emit(event);
        }
        subscription.close();
      } catch (error) {
        if (!this.stopped && this.listeners.size > 0) {
          console.warn("[conversations] OpenCode event stream disconnected", error);
        }
      } finally {
        if (livenessTimer) clearTimeout(livenessTimer);
        if (this.abortController === abortController) {
          this.abortController = null;
        }
      }

      if (this.stopped || this.listeners.size === 0) return;
      const delay = connected
        ? INITIAL_RECONNECT_DELAY_MS
        : this.nextReconnectDelayMs;
      if (!connected) {
        this.nextReconnectDelayMs = Math.min(
          this.nextReconnectDelayMs * 2,
          MAX_RECONNECT_DELAY_MS,
        );
      }
      await wait(delay);
    }
  }
}

const registry = new Map<string, SharedOpenCodeEventSource>();

export function getSharedOpenCodeEventSource(client: CloudProxyClient) {
  const existing = registry.get(client.key);
  if (existing) return existing;
  const source = new SharedOpenCodeEventSource(client, () => {
    if (registry.get(client.key) === source) registry.delete(client.key);
  });
  registry.set(client.key, source);
  return source;
}

export function disposeSharedOpenCodeEventSources() {
  for (const source of registry.values()) source.dispose();
  registry.clear();
}

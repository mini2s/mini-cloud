import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { CloudProxyClient } from "../clients/cloud-proxy";
import type { ConversationRuntimeController } from "./controller";

// Keep the resource alive across StrictMode's synchronous effect replay.
export const SHARED_CONVERSATION_RUNTIME_DISPOSE_DELAY_MS = 250;

type SharedControllerEntry = {
  controller: ConversationRuntimeController;
  started: Promise<void>;
  retainCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  remove: () => void;
};

export type ConversationRuntimeControllerLease = {
  controller: ConversationRuntimeController;
  started: Promise<void>;
  release: () => void;
};

const queryClientRegistries = new WeakMap<
  QueryClient,
  WeakMap<CloudProxyClient, Map<string, SharedControllerEntry>>
>();
const activeEntries = new Set<SharedControllerEntry>();

function getRegistry(queryClient: QueryClient, client: CloudProxyClient) {
  let clientRegistries = queryClientRegistries.get(queryClient);
  if (!clientRegistries) {
    clientRegistries = new WeakMap();
    queryClientRegistries.set(queryClient, clientRegistries);
  }

  let registry = clientRegistries.get(client);
  if (!registry) {
    registry = new Map();
    clientRegistries.set(client, registry);
  }
  return registry;
}

function disposeEntry(entry: SharedControllerEntry) {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
  entry.disposeTimer = null;
  entry.controller.dispose();
  entry.remove();
  activeEntries.delete(entry);
}

export function acquireSharedConversationRuntimeController({
  queryClient,
  queryKey,
  client,
  conversationId,
  createController,
}: {
  queryClient: QueryClient;
  queryKey: QueryKey;
  client: CloudProxyClient;
  conversationId: string;
  createController: () => ConversationRuntimeController;
}): ConversationRuntimeControllerLease {
  const registry = getRegistry(queryClient, client);
  const key = JSON.stringify([conversationId, queryKey]);
  let entry = registry.get(key);

  if (!entry) {
    const controller = createController();
    entry = {
      controller,
      started: Promise.resolve(controller.start()),
      retainCount: 0,
      disposeTimer: null,
      disposed: false,
      remove: () => {
        if (registry.get(key) === entry) registry.delete(key);
      },
    };
    registry.set(key, entry);
    activeEntries.add(entry);
  }

  if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
  entry.disposeTimer = null;
  entry.retainCount++;

  let released = false;
  return {
    controller: entry.controller,
    started: entry.started,
    release: () => {
      if (released) return;
      released = true;
      entry.retainCount--;
      if (entry.retainCount !== 0 || entry.disposeTimer) return;
      entry.disposeTimer = setTimeout(() => {
        entry.disposeTimer = null;
        if (entry.retainCount === 0) disposeEntry(entry);
      }, SHARED_CONVERSATION_RUNTIME_DISPOSE_DELAY_MS);
    },
  };
}

export function disposeSharedConversationRuntimeControllers() {
  for (const entry of [...activeEntries]) disposeEntry(entry);
}

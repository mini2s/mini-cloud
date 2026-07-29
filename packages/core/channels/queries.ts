import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AuthIdentity, ChannelConfig, ChannelType } from "../types/channels";

// ── Query key factory ────────────────────────────────────────────────────
// Notification channels are user-scoped (the cloud-store backend resolves "me"
// from the session), so there is no wsId segment — same shape as the quota keys.

export const channelKeys = {
  all: ["channels"] as const,
  /** Configured channel instances for the current user. */
  list: () => [...channelKeys.all, "list"] as const,
  /** Channel types the backend makes available. */
  available: () => [...channelKeys.all, "available"] as const,
  /** Linked auth identities (for the IDTrust gate). */
  identities: () => [...channelKeys.all, "identities"] as const,
};

// ── Configured channels ──────────────────────────────────────────────────

export function channelsQueryOptions() {
  return queryOptions({
    queryKey: channelKeys.list(),
    queryFn: async (): Promise<ChannelConfig[]> => api.channelList(),
    staleTime: 30_000,
  });
}

export function useChannels() {
  return useQuery(channelsQueryOptions());
}

// ── Available channel types ──────────────────────────────────────────────

export function availableChannelTypesQueryOptions() {
  return queryOptions({
    queryKey: channelKeys.available(),
    queryFn: async (): Promise<ChannelType[]> => api.channelAvailable(),
    staleTime: 5 * 60_000,
  });
}

export function useAvailableChannelTypes() {
  return useQuery(availableChannelTypesQueryOptions());
}

// ── Auth identities ──────────────────────────────────────────────────────

export function identitiesQueryOptions() {
  return queryOptions({
    queryKey: channelKeys.identities(),
    queryFn: async (): Promise<AuthIdentity[]> => api.listIdentities(),
    staleTime: 60_000,
  });
}

export function useIdentities() {
  return useQuery(identitiesQueryOptions());
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CapabilityItem,
  DistributionResult,
  HubDistributionCreateParams,
  HubRepoCreateParams,
  HubRepoInviteParams,
  HubRepoMemberAddParams,
  HubRepoSyncTriggerResult,
  HubRepoUpdateParams,
  HubUploadPluginProgress,
  Repository,
} from "../types/hub";
import { hubKeys, type HubFavoriteStatus } from "./queries";

// ── Favorites ────────────────────────────────────────────────────────────

export function useHubFavoriteMutation() {
  const qc = useQueryClient();
  return useMutation<HubFavoriteStatus, Error, string>({
    mutationFn: (id) => api.hubFavoriteItem(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: hubKeys.favorite(id) });
      qc.invalidateQueries({ queryKey: hubKeys.items() });
      qc.invalidateQueries({ queryKey: hubKeys.item(id) });
    },
  });
}

export function useHubUnfavoriteMutation() {
  const qc = useQueryClient();
  return useMutation<HubFavoriteStatus, Error, string>({
    mutationFn: (id) => api.hubUnfavoriteItem(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: hubKeys.favorite(id) });
      qc.invalidateQueries({ queryKey: hubKeys.items() });
      qc.invalidateQueries({ queryKey: hubKeys.item(id) });
    },
  });
}

// ── Behavior logging (FR-10) ─────────────────────────────────────────────

/** Behavior action types, aligned with the source store project enum. */
export const HUB_BEHAVIOR_ACTION_TYPES = ["view", "preview", "install"] as const;
export type HubBehaviorActionType = (typeof HUB_BEHAVIOR_ACTION_TYPES)[number];

export interface HubLogBehaviorParams {
  id: string;
  actionType: HubBehaviorActionType;
  context?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Single entry point for hub behavior tracking — components declare the
 * action point, the payload shape (`action`/`actionType`) stays here so the
 * wire format never drifts between call sites.
 */
export function useHubLogBehaviorMutation() {
  return useMutation<void, Error, HubLogBehaviorParams>({
    mutationFn: ({ id, actionType, context, durationMs, metadata }) =>
      api.hubLogBehavior(id, {
        action: actionType,
        actionType,
        ...(context !== undefined ? { context } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      }),
  });
}

// ── Plugin package upload (SD-05) ────────────────────────────────────────

export interface HubUploadPluginVariables {
  repoId: string;
  file: File;
  onProgress?: (progress: HubUploadPluginProgress) => void;
}

/**
 * Uploads a plugin package via the unified core client (no bare XHR, no
 * private client access). On success the items list namespace is invalidated
 * so the "我创建的" (createdBy: me) list refetches with the new entry.
 */
export function useHubUploadPluginMutation() {
  const qc = useQueryClient();
  return useMutation<CapabilityItem, Error, HubUploadPluginVariables>({
    mutationFn: ({ repoId, file, onProgress }) =>
      api.hubUploadPlugin({ repoId, file }, onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.items() });
    },
  });
}

// ── Distributions ────────────────────────────────────────────────────────

export function useHubDistributeMutation() {
  const qc = useQueryClient();
  return useMutation<DistributionResult, Error, { id: string; data: HubDistributionCreateParams }>({
    mutationFn: ({ id, data }) => api.hubDistributeItem(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.distributions() });
    },
  });
}

export function useHubRevokeDistributionMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubRevokeDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.distributions() });
    },
  });
}

export function useHubDismissDistributionMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubDismissDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.distributions() });
    },
  });
}

export function useHubMarkDistributionReadMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubMarkDistributionRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.distributions() });
    },
  });
}

export function useHubForkDistributionMutation() {
  const qc = useQueryClient();
  return useMutation<CapabilityItem, Error, string>({
    mutationFn: (id) => api.hubForkDistribution(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.distributions() });
      qc.invalidateQueries({ queryKey: hubKeys.items() });
    },
  });
}

/**
 * Fork a public capability into the caller's own namespace. Returns the newly
 * created fork (with its own id) so the caller can navigate to the fork's
 * editor — matching the source store's post-fork behavior.
 */
export function useHubForkItemMutation() {
  const qc = useQueryClient();
  return useMutation<CapabilityItem, Error, string>({
    mutationFn: (id) => api.hubForkItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.items() });
      qc.invalidateQueries({ queryKey: hubKeys.myItems() });
    },
  });
}

// ── Repos ────────────────────────────────────────────────────────────────

export function useHubCreateRepoMutation() {
  const qc = useQueryClient();
  return useMutation<Repository, Error, HubRepoCreateParams>({
    mutationFn: (data) => api.hubCreateRepo(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.repos() });
    },
  });
}

export function useHubUpdateRepoMutation() {
  const qc = useQueryClient();
  return useMutation<Repository, Error, { id: string; data: HubRepoUpdateParams }>({
    mutationFn: ({ id, data }) => api.hubUpdateRepo(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.repos() });
    },
  });
}

export function useHubDeleteRepoMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.hubDeleteRepo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hubKeys.repos() });
    },
  });
}

export function useHubAddRepoMemberMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, { repoId: string; data: HubRepoMemberAddParams }>({
    mutationFn: ({ repoId, data }) => api.hubAddRepoMember(repoId, data),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: hubKeys.repoMembers(repoId) });
    },
  });
}

export function useHubRemoveRepoMemberMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, { repoId: string; userId: string }>({
    mutationFn: ({ repoId, userId }) => api.hubRemoveRepoMember(repoId, userId),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: hubKeys.repoMembers(repoId) });
    },
  });
}

export function useHubInviteRepoMemberMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, { repoId: string; data: HubRepoInviteParams }>({
    mutationFn: ({ repoId, data }) => api.hubInviteRepoMember(repoId, data),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: hubKeys.repoMembers(repoId) });
    },
  });
}

// ── Repo sync (FR-04) ────────────────────────────────────────────────────

export interface HubTriggerRepoSyncVariables {
  repoId: string;
  /** Dry-run: walk the remote and report the diff without applying changes. */
  dryRun?: boolean;
  registryId?: string;
}

/**
 * Trigger a manual sync for a sync-type repo. On success both the status
 * and the log queries are invalidated; the panel then polls the status
 * query until the job reaches a terminal state (see useHubRepoSyncStatus).
 */
export function useHubTriggerRepoSyncMutation() {
  const qc = useQueryClient();
  return useMutation<HubRepoSyncTriggerResult, Error, HubTriggerRepoSyncVariables>({
    mutationFn: ({ repoId, dryRun, registryId }) =>
      api.hubTriggerRepoSync(repoId, { dryRun, registryId }),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: hubKeys.repoSyncStatus(repoId) });
      qc.invalidateQueries({ queryKey: hubKeys.repoSyncLogs(repoId) });
    },
  });
}

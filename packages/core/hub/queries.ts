import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { api, ApiError } from "../api";
import type {
  CapabilityItem,
  Category,
  HubDistributionDepartment,
  FilterOption,
  HubItemListParams,
  HubRepoSyncStatusResult,
  ItemFilterOptions,
  ItemTag,
  SearchedUser,
  SourceOption,
  SyncStatus,
} from "../types/hub";

// ── Query key factory ────────────────────────────────────────────────────

export const hubKeys = {
  all: ["hub"] as const,
  items: () => [...hubKeys.all, "items"] as const,
  itemsList: (params: HubItemListParams) => [...hubKeys.items(), params] as const,
  /** Items created by the current user — own namespace so the "my items" list
   *  and badge counts don't collide with the public list cache. */
  myItems: () => [...hubKeys.items(), "my"] as const,
  myItemsList: (params: HubItemListParams) => [...hubKeys.myItems(), params] as const,
  /** Per-type totals for the sidebar badges (FR-08) — own key namespace so
   *  filter/sort changes on the list never collide with the count cache. */
  typeCounts: () => [...hubKeys.all, "type-counts"] as const,
  typeCount: (type: HubItemType) => [...hubKeys.typeCounts(), type] as const,
  item: (id: string) => [...hubKeys.all, "item", id] as const,
  favorite: (id: string) => [...hubKeys.all, "favorite", id] as const,
  scanResults: (id: string) => [...hubKeys.all, "scan-results", id] as const,
  artifacts: (id: string) => [...hubKeys.all, "artifacts", id] as const,
  filterOptions: () => [...hubKeys.all, "filterOptions"] as const,
  distributions: () => [...hubKeys.all, "distributions"] as const,
  distributionsSent: () => [...hubKeys.distributions(), "sent"] as const,
  distributionsReceived: () => [...hubKeys.distributions(), "received"] as const,
  distributionAuthority: () => [...hubKeys.distributions(), "authority"] as const,
  repos: () => [...hubKeys.all, "repos"] as const,
  myRepos: () => [...hubKeys.repos(), "my"] as const,
  repoMembers: (repoId: string) => [...hubKeys.repos(), repoId, "members"] as const,
  repoSyncStatus: (repoId: string) => [...hubKeys.repos(), repoId, "sync-status"] as const,
  repoSyncLogs: (repoId: string) => [...hubKeys.repos(), repoId, "sync-logs"] as const,
};

// ── Items list ───────────────────────────────────────────────────────────

export interface HubItemsResult {
  items: CapabilityItem[];
  total: number;
}

export function hubItemsQueryOptions(params: HubItemListParams) {
  return queryOptions({
    queryKey: hubKeys.itemsList(params),
    queryFn: async (): Promise<HubItemsResult> => {
      const res = await api.hubListItems(params);
      return { items: res.items ?? [], total: res.total ?? 0 };
    },
  });
}

export function useHubItems(params: HubItemListParams) {
  return useQuery(hubItemsQueryOptions(params));
}

// ── My items (created by current user) ───────────────────────────────────
// Source project uses a dedicated `/api/items/my` endpoint where the server
// resolves the caller from the session token. `createdBy: "me"` on the public
// `/api/items` endpoint is NOT honored by the backend, so the manager "created"
// tab must go through this path instead.

export function hubMyItemsQueryOptions(params: HubItemListParams) {
  return queryOptions({
    queryKey: hubKeys.myItemsList(params),
    queryFn: async (): Promise<HubItemsResult> => {
      const res = await api.hubListMyItems(params);
      return { items: res.items ?? [], total: res.total ?? 0 };
    },
  });
}

export function useHubMyItems(params: HubItemListParams) {
  return useQuery(hubMyItemsQueryOptions(params));
}

// ── Item detail ──────────────────────────────────────────────────────────

export function hubItemQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: hubKeys.item(id ?? ""),
    queryFn: async (): Promise<CapabilityItem | undefined> => {
      if (!id) return undefined;
      return api.hubGetItem(id);
    },
    enabled: !!id,
  });
}

export function useHubItemDetail(id: string | undefined) {
  return useQuery(hubItemQueryOptions(id));
}

// ── Favorite status ──────────────────────────────────────────────────────

export interface HubFavoriteStatus {
  favorited: boolean;
  favoriteCount: number;
}

export function hubFavoriteStatusQueryOptions(id: string) {
  return queryOptions({
    queryKey: hubKeys.favorite(id),
    queryFn: async (): Promise<HubFavoriteStatus> => {
      const item = await api.hubGetItem(id);
      return {
        favorited: item.favorited ?? false,
        favoriteCount: item.favoriteCount ?? 0,
      };
    },
  });
}

export function useHubFavoriteStatus(id: string) {
  return useQuery(hubFavoriteStatusQueryOptions(id));
}

// ── Scan results (D-08) ──────────────────────────────────────────────────

export function hubScanResultsQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: hubKeys.scanResults(id ?? ""),
    queryFn: () => api.hubGetScanResults(id!),
    enabled: !!id,
  });
}

export function useHubScanResults(id: string | undefined) {
  return useQuery(hubScanResultsQueryOptions(id));
}

// ── Artifacts (D-16) ─────────────────────────────────────────────────────

export function hubArtifactsQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: hubKeys.artifacts(id ?? ""),
    queryFn: () => api.hubListArtifacts(id!),
    enabled: !!id,
  });
}

export function useHubArtifacts(id: string | undefined) {
  return useQuery(hubArtifactsQueryOptions(id));
}

// ── Filter options ───────────────────────────────────────────────────────

export interface HubFilterOptions {
  categories: Category[];
  securityRiskGroups: FilterOption[];
  sources: SourceOption[];
  tags: ItemTag[];
}

export function hubFilterOptionsQueryOptions() {
  return queryOptions({
    queryKey: hubKeys.filterOptions(),
    queryFn: async (): Promise<HubFilterOptions> => {
      const [filters, tags] = await Promise.all([
        api.hubListFilterOptions() as Promise<ItemFilterOptions>,
        api.hubListTags({ pageSize: 200 }),
      ]);
      return {
        categories: filters.categories ?? [],
        securityRiskGroups: filters.securityRiskGroups ?? [],
        sources: filters.sources ?? [],
        tags: tags ?? [],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useHubFilterOptions() {
  return useQuery(hubFilterOptionsQueryOptions());
}

// ── Type counts (FR-08) ──────────────────────────────────────────────────

/** Capability types surfaced in the hub sidebar, in nav order. */
export const HUB_ITEM_TYPES = ["skill", "subagent", "command", "mcp", "plugin"] as const;
export type HubItemType = (typeof HUB_ITEM_TYPES)[number];

export type HubTypeCounts = Record<HubItemType, number>;

/**
 * Per-type total: `hubListItems({ type, pageSize: 1 })` -> `total`.
 * Independent queryKey per type with a long staleTime — the badge counts are
 * type totals and must not refetch on every filter/sort/page change.
 */
export function hubTypeCountQueryOptions(type: HubItemType) {
  return queryOptions({
    queryKey: hubKeys.typeCount(type),
    queryFn: async (): Promise<number> => {
      const res = await api.hubListItems({ type, pageSize: 1 });
      return res.total ?? 0;
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** Fire the five type-count queries in parallel and combine the totals. */
export function useHubTypeCounts(): { counts: HubTypeCounts; isLoading: boolean } {
  const results = useQueries({
    queries: HUB_ITEM_TYPES.map((type) => hubTypeCountQueryOptions(type)),
  });
  const counts = {} as HubTypeCounts;
  HUB_ITEM_TYPES.forEach((type, i) => {
    counts[type] = results[i]?.data ?? 0;
  });
  return { counts, isLoading: results.some((r) => r.isLoading) };
}

// ── Manager tab counts (M-01) ────────────────────────────────────────────

/**
 * "我创建的" badge total: `hubListMyItems({ pageSize: 1 })` -> `total`.
 * Uses the `/api/items/my` endpoint (server resolves caller from session),
 * NOT the public `/api/items` with `createdBy: "me"` (which the backend does
 * not honor). Lives under the my-items namespace so any items invalidation
 * (create/edit/delete mutations) refreshes the badge, while the independent
 * key keeps it from colliding with the filtered list caches.
 */
export function hubManagerCreatedCountQueryOptions() {
  return queryOptions({
    queryKey: [...hubKeys.myItems(), "__count__"] as const,
    queryFn: async (): Promise<number> => {
      const res = await api.hubListMyItems({ pageSize: 1 });
      return res.total ?? 0;
    },
    staleTime: 60 * 1000,
  });
}

/** "我订阅的" badge total: favorites list total (filter-independent). */
export function hubManagerFavoritedCountQueryOptions() {
  return queryOptions({
    queryKey: [...hubKeys.items(), "__count__", "favorited"] as const,
    queryFn: async (): Promise<number> => {
      const res = await api.hubListItems({ favorited: true, pageSize: 1 });
      return res.total ?? 0;
    },
    staleTime: 60 * 1000,
  });
}

/** Fire the created/favorited badge count queries in parallel. */
export function useHubManagerTabCounts(): {
  createdCount: number;
  favoritedCount: number;
  isLoading: boolean;
} {
  const results = useQueries({
    queries: [hubManagerCreatedCountQueryOptions(), hubManagerFavoritedCountQueryOptions()],
  });
  return {
    createdCount: results[0]?.data ?? 0,
    favoritedCount: results[1]?.data ?? 0,
    isLoading: results.some((r) => r.isLoading),
  };
}

// ── Distributions ────────────────────────────────────────────────────────

export function hubMySentDistributionsQueryOptions() {
  return queryOptions({
    queryKey: hubKeys.distributionsSent(),
    queryFn: () => api.hubMySentDistributions(),
  });
}

export function useHubMySentDistributions() {
  const { data, isLoading } = useQuery(hubMySentDistributionsQueryOptions());
  return { distributions: data ?? [], isLoading };
}

export function hubMyReceivedDistributionsQueryOptions() {
  return queryOptions({
    queryKey: hubKeys.distributionsReceived(),
    queryFn: () => api.hubMyReceivedDistributions(),
  });
}

export function useHubMyReceivedDistributions() {
  const { data, isLoading } = useQuery(hubMyReceivedDistributionsQueryOptions());
  return { receipts: data ?? [], isLoading };
}

export function hubDistributionAuthorityQueryOptions() {
  return queryOptions({
    queryKey: hubKeys.distributionAuthority(),
    queryFn: () => api.hubMyDistributionAuthority(),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Whether the caller may distribute at all — the single gating flag for every
 * distribute entry (manager toolbar, detail page). Prefers the server-provided
 * `canDistribute`; falls back to the source store semantics
 * (`unlimited || leads ≥1 department`). Failures degrade to "cannot
 * distribute" so entries simply stay hidden.
 */
export function selectCanDistribute(
  authority:
    | { canDistribute?: boolean; unlimited: boolean; departments: HubDistributionDepartment[] }
    | undefined,
): boolean {
  if (!authority) return false;
  if (typeof authority.canDistribute === "boolean") return authority.canDistribute;
  return authority.unlimited || (authority.departments?.length ?? 0) > 0;
}

/** Flatten the authority department tree into a depth-annotated list for flat
 *  multi-select pickers (design A2: no admin dept-tree interface). */
export function flattenHubDistributionDepartments(
  departments: HubDistributionDepartment[],
): { dept: HubDistributionDepartment; depth: number }[] {
  const out: { dept: HubDistributionDepartment; depth: number }[] = [];
  const walk = (nodes: HubDistributionDepartment[], depth: number) => {
    for (const node of nodes) {
      out.push({ dept: node, depth });
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(departments, 0);
  return out;
}

export function useHubDistributionAuthority() {
  const { data, isLoading } = useQuery(hubDistributionAuthorityQueryOptions());
  return {
    authority: data,
    canDistribute: selectCanDistribute(data),
    departments: data?.departments ?? [],
    isLoading,
  };
}

// ── Eligible-user search (debounced imperative read, not a cached query) ───

/** Debounced search of distribution-eligible users (`hubSearchEligibleUsers`),
 *  mirroring the semantic-search hook pattern. */
export function useHubEligibleUserSearch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (query: string): Promise<SearchedUser[]> => {
      return new Promise((resolve, reject) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          try {
            const trimmed = query.trim();
            if (!trimmed) {
              resolve([]);
              return;
            }
            const users = await api.hubSearchEligibleUsers(trimmed);
            resolve(users ?? []);
          } catch (err) {
            reject(err);
          }
        }, 300);
      });
    },
    [],
  );

  return { search };
}

// ── Repos ────────────────────────────────────────────────────────────────

export function hubMyReposQueryOptions() {
  return queryOptions({
    queryKey: hubKeys.myRepos(),
    queryFn: () => api.hubListMyRepos(),
  });
}

export function useHubMyRepos() {
  const { data, isLoading } = useQuery(hubMyReposQueryOptions());
  return { repos: data ?? [], isLoading };
}

export function hubRepoMembersQueryOptions(repoId: string) {
  return queryOptions({
    queryKey: hubKeys.repoMembers(repoId),
    queryFn: () => api.hubListRepoMembers(repoId),
    enabled: !!repoId,
  });
}

export function useHubRepoMembers(repoId: string) {
  const { data, isLoading } = useQuery(hubRepoMembersQueryOptions(repoId));
  return { members: data ?? [], isLoading };
}

// ── Repo sync (FR-04) ────────────────────────────────────────────────────

/** Poll cadence while a sync job is in flight. */
export const HUB_SYNC_POLL_INTERVAL_MS = 3000;

/**
 * True when the upstream store backend does not serve the repo-sync
 * endpoints (404 Not Found / 501 Not Implemented). The sync panel degrades
 * to config-only display on this signal — never an error toast.
 */
export function isHubSyncUnavailableError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}

/** syncStatus values that mean a job is still in flight (non-terminal). */
export const HUB_SYNC_ACTIVE_STATUSES = ["pending", "running", "syncing", "queued"] as const;

/**
 * Collapse the `sync-status` union into a single view model: multi-registry
 * repos are aggregated (active/failed status wins, pendingJobs summed,
 * lastSyncedAt = latest across registries).
 */
export function normalizeHubRepoSyncStatus(
  data: HubRepoSyncStatusResult | undefined,
): SyncStatus | undefined {
  if (!data) return undefined;
  if ("registries" in data) {
    const regs = Array.isArray(data.registries) ? data.registries : [];
    const representative =
      regs.find((r) => (HUB_SYNC_ACTIVE_STATUSES as readonly string[]).includes(r.syncStatus)) ??
      regs.find((r) => r.syncStatus === "failed") ??
      regs[0];
    const lastSyncedAt = regs
      .map((r) => r.lastSyncedAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1);
    return {
      syncStatus: representative?.syncStatus ?? "idle",
      lastSyncedAt,
      lastSyncSha: representative?.lastSyncSha ?? "",
      pendingJobs: regs.reduce((sum, r) => sum + (r.pendingJobs ?? 0), 0),
    };
  }
  return data;
}

export function isHubRepoSyncActive(status: SyncStatus | undefined): boolean {
  if (!status) return false;
  if ((status.pendingJobs ?? 0) > 0) return true;
  return (HUB_SYNC_ACTIVE_STATUSES as readonly string[]).includes(status.syncStatus);
}

/** Never hammer a missing endpoint — 404/501 means "no sync service upstream". */
function hubSyncRetry(failureCount: number, error: Error): boolean {
  if (isHubSyncUnavailableError(error)) return false;
  return failureCount < 3;
}

export function hubRepoSyncStatusQueryOptions(repoId: string) {
  return queryOptions({
    queryKey: hubKeys.repoSyncStatus(repoId),
    queryFn: () => api.hubGetRepoSyncStatus(repoId),
    enabled: !!repoId,
    retry: hubSyncRetry,
  });
}

/**
 * Repo sync status with activity-driven polling: while the latest status is
 * non-terminal (or the caller just triggered a run and passes
 * `polling: true`), refetch on a fixed cadence; once the status reaches a
 * terminal state the interval resolves to `false` and polling stops.
 */
export function useHubRepoSyncStatus(repoId: string, opts?: { polling?: boolean }) {
  const polling = opts?.polling ?? false;
  return useQuery({
    ...hubRepoSyncStatusQueryOptions(repoId),
    refetchInterval: (query) => {
      const status = normalizeHubRepoSyncStatus(query.state.data);
      if (isHubRepoSyncActive(status)) return HUB_SYNC_POLL_INTERVAL_MS;
      return polling ? HUB_SYNC_POLL_INTERVAL_MS : false;
    },
  });
}

export function hubRepoSyncLogsQueryOptions(repoId: string, pageSize = 10) {
  return queryOptions({
    queryKey: hubKeys.repoSyncLogs(repoId),
    queryFn: () => api.hubListRepoSyncLogs(repoId, { page: 1, pageSize }),
    enabled: !!repoId,
    retry: hubSyncRetry,
  });
}

export function useHubRepoSyncLogs(repoId: string, pageSize = 10) {
  const { data, isLoading, error } = useQuery(hubRepoSyncLogsQueryOptions(repoId, pageSize));
  return { logs: data?.logs ?? [], total: data?.total ?? 0, isLoading, error };
}

// ── Semantic search (debounced imperative read, not a cached query) ──────

export function useHubSemanticSearch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (query: string): Promise<CapabilityItem[]> => {
      return new Promise((resolve, reject) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          try {
            const trimmed = query.trim();
            if (!trimmed) {
              resolve([]);
              return;
            }
            const items = await api.hubSemanticSearch({ query: trimmed });
            resolve(items ?? []);
          } catch (err) {
            reject(err);
          }
        }, 300);
      });
    },
    [],
  );

  return { search };
}

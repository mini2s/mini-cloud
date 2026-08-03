// ── Hub data domain ──────────────────────────────────────────────────────
// queries.ts: hubKeys key factory + queryOptions factories + query hooks.
// mutations.ts: mutation hooks with centralized invalidation via hubKeys.
// view-store.ts: persisted view preferences (viewMode / pageSize).

export {
  hubKeys,
  hubItemsQueryOptions,
  useHubItems,
  hubMyItemsQueryOptions,
  useHubMyItems,
  hubItemQueryOptions,
  useHubItemDetail,
  hubFavoriteStatusQueryOptions,
  useHubFavoriteStatus,
  hubScanResultsQueryOptions,
  useHubScanResults,
  hubArtifactsQueryOptions,
  useHubArtifacts,
  hubFilterOptionsQueryOptions,
  useHubFilterOptions,
  HUB_ITEM_TYPES,
  hubTypeCountQueryOptions,
  useHubTypeCounts,
  hubManagerCreatedCountQueryOptions,
  hubManagerFavoritedCountQueryOptions,
  useHubManagerTabCounts,
  hubMySentDistributionsQueryOptions,
  useHubMySentDistributions,
  hubMyReceivedDistributionsQueryOptions,
  useHubMyReceivedDistributions,
  hubDistributionAuthorityQueryOptions,
  useHubDistributionAuthority,
  selectCanDistribute,
  flattenHubDistributionDepartments,
  useHubEligibleUserSearch,
  hubMyReposQueryOptions,
  useHubMyRepos,
  hubRepoMembersQueryOptions,
  useHubRepoMembers,
  HUB_SYNC_POLL_INTERVAL_MS,
  HUB_SYNC_ACTIVE_STATUSES,
  isHubSyncUnavailableError,
  normalizeHubRepoSyncStatus,
  isHubRepoSyncActive,
  hubRepoSyncStatusQueryOptions,
  useHubRepoSyncStatus,
  hubRepoSyncLogsQueryOptions,
  useHubRepoSyncLogs,
  useHubSemanticSearch,
} from "./queries";
export type {
  HubItemsResult,
  HubFavoriteStatus,
  HubFilterOptions,
  HubItemType,
  HubTypeCounts,
} from "./queries";

export {
  useHubFavoriteMutation,
  useHubUnfavoriteMutation,
  HUB_BEHAVIOR_ACTION_TYPES,
  useHubLogBehaviorMutation,
  useHubUploadPluginMutation,
  useHubDistributeMutation,
  useHubRevokeDistributionMutation,
  useHubDismissDistributionMutation,
  useHubMarkDistributionReadMutation,
  useHubForkDistributionMutation,
  useHubForkItemMutation,
  useHubCreateRepoMutation,
  useHubUpdateRepoMutation,
  useHubDeleteRepoMutation,
  useHubAddRepoMemberMutation,
  useHubRemoveRepoMemberMutation,
  useHubInviteRepoMemberMutation,
  useHubTriggerRepoSyncMutation,
} from "./mutations";
export type {
  HubBehaviorActionType,
  HubLogBehaviorParams,
  HubUploadPluginVariables,
  HubTriggerRepoSyncVariables,
} from "./mutations";

export {
  useHubViewStore,
  useHubPagination,
  HUB_PAGE_SIZE_OPTIONS,
  HUB_DEFAULT_PAGE_SIZE,
  HUB_DEFAULT_VIEW_MODE,
} from "./view-store";
export type {
  HubViewMode,
  HubPageSize,
  HubViewState,
  HubPagination,
} from "./view-store";

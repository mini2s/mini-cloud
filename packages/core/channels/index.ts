// ── Notification channels data domain ───────────────────────────────────────
// queries.ts: channelKeys key factory + queryOptions factories + query hooks.
// mutations.ts: update / delete / test mutations with list invalidation.
// Types live centrally in packages/core/types/channels.ts.
//
// Backed by the cloud-store backend (reverse-proxied at /api/channels and
// /api/auth/*). Powers the "通知渠道" page.

export {
  channelKeys,
  channelsQueryOptions,
  useChannels,
  availableChannelTypesQueryOptions,
  useAvailableChannelTypes,
  identitiesQueryOptions,
  useIdentities,
} from "./queries";

export {
  useUpdateChannelMutation,
  useDeleteChannelMutation,
  useTestChannelMutation,
} from "./mutations";

export type {
  ChannelCapabilities,
  ChannelSchemaField,
  ChannelType,
  ChannelConfig,
  ChannelUpdateInput,
  AuthIdentity,
  IdentityUnbindResult,
  MergeResult,
} from "../types/channels";

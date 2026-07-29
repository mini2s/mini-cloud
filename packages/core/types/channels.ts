// ── Notification Channels Type Definitions ──────────────────────────────────
// Mirrors the response shapes of the cloud-store backend's channel endpoints:
//   GET /api/channels              → { channels: ChannelConfig[] }
//   GET /api/channels/available    → { channelTypes: ChannelType[] }
//   GET /api/auth/identities       → { identities: AuthIdentity[] }
// Field names intentionally match the upstream snake_case API.

/** Capabilities a channel type advertises (e.g. wecom-bot supports markdown). */
export interface ChannelCapabilities {
  inboundMessages: boolean;
  outboundMessages: boolean;
  directChat: boolean;
  groupChat: boolean;
  markdown: boolean;
  media: boolean;
  mentionRequired: boolean;
  contentTypes: string[];
}

/** A per-type config form field, when the backend provides a schema. */
export interface ChannelSchemaField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

/** A channel type the backend makes available (e.g. "wecom-bot"). */
export interface ChannelType {
  type: string;
  capabilities: ChannelCapabilities;
  schema: ChannelSchemaField[] | null;
}

/** A configured notification channel instance. */
export interface ChannelConfig {
  id: string;
  userId: string;
  channelType: string;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  webhookVerified: boolean;
  lastActiveAt?: string;
  lastError?: string;
  /** wecom-bot only: the URL encoded into the binding QR code. */
  botQRCode?: string;
  createdAt: string;
  updatedAt: string;
}

/** A linked auth identity (used by the IDTrust gate for wecom channels). */
export interface AuthIdentity {
  provider: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  lastLoginAt: string | null;
}

/** Body for PUT /api/channels/{id}. All fields optional (partial update). */
export interface ChannelUpdateInput {
  name?: string;
  config?: Record<string, string>;
  enabled?: boolean;
}

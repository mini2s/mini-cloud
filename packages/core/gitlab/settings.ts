import type { Workspace } from "../types";

export interface GitlabDerivedSettings {
  /** Always true — the master switch has been removed; the GitLab integration is always on. */
  enabled: boolean;
  /** Issue-detail MR sidebar visibility. */
  mrSidebar: boolean;
  /** Auto-link issues to MRs from webhook payloads. */
  autoLinkMRs: boolean;
}

/**
 * Pure derivation from a workspace's settings JSONB. The integration is always
 * on; sub-features are opt-in (require an explicit true).
 */
export function deriveGitlabSettings(
  workspace: Pick<Workspace, "settings"> | null | undefined,
): GitlabDerivedSettings {
  const s = (workspace?.settings ?? {}) as Record<string, unknown>;
  // The master `gitlab_enabled` switch has been removed — the feature is
  // always on. Historical gitlab_enabled values are ignored.
  return {
    enabled: true,
    mrSidebar: s.gitlab_mr_sidebar_enabled === true,
    autoLinkMRs: s.gitlab_auto_link_enabled === true,
  };
}

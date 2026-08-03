import type { Workspace } from "../types";

export interface GitHubSettings {
  /** Always true — the master switch has been removed; the GitHub integration is always on. */
  enabled: boolean;
  /** Issue-detail PR sidebar visibility. */
  prSidebar: boolean;
  /** Co-authored-by trailer in agent commits. */
  coAuthor: boolean;
  /** Auto-link issues ↔ PRs from webhook payloads. */
  autoLinkPRs: boolean;
}

/**
 * Pure derivation from a workspace's settings JSONB. The integration is always
 * on; sub-flags default to off and only turn on when explicitly set to true.
 */
export function deriveGitHubSettings(
  workspace: Pick<Workspace, "settings"> | null | undefined,
): GitHubSettings {
  const s = (workspace?.settings ?? {}) as Record<string, unknown>;
  // The master `github_enabled` switch has been removed — the feature is
  // always on. Historical github_enabled values are ignored.
  return {
    enabled: true,
    prSidebar: s.github_pr_sidebar_enabled === true,
    coAuthor: s.co_authored_by_enabled === true,
    autoLinkPRs: s.github_auto_link_prs_enabled === true,
  };
}

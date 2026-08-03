import { describe, it, expect } from "vitest";
import { deriveGitHubSettings } from "./settings";
import type { Workspace } from "../types";

function ws(settings: Record<string, unknown>): Pick<Workspace, "settings"> {
  return { settings };
}

describe("deriveGitHubSettings", () => {
  it("enabled is always true (master switch removed)", () => {
    expect(deriveGitHubSettings(null).enabled).toBe(true);
    expect(deriveGitHubSettings(ws({})).enabled).toBe(true);
    expect(deriveGitHubSettings(ws({ github_enabled: false })).enabled).toBe(true);
  });

  it("sub-flags default OFF and only turn on when explicitly true", () => {
    expect(deriveGitHubSettings(null)).toMatchObject({ prSidebar: false, coAuthor: false, autoLinkPRs: false });
    expect(deriveGitHubSettings(ws({}))).toMatchObject({ prSidebar: false, coAuthor: false, autoLinkPRs: false });
    // explicit true turns them on
    expect(deriveGitHubSettings(ws({ github_pr_sidebar_enabled: true })).prSidebar).toBe(true);
    expect(deriveGitHubSettings(ws({ co_authored_by_enabled: true })).coAuthor).toBe(true);
    expect(deriveGitHubSettings(ws({ github_auto_link_prs_enabled: true })).autoLinkPRs).toBe(true);
    // explicit false stays off
    expect(deriveGitHubSettings(ws({ github_pr_sidebar_enabled: false })).prSidebar).toBe(false);
  });
});

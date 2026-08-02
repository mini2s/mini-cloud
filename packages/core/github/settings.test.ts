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

  it("sub-flags keep their default-on semantics independently of master", () => {
    expect(deriveGitHubSettings(null)).toMatchObject({ prSidebar: true, coAuthor: true, autoLinkPRs: true });
    expect(deriveGitHubSettings(ws({ github_pr_sidebar_enabled: false })).prSidebar).toBe(false);
    expect(deriveGitHubSettings(ws({ co_authored_by_enabled: false })).coAuthor).toBe(false);
    expect(deriveGitHubSettings(ws({ github_auto_link_prs_enabled: false })).autoLinkPRs).toBe(false);
    // master off no longer forces sub-flags off
    expect(
      deriveGitHubSettings(ws({ github_enabled: false, github_pr_sidebar_enabled: true })).prSidebar,
    ).toBe(true);
  });
});

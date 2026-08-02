import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { deriveGitlabSettings } from "./settings";

function ws(settings: Record<string, unknown>): Pick<Workspace, "settings"> {
  return { settings };
}

describe("deriveGitlabSettings", () => {
  it("enabled is always true (master switch removed)", () => {
    expect(deriveGitlabSettings(null).enabled).toBe(true);
    expect(deriveGitlabSettings(ws({})).enabled).toBe(true);
    // Even an explicit historical gitlab_enabled:false no longer disables.
    expect(deriveGitlabSettings(ws({ gitlab_enabled: false })).enabled).toBe(true);
  });

  it("autoLink defaults off and follows its sub-flag independently", () => {
    expect(deriveGitlabSettings(null).autoLinkMRs).toBe(false);
    expect(deriveGitlabSettings(ws({ gitlab_auto_link_enabled: true })).autoLinkMRs).toBe(true);
    // master off no longer forces autoLink off
    expect(
      deriveGitlabSettings(ws({ gitlab_enabled: false, gitlab_auto_link_enabled: true })).autoLinkMRs,
    ).toBe(true);
  });

  it("mrSidebar follows its sub-flag independently", () => {
    expect(deriveGitlabSettings(ws({ gitlab_mr_sidebar_enabled: true })).mrSidebar).toBe(true);
    expect(
      deriveGitlabSettings(ws({ gitlab_enabled: false, gitlab_mr_sidebar_enabled: true })).mrSidebar,
    ).toBe(true);
  });
});

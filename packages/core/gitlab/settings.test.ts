import { describe, expect, it } from "vitest";
import type { Workspace } from "../types";
import { deriveGitlabSettings } from "./settings";

function ws(settings: Record<string, unknown>): Pick<Workspace, "settings"> {
  return { settings };
}

describe("deriveGitlabSettings", () => {
  it("defaults the master switch to on and hidden sub-features to off when workspace is null", () => {
    expect(deriveGitlabSettings(null)).toEqual({
      enabled: true,
      mrSidebar: false,
      autoLinkMRs: false,
    });
  });

  it("defaults the master switch to on and hidden sub-features to off on empty settings", () => {
    expect(deriveGitlabSettings(ws({}))).toEqual({
      enabled: true,
      mrSidebar: false,
      autoLinkMRs: false,
    });
  });

  it("explicit master switch off forces dependent flags off", () => {
    expect(
      deriveGitlabSettings(
        ws({
          gitlab_enabled: false,
          gitlab_mr_sidebar_enabled: true,
          gitlab_auto_link_enabled: true,
        }),
      ),
    ).toEqual({
      enabled: false,
      mrSidebar: false,
      autoLinkMRs: false,
    });
  });

  it("lets hidden sub-flags opt in independently when the master switch is on", () => {
    expect(
      deriveGitlabSettings(ws({ gitlab_mr_sidebar_enabled: true })),
    ).toMatchObject({ enabled: true, mrSidebar: true, autoLinkMRs: false });

    expect(
      deriveGitlabSettings(ws({ gitlab_auto_link_enabled: true })),
    ).toMatchObject({ enabled: true, mrSidebar: false, autoLinkMRs: true });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// ContributionDimension integration smoke test. Mirrors the
// efficiency-dimension.test pattern: mock the workspace hook + view-state,
// and intercept useQuery to return the real mock-data factories keyed off
// the queryKey shape so the default (org) aggregate view exercises its
// "data present" render path. The whole point is that the page graph mounts
// and the four entity tabs + default (org) dept ranking + KPI strip render
// without throwing — the most faithful check possible without a backend.
//
// Per design decision #5 (zero-platform-request) the contribution dimension
// issues NO new platform queries — it reuses dept-tree / dept-ranking /
// all-users / all-repos / project-list, the same keys already exercised by
// the efficiency dimension test. We mock the same set here.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/efficiency", async () => {
  const actual =
    await vi.importActual<typeof import("@multica/core/efficiency")>(
      "@multica/core/efficiency",
    );
  return {
    ...actual,
    useViewState: () => ({
      timeRange: actual.getDefaultDateRangeWide(30),
      setTimeRange: () => {},
    }),
  };
});

// Intercept useQuery and return mock data shaped off the queryKey. The
// contribution dimension reuses these keys:
//   ["efficiency", wsId, "dept-tree"]
//   ["efficiency", wsId, "dept-ranking", parentDeptId, start, end]
//   ["efficiency", wsId, "all-users", start, end]
//   ["efficiency", wsId, "all-repos", start, end]
//   ["efficiency", wsId, "project-list", start, end, order]
// We dispatch on key[2] (the segment discriminator).
vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  const eff = await vi.importActual<typeof import("@multica/core/efficiency")>(
    "@multica/core/efficiency",
  );
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[] }) => {
      const key = opts.queryKey;
      const segment = String(key[2]);
      const start = key[3] != null ? String(key[3]) : undefined;
      const end = key[4] != null ? String(key[4]) : undefined;
      let data: unknown = undefined;
      if (segment === "dept-tree") data = eff.mock.deptTree();
      else if (segment === "dept-ranking") {
        const parentDeptId = key[3] != null ? String(key[3]) : undefined;
        data = eff.mock.deptRanking({ parentDeptId, startDate: start, endDate: end });
      } else if (segment === "all-users") {
        data = eff.mock.allUsers({ startDate: start, endDate: end });
      } else if (segment === "all-repos") {
        data = eff.mock.allRepos({ startDate: start, endDate: end });
      } else if (segment === "project-list") {
        data = eff.mock.projectList({ startDate: start, endDate: end });
      }
      return { data, isLoading: false, error: null };
    },
  };
});

import { ContributionDimension } from "./contribution-dimension";

describe("ContributionDimension — full page integration render", () => {
  beforeEach(() => {
    cleanup();
  });

  it("mounts without throwing and renders the page header title", () => {
    renderWithI18n(<ContributionDimension />);
    expect(screen.getByText("贡献看板")).toBeInTheDocument();
  });

  it("renders the four entity tabs (org/user/project/repo)", () => {
    renderWithI18n(<ContributionDimension />);
    expect(screen.getByText("组织")).toBeInTheDocument();
    expect(screen.getByText("个人")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();
    expect(screen.getByText("仓库")).toBeInTheDocument();
  });

  it("renders the derived-caliber note (zero-platform-request)", () => {
    renderWithI18n(<ContributionDimension />);
    expect(screen.getByText("看板派生口径")).toBeInTheDocument();
  });

  it("renders the org ranking table header by default (org is the landing entity)", () => {
    renderWithI18n(<ContributionDimension />);
    expect(screen.getByText("部门贡献排行")).toBeInTheDocument();
  });
});

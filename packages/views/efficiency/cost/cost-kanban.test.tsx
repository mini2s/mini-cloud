import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// CostKanban integration smoke test. Mirrors the usage-kanban.test pattern:
// mock the workspace hook + view-state, and intercept useQuery to return the
// real mock-data factories keyed off the queryKey shape so the aggregate view
// exercises its "data present" render path. The whole point is that the page
// graph mounts and the three view tabs + dept tree + aggregate cards render
// without throwing — the most faithful check possible without a backend.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// CostKanban drills into the user detail page on member row click, so it
// pulls the workspace path builder via useWorkspacePaths() and the push hook
// via useNavigation(). The test isn't workspace-scoped (no
// WorkspaceSlugProvider / NavigationProvider), so stub both.
vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    metricsUserDetail: (uid: string) => `/ws/metrics/user/${uid}`,
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: () => {} }),
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

// Intercept useQuery and return mock data shaped off the queryKey. The cost
// queryKeys look like:
//   ["efficiency", wsId, "cost", <segment>, deptId, start, end, includeChildren]
// and dept-tree is ["efficiency", wsId, "dept-tree"]. We dispatch on key[2]
// ("dept-tree" vs "cost") and key[3] (the cost segment).
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
      const dimension = key[2];
      // Build a DeptQuery-shaped arg from the trailing fields when present.
      const q = {
        deptId: String(key[4] ?? ""),
        start: String(key[5] ?? ""),
        end: String(key[6] ?? ""),
        includeChildren: Boolean(key[7] ?? true),
      };
      let data: unknown = undefined;
      if (dimension === "dept-tree") data = eff.mock.deptTree();
      else if (dimension === "cost") {
        const segment = String(key[3]);
        if (segment === "overview") data = eff.mock.costOverview(q);
        else if (segment === "period-compare") data = eff.mock.costPeriodCompare(q);
        else if (segment === "models") data = eff.mock.costModels(q);
        else if (segment === "model-trend") data = eff.mock.costModelTrend(q);
        else if (segment === "model-composition") data = eff.mock.costModelComposition(q);
        else if (segment === "anomaly") data = eff.mock.costAnomaly(q);
        else if (segment === "sub-depts") data = eff.mock.costSubDepts(q);
        else if (segment === "team-trend") data = eff.mock.costTeamTrend(q);
        else if (segment === "team-composition") data = eff.mock.costTeamComposition(q);
      }
      return { data, isLoading: false, error: null };
    },
  };
});

import { CostKanban } from "./cost-kanban";

describe("CostKanban — full page integration render", () => {
  beforeEach(() => {
    cleanup();
  });

  it("mounts without throwing and renders the page header title", () => {
    renderWithI18n(<CostKanban />);
    expect(screen.getByText("成本看板")).toBeInTheDocument();
  });

  it("renders the dept tree panel header", () => {
    renderWithI18n(<CostKanban />);
    expect(screen.getByText("部门导航")).toBeInTheDocument();
  });

  it("renders the three view tabs", () => {
    renderWithI18n(<CostKanban />);
    expect(screen.getByText("部门聚合")).toBeInTheDocument();
    expect(screen.getByText("子部门对比")).toBeInTheDocument();
    expect(screen.getByText("成员成本")).toBeInTheDocument();
  });

  it("renders the include-children switch label", () => {
    renderWithI18n(<CostKanban />);
    expect(screen.getByText("包含子部门")).toBeInTheDocument();
  });

  it("renders the aggregate view's section titles by default", () => {
    renderWithI18n(<CostKanban />);
    // The aggregate view (default) renders the "总成本" and "Token 成本" and
    // "缓存成本" card titles.
    expect(screen.getByText("总成本")).toBeInTheDocument();
    expect(screen.getByText("Token 成本")).toBeInTheDocument();
    expect(screen.getByText("缓存成本")).toBeInTheDocument();
  });
});

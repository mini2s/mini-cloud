import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// UsageKanban integration smoke test (slice 3b). Mirrors the overview-page
// test pattern: mock the workspace hook + view-state, and intercept useQuery
// to return the real mock-data factories keyed off the queryKey shape so each
// sub-view exercises its "data present" render path. The whole point is that
// the page graph mounts and the three view tabs + dept tree render without
// throwing — the most faithful check possible without a backend.

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

// Intercept useQuery (the page uses useQuery directly; useQueries is exercised
// only inside DeptCompareView which we don't open in this smoke test) and
// return mock data shaped off the queryKey. The usage queryKeys look like:
//   ["efficiency", wsId, "usage", <segment>, deptId, start, end, includeChildren]
// and dept-tree is ["efficiency", wsId, "dept-tree"]. We dispatch on key[2].
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
      const segment = key[2];
      // Build a DeptQuery-shaped arg from the trailing fields when present.
      const q = {
        deptId: String(key[4] ?? ""),
        start: String(key[5] ?? ""),
        end: String(key[6] ?? ""),
        includeChildren: Boolean(key[7] ?? true),
      };
      let data: unknown = undefined;
      if (segment === "dept-tree") data = eff.mock.deptTree();
      else if (segment === "usage") {
        const sub = String(key[3]);
        if (sub === "dept-overview") data = eff.mock.usageDeptOverview(q);
        else if (sub === "dept-active-users") data = eff.mock.usageDeptActiveUsers(q);
        else if (sub === "dept-trend") data = eff.mock.usageDeptTrend(q);
        else if (sub === "dept-models") data = eff.mock.usageDeptModels(q);
        else if (sub === "dept-weekly") data = eff.mock.usageDeptWeekly(q);
        else if (sub === "dept-results") data = eff.mock.usageDeptResults(q);
        else if (sub === "dept-period-compare") data = eff.mock.usageDeptPeriodCompare(q);
        else if (sub === "dept-mode-usage") data = eff.mock.usageDeptModeUsage(q);
      }
      return { data, isLoading: false, error: null };
    },
  };
});

import { UsageKanban } from "./usage-kanban";

describe("UsageKanban — full page integration render", () => {
  beforeEach(() => {
    cleanup();
  });

  it("mounts without throwing and renders the page header title", () => {
    renderWithI18n(<UsageKanban />);
    expect(screen.getByText("使用看板")).toBeInTheDocument();
  });

  it("renders the dept tree panel header", () => {
    renderWithI18n(<UsageKanban />);
    expect(screen.getByText("部门导航")).toBeInTheDocument();
  });

  it("renders the three view tabs", () => {
    renderWithI18n(<UsageKanban />);
    expect(screen.getByText("部门聚合")).toBeInTheDocument();
    expect(screen.getByText("子部门对比")).toBeInTheDocument();
    expect(screen.getByText("本部门人员")).toBeInTheDocument();
  });

  it("renders the include-children switch label", () => {
    renderWithI18n(<UsageKanban />);
    expect(screen.getByText("包含子部门")).toBeInTheDocument();
  });

  it("renders the aggregate view's section titles by default", () => {
    renderWithI18n(<UsageKanban />);
    // The aggregate view (default) renders the "活跃用户" card title and the
    // "使用概览" card title. "活跃用户" also appears as a KPI label inside
    // that card, so we assert at least one match (getAllByText).
    expect(screen.getAllByText("活跃用户").length).toBeGreaterThan(0);
    expect(screen.getByText("使用概览")).toBeInTheDocument();
  });
});

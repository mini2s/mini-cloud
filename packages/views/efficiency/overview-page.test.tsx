import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";

// OverviewPage is the first end-to-end page (slice 2). The browser route is
// gated behind workspace auth + a live backend, neither of which exist in the
// mock phase. This integration test renders the WHOLE page tree with mocked
// query responses, verifying the component graph mounts, the 9 sections appear,
// and no card throws — the most faithful check possible without a server.

// --- Mock the workspace hook ---
vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// useViewState holds the global time range. Return a fixed 90d window so the
// header DateRangePicker shows a real range. We spread the real module so the
// cards' other imports (queryOptions, formatters, glossaryTip, mock factories)
// keep working.
vi.mock("@multica/core/efficiency", async () => {
  const actual =
    await vi.importActual<typeof import("@multica/core/efficiency")>(
      "@multica/core/efficiency",
    );
  return {
    ...actual,
    useViewState: () => ({
      timeRange: actual.getDefaultDateRangeWide(90),
      setTimeRange: () => {},
    }),
  };
});

// --- Mock useQuery to return the real mock-data factories, not undefined ---
// This exercises every card's "data present" render path (what users see),
// not the loading skeleton. Each card's options carry a queryKey whose third
// element identifies which mock to return.
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
      const p = key[3] as string | undefined;
      let data: unknown = undefined;
      if (segment === "summary") data = eff.mock.dashboardSummary({ startDate: p });
      else if (segment === "trends") data = eff.mock.dashboardTrends({ startDate: p });
      else if (segment === "config") data = eff.mock.globalConfig();
      else if (segment === "dept-tree") data = eff.mock.deptTree();
      else if (segment === "dept-ranking") data = eff.mock.deptRanking({ parentDeptId: p });
      else if (segment === "all-needs") data = eff.mock.allNeeds({ startDate: p });
      else if (segment === "users") data = eff.mock.users({ startDate: p });
      return { data, isLoading: false, error: null };
    },
  };
});

import { OverviewPage } from "./overview-page";

describe("OverviewPage — full page integration render", () => {
  beforeEach(() => {
    cleanup();
  });

  it("mounts without throwing and renders the page header title", () => {
    // The whole point: if any of the 8 cards throws during render, this fails.
    renderWithI18n(<OverviewPage />);
    expect(screen.getByText("AI 提效总览")).toBeInTheDocument();
  });

  it("renders the hero sub-title (cost-basis line)", () => {
    renderWithI18n(<OverviewPage />);
    // HeroSaving renders an h2 "提效节省概览" (renamed from the duplicate h1).
    expect(screen.getByText("提效节省概览")).toBeInTheDocument();
  });

  it("renders the three scorecard labels from ScorecardStrip", () => {
    renderWithI18n(<OverviewPage />);
    expect(screen.getByText("使用人数")).toBeInTheDocument();
    expect(screen.getByText("贡献行数")).toBeInTheDocument();
    expect(screen.getByText("AI 代码占比")).toBeInTheDocument();
  });

  it("renders the AI penetration card title", () => {
    renderWithI18n(<OverviewPage />);
    // Title h2 + a KpiCard label both carry "AI 渗透率" — assert at least one.
    expect(screen.getAllByText("AI 渗透率").length).toBeGreaterThan(0);
  });

  it("renders the scale-overview (CountsCard) title", () => {
    renderWithI18n(<OverviewPage />);
    expect(screen.getByText("规模概览")).toBeInTheDocument();
  });

  it("renders the DeptPK and TopRank card titles side by side", () => {
    renderWithI18n(<OverviewPage />);
    expect(screen.getByText("部门 PK")).toBeInTheDocument();
    expect(screen.getByText("Top 提效榜")).toBeInTheDocument();
  });
});

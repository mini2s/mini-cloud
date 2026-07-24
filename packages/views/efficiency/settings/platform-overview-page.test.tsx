import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// PlatformOverviewPage integration smoke test. Mirrors the pricing-page test
// pattern: mock the workspace hook and intercept useQuery to return the real
// mock-data factories keyed off the queryKey shape so the page exercises its
// "data present" render path. The point is that the whole page graph mounts
// without throwing and the header + KPIs + tab content render.
//
// The chat historical query keys look like:
//   ["efficiency", wsId, "chat", "global-daily", start, end]
//   ["efficiency", wsId, "chat", "cost-trend", start, end, model]
//   ["efficiency", wsId, "chat", "cache-hit-rate", start, end]
//   ["efficiency", wsId, "chat", "model-cost-ranking", start, end]
//   ["efficiency", wsId, "chat", "models-usage", start, end]
//   ["efficiency", wsId, "chat", "users-ranking", start, end, sortBy, search]
// so key[2] is the dimension ("chat") and key[3] is the segment.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

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
      const segment = key[3];
      let data: unknown = undefined;
      if (dimension === "chat") {
        // The page always passes a 30-day window; reuse it for the mock args.
        const start = String(key[4] ?? "2026-06-25");
        const end = String(key[5] ?? "2026-07-24");
        if (segment === "global-daily")
          data = eff.mock.chatGlobalDaily({ startDate: start, endDate: end });
        else if (segment === "cost-trend")
          data = eff.mock.chatCostTrend({ startDate: start, endDate: end });
        else if (segment === "cache-hit-rate")
          data = eff.mock.chatCacheHitRate({ startDate: start, endDate: end });
        else if (segment === "model-cost-ranking")
          data = eff.mock.chatModelCostRanking({ startDate: start, endDate: end });
        else if (segment === "models-usage")
          data = eff.mock.chatModelsUsage({ startDate: start, endDate: end });
        else if (segment === "users-ranking")
          data = eff.mock.chatUsersRanking({ startDate: start, endDate: end });
      }
      return {
        data,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: () => Promise.resolve(),
        dataUpdatedAt: Date.now(),
        errorUpdatedAt: 0,
      };
    },
  };
});

import { PlatformOverviewPage } from "./platform-overview-page";

describe("PlatformOverviewPage (smoke)", () => {
  beforeEach(() => cleanup());

  it("mounts and renders the page header title", () => {
    // The whole point: if any chart/table throws during render, this fails.
    renderWithI18n(<PlatformOverviewPage />);
    expect(screen.getByText("平台总览")).toBeInTheDocument();
  });

  it("renders the date-range preset buttons", () => {
    renderWithI18n(<PlatformOverviewPage />);
    expect(screen.getByText("近7天")).toBeInTheDocument();
    expect(screen.getByText("近30天")).toBeInTheDocument();
    expect(screen.getByText("近90天")).toBeInTheDocument();
  });

  it("renders the three tab triggers", () => {
    renderWithI18n(<PlatformOverviewPage />);
    expect(screen.getByText("全局趋势")).toBeInTheDocument();
    expect(screen.getByText("模型与成本")).toBeInTheDocument();
    expect(screen.getByText("用户分析")).toBeInTheDocument();
  });

  it("renders the global-tab KPI and section titles (default tab)", () => {
    renderWithI18n(<PlatformOverviewPage />);
    // KPI strip (global tab).
    expect(screen.getByText("总请求")).toBeInTheDocument();
    expect(screen.getByText("活跃用户（日均）")).toBeInTheDocument();
    expect(screen.getByText("错误率")).toBeInTheDocument();
    expect(screen.getByText("总成本")).toBeInTheDocument();
    // Trend sections.
    expect(screen.getByText("成本趋势")).toBeInTheDocument();
    expect(screen.getByText("Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("请求量趋势")).toBeInTheDocument();
    expect(screen.getByText("缓存命中率趋势")).toBeInTheDocument();
  });
});

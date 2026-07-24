import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// PlatformOverviewPage integration smoke test. Mirrors the pricing-page test
// pattern: mock the workspace hook and intercept useQuery to return the real
// mock-data factories keyed off the queryKey shape so the page exercises its
// "data present" render path. The point is that the whole page graph mounts
// without throwing and the header + KPIs + tables render.
//
// The chat query keys look like:
//   ["efficiency", wsId, "chat", "realtime", range, datasourceId]
//   ["efficiency", wsId, "chat", "system-config"]
//   ["efficiency", wsId, "chat", "datasources"]
// and the global config key:
//   ["efficiency", wsId, "config"]
// so key[2] is the dimension ("chat" vs "config") and key[3] is the segment.

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
      if (dimension === "config") {
        data = eff.mock.globalConfig();
      } else if (dimension === "chat") {
        if (segment === "system-config") data = eff.mock.chatSystemConfig();
        else if (segment === "datasources") data = eff.mock.chatDatasources();
        else if (segment === "realtime")
          data = eff.mock.chatRealtime({
            range: "1h",
            datasourceId: "1",
          });
      }
      return {
        data,
        isLoading: false,
        isFetching: false,
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

  it("renders the range toggle buttons", () => {
    renderWithI18n(<PlatformOverviewPage />);
    // 30m / 1h / 3h range buttons.
    expect(screen.getByText("30m")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("3h")).toBeInTheDocument();
  });

  it("renders the KPI strip titles", () => {
    renderWithI18n(<PlatformOverviewPage />);
    expect(screen.getByText("请求量")).toBeInTheDocument();
    expect(screen.getByText("活跃用户")).toBeInTheDocument();
    expect(screen.getByText("错误率")).toBeInTheDocument();
  });

  it("renders the trend and table section titles", () => {
    renderWithI18n(<PlatformOverviewPage />);
    expect(screen.getByText("Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("模型详情")).toBeInTheDocument();
    expect(screen.getByText("请求量 Top 用户")).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EfficiencyRepoRanking } from "./efficiency-repo-ranking";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  repoAddr: "github.com/askhz/multica",
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    metricsRepoDetail: (repoAddr: string) =>
      `/acme/metrics/repo/${encodeURIComponent(repoAddr)}`,
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: mocks.push }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQuery: () => ({
      data: [
        {
          repo_addr: mocks.repoAddr,
          efficiency_ratio: 120,
          sum_ancient_minutes: 960,
          sum_real_minutes: 480,
          commit_count: 12,
        },
      ],
      isLoading: false,
      error: null,
    }),
  };
});

describe("EfficiencyRepoRanking", () => {
  afterEach(() => {
    cleanup();
    mocks.push.mockReset();
  });

  it("opens the standalone repository detail route", () => {
    render(
      <EfficiencyRepoRanking startDate="2026-07-01" endDate="2026-07-30" />,
    );

    fireEvent.click(screen.getByText(mocks.repoAddr));

    expect(mocks.push).toHaveBeenCalledWith(
      "/acme/metrics/repo/github.com%2Faskhz%2Fmultica",
    );
  });
});

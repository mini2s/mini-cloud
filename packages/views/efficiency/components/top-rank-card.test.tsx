import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: mocks.useQuery,
  };
});

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "workspace-id",
}));

vi.mock("@multica/core/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/core/paths")>();
  return {
    ...actual,
    useWorkspacePaths: () => actual.paths.workspace("acme"),
  };
});

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: mocks.push }),
}));

import { TopRankCard } from "./top-rank-card";

describe("TopRankCard need drill-down", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.useQuery.mockReset();
  });

  it("keeps the complete slash-bearing need id in the detail URL", () => {
    const needId =
      "branch:git@example.com/acme/app.git:feature/TASK-210-login";
    mocks.useQuery
      .mockReturnValueOnce({
        data: [
          {
            need_id: needId,
            repo_branch: "feature/TASK-210-login",
            coverage_eligible: true,
            efficiency_ratio: 1.2,
          },
        ],
        isLoading: false,
        error: null,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

    render(<TopRankCard startDate="2026-07-01" endDate="2026-07-29" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "查看 feature/TASK-210-login 详情",
      }),
    );

    expect(mocks.push).toHaveBeenCalledWith(
      "/acme/metrics/need/branch%3Agit%40example.com%2Facme%2Fapp.git%3Afeature%2FTASK-210-login",
    );
  });
});

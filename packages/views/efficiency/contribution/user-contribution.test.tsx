import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserContribution } from "./user-contribution";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  userId: "69d2588916754cf3ea00110e0a242cc3",
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    metricsUserDetail: (userId: string) => `/acme/metrics/user/${userId}`,
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: mocks.push }),
}));

vi.mock("@multica/core/efficiency", async () => {
  const actual =
    await vi.importActual<typeof import("@multica/core/efficiency")>(
      "@multica/core/efficiency",
    );
  return {
    ...actual,
    useUserNameMap: () => ({
      resolveName: (userId: string) =>
        userId === mocks.userId ? "Alice" : userId,
    }),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQuery: (options: { queryKey: unknown[] }) => {
      if (options.queryKey[2] === "all-users") {
        return {
          data: [
            {
              user_id: mocks.userId,
              merged_need_count: 8,
              commit_diff_lines: 1200,
              commit_count: 16,
              ai_code_ratio: 0.5,
            },
          ],
          isLoading: false,
          error: null,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        error: null,
      };
    },
  };
});

describe("UserContribution", () => {
  afterEach(() => {
    cleanup();
    mocks.push.mockReset();
  });

  it("opens standalone user detail with the active date range", () => {
    render(
      <UserContribution startDate="2026-07-01" endDate="2026-07-30" />,
    );

    fireEvent.click(screen.getByText("Alice"));

    expect(mocks.push).toHaveBeenCalledWith(
      `/acme/metrics/user/${mocks.userId}?startDate=20260701&endDate=20260730`,
    );
  });
});

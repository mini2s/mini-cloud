import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoContribution } from "./repo-contribution";

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
    useQuery: (options: { queryKey: unknown[] }) => {
      if (options.queryKey[2] === "all-repos") {
        return {
          data: [
            {
              repo_addr: mocks.repoAddr,
              branch_count: 3,
              commit_count: 18,
              task_count: 7,
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

describe("RepoContribution", () => {
  afterEach(() => {
    cleanup();
    mocks.push.mockReset();
  });

  it("opens standalone whole-repository detail from the ranking", () => {
    render(
      <RepoContribution startDate="2026-07-01" endDate="2026-07-30" />,
    );

    fireEvent.click(screen.getByText(mocks.repoAddr));

    expect(mocks.push).toHaveBeenCalledWith(
      `/acme/metrics/repo/${encodeURIComponent(mocks.repoAddr)}`,
    );
  });
});

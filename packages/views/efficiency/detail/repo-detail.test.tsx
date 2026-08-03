import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderWithI18n } from "../../test/i18n";

// RepoDetail integration smoke test. Mirrors the need-detail test pattern:
// mock the workspace hook and intercept useQuery to dispatch on the queryKey
// entity segment, returning the real mock-data factories for repo-detail,
// repo-branches and repo-trend. The point is that the largest detail page
// (KPI grid + branch selector + sortable commits/tasks + branch overview +
// trend chart) exercises its "data present" render path and mounts without
// throwing — the most faithful check possible without a backend.
//
// The page now also calls mutation hooks (useCreateProject /
// useCheckProjectConflicts / useAddRepoToProject) inside AddRepoToProjectDialog,
// which need a QueryClient for useQueryClient. The wrapper below provides an
// in-memory QueryClient; the smoke test never drives a mutation, so no
// mutationFn ever fires.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    metricsCommitDetail: (commit: string) => `/metrics/commit/${commit}`,
    metricsTaskDetail: (task: string) => `/metrics/task/${task}`,
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

// Intercept useQuery and return mock data keyed off the queryKey shape:
//   ["efficiency", wsId, "detail", entity, ...]
// where entity is "repo" | "repo-branches" | "repo-trend". Other keys fall
// through to a no-data return (none expected here).
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
      const segment = key[2]; // "detail"
      const entity = key[3]; // "repo" / "repo-branches" / "repo-trend"
      if (segment === "detail" && entity === "repo-branches") {
        return {
          data: eff.mock.repoBranches(String(key[4] ?? "")),
          isLoading: false,
          error: null,
        };
      }
      if (segment === "detail" && entity === "repo-trend") {
        return {
          data: eff.mock.repoTrend({ repoAddr: String(key[4] ?? "") }),
          isLoading: false,
          error: null,
        };
      }
      if (segment === "detail" && entity === "repo") {
        return {
          data: eff.mock.repoDetail({
            repoAddr: String(key[4] ?? ""),
            repoBranch: key[5] ? String(key[5]) : undefined,
          }),
          isLoading: false,
          error: null,
        };
      }
      if (segment === "user-names") {
        return {
          data: eff.mock.userNames(),
          isLoading: false,
          error: null,
        };
      }
      return { data: undefined, isLoading: false, error: null };
    },
  };
});

import { RepoDetail } from "./repo-detail";

function renderWithQueryClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RepoDetail (smoke)", () => {
  beforeEach(() => cleanup());

  it("matches the source summary order and renders commits, tasks, and trend", async () => {
    const onBack = vi.fn();
    const { container } = renderWithQueryClient(
      <RepoDetail repoAddr="git@github.com:costrict/repo-1.git" onBack={onBack} />,
    );

    // Title block.
    expect(screen.getByText("仓库详情")).toBeTruthy();

    // Source metric block labels, including contributor count.
    expect(screen.getAllByText("提效比").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 代码占比").length).toBeGreaterThan(0);
    expect(screen.getAllByText("实际耗时").length).toBeGreaterThan(0);
    expect(screen.getByText("贡献者")).toBeTruthy();
    expect(screen.getByText("总费用（Tasks）")).toBeTruthy();

    // Basic information precedes the source-style metric block.
    const text = container.textContent ?? "";
    expect(text.indexOf("基础信息")).toBeLessThan(text.indexOf("传统开发时长预估"));

    expect(screen.getByText("基础信息")).toBeTruthy();
    expect(screen.getAllByText("Commits").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
    expect(screen.getByText("周趋势")).toBeTruthy();

    // Whole-repo scope (no branch) renders the branch overview.
    expect(screen.getByText("分支一览")).toBeTruthy();

    // Source percentage pills and visible drill-down link color are retained.
    expect(container.querySelector(".rounded-full.tabular-nums")).toBeTruthy();
    expect(container.querySelector(".font-mono.text-brand")).toBeTruthy();

    // The back button is wired (no router import in the shared view).
    const backBtn = container.querySelector("button");
    expect(backBtn).toBeTruthy();

    // The page rendered rich nested data without blowing up.
    expect(container.textContent).toContain("仓库详情");
  });

  it("invokes onBack when the back button is clicked", async () => {
    const onBack = vi.fn();
    const { container } = renderWithQueryClient(
      <RepoDetail repoAddr="git@github.com:costrict/repo-2.git" onBack={onBack} />,
    );
    const backBtn = container.querySelector("button");
    backBtn?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("uses the source-style branch dropdown and labels whole-repo scope", () => {
    const { container } = renderWithQueryClient(
      <RepoDetail repoAddr="git@github.com:costrict/repo-1.git" onBack={vi.fn()} />,
    );

    const branchSelect = screen.getByRole("combobox", {
      name: "切换分支",
    }) as HTMLSelectElement;

    expect(branchSelect.tagName).toBe("SELECT");
    expect(branchSelect.value).toBe("");
    expect(
      screen.getByRole("option", { name: "全部分支（整仓）" }),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("__all__");
  });
});

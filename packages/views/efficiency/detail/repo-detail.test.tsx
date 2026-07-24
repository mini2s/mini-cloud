import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// RepoDetail integration smoke test. Mirrors the need-detail test pattern:
// mock the workspace hook and intercept useQuery to dispatch on the queryKey
// entity segment, returning the real mock-data factories for repo-detail,
// repo-branches and repo-trend. The point is that the largest detail page
// (KPI grid + branch selector + sortable commits/tasks + branch overview +
// trend chart) exercises its "data present" render path and mounts without
// throwing — the most faithful check possible without a backend.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
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
      return { data: undefined, isLoading: false, error: null };
    },
  };
});

import { RepoDetail } from "./repo-detail";

describe("RepoDetail (smoke)", () => {
  beforeEach(() => cleanup());

  it("mounts and renders the title + KPI grid + commits + tasks + trend", async () => {
    const onBack = vi.fn();
    const { container } = renderWithI18n(
      <RepoDetail repoAddr="git@github.com:costrict/repo-1.git" onBack={onBack} />,
    );

    // Title block.
    expect(screen.getByText("Repo detail")).toBeTruthy();

    // KPI grid labels.
    expect(screen.getByText("Efficiency ratio")).toBeTruthy();
    expect(screen.getByText("AI code share")).toBeTruthy();
    expect(screen.getByText("Actual time spent")).toBeTruthy();

    // Section panels. "Commits" / "Tasks" also appear as sort headers and
    // trend legend entries, so use getAllByText and assert at least one match.
    expect(screen.getByText("Basic info")).toBeTruthy();
    expect(screen.getAllByText("Commits").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
    expect(screen.getByText("Weekly trend")).toBeTruthy();

    // Whole-repo scope (no branch) renders the branch overview.
    expect(screen.getByText("Branch overview")).toBeTruthy();

    // The back button is wired (no router import in the shared view).
    const backBtn = container.querySelector("button");
    expect(backBtn).toBeTruthy();

    // The page rendered rich nested data without blowing up.
    expect(container.textContent).toContain("Repo detail");
  });

  it("invokes onBack when the back button is clicked", async () => {
    const onBack = vi.fn();
    const { container } = renderWithI18n(
      <RepoDetail repoAddr="git@github.com:costrict/repo-2.git" onBack={onBack} />,
    );
    const backBtn = container.querySelector("button");
    backBtn?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

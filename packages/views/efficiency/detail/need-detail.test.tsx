import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderWithI18n } from "../../test/i18n";

// NeedDetail integration smoke test. Mirrors the efficiency-dimension /
// usage-kanban test pattern: mock the workspace hook and intercept useQuery
// to return the real mock-data factory keyed off the queryKey shape, so the
// richest detail page (sessions + commits + baseline + signals + files)
// exercises its "data present" render path. The point is that the whole page
// graph mounts without throwing and the title/KPI/sections render — the most
// faithful check possible without a backend.
//
// The page calls useUserNameMap, which fires its own useQuery for the
// user-names roster. That query is also intercepted below (returning the mock
// roster) so resolver-backed cells ("Primary user", session user) render real
// names instead of raw ids.

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

// Intercept useQuery and return mock data for the need-detail queryKey:
//   ["efficiency", wsId, "detail", "need", needId]
// so indices are: [2]="detail" (segment), [3]="need" (entity), [4]=needId.
// The user-names roster key is ["efficiency", wsId, "user-names"] ([2] is the
// segment). Other keys fall through to a no-data return (none expected here).
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
      const segment = key[2]; // "detail" | "user-names"
      const entity = key[3]; // "need" / "user" / "task" / "commit"
      if (segment === "detail" && entity === "need") {
        return {
          data: eff.mock.needDetail(String(key[4] ?? "n-test")),
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

import { NeedDetail } from "./need-detail";

// The page's useUserNameMap calls useQuery; provide an in-memory QueryClient so
// the hook's query is valid even if a future change bypasses the mock above.
function withQueryClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      {node}
    </QueryClientProvider>
  );
}

describe("NeedDetail (smoke)", () => {
  beforeEach(() => cleanup());

  it("mounts and renders the title + KPI grid + collapsible commits section", async () => {
    const onBack = vi.fn();
    const { container } = renderWithI18n(
      withQueryClient(<NeedDetail needId="n-test-1" onBack={onBack} />),
    );

    // Title block: "Need detail" + the need id subtitle.
    expect(screen.getByText("Need detail")).toBeTruthy();

    // KPI grid: the six baseline-vs-actual card labels.
    expect(screen.getByText("Calendar efficiency")).toBeTruthy();
    expect(screen.getByText("Work efficiency")).toBeTruthy();
    expect(screen.getByText("Actual period")).toBeTruthy();
    expect(screen.getByText("Baseline period")).toBeTruthy();
    expect(screen.getByText("Actual work")).toBeTruthy();
    expect(screen.getByText("Baseline work (fused)")).toBeTruthy();

    // Section panels render.
    expect(screen.getByText("Basic info")).toBeTruthy();
    expect(screen.getByText("Stage workload")).toBeTruthy();
    expect(screen.getByText("Related sessions")).toBeTruthy();

    // Collapsible commits section is present (collapsed by default).
    expect(screen.getByText("Related commits")).toBeTruthy();

    // The back button is wired (no router import in the shared view).
    const backBtn = container.querySelector("button");
    expect(backBtn).toBeTruthy();

    // The page did not blow up rendering rich nested data.
    expect(container.textContent).toContain("Need detail");
  });

  it("invokes onBack when the back button is clicked", async () => {
    const onBack = vi.fn();
    const { container } = renderWithI18n(
      withQueryClient(<NeedDetail needId="n-test-2" onBack={onBack} />),
    );
    const backBtn = container.querySelector("button");
    backBtn?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";

// PricingPage integration smoke test. Mirrors the cost-kanban / usage-kanban
// pattern: mock the workspace hook and intercept useQuery to return the real
// mock-data factories keyed off the queryKey shape so the page exercises its
// "data present" render path. The point is that the whole page graph mounts
// without throwing and the title + pricing table render.
//
// The chat query keys look like:
//   ["efficiency", wsId, "chat", "pricing"]
//   ["efficiency", wsId, "chat", "system-config"]
// so key[2] === "chat" and key[3] is the segment.

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
        if (segment === "pricing") data = eff.mock.chatPricing();
        else if (segment === "system-config") data = eff.mock.chatSystemConfig();
      }
      return { data, isLoading: false, error: null };
    },
  };
});

import { PricingPage } from "./pricing-page";

describe("PricingPage (smoke)", () => {
  beforeEach(() => cleanup());

  it("mounts and renders the page header title", () => {
    renderWithI18n(<PricingPage />);
    // "Model pricing" appears in both the PageHeader and the Section title —
    // assert at least one match (header renders the page mounted).
    expect(screen.getAllByText("Model pricing").length).toBeGreaterThan(0);
  });

  it("renders the pricing table section header", () => {
    renderWithI18n(<PricingPage />);
    // The Section title is "Model pricing" (also the header); assert the count
    // surface renders by checking the column header text.
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.getByText("Original currency")).toBeTruthy();
  });

  it("renders a row per mock pricing entry", () => {
    const { container } = renderWithI18n(<PricingPage />);
    // The mock sample has 3 pricing rows. Each renders as a <tr> with the
    // model name in a cell. glm-4.6 is the first mock model name.
    expect(container.textContent).toContain("glm-4.6");
    // The count badge reads "3 entries".
    expect(screen.getByText(/3 entries/)).toBeTruthy();
  });

  it("renders the Add pricing button", () => {
    renderWithI18n(<PricingPage />);
    expect(screen.getByText("Add pricing")).toBeTruthy();
  });
});

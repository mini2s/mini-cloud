// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostrictIdentityBridge } from "./costrict-identity-bridge";

const mockAssociateDeptIdentity = vi.hoisted(() => vi.fn());
const mockRefreshMe = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  getApi: () => ({
    associateDeptIdentity: mockAssociateDeptIdentity,
  }),
}));

vi.mock("../auth", () => ({
  useAuthStore: {
    getState: () => ({
      refreshMe: mockRefreshMe,
    }),
  },
}));

function renderBridge(queryClient = new QueryClient()) {
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <CostrictIdentityBridge />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe("CostrictIdentityBridge", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?embedded=opencode");
    mockAssociateDeptIdentity.mockResolvedValue({
      associated: true,
      associated_count: 1,
    });
    mockRefreshMe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("associates the current user when the opencode parent posts a universal id", async () => {
    const { invalidateSpy } = renderBridge();

    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://opencode.example.test",
      source: window,
      data: {
        type: "costrict:identity",
        casdoorUniversalId: "uni-current",
      },
    }));

    await waitFor(() => {
      expect(mockAssociateDeptIdentity).toHaveBeenCalledWith({
        casdoor_universal_id: "uni-current",
      });
    });
    await waitFor(() => {
      expect(mockRefreshMe).toHaveBeenCalledTimes(1);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["workspaces"] });
  });

  it("ignores duplicate identity messages for the same universal id", async () => {
    renderBridge();

    const message = new MessageEvent("message", {
      origin: "https://opencode.example.test",
      source: window,
      data: {
        type: "costrict:identity",
        casdoorUniversalId: "uni-current",
      },
    });
    window.dispatchEvent(message);
    window.dispatchEvent(message);

    await waitFor(() => {
      expect(mockAssociateDeptIdentity).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores malformed identity messages", async () => {
    renderBridge();

    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://opencode.example.test",
      data: { type: "costrict:identity", casdoorUniversalId: "" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://opencode.example.test",
      data: { type: "other", casdoorUniversalId: "uni-current" },
    }));

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(mockAssociateDeptIdentity).not.toHaveBeenCalled();
  });

  it("ignores identity messages that are not from the parent frame", async () => {
    renderBridge();

    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://opencode.example.test",
      data: {
        type: "costrict:identity",
        casdoorUniversalId: "uni-current",
      },
    }));

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(mockAssociateDeptIdentity).not.toHaveBeenCalled();
  });
});

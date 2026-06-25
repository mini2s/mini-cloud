import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mutable test state so individual cases can flip embedded/pathname.
const embeddedState = { value: true };
const postedPaths: string[] = [];
const routerPush = vi.fn();
let currentPathname = "/inbox";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@multica/core/platform/costrict-bridge", () => ({
  isEmbeddedInCostrict: () => embeddedState.value,
  postLocationToParent: (path: string) => {
    postedPaths.push(path);
  },
  parseParentRouteCommand: (event: MessageEvent) =>
    event.data?.type === "multica:route" && typeof event.data?.path === "string"
      ? { path: event.data.path }
      : null,
}));

import { CostrictEmbedSync } from "./costrict-embed-sync";

describe("CostrictEmbedSync", () => {
  beforeEach(() => {
    postedPaths.length = 0;
    routerPush.mockClear();
    embeddedState.value = true;
    currentPathname = "/inbox";
  });

  it("reports the current pathname to the parent when embedded", () => {
    render(<CostrictEmbedSync />);
    expect(postedPaths).toEqual(["/inbox"]);
  });

  it("does nothing when not embedded", () => {
    embeddedState.value = false;
    render(<CostrictEmbedSync />);
    expect(postedPaths).toEqual([]);
  });

  it("navigates on an inbound multica:route command from the parent", () => {
    render(<CostrictEmbedSync />);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { type: "multica:route", path: "/settings" },
      }),
    );
    expect(routerPush).toHaveBeenCalledWith("/settings");
  });

  it("ignores a route command equal to the current pathname", () => {
    render(<CostrictEmbedSync />);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { type: "multica:route", path: "/inbox" },
      }),
    );
    expect(routerPush).not.toHaveBeenCalled();
  });
});

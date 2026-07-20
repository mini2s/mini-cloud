import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmbeddedInCostrict,
  parseParentRouteCommand,
  postCostrictNavigateToSession,
  postLocationToParent,
} from "./costrict-bridge";

describe("costrict-bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("isEmbeddedInCostrict", () => {
    it("true when coStrictToken is injected", () => {
      vi.stubGlobal("window", {
        desktopAPI: { coStrictToken: "tok" },
        location: { search: "" },
        parent: {},
      } as unknown as Window);
      expect(isEmbeddedInCostrict()).toBe(true);
    });

    it("true when embedded query param is present", () => {
      const w = { location: { search: "?embedded=opencode" } } as unknown as Window;
      // parent === window so only the query param can trip it
      (w as unknown as { parent: Window }).parent = w;
      vi.stubGlobal("window", w);
      expect(isEmbeddedInCostrict()).toBe(true);
    });

    it("false when standalone (own frame, no token, no param)", () => {
      const w = { location: { search: "" }, desktopAPI: undefined } as unknown as Window;
      (w as unknown as { parent: Window }).parent = w;
      vi.stubGlobal("window", w);
      expect(isEmbeddedInCostrict()).toBe(false);
    });
  });

  describe("postCostrictNavigateToSession", () => {
    it("posts the navigate message to the parent when embedded", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      const posted = postCostrictNavigateToSession({ sessionId: "s1", workDir: "/p/proj" });

      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "multica:navigate",
          target: "session",
          sessionId: "s1",
          workDir: "/p/proj",
        },
        "*",
      );
      expect(posted).toBe(true);
    });

    it("posts without workDir when it is absent", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      const posted = postCostrictNavigateToSession({ sessionId: "s1" });

      expect(postMessage).toHaveBeenCalledWith(
        { type: "multica:navigate", target: "session", sessionId: "s1" },
        "*",
      );
      expect(posted).toBe(true);
    });

    it("no-ops when sessionId is missing", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      const posted = postCostrictNavigateToSession({ sessionId: "", workDir: "/p" });

      expect(postMessage).not.toHaveBeenCalled();
      expect(posted).toBe(false);
    });

    it("no-ops when there is no parent frame (standalone)", () => {
      const postMessage = vi.fn();
      const w = { } as Record<string, unknown>;
      w.parent = w;
      w.postMessage = postMessage;
      vi.stubGlobal("window", w as unknown as Window);

      const posted = postCostrictNavigateToSession({ sessionId: "s1", workDir: "/p" });

      expect(postMessage).not.toHaveBeenCalled();
      expect(posted).toBe(false);
    });
  });

  describe("postLocationToParent", () => {
    it("posts the location message to the parent when embedded", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      postLocationToParent("/ipd-1/issues/abc");

      expect(postMessage).toHaveBeenCalledWith(
        { type: "multica:location", path: "/ipd-1/issues/abc" },
        "*",
      );
    });

    it("no-ops when path is empty", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      postLocationToParent("");

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("no-ops when there is no parent frame (standalone)", () => {
      const postMessage = vi.fn();
      const w = {} as Record<string, unknown>;
      w.parent = w;
      w.postMessage = postMessage;
      vi.stubGlobal("window", w as unknown as Window);

      postLocationToParent("/inbox");

      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe("parseParentRouteCommand", () => {
    const parent = { postMessage: vi.fn() } as unknown as Window;

    it("returns the path for a valid command from the parent", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: parent,
        data: { type: "multica:route", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toEqual({ path: "/inbox" });
    });

    it("returns null when source is not the parent", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: {} as Window,
        data: { type: "multica:route", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toBeNull();
    });

    it("returns null for a different message type", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: parent,
        data: { type: "multica:location", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toBeNull();
    });

    it("returns null when path is missing or empty", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      expect(
        parseParentRouteCommand({
          source: parent,
          data: { type: "multica:route" },
        } as MessageEvent),
      ).toBeNull();
      expect(
        parseParentRouteCommand({
          source: parent,
          data: { type: "multica:route", path: "" },
        } as MessageEvent),
      ).toBeNull();
    });
  });
});

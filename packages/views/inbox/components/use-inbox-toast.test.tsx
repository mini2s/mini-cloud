// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock wiring — must precede the import of the hook under test
// ---------------------------------------------------------------------------

// Capture the subscribe callback so tests can fire WS events on demand.
const wsSubscribers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
const mockPush = vi.hoisted(() => vi.fn());
const mockToastFn = vi.hoisted(() => vi.fn());
// The hook reads pathname on every event; keep it mutable per test.
const navState = { pathname: "/acme/issues", push: mockPush };

vi.mock("@multica/core/realtime", () => ({
  useWS: () => ({
    subscribe: (event: string, handler: (payload: unknown) => void) => {
      wsSubscribers.set(event, handler);
      return () => { wsSubscribers.delete(event); };
    },
  }),
}));

vi.mock("../../navigation", () => ({
  useNavigation: () => navState,
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    inbox: () => "/acme/inbox",
  }),
}));

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (selector: (s: { toast: { view: string } }) => string) =>
      selector({ toast: { view: "View" } }),
  }),
}));

vi.mock("sonner", () => ({
  toast: mockToastFn,
}));

// ---------------------------------------------------------------------------

import { useInboxToast } from "./use-inbox-toast";

// Helper to build a minimal WS payload matching InboxNewPayload shape.
function payload(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      id: "n1",
      issue_id: "issue-1",
      severity: "action_required",
      title: "Test notification",
      body: "Something happened",
      ...overrides,
    },
  };
}

function fireInboxNew(p: unknown) {
  const handler = wsSubscribers.get("inbox:new");
  if (!handler) throw new Error("No subscriber registered for inbox:new");
  handler(p);
}

describe("useInboxToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsSubscribers.clear();
    navState.pathname = "/acme/issues";
  });

  afterEach(() => {
    // Unmount the hook to clear the effect subscription.
  });

  it("shows a toast for non-info notifications when not on the inbox page", () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ severity: "action_required", title: "Hello" }));

    expect(mockToastFn).toHaveBeenCalledTimes(1);
    // First positional arg is the toast title.
    expect(mockToastFn).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({
        description: "Something happened",
        action: expect.objectContaining({
          label: "View",
        }),
      }),
    );

    unmount();
  });

  it("skips toasts when severity is info", () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ severity: "info", title: "Low pri" }));

    expect(mockToastFn).not.toHaveBeenCalled();

    unmount();
  });

  it("skips toasts when the user is on the inbox page (exact match)", () => {
    navState.pathname = "/acme/inbox";
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ severity: "action_required" }));

    expect(mockToastFn).not.toHaveBeenCalled();

    unmount();
  });

  it("skips toasts when the user is on the inbox page with query params", () => {
    navState.pathname = "/acme/inbox?issue=old-1";
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ severity: "action_required" }));

    expect(mockToastFn).not.toHaveBeenCalled();

    unmount();
  });

  it("deduplicates by issue_id within the 30-second window", () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ id: "n1", issue_id: "dup-1", severity: "action_required", title: "First" }));
    fireInboxNew(payload({ id: "n2", issue_id: "dup-1", severity: "action_required", title: "Second" }));

    expect(mockToastFn).toHaveBeenCalledTimes(1);
    expect(mockToastFn).toHaveBeenCalledWith("First", expect.anything());

    unmount();
  });

  it("allows different issue_ids within the dedup window", () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ id: "n1", issue_id: "issue-a", severity: "action_required", title: "A" }));
    fireInboxNew(payload({ id: "n2", issue_id: "issue-b", severity: "action_required", title: "B" }));

    expect(mockToastFn).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('falls back to item.id as dedup key when issue_id is absent', () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ id: "n1", issue_id: null, severity: "action_required", title: "First" }));
    fireInboxNew(payload({ id: "n1", issue_id: null, severity: "action_required", title: "Second" }));

    expect(mockToastFn).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('the "View" action navigates to the inbox with the issue query param', () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew(payload({ id: "n1", issue_id: "nav-1", severity: "action_required", title: "Go" }));

    // Grab the onClick from the toast action and call it.
    const callArgs = mockToastFn.mock.calls[0]!;
    const actionOnClick = callArgs[1].action.onClick as () => void;
    actionOnClick();

    expect(mockPush).toHaveBeenCalledWith("/acme/inbox?issue=nav-1");

    unmount();
  });

  it("skips events where item is nullish", () => {
    const { unmount } = renderHook(() => useInboxToast());

    fireInboxNew({ item: null });
    fireInboxNew({ item: undefined });
    fireInboxNew({});

    expect(mockToastFn).not.toHaveBeenCalled();

    unmount();
  });

  it("cleans up the subscription on unmount", () => {
    const { unmount } = renderHook(() => useInboxToast());
    expect(wsSubscribers.has("inbox:new")).toBe(true);

    unmount();
    expect(wsSubscribers.has("inbox:new")).toBe(false);
  });
});

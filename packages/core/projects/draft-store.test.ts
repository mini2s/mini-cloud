// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useProjectDraftStore } from "./draft-store";
import { setCurrentWorkspace } from "../platform/workspace-storage";

const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

// Node ships a partial `localStorage` shim under jsdom that's missing
// `clear`/`removeItem`; replace it with a real in-memory Storage so persist
// can round-trip values.
beforeAll(() => {
  if (typeof globalThis.localStorage?.clear !== "function") {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (k) => values.get(k) ?? null,
      key: (i) => Array.from(values.keys())[i] ?? null,
      removeItem: (k) => { values.delete(k); },
      setItem: (k, v) => { values.set(k, v); },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }
});

beforeEach(() => {
  localStorage.clear();
  useProjectDraftStore.setState({
    draft: {
      title: "",
      description: "",
      status: "planned",
      priority: "none",
      leadType: undefined,
      leadId: undefined,
      icon: undefined,
      repos: [],
    },
  });
  setCurrentWorkspace(null, null);
});

afterEach(() => {
  setCurrentWorkspace(null, null);
});

describe("useProjectDraftStore migration", () => {
  it("backfills repos: [] for a legacy persisted draft that predates the repos field", async () => {
    // A draft persisted before commit c76717e6d added the `repos` field: stored
    // under version 0 with no `repos` key, so a naive rehydrate leaves
    // draft.repos undefined. The persist migrate must backfill repos: [] so the
    // create-project modal's selectedRepos.length doesn't crash.
    localStorage.setItem(
      "multica_project_draft:acme",
      JSON.stringify({
        state: {
          draft: {
            title: "old title",
            description: "d",
            status: "planned",
            priority: "none",
          },
        },
        version: 0,
      }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();

    const draft = useProjectDraftStore.getState().draft;
    expect(draft.repos).toEqual([]);
    // Non-repos fields are preserved, not wiped.
    expect(draft.title).toBe("old title");
  });
});

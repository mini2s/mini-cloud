import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Agent } from "@multica/core/types";
import type { BuiltinPlugin } from "@multica/core/api";
import { useBoundPlugin } from "./use-bound-plugin";

// hoisted so the mock fn identity is shared between the test and the hook
// (which reaches it via queries.ts → @multica/core/api). vi.mocked() on the
// imported `api` can resolve to a different fn instance and leak across tests.
const pluginApiMocks = vi.hoisted(() => ({
  listBuiltinPlugins: vi.fn(),
  getPlugin: vi.fn(),
}));

vi.mock("@multica/core/api", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, api: { ...real.api, ...pluginApiMocks } };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

function makePlugin(overrides: Record<string, unknown> = {}): BuiltinPlugin {
  return {
    id: "new-uuid",
    slug: "cospowers-task-planning",
    name: "Task Planning",
    version: "1.0.0",
    description: "",
    category: "builtin",
    ...overrides,
  } as unknown as BuiltinPlugin;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    plugin_id: "stale-uuid",
    plugin_name: "cospowers-task-planning",
    ...overrides,
  } as Agent;
}

describe("useBoundPlugin", () => {
  beforeEach(() => {
    pluginApiMocks.listBuiltinPlugins.mockReset();
    pluginApiMocks.getPlugin.mockReset();
  });

  it("recovers the binding by slug when plugin_id is stale (catalog UUID rotated)", async () => {
    pluginApiMocks.listBuiltinPlugins.mockResolvedValue({
      items: [makePlugin({ id: "new-uuid", slug: "cospowers-task-planning" })],
    });
    const { result } = renderHook(() => useBoundPlugin(makeAgent()), { wrapper });
    await waitFor(() => expect(result.current.selected).not.toBeNull());
    expect(result.current.selected?.id).toBe("new-uuid");
    expect(result.current.stale).toBe(false);
  });

  it("prefers an exact id match over the slug fallback", async () => {
    pluginApiMocks.listBuiltinPlugins.mockResolvedValue({
      items: [
        makePlugin({ id: "exact-id", slug: "other-slug" }),
        makePlugin({ id: "new-uuid", slug: "cospowers-task-planning" }),
      ],
    });
    const { result } = renderHook(
      () => useBoundPlugin(makeAgent({ plugin_id: "exact-id" })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.selected).not.toBeNull());
    expect(result.current.selected?.id).toBe("exact-id");
  });

  it("marks stale when id misses and no plugin_name to fall back on", async () => {
    pluginApiMocks.listBuiltinPlugins.mockResolvedValue({ items: [] });
    pluginApiMocks.getPlugin.mockRejectedValue(new Error("404 not found"));
    const { result } = renderHook(
      () => useBoundPlugin(makeAgent({ plugin_name: null })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.selected).toBeNull();
  });
});

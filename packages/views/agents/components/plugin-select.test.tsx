// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enAgents from "../../locales/en/agents.json";

const mockListBuiltinPlugins = vi.hoisted(() => vi.fn());
const mockListCatalogPlugins = vi.hoisted(() => vi.fn());
const mockGetPlugin = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({
  api: {
    listBuiltinPlugins: (...args: unknown[]) => mockListBuiltinPlugins(...args),
    listCatalogPlugins: (...args: unknown[]) => mockListCatalogPlugins(...args),
    getPlugin: (...args: unknown[]) => mockGetPlugin(...args),
  },
}));

import { PluginSelect } from "./plugin-select";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

function renderPluginSelect(onChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={queryClient}>
        <PluginSelect value="" onChange={onChange} />
      </QueryClientProvider>
    </I18nProvider>,
  );

  return { onChange };
}

describe("PluginSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBuiltinPlugins.mockResolvedValue({
      items: [
        {
          id: "builtin-1",
          name: "Built-in One",
          description: "Bundled plugin",
          slug: "builtin-one",
          version: "1.0.0",
          category: "tools",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    mockListCatalogPlugins.mockResolvedValue({
      items: [
        {
          id: "builtin-1",
          name: "Built-in One",
          description: "Bundled plugin",
          slug: "builtin-one",
          version: "1.0.0",
          category: "tools",
        },
        {
          id: "cloud-1",
          name: "Cloud One",
          description: "Cloud plugin",
          slug: "cloud-one",
          version: "1.0.0",
          category: "tools",
        },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    mockGetPlugin.mockResolvedValue(null);
  });

  it("shows distinct cloud plugins after built-ins and selects them", async () => {
    const { onChange } = renderPluginSelect();

    fireEvent.click(screen.getByRole("button", { name: /Select a plugin/i }));

    const builtin = await screen.findByRole("button", { name: /Built-in One/i });
    const cloud = await screen.findByRole("button", { name: /Cloud One/i });
    expect(
      builtin.compareDocumentPosition(cloud) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Cloud plugins")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Built-in One/i })).toHaveLength(1);

    fireEvent.click(cloud);
    expect(onChange).toHaveBeenCalledWith("cloud-1", "cloud-one");
    await waitFor(() => {
      expect(mockListCatalogPlugins).toHaveBeenCalledWith({
        search: "",
        page: 1,
        pageSize: 100,
      });
    });
  });
});

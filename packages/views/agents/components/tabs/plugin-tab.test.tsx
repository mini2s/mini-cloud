// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { Agent } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

const mockListBuiltinPlugins = vi.hoisted(() => vi.fn());
const mockGetPlugin = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listBuiltinPlugins: (...args: unknown[]) => mockListBuiltinPlugins(...args),
    getPlugin: (...args: unknown[]) => mockGetPlugin(...args),
    updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { PluginTab } from "./plugin-tab";

const agent: Agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "Agent",
  description: "",
  instructions: "",
  avatar_url: null,
  runtime_mode: "local",
  runtime_config: {},
  custom_env: {},
  custom_args: [],
  custom_env_redacted: false,
  visibility: "workspace",
  status: "idle",
  max_concurrent_tasks: 1,
  model: "",
  plugin_id: "search-only",
  owner_id: "user-1",
  skills: [],
  created_at: "2026-04-16T00:00:00Z",
  updated_at: "2026-04-16T00:00:00Z",
  archived_at: null,
  archived_by: null,
  is_builtin: false,
};

function renderPluginTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={queryClient}>
        <PluginTab agent={agent} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("PluginTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBuiltinPlugins.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    mockGetPlugin.mockResolvedValue({
      id: "search-only",
      name: "Search Only",
      description: "Only discoverable through item search",
      slug: "search-only",
      version: "1.0.0",
      category: "design",
    });
  });

  it("hydrates a selected plugin missing from the default list", async () => {
    renderPluginTab();

    expect(await screen.findByText("Search Only")).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/i)).not.toBeInTheDocument();
    expect(mockGetPlugin).toHaveBeenCalledWith("search-only");
  });
});

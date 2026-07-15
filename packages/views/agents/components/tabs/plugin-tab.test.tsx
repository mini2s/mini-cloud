// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Agent } from "@multica/core/types";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../../locales/en/common.json";
import enAgents from "../../../locales/en/agents.json";
import { toast } from "sonner";

const TEST_RESOURCES = { en: { common: enCommon, agents: enAgents } };

const mockListBuiltinPlugins = vi.hoisted(() => vi.fn());
const mockGetPlugin = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());
const mockListAgentCloudSkills = vi.hoisted(() => vi.fn());
const mockSetAgentCloudSkills = vi.hoisted(() => vi.fn());
const mockListCatalogSkills = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/api", () => ({
  api: {
    listBuiltinPlugins: (...args: unknown[]) => mockListBuiltinPlugins(...args),
    getPlugin: (...args: unknown[]) => mockGetPlugin(...args),
    updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
    listAgentCloudSkills: (...args: unknown[]) =>
      mockListAgentCloudSkills(...args),
    setAgentCloudSkills: (...args: unknown[]) =>
      mockSetAgentCloudSkills(...args),
    listCatalogSkills: (...args: unknown[]) => mockListCatalogSkills(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Render Popover/PopoverContent inline so the picker rows are queryable
// without simulating a Base UI portal — the content is always in the DOM.
vi.mock("@multica/ui/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ render }: { render?: ReactNode }) =>
    render !== undefined ? <>{render}</> : null,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    mockListAgentCloudSkills.mockResolvedValue([]);
    mockSetAgentCloudSkills.mockResolvedValue([]);
    mockListCatalogSkills.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
  });

  it("hydrates a selected plugin missing from the default list", async () => {
    renderPluginTab();

    expect(await screen.findByText("Search Only")).toBeInTheDocument();
    expect(screen.queryByText(/Unavailable/i)).not.toBeInTheDocument();
    expect(mockGetPlugin).toHaveBeenCalledWith("search-only");
  });

  it("renders the empty cloud skills state when there are no bindings", async () => {
    renderPluginTab();

    expect(await screen.findByText("No skills selected")).toBeInTheDocument();
    expect(mockListAgentCloudSkills).toHaveBeenCalledWith("agent-1");
  });

  it("renders current cloud skill bindings from listAgentCloudSkills", async () => {
    mockListAgentCloudSkills.mockResolvedValue([
      {
        id: "search-skill",
        name: "Web Search",
        description: "Search the web",
        category: "web",
        slug: "search",
        position: 0,
      },
    ]);

    renderPluginTab();

    expect(await screen.findByText("Web Search")).toBeInTheDocument();
    expect(screen.queryByText("No skills selected")).not.toBeInTheDocument();
  });

  it("sends a full replacement ID list when removing a bound cloud skill", async () => {
    mockListAgentCloudSkills.mockResolvedValue([
      { id: "keep", name: "Keep", description: "", position: 0 },
      { id: "remove", name: "Remove", description: "", position: 1 },
    ]);

    renderPluginTab();

    const removeBtn = await screen.findByRole("button", {
      name: "Remove Remove",
    });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(mockSetAgentCloudSkills).toHaveBeenCalledWith("agent-1", {
        // The replacement list keeps "keep" and drops "remove" — never an
        // empty replacement that would wipe unrelated bindings.
        skill_ids: ["keep"],
      });
    });
  });

  it("adds a cloud skill from the picker popover via a full replacement list", async () => {
    mockListAgentCloudSkills.mockResolvedValue([
      { id: "existing", name: "Existing", description: "", position: 0 },
    ]);
    mockListCatalogSkills.mockResolvedValue({
      items: [{ id: "new-skill", name: "New Skill", description: "d" }],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });

    renderPluginTab();

    // The popover content is always rendered by the mock; the available skill
    // appears once the catalog query resolves (already-bound ids excluded).
    const row = await screen.findByRole("button", { name: /New Skill/i });
    fireEvent.click(row);

    await waitFor(() => {
      expect(mockSetAgentCloudSkills).toHaveBeenCalledWith("agent-1", {
        // Full replacement = existing bindings + the newly added id.
        skill_ids: ["existing", "new-skill"],
      });
    });
  });

  it("shows an error toast when adding a cloud skill fails", async () => {
    mockListAgentCloudSkills.mockResolvedValue([
      { id: "existing", name: "Existing", description: "d", position: 0 },
    ]);
    mockListCatalogSkills.mockResolvedValue({
      items: [{ id: "new-skill", name: "New Skill", description: "d" }],
      total: 1,
      page: 1,
      pageSize: 100,
      hasMore: false,
    });
    mockSetAgentCloudSkills
      .mockRejectedValueOnce(new Error("forced scenario 14"))
      .mockResolvedValueOnce([]);

    renderPluginTab();

    const addRows = await screen.findAllByRole("button", { name: /New Skill/i });
    const addRow = addRows[0];
    if (!addRow) throw new Error("expected a cloud skill add row");
    fireEvent.click(addRow);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update skills");
    });
    expect(screen.getByText("Existing")).toBeInTheDocument();

    fireEvent.click(addRow);
    await waitFor(() => {
      expect(mockSetAgentCloudSkills).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith("Skills updated");
    });
  });

  it("shows an error toast when removing a cloud skill fails", async () => {
    mockListAgentCloudSkills.mockResolvedValue([
      { id: "bound-skill", name: "Bound Skill", description: "d", position: 0 },
    ]);
    mockSetAgentCloudSkills
      .mockRejectedValueOnce(new Error("forced scenario 14"))
      .mockResolvedValueOnce([]);

    renderPluginTab();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Bound Skill" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update skills");
    });
    expect(screen.getByText("Bound Skill")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Bound Skill" }),
    );
    await waitFor(() => {
      expect(mockSetAgentCloudSkills).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith("Skills updated");
    });
  });
});

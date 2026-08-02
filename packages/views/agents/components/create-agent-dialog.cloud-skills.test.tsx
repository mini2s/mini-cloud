// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { catalogSkillKeys } from "@multica/core/workspace/queries";
import type {
  Agent,
  CatalogSkill,
  CreateAgentRequest,
  RuntimeDevice,
} from "@multica/core/types";
import { RESOURCES } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";

const mockSetAgentCloudSkills = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({
  api: {
    setAgentCloudSkills: (...args: unknown[]) => mockSetAgentCloudSkills(...args),
  },
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("./plugin-select", () => ({
  PluginSelect: () => null,
}));

vi.mock("../../runtimes/components/provider-logo", () => ({
  ProviderLogo: () => null,
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { CreateAgentDialog } from "./create-agent-dialog";

const navigationStub: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/test/agents",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path: string) => path,
};

const runtime: RuntimeDevice = {
  id: "runtime-1",
  workspace_id: "ws-1",
  daemon_id: null,
  name: "Test Runtime",
  runtime_mode: "local",
  provider: "codex",
  launch_header: "",
  status: "online",
  device_info: "host.local",
  metadata: {},
  owner_id: "user-1",
  visibility: "private",
  last_seen_at: "2026-07-16T00:00:00Z",
  created_at: "2026-07-16T00:00:00Z",
  updated_at: "2026-07-16T00:00:00Z",
};

const catalogSkill: CatalogSkill = {
  id: "web-search",
  name: "Web Search",
  description: "Search the public web",
  slug: "web-search",
  version: "1.0.0",
  category: "web",
};

function makeCreatedAgent(): Agent {
  return {
    id: "created-agent",
    workspace_id: "ws-1",
    runtime_id: runtime.id,
    name: "Research Agent",
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
    plugin_id: null,
    owner_id: "user-1",
    skills: [],
    created_at: "2026-07-16T00:00:00Z",
    updated_at: "2026-07-16T00:00:00Z",
    archived_at: null,
    archived_by: null,
    is_builtin: false,
  };
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(catalogSkillKeys.list(""), {
    items: [catalogSkill],
    total: 1,
    page: 1,
    pageSize: 20,
    hasMore: false,
  });

  const onCreate = vi.fn().mockResolvedValue(makeCreatedAgent());
  const onClose = vi.fn();

  const view = render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceSlugProvider slug="test">
          <NavigationProvider value={navigationStub}>
            <CreateAgentDialog
              runtimes={[runtime]}
              members={[]}
              currentUserId="user-1"
              onClose={onClose}
              onCreate={onCreate as (data: CreateAgentRequest) => Promise<Agent>}
            />
          </NavigationProvider>
        </WorkspaceSlugProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );

  return { onCreate, onClose, ...view };
}

describe("CreateAgentDialog cloud skills", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("selects a catalog skill and binds it after the agent is created", async () => {
    mockSetAgentCloudSkills.mockResolvedValue([]);
    const { onCreate } = renderDialog();

    fireEvent.change(screen.getByPlaceholderText("e.g. Deep Research Digital Human"), {
      target: { value: "Research Agent" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    fireEvent.click(await screen.findByRole("button", { name: /Web Search/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(mockSetAgentCloudSkills).toHaveBeenCalledWith("created-agent", {
      skill_ids: ["web-search"],
    });
  });
});

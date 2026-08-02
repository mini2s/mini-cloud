import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const mockUpdateWorkspace = vi.hoisted(() => vi.fn());
const workspaceRef = vi.hoisted(() => ({
  current: {
    id: "workspace-1",
    name: "Test Workspace",
    slug: "test-workspace",
    repos: [] as { url: string }[],
  },
}));
const membersRef = vi.hoisted(() => ({
  current: [{ user_id: "user-1", role: "owner" as const }],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: membersRef.current }),
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => workspaceRef.current }));
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"], queryFn: vi.fn() }),
  workspaceKeys: { list: () => ["workspaces"] },
}));
vi.mock("@multica/core/api", () => ({ api: { updateWorkspace: mockUpdateWorkspace } }));
vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: { id: string } }) => unknown) =>
      sel ? sel({ user: { id: "user-1" } }) : { user: { id: "user-1" } },
    { getState: () => ({ user: { id: "user-1" } }) },
  );
  return { useAuthStore };
});
const mockToastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: vi.fn() } }));

import { RepositoriesSection } from "./repositories-section";

const TEST_RESOURCES = { en: { common: enCommon, settings: enSettings } };
function I18nWrapper({ children }: { children: ReactNode }) {
  return <I18nProvider locale="en" resources={TEST_RESOURCES}>{children}</I18nProvider>;
}

describe("RepositoriesSection host sharding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membersRef.current = [{ user_id: "user-1", role: "owner" }];
  });

  it("host='github' only renders github.com repos", () => {
    workspaceRef.current = {
      ...workspaceRef.current,
      repos: [
        { url: "https://github.com/org/a" },
        { url: "https://gitlab.example.com/org/b" },
      ],
    };
    render(<RepositoriesSection host="github" />, { wrapper: I18nWrapper });
    expect(screen.getByText("https://github.com/org/a")).toBeTruthy();
    expect(screen.queryByText("https://gitlab.example.com/org/b")).toBeNull();
  });

  it("host='other' only renders non-github repos", () => {
    workspaceRef.current = {
      ...workspaceRef.current,
      repos: [
        { url: "https://github.com/org/a" },
        { url: "https://gitlab.example.com/org/b" },
      ],
    };
    render(<RepositoriesSection host="other" />, { wrapper: I18nWrapper });
    expect(screen.getByText("https://gitlab.example.com/org/b")).toBeTruthy();
    expect(screen.queryByText("https://github.com/org/a")).toBeNull();
  });

  it("adding a URL of the OTHER host saves it and it disappears from this view (input routing)", async () => {
    const user = userEvent.setup();
    workspaceRef.current = { ...workspaceRef.current, repos: [] };
    mockUpdateWorkspace.mockImplementation(async (_id: string, payload: { repos: { url: string }[] }) => {
      workspaceRef.current = { ...workspaceRef.current, repos: payload.repos };
      return workspaceRef.current;
    });

    render(<RepositoriesSection host="github" />, { wrapper: I18nWrapper });
    await user.click(screen.getByRole("button", { name: /Add repository/ }));
    await user.type(screen.getByRole("textbox"), "https://gitlab.example.com/org/routed");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => {
      expect(mockUpdateWorkspace).toHaveBeenCalledWith("workspace-1", {
        repos: [{ url: "https://gitlab.example.com/org/routed" }],
      });
    });
    expect(screen.queryByText("https://gitlab.example.com/org/routed")).toBeNull();
    // Routed-away URL triggers the routed toast (not the plain saved toast).
    expect(mockToastSuccess).toHaveBeenCalledWith(
      enSettings.repositories.routed_to_other_tab,
    );
  });
});

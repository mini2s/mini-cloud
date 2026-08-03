import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";

const workspaceRef = vi.hoisted(() => ({
  current: {
    id: "workspace-1",
    name: "Test Workspace",
    slug: "test-workspace",
    repos: [],
    settings: { code_platform: "github" },
  },
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => workspaceRef.current,
}));

const authRef = vi.hoisted(() => ({
  user: {
    id: "user-1",
    can_manage_workflows: false,
    workflow_admin_source: "local",
  } as { id: string; can_manage_workflows: boolean; workflow_admin_source: string },
}));

vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: typeof authRef.user }) => unknown) =>
      sel ? sel({ user: authRef.user }) : { user: authRef.user },
    { getState: () => ({ user: authRef.user }) },
  );
  return { useAuthStore };
});

vi.mock("./account-tab", () => ({ AccountTab: () => <div>Profile content</div> }));
vi.mock("./preferences-tab", () => ({ PreferencesTab: () => <div>Preferences content</div> }));
vi.mock("./notifications-tab", () => ({ NotificationsTab: () => <div>Notifications content</div> }));
// Hidden: API tokens tab removed.
// vi.mock("./tokens-tab", () => ({ TokensTab: () => <div>Tokens content</div> }));
vi.mock("./workspace-tab", () => ({ WorkspaceTab: () => <div>Workspace content</div> }));
vi.mock("./github-tab", () => ({ GitHubTab: () => <div>GitHub content</div> }));
vi.mock("./gitlab-tab", () => ({ GitlabTab: () => <div>GitLab content</div> }));
vi.mock("./workflow-roles-tab", () => ({ WorkflowRolesTab: () => <div>Roles content</div> }));
vi.mock("./workflow-admins-tab", () => ({
  WorkflowAdminsTab: () => <div>Workflow admins content</div>,
}));

import { SettingsPage } from "./settings-page";

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

function TestWrapper({ children }: { children: ReactNode }) {
  const navigation: NavigationAdapter = {
    pathname: "/test-workspace/settings",
    searchParams: new URLSearchParams(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    getShareableUrl: (path) => `https://example.test${path}`,
  };

  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <NavigationProvider value={navigation}>{children}</NavigationProvider>
    </I18nProvider>
  );
}

describe("SettingsPage workspace integration tabs", () => {
  beforeEach(() => {
    workspaceRef.current = {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
      repos: [],
      settings: { code_platform: "github" },
    };
    authRef.user = {
      id: "user-1",
      can_manage_workflows: false,
      workflow_admin_source: "local",
    };
  });

  it("shows both GitHub and GitLab tabs for every workspace (no code_platform hiding), no repositories tab", () => {
    workspaceRef.current = {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
      repos: [],
      settings: { code_platform: "github" },
    };
    render(<SettingsPage />, { wrapper: TestWrapper });
    const tabList = screen.getByRole("tablist");
    expect(within(tabList).getByRole("tab", { name: "GitHub" })).toBeTruthy();
    expect(within(tabList).getByRole("tab", { name: "GitLab" })).toBeTruthy();
    expect(within(tabList).queryByRole("tab", { name: "Repositories" })).toBeNull();
  });

  it("?tab=repositories falls back to the default tab (no such route)", () => {
    const navigation: NavigationAdapter = {
      pathname: "/test-workspace/settings",
      searchParams: new URLSearchParams("tab=repositories"),
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      getShareableUrl: (path) => `https://example.test${path}`,
    };
    render(
      <I18nProvider locale="en" resources={TEST_RESOURCES}>
        <NavigationProvider value={navigation}><SettingsPage /></NavigationProvider>
      </I18nProvider>,
    );
    expect(screen.getByText("Profile content")).toBeTruthy();
  });
});

describe("SettingsPage workflow-admins tab visibility", () => {
  beforeEach(() => {
    authRef.user = {
      id: "user-1",
      can_manage_workflows: false,
      workflow_admin_source: "local",
    };
  });

  it("shows the workflow-admins tab for local workflow admins", async () => {
    authRef.user = {
      id: "user-1",
      can_manage_workflows: true,
      workflow_admin_source: "local",
    };
    render(<SettingsPage />, { wrapper: TestWrapper });
    expect(await screen.findByRole("tab", { name: /workflow admin/i })).toBeInTheDocument();
  });

  it("hides the workflow-admins tab in platform mode even for platform admins", () => {
    authRef.user = {
      id: "user-1",
      can_manage_workflows: true,
      workflow_admin_source: "platform",
    };
    render(<SettingsPage />, { wrapper: TestWrapper });
    expect(screen.queryByRole("tab", { name: /workflow admin/i })).not.toBeInTheDocument();
  });
});

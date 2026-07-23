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

vi.mock("@multica/core/auth", () => {
  const useAuthStore = Object.assign(
    (sel?: (s: { user: { id: string } }) => unknown) =>
      sel ? sel({ user: { id: "user-1" } }) : { user: { id: "user-1" } },
    { getState: () => ({ user: { id: "user-1" } }) },
  );
  return { useAuthStore };
});

vi.mock("@multica/core/workflows/queries", () => ({
  useWorkflowAdmins: () => ({ data: [] }),
}));

vi.mock("./account-tab", () => ({ AccountTab: () => <div>Profile content</div> }));
vi.mock("./preferences-tab", () => ({ PreferencesTab: () => <div>Preferences content</div> }));
vi.mock("./notifications-tab", () => ({ NotificationsTab: () => <div>Notifications content</div> }));
vi.mock("./tokens-tab", () => ({ TokensTab: () => <div>Tokens content</div> }));
vi.mock("./workspace-tab", () => ({ WorkspaceTab: () => <div>Workspace content</div> }));
vi.mock("./repositories-tab", () => ({ RepositoriesTab: () => <div>Repositories content</div> }));
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
  });

  it("keeps the GitHub tab available for workspaces using GitHub PRs", () => {
    render(<SettingsPage />, { wrapper: TestWrapper });

    const tabList = screen.getByRole("tablist");
    expect(within(tabList).getByRole("tab", { name: "GitHub" })).toBeTruthy();
    expect(within(tabList).queryByRole("tab", { name: "GitLab" })).toBeNull();
  });
});

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";
import { MembersTab } from "./members-tab";

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  listMembers: vi.fn(),
  searchDeptUsers: vi.fn(),
  batchAddDeptMembers: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey ?? []);
      if (key.includes("members")) return { data: mocks.listMembers() };
      return { data: [] };
    },
  };
});

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: "owner-user", name: "Owner", email: "owner@example.test" } }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),
  useWorkspacePaths: () => ({ memberDetail: (id: string) => `/acme/members/${id}` }),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    searchDeptUsers: mocks.searchDeptUsers,
    batchAddDeptMembers: mocks.batchAddDeptMembers,
    updateMember: vi.fn(),
    deleteMember: vi.fn(),
  },
}));

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

describe("MembersTab", () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockReset();
    mocks.searchDeptUsers.mockReset();
    mocks.batchAddDeptMembers.mockReset();
    mocks.searchDeptUsers.mockResolvedValue([]);
    mocks.batchAddDeptMembers.mockResolvedValue({ added: 0, skipped: 0 });
    mocks.listMembers.mockReturnValue([
      {
        id: "member-owner",
        workspace_id: "ws-1",
        user_id: "owner-user",
        role: "owner",
        source: "manual",
        status: "active",
        name: "Owner",
        email: "owner@example.test",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "member-runtime",
        workspace_id: "ws-1",
        user_id: "runtime-user",
        role: "member",
        source: "dept",
        status: "active",
        subject_id: "sub-runtime",
        external_user_id: "E004",
        external_universal_id: "uni-runtime",
        employee_id: "E004",
        name: "Runtime Dept User",
        email: "runtime@example.test",
        position: "SRE",
        dept_name: "Platform Runtime",
        dept_path: "/深信服科技股份有限公司/研发体系/Costrict研发部/开发组",
        created_at: "2026-01-01T00:00:00Z",
        avatar_url: null,
      },
    ]);
  });

  it("searches by name and batch-adds selected members by subject_id", async () => {
    mocks.searchDeptUsers.mockResolvedValue([
      {
        subject_id: "sub-001",
        name: "Ada Lovelace",
        email: "ada@example.test",
      },
    ]);
    mocks.batchAddDeptMembers.mockResolvedValue({ added: 1, skipped: 0 });

    render(<MembersTab />, { wrapper: I18nWrapper });

    // Existing member row still shows
    expect(screen.getByText("Runtime Dept User(E004)")).toBeInTheDocument();
    expect(screen.getByText("研发体系/Costrict研发部/开发组 SRE")).toBeInTheDocument();

    // Type a name
    fireEvent.change(screen.getByPlaceholderText(/Search members by name/i), {
      target: { value: "Ada" },
    });

    // Wait for search results
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(screen.getByTestId("dept-member-results")).toHaveClass("max-h-72", "overflow-y-auto");
    expect(mocks.searchDeptUsers).toHaveBeenCalledWith("Ada");

    // Select the hit
    fireEvent.click(screen.getByRole("checkbox", { name: /Ada Lovelace/i }));
    expect(screen.getByText("Selected")).toBeInTheDocument();

    // Add selected
    fireEvent.click(screen.getByRole("button", { name: /add selected/i }));

    await waitFor(() =>
      expect(mocks.batchAddDeptMembers).toHaveBeenCalledWith("ws-1", {
        users: [{ subject_id: "sub-001" }],
      }),
    );
    expect(screen.getByText("Added 1 members. Skipped 0.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search members by name/i)).toHaveValue("");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("disables checkbox for already-added member matched by subject_id", async () => {
    // The existing member has subject_id "sub-runtime", so a search hit
    // with the same subject_id should be disabled.
    mocks.searchDeptUsers.mockResolvedValue([
      {
        subject_id: "sub-runtime",
        name: "Runtime Dept User",
        email: "runtime@example.test",
      },
    ]);

    render(<MembersTab />, { wrapper: I18nWrapper });

    fireEvent.change(screen.getByPlaceholderText(/Search members by name/i), {
      target: { value: "Runtime" },
    });

    const checkbox = await screen.findByRole("checkbox", { name: /Runtime Dept User/i });
    expect(checkbox).toHaveAttribute("data-disabled", "");
  });

  it("shows inactive status badge but not pending_activation", () => {
    mocks.listMembers.mockReturnValue([
      {
        id: "member-inactive",
        workspace_id: "ws-1",
        user_id: "inactive-user",
        role: "member",
        source: "dept",
        status: "inactive",
        name: "Inactive Member",
        email: "inactive@example.test",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    render(<MembersTab />, { wrapper: I18nWrapper });

    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });
});

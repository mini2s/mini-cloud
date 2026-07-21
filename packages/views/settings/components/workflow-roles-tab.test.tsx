// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRolesTab } from "./workflow-roles-tab";

const mocks = vi.hoisted(() => ({
  userId: "user-1",
  members: [] as Array<Record<string, unknown>>,
  roles: [] as Array<Record<string, unknown>>,
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => ({
    data: opts.queryKey.includes("members") ? mocks.members : mocks.roles,
    isLoading: false,
  }),
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: mocks.userId } }),
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"] }),
}));
vi.mock("@multica/core/workflows/queries", () => ({
  workflowRolesOptions: () => ({ queryKey: ["roles"] }),
  useCreateWorkflowRole: () => ({ mutateAsync: mocks.createRole, isPending: false }),
  useUpdateWorkflowRole: () => ({ mutateAsync: mocks.updateRole, isPending: false }),
  useDeleteWorkflowRole: () => ({ mutateAsync: mocks.deleteRole, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../../i18n", () => {
  const workflow_roles = {
    title: "Workflow roles", description: "Manage reusable roles", read_only: "Read only",
    name_required: "Name required", name_too_long: "Name too long",
    name_duplicate: "Conflicts with existing role", name_duplicate_builtin: "Conflicts with built-in role",
    description_required: "Description required", description_too_long: "Description too long",
    edit_title: "Edit role", create_title: "Create role", cancel: "Cancel",
    name_label: "Role name", name_placeholder: "Name", description_label: "Responsibilities",
    description_placeholder: "Description", update: "Update", create: "Create",
    loading: "Loading", empty: "No roles", builtin_read_only: "Built-in role is read only",
    referenced_cannot_delete: "Role is referenced", builtin: "Built in",
    needs_description: "Needs description", no_description: "No description",
    edit: "Edit", delete: "Delete", delete_title: "Delete role", delete_description: "Delete role?",
    toast_updated: "Updated", toast_created: "Created", toast_save_failed: "Save failed",
    toast_deleted: "Deleted", toast_delete_failed: "Delete failed",
  };
  const builtin_roles = {
    developer: { name: "Developer", description: "Builds changes" },
    qa: { name: "QA", description: "Validates changes" },
    tech_lead: { name: "Tech Lead", description: "Tech direction" },
  };
  return {
    useT: (namespace: "settings" | "workflows") => ({
      t: (selector: (value: { workflow_roles: typeof workflow_roles; builtin_roles: typeof builtin_roles }) => string) =>
        selector(namespace === "settings" ? { workflow_roles, builtin_roles } : { workflow_roles, builtin_roles }),
    }),
  };
});

const customRole = {
  id: "role-1", workspace_id: "ws-1", name: "Developer", description: "Builds changes",
  is_builtin: false, needs_description: false, is_referenced: false,
  created_by: "user-1", created_at: "", updated_at: "",
};

describe("WorkflowRolesTab", () => {
  beforeEach(() => {
    mocks.members = [{ user_id: "user-1", name: "Owner", role: "owner", status: "active" }];
    mocks.roles = [customRole];
    mocks.createRole.mockReset().mockResolvedValue(customRole);
    mocks.updateRole.mockReset().mockResolvedValue(customRole);
    mocks.deleteRole.mockReset().mockResolvedValue(undefined);
  });

  it("lets owners create a trimmed role with required fields", async () => {
    render(<WorkflowRolesTab />);
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "  Backend Engineer  " } });
    fireEvent.change(screen.getByLabelText("Responsibilities"), { target: { value: "  Validates changes  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mocks.createRole).toHaveBeenCalledWith({ name: "Backend Engineer", description: "Validates changes" }));
  });

  it("is read-only for ordinary members", () => {
    mocks.members = [{ user_id: "user-1", name: "Member", role: "member", status: "active" }];
    render(<WorkflowRolesTab />);
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role name")).not.toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
  });

  it("disables deletion for referenced custom roles and hides built-in editing", () => {
    mocks.roles = [
      { ...customRole, is_referenced: true },
      { ...customRole, id: "builtin-1", name: "qa", is_builtin: true, is_referenced: false },
    ];
    render(<WorkflowRolesTab />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("Role is referenced")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });

  it("rejects a duplicate of an existing custom role's name when creating", () => {
    mocks.roles = [{ ...customRole, name: "Frontend Engineer" }];
    render(<WorkflowRolesTab />);
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "frontend engineer" } });
    fireEvent.change(screen.getByLabelText("Responsibilities"), { target: { value: "Some responsibilities" } });
    expect(screen.getByText("Conflicts with existing role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("rejects a built-in identifier even when no visible role uses that raw name", () => {
    // Pathological state: workspace somehow lost its seeded built-in row.
    // The identifier is still reserved so a custom role can't claim it.
    mocks.roles = [];
    render(<WorkflowRolesTab />);
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "developer" } });
    fireEvent.change(screen.getByLabelText("Responsibilities"), { target: { value: "Some responsibilities" } });
    expect(screen.getByText("Conflicts with built-in role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("rejects a case-variant of a visible built-in role's name when creating", () => {
    // The mocked i18n renders the developer built-in role as "Developer".
    // A user typing that exact display string must be told it collides —
    // previously the validation only checked the underlying raw "developer"
    // identifier, so the user saw "Developer" in the list and got a confusing
    // 409 when typing the very same label.
    mocks.roles = [{ ...customRole, id: "builtin-dev", name: "developer", is_builtin: true }];
    render(<WorkflowRolesTab />);
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Developer" } });
    fireEvent.change(screen.getByLabelText("Responsibilities"), { target: { value: "Some responsibilities" } });
    expect(screen.getByText("Conflicts with built-in role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("allows editing a custom role to keep its own current name", () => {
    mocks.roles = [{ ...customRole, name: "Frontend Engineer" }];
    render(<WorkflowRolesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Without changing anything, the inline save should remain enabled —
    // the duplicate check excludes the role being edited.
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@multica/core/types";
import { ProjectLeadPicker } from "./project-lead-picker";

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const key = options.queryKey ?? [];
    if (key.includes("members")) {
      return {
        data: [
          {
            id: "member-1",
            user_id: "user-1",
            name: "Member Lead",
            status: "active",
          },
        ],
      };
    }
    if (key.includes("agents")) {
      return {
        data: [
          {
            id: "agent-1",
            name: "Agent Lead",
            archived_at: null,
          },
        ],
      };
    }
    return { data: [] };
  },
}));

vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => null }),
}));

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (selector: (value: any) => string) =>
      selector({
        lead: {
          assign_placeholder: "Assign lead",
          no_lead: "No lead",
          members_group: "Members",
          agents_group: "Agents",
          no_results: "No results",
        },
      }),
  }),
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <span data-testid="actor-avatar" />,
}));

vi.mock("@multica/ui/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const project: Project = {
  id: "project-1",
  workspace_id: "workspace-1",
  title: "Project",
  description: null,
  icon: null,
  status: "planned",
  priority: "medium",
  lead_type: null,
  lead_id: null,
  issue_count: 0,
  done_count: 0,
  resource_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("ProjectLeadPicker", () => {
  it("only offers workspace members as project leads", () => {
    render(
      <ProjectLeadPicker
        project={project}
        handleUpdate={vi.fn()}
        renderTrigger={() => <button type="button">Lead</button>}
      />,
    );

    expect(screen.getByText("Member Lead")).toBeInTheDocument();
    expect(screen.queryByText("Agent Lead")).not.toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
  });
});

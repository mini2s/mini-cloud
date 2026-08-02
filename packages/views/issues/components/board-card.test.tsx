import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@multica/core/types";
import { BoardCardContent } from "./board-card";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@multica/core/issues/mutations", () => ({
  useUpdateIssue: () => ({ mutate: vi.fn() }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ issueDetail: (id: string) => `/issues/${id}` }),
}));

vi.mock("@multica/core/projects/queries", () => ({
  projectListOptions: () => ({ queryKey: ["projects"], queryFn: vi.fn() }),
}));

vi.mock("@multica/core/issues/stores/view-store-context", () => ({
  useViewStore: (selector: any) =>
    selector({
      cardProperties: {
        priority: true,
        description: false,
        assignee: true,
        startDate: false,
        dueDate: false,
        project: false,
        childProgress: false,
        labels: false,
      },
    }),
}));

vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (selector: any) =>
      selector({
        card: {
          responsible: "Owner",
          assignee: "Assignee",
          update_failed: "Update failed",
        },
        priority: {
          medium: "Medium",
        },
      }),
  }),
}));

vi.mock("./issue-people-badges", () => ({
  IssuePeopleBadges: () => <span>People roles</span>,
}));

vi.mock("./pickers", () => ({
  PriorityPicker: ({ trigger }: { trigger: React.ReactNode }) => trigger,
  StartDatePicker: ({ trigger }: { trigger: React.ReactNode }) => trigger,
  DueDatePicker: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

vi.mock("./issue-agent-activity-indicator", () => ({
  IssueAgentActivityIndicator: () => null,
}));

const issue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  number: 1,
  identifier: "MUL-1",
  title: "Place people after priority",
  description: null,
  status: "todo",
  priority: "medium",
  assignee_type: "agent",
  assignee_id: "agent-1",
  responsible_user_id: "user-1",
  creator_type: "member",
  creator_id: "user-1",
  parent_issue_id: null,
  project_id: null,
  workflow_id: null,
  workflow_run_id: null,
  stage_id: null,
  position: 1,
  start_date: null,
  due_date: null,
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("BoardCardContent", () => {
  it("renders people roles to the right of the priority badge", () => {
    render(<BoardCardContent issue={issue} />);

    const priority = screen.getByText("Medium");
    const people = screen.getByText("People roles");

    expect(
      priority.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

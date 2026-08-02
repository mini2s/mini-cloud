import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@multica/core/types";
import { IssuePeopleBadges } from "./issue-people-badges";

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (type: string, id: string) => {
      if (type === "member" && id === "user-1") return "Alice Owner";
      if (type === "agent" && id === "agent-1") return "Claude Worker";
      return "Unknown";
    },
  }),
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorType, actorId }: { actorType: string; actorId: string }) => (
    <span data-testid={`avatar-${actorType}-${actorId}`} />
  ),
}));

const baseIssue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  number: 1,
  identifier: "MUL-1",
  title: "Show people",
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

describe("IssuePeopleBadges", () => {
  it("renders two avatars and keeps responsible and assignee names in the hover tooltip", () => {
    render(
      <IssuePeopleBadges
        issue={baseIssue}
        responsibleLabel="Owner"
        assigneeLabel="Assignee"
      />,
    );

    expect(screen.getAllByText("Owner")).toHaveLength(2);
    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-member-user-1")).toBeInTheDocument();
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    expect(screen.getAllByText("Assignee")).toHaveLength(2);
    expect(screen.getByText("Claude Worker")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-agent-agent-1")).toBeInTheDocument();
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });
});

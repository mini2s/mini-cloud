import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@multica/core/types";
import { IssuePeopleBadges } from "./issue-people-badges";

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (type: string, id: string) => {
      if (type === "member" && id === "user-1") return "Alice Owner";
      if (type === "agent" && id === "agent-1") return "Claude Worker";
      if (type === "squad" && id === "squad-1") return "Review Squad";
      if (type === "workflow" && id === "workflow-1") return "Release Workflow";
      return "Unknown";
    },
    getActorInitials: (type: string, id: string) => {
      if (type === "member" && id === "user-1") return "AO";
      if (type === "agent" && id === "agent-1") return "CW";
      if (type === "squad" && id === "squad-1") return "RS";
      if (type === "workflow" && id === "workflow-1") return "RW";
      return "?";
    },
  }),
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
        actorTypeLabels={{
          member: "Member",
          agent: "Digital Human",
          squad: "Squad",
          workflow: "Workflow",
        }}
      />,
    );

    expect(screen.getAllByText("Owner")).toHaveLength(2);
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByTestId("actor-tile-member-user-1")).toHaveClass(
      "rounded-[4px]",
      "bg-primary/10",
    );
    expect(screen.getByTestId("actor-tile-member-user-1-detail")).toHaveClass(
      "rounded-[4px]",
      "bg-primary/10",
    );
    expect(screen.getAllByLabelText("member icon")).toHaveLength(2);
    expect(screen.getAllByText("A")).toHaveLength(2);
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    expect(screen.getAllByText("Assignee")).toHaveLength(2);
    expect(screen.getByText("Digital Human")).toBeInTheDocument();
    expect(screen.getByText("Claude Worker")).toBeInTheDocument();
    expect(screen.getByTestId("actor-tile-agent-agent-1")).toHaveClass(
      "rounded-[4px]",
      "bg-info/10",
    );
    expect(screen.getByTestId("actor-tile-agent-agent-1-detail")).toHaveClass(
      "rounded-[4px]",
      "bg-info/10",
    );
    expect(screen.getAllByLabelText("agent icon")).toHaveLength(2);
    expect(screen.getAllByText("C")).toHaveLength(2);
  });

  it("distinguishes member, squad, agent, and workflow types in the hover tooltip", () => {
    const cases = [
      { type: "member", id: "user-1", label: "Member" },
      { type: "agent", id: "agent-1", label: "Digital Human" },
      { type: "squad", id: "squad-1", label: "Squad" },
      { type: "workflow", id: "workflow-1", label: "Workflow" },
    ];

    for (const item of cases) {
      const issue = {
        ...baseIssue,
        responsible_user_id: null,
        assignee_type: item.type,
        assignee_id: item.id,
      } as Issue;
      const { unmount } = render(
        <IssuePeopleBadges
          issue={issue}
          responsibleLabel="Owner"
          assigneeLabel="Assignee"
          actorTypeLabels={{
            member: "Member",
            agent: "Digital Human",
            squad: "Squad",
            workflow: "Workflow",
          }}
        />,
      );

      expect(screen.getByTestId(`actor-tile-${item.type}-${item.id}`)).toHaveClass(
        "rounded-[4px]",
      );
      expect(screen.getByTestId(`actor-tile-${item.type}-${item.id}-detail`)).toHaveClass(
        "rounded-[4px]",
      );
      expect(screen.getAllByLabelText(`${item.type} icon`)).toHaveLength(2);
      expect(screen.getByText(item.label)).toBeInTheDocument();

      unmount();
    }
  });
});

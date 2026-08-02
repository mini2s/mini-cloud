import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Issue } from "@multica/core/types";
import { IssuePeopleBadges } from "./issue-people-badges";

const mockedAssigneePickers: Array<{
  allowedTypes?: string[];
  allowUnassigned?: boolean;
  onUpdate: (updates: Record<string, unknown>) => void;
}> = [];

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

vi.mock("./pickers", () => ({
  AssigneePicker: ({
    trigger,
    triggerRender,
    allowedTypes,
    allowUnassigned,
    onUpdate,
  }: {
    trigger: ReactNode;
    triggerRender?: ReactElement<{ className?: string }>;
    allowedTypes?: string[];
    allowUnassigned?: boolean;
    onUpdate: (updates: Record<string, unknown>) => void;
  }) => {
    mockedAssigneePickers.push({ allowedTypes, allowUnassigned, onUpdate });
    return (
      <span
        data-testid="assignee-picker"
        data-trigger-class={triggerRender?.props.className ?? ""}
      >
        {trigger}
      </span>
    );
  },
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
  beforeEach(() => {
    mockedAssigneePickers.length = 0;
  });

  it("renders two actor tiles and keeps responsible and assignee names in the hover tooltip", () => {
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

    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByTestId("actor-tile-member-user-1")).toHaveClass(
      "rounded-[4px]",
      "bg-primary/10",
    );
    expect(
      screen.queryByTestId("actor-tile-member-user-1-detail"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("member icon")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Claude Worker")).toBeInTheDocument();
    expect(screen.getByTestId("actor-tile-agent-agent-1")).toHaveClass(
      "rounded-[4px]",
      "bg-info/10",
    );
    expect(
      screen.queryByTestId("actor-tile-agent-agent-1-detail"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("agent icon")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("keeps member, squad, agent, and workflow type icons on the card tile only", () => {
    const cases = [
      { type: "member", id: "user-1", name: "Alice Owner" },
      { type: "agent", id: "agent-1", name: "Claude Worker" },
      { type: "squad", id: "squad-1", name: "Review Squad" },
      { type: "workflow", id: "workflow-1", name: "Release Workflow" },
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
      expect(
        screen.queryByTestId(`actor-tile-${item.type}-${item.id}-detail`),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText(`${item.type} icon`)).toBeInTheDocument();
      expect(screen.getByText(item.name)).toBeInTheDocument();

      unmount();
    }
  });

  it("keeps each role hover scoped to that actor detail", () => {
    render(
      <IssuePeopleBadges
        issue={baseIssue}
        responsibleLabel="Owner"
        assigneeLabel="Assignee"
        actorTypeLabels={{
          member: "Member",
          agent: "Digital Human",
        }}
      />,
    );

    const responsible = screen.getByLabelText("Alice Owner");
    const assignee = screen.getByLabelText("Claude Worker");

    expect(responsible).toHaveTextContent("Owner");
    expect(responsible).toHaveTextContent("Alice Owner");
    expect(responsible).not.toHaveTextContent("Member");
    expect(responsible).not.toHaveTextContent("Assignee");
    expect(responsible).not.toHaveTextContent("Digital Human");
    expect(responsible).not.toHaveTextContent("Claude Worker");
    expect(assignee).toHaveTextContent("Assignee");
    expect(assignee).toHaveTextContent("Claude Worker");
    expect(assignee).not.toHaveTextContent("Digital Human");
    expect(assignee).not.toHaveTextContent("Owner");
    expect(assignee).not.toHaveTextContent("Member");
    expect(assignee).not.toHaveTextContent("Alice Owner");
  });

  it("aligns each hover detail to its actor tile", () => {
    render(
      <IssuePeopleBadges
        issue={baseIssue}
        responsibleLabel="Owner"
        assigneeLabel="Assignee"
      />,
    );

    const responsibleTile = screen.getByTestId("actor-tile-member-user-1");
    const responsibleTooltip = screen.getByTestId("actor-tooltip-member-user-1");
    const assigneeTile = screen.getByTestId("actor-tile-agent-agent-1");
    const assigneeTooltip = screen.getByTestId("actor-tooltip-agent-agent-1");

    expect(responsibleTooltip.parentElement).toHaveClass("relative");
    expect(responsibleTooltip.parentElement).toContainElement(responsibleTile);
    expect(assigneeTooltip.parentElement).toHaveClass("relative");
    expect(assigneeTooltip.parentElement).toContainElement(assigneeTile);
  });

  it("keeps the editable picker trigger from clipping the hover details", () => {
    render(
      <IssuePeopleBadges
        issue={baseIssue}
        responsibleLabel="Owner"
        assigneeLabel="Assignee"
        actorTypeLabels={{
          member: "Member",
          agent: "Digital Human",
        }}
        editableAssignee
        onAssigneeUpdate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("assignee-picker")).toHaveAttribute(
      "data-trigger-class",
      expect.stringContaining("overflow-visible"),
    );
    expect(
      screen.getByLabelText("Claude Worker"),
    ).not.toHaveAttribute("title");
  });

  it("limits the editable responsible picker to members", () => {
    const onResponsibleUpdate = vi.fn();
    const onAssigneeUpdate = vi.fn();
    render(
      <IssuePeopleBadges
        issue={baseIssue}
        responsibleLabel="Owner"
        assigneeLabel="Assignee"
        editableResponsible
        editableAssignee
        onResponsibleUpdate={onResponsibleUpdate}
        onAssigneeUpdate={onAssigneeUpdate}
      />,
    );

    expect(mockedAssigneePickers).toHaveLength(2);
    expect(mockedAssigneePickers[0]).toMatchObject({
      allowedTypes: ["member"],
      allowUnassigned: false,
    });

    mockedAssigneePickers[0]!.onUpdate({
      assignee_type: "member",
      assignee_id: "user-2",
    });

    expect(onResponsibleUpdate).toHaveBeenCalledWith({
      responsible_user_id: "user-2",
    });
    expect(onAssigneeUpdate).not.toHaveBeenCalled();
  });
});

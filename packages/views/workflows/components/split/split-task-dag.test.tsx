// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitTaskDag } from "./split-task-dag";
import type { Edge, Node } from "@xyflow/react";
import type { SplitTaskStatus } from "@multica/core/types";

const mocks = vi.hoisted(() => ({
  reactFlowProps: null as null | {
    nodes: Node[];
    edges: Edge[];
  },
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { nodes: Node[]; edges: Edge[]; children?: React.ReactNode }) => {
    mocks.reactFlowProps = props;
    return <div data-testid="split-task-dag-canvas">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => <div data-testid="split-task-dag-background" />,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

function makeTask(
  id: string,
  {
    sourceTaskId = id,
    title = id,
    dependsOn = [],
    approved = true,
    deleted = false,
    status = "draft",
  }: {
    sourceTaskId?: string | null;
    title?: string;
    dependsOn?: string[];
    approved?: boolean;
    deleted?: boolean;
    status?: SplitTaskStatus;
  } = {},
) {
  return {
    id,
    sourceTaskId,
    title,
    description: "",
    dependsOn,
    suggestedAssigneeType: null,
    suggestedAssigneeId: null,
    status,
    approved,
    deleted,
  } as const;
}

describe("SplitTaskDag", () => {
  it("renders visible tasks as read-only graph nodes and dependency edges", () => {
    render(
      <SplitTaskDag
        tasks={[
          makeTask("task-1", { title: "Plan API" }),
          makeTask("task-2", { title: "Ship tests", dependsOn: ["task-1"] }),
          makeTask("task-3", { title: "Discard me", deleted: true }),
          makeTask("new-task-1", { sourceTaskId: null, title: "Docs", dependsOn: ["task-2"] }),
        ]}
      />,
    );

    expect(screen.getByTestId("split-task-dag-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("split-task-dag-background")).toBeInTheDocument();
    expect(mocks.reactFlowProps?.nodes.map((node) => node.id)).toEqual(["task-1", "task-2", "new-task-1"]);
    expect(mocks.reactFlowProps?.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "task-1->task-2",
      "task-2->new-task-1",
    ]);
    expect(mocks.reactFlowProps?.nodes[0]).toMatchObject({
      data: expect.objectContaining({
        title: "Plan API",
        status: "draft",
        approved: true,
      }),
    });
  });

  it("shows an empty hint when no visible tasks remain", () => {
    render(
      <SplitTaskDag
        tasks={[
          makeTask("task-1", { deleted: true }),
        ]}
      />,
    );

    expect(screen.getByText("No task graph to display yet.")).toBeInTheDocument();
  });
});

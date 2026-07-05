// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowNodeCard } from "./workflow-node-card";
import type { CanvasNode } from "@multica/core/workflows/canvas";

function node(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: "n1",
    workflowId: "workflow-1",
    title: "Plan work",
    description: "Describe plan",
    position: { x: 0, y: 0 },
    sortOrder: 0,
    stageId: null,
    shape: "rectangle",
    formatSchema: null,
    workerType: "agent",
    workerId: "agent-1",
    criticType: "human",
    criticId: "member-1",
    criticApiUrl: null,
    source: {} as CanvasNode["source"],
    runtime: null,
    ...overrides,
  };
}

describe("WorkflowNodeCard", () => {
  it("renders definition node title and actor labels", () => {
    renderWithI18n(<WorkflowNodeCard node={node()} variant="definition" selected={false} />);
    expect(screen.getByText("Plan work")).toBeTruthy();
    expect(screen.getByText(/agent worker/)).toBeTruthy();
    expect(screen.getByText(/human critic/)).toBeTruthy();
  });

  it("renders runtime status and actions", () => {
    renderWithI18n(
      <WorkflowNodeCard
        node={node({
          runtime: {
            nodeRunId: "nr1",
            workflowRunId: "run1",
            status: "awaiting_critic",
            retryCount: 0,
            workerOutput: null,
            criticOutput: null,
            criticComment: "",
            startedAt: null,
            completedAt: null,
            sessionId: null,
            runtimeId: null,
            deviceId: null,
          },
        })}
        variant="runtime"
        selected={false}
      />,
    );
    expect(screen.getByText("awaiting_critic")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(<WorkflowNodeCard node={node()} variant="definition" selected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Plan work/ }));
    expect(onSelect).toHaveBeenCalledWith("n1");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasStageLabels } from "./canvas-stage-labels";
import type { WorkflowStage } from "@multica/core/types";

function makeStage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: "s-1",
    workflow_id: "wf-1",
    name: "Design",
    description: "",
    sort_order: 0,
    node_count: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("CanvasStageLabels", () => {
  const baseProps = {
    stages: [makeStage(), makeStage({ id: "s-2", name: "Implement", sort_order: 1 })],
    viewportY: 0,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
  };

  it("renders stage names", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
  });

  it("shows stage sort order as label", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
  });

  it("renders unassigned label when stages exist", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("does not render unassigned label when no stages", () => {
    render(<CanvasStageLabels {...baseProps} stages={[]} />);
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("calls onEdit when edit button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const editButtons = screen.getAllByLabelText("Edit stage");
    fireEvent.click(editButtons[0]);
    expect(baseProps.onEdit).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("calls onDelete when delete button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const deleteButtons = screen.getAllByLabelText("Delete stage");
    fireEvent.click(deleteButtons[0]);
    expect(baseProps.onDelete).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("positions labels offset by viewportY", () => {
    render(<CanvasStageLabels {...baseProps} viewportY={-136} />);
    const container = screen.getByTestId("canvas-stage-labels");
    expect(container.getAttribute("style")).toContain("translateY");
  });
});

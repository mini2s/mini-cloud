// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasStageLabels } from "./canvas-stage-labels";
import { STAGE_COLOR_BAR_CLASSES } from "./constants";
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
    viewportZoom: 1,
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

  it("renders unified card containers", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    expect(cards).toHaveLength(2);
  });

  it("applies stage color bar class based on sort order", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    expect(cards[0]!.className).toContain(STAGE_COLOR_BAR_CLASSES[0]);
    expect(cards[1]!.className).toContain(STAGE_COLOR_BAR_CLASSES[1]);
  });

  it("renders drag handles", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const handles = screen.getAllByLabelText("Drag to reorder");
    expect(handles).toHaveLength(2);
  });

  it("calls onEdit when edit button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const editButtons = screen.getAllByLabelText("Edit stage");
    fireEvent.click(editButtons[0]!);
    expect(baseProps.onEdit).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("calls onEdit when card body clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    fireEvent.click(cards[0]!);
    expect(baseProps.onEdit).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("calls onDelete when delete button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const deleteButtons = screen.getAllByLabelText("Delete stage");
    fireEvent.click(deleteButtons[0]!);
    expect(baseProps.onDelete).toHaveBeenCalledWith(baseProps.stages[0]);
  });

  it("calls onReorder when up button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    // Second stage (sort_order=1) — move up
    const upButtons = screen.getAllByLabelText("Move stage up");
    fireEvent.click(upButtons[1]!);
    expect(baseProps.onReorder).toHaveBeenCalledWith("s-2", "up");
  });

  it("calls onReorder when down button clicked", () => {
    render(<CanvasStageLabels {...baseProps} />);
    // First stage (sort_order=0) — move down
    const downButtons = screen.getAllByLabelText("Move stage down");
    fireEvent.click(downButtons[0]!);
    expect(baseProps.onReorder).toHaveBeenCalledWith("s-1", "down");
  });

  it("disables up button for first stage", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const upButtons = screen.getAllByLabelText("Move stage up");
    expect(upButtons[0]!).toBeDisabled();
  });

  it("disables down button for last stage", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const downButtons = screen.getAllByLabelText("Move stage down");
    expect(downButtons[1]!).toBeDisabled();
  });

  it("renders stage description when present", () => {
    const stages = [makeStage({ description: "Requirements and design phase" })];
    render(<CanvasStageLabels {...baseProps} stages={stages} />);
    expect(screen.getByText("Requirements and design phase")).toBeInTheDocument();
  });

  it("positions labels accounting for viewportY and viewportZoom", () => {
    // At zoom=1, positions should match flow coordinates + viewportY
    const { rerender } = render(<CanvasStageLabels {...baseProps} viewportY={-176} viewportZoom={1} />);
    const container = screen.getByTestId("canvas-stage-labels");
    // Container no longer uses translateY — positions are per-label
    expect(container).toBeInTheDocument();

    // At zoom=2, later stages should be further apart
    rerender(<CanvasStageLabels {...baseProps} viewportY={0} viewportZoom={2} />);
    const cards = screen.getAllByTestId("stage-label-card");
    // Stage 0 at top=0, Stage 1 at top=LANE_STEP*2=352
    expect(cards[0]!.closest("[style]")?.getAttribute("style")).toContain("top: 0px");
    expect(cards[1]!.closest("[style]")?.getAttribute("style")).toContain("top: 352px");
  });
});

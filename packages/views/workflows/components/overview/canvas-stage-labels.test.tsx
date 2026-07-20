// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasStageLabels } from "./canvas-stage-labels";
import { GRADIENT_HEIGHT, LANE_HEIGHT, LANE_STEP, STAGE_BG_COLORS } from "./constants";
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

  it("renders neutral stage label containers", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    expect(cards).toHaveLength(2);
  });

  it("keeps full-width stage lane background bands from the same viewport transform as labels", () => {
    render(<CanvasStageLabels {...baseProps} viewportY={24} viewportZoom={1.5} />);

    const bands = screen.getAllByTestId("stage-lane-band");
    expect(bands).toHaveLength(2);
    expect(bands[0]!.className).toContain(STAGE_BG_COLORS[0]);
    expect(bands[0]!.getAttribute("style")).toContain("top: 24px");
    expect(bands[0]!.getAttribute("style")).toContain(`height: ${LANE_HEIGHT * 1.5}px`);
    expect(bands[1]!.getAttribute("style")).toContain(`top: ${LANE_STEP * 1.5 + 24}px`);
    expect(bands[1]!.getAttribute("style")).toContain(`height: ${LANE_HEIGHT * 1.5}px`);
  });

  it("uses neutral transparent labels without stage color bars or lane backgrounds", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    for (const card of cards) {
      expect(card.className).not.toContain("border-l-[3px]");
      expect(card.className).not.toMatch(/\bbg-(slate|stone|blue|rose|violet|amber)-100/);
      expect(card.className).toContain("hover:bg-muted/50");
    }
  });

  it("uses compact stage typography", () => {
    render(<CanvasStageLabels {...baseProps} />);
    expect(screen.getByText("Stage 1").className).toContain("font-mono");
    expect(screen.getByText("Stage 1").className).toContain("text-slate-400");
    expect(screen.getByText("Design").className).toContain("text-[12px]");
    expect(screen.getByText("Design").className).toContain("font-medium");
    expect(screen.getByText("Design").className).toContain("text-slate-700");
  });

  it("renders gradient separators between stage backgrounds", () => {
    render(<CanvasStageLabels {...baseProps} viewportY={10} viewportZoom={2} />);
    const gradients = screen.getAllByTestId("stage-gradient-bar");
    expect(gradients).toHaveLength(baseProps.stages.length - 1);
    expect(gradients[0]!.getAttribute("style")).toContain(`top: ${LANE_HEIGHT * 2 + 10}px`);
    expect(gradients[0]!.getAttribute("style")).toContain(`height: ${GRADIENT_HEIGHT * 2}px`);
  });

  it("does not have card chrome classes (no rounded, shadow, backdrop, card border)", () => {
    render(<CanvasStageLabels {...baseProps} />);
    const cards = screen.getAllByTestId("stage-label-card");
    for (const card of cards) {
      expect(card.className).not.toContain("rounded-lg");
      expect(card.className).not.toContain("shadow-sm");
      expect(card.className).not.toContain("backdrop-blur");
      expect(card.className).not.toContain("bg-background/95");
      expect(card.className).not.toMatch(/\bborder\b.*\bborder-border/);
    }
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

  it("clamps long stage descriptions without losing the full text", () => {
    const longDescription = "Collect requirements, validate stakeholder constraints, identify automation risks, and prepare implementation handoff notes for the next stage";
    const stages = [makeStage({ description: longDescription })];
    render(<CanvasStageLabels {...baseProps} stages={stages} />);

    const description = screen.getByText(longDescription);
    expect(description).toHaveAttribute("title", longDescription);
    expect(description.className).toContain("line-clamp-2");
    expect(description.className).toContain("break-words");
    expect(description.className).not.toContain("truncate");
  });

  it("does not render gradient bars when only one stage", () => {
    const stages = [makeStage()];
    render(<CanvasStageLabels {...baseProps} stages={stages} />);
    expect(screen.queryByTestId("stage-gradient-bar")).toBeNull();
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
    // Stage 0 at top=0, Stage 1 at top=LANE_STEP scaled by zoom.
    expect(cards[0]!.closest("[data-testid='stage-label-rail']")?.getAttribute("style")).toContain("top: 0px");
    expect(cards[1]!.closest("[data-testid='stage-label-rail']")?.getAttribute("style")).toContain(`top: ${LANE_STEP * 2}px`);
  });

  it("packs sparse sort orders at the top of the visible canvas", () => {
    const stages = [
      makeStage({ id: "s-2", name: "Analysis", sort_order: 1 }),
      makeStage({ id: "s-3", name: "Build", sort_order: 2 }),
    ];

    render(<CanvasStageLabels {...baseProps} stages={stages} />);

    const rails = screen.getAllByTestId("stage-label-rail");
    expect(rails[0]!.getAttribute("style")).toContain("top: 0px");
    expect(rails[1]!.getAttribute("style")).toContain(`top: ${LANE_STEP}px`);
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
    expect(screen.queryByText("Stage 3")).not.toBeInTheDocument();
  });
});

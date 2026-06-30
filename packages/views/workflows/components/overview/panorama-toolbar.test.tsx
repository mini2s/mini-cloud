import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanoramaToolbar } from "./panorama-toolbar";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (getter: (d: Record<string, string>) => string) => {
      const dict: Record<string, string> = {
        "panorama.toolbar.undo": "Undo",
        "panorama.toolbar.redo": "Redo",
        "panorama.toolbar.auto_layout": "Auto layout",
        "panorama.toolbar.annotations": "Toggle annotations",
        "panorama.toolbar.save": "Save changes",
        "panorama.toolbar.unsaved": "Unsaved changes",
      };
      return getter(dict);
    },
  }),
}));

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      undoStack: [{ snapshot: { nodeEdits: {}, deletedNodeIds: [] } }],
      redoStack: [],
      showAnnotations: true,
    };
    return selector(state);
  }),
}));

describe("PanoramaToolbar", () => {
  const baseProps = {
    onAutoLayout: vi.fn(),
    onSave: vi.fn(),
    hasUnsaved: false,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomLevel: 100,
  };

  it("renders undo and redo buttons", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
    expect(screen.getByLabelText("Redo")).toBeInTheDocument();
  });

  it("renders auto layout button", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Auto layout")).toBeInTheDocument();
  });

  it("renders annotation toggle button", () => {
    render(<PanoramaToolbar {...baseProps} />);
    expect(screen.getByLabelText("Toggle annotations")).toBeInTheDocument();
  });

  it("calls onAutoLayout when button clicked", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Auto layout"));
    expect(baseProps.onAutoLayout).toHaveBeenCalledOnce();
  });

  it("calls onSave when save button clicked", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Save changes"));
    expect(baseProps.onSave).toHaveBeenCalledOnce();
  });

  it("shows blue dot on save button when hasUnsaved is true", () => {
    render(<PanoramaToolbar {...baseProps} hasUnsaved />);
    const saveBtn = screen.getByLabelText("Save changes");
    // The save button should have an indicator dot
    const dot = saveBtn.querySelector(".bg-primary");
    expect(dot).toBeInTheDocument();
  });

  it("shows zoom percentage", () => {
    render(<PanoramaToolbar {...baseProps} zoomLevel={75} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("calls zoomIn and zoomOut", () => {
    render(<PanoramaToolbar {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(baseProps.zoomIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(baseProps.zoomOut).toHaveBeenCalledOnce();
  });
});

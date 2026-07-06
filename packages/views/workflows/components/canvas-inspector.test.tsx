import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasInspector } from "./canvas-inspector";

describe("CanvasInspector", () => {
  const tabs = [
    { id: "overview", label: "Overview", content: <div>Overview content</div> },
    { id: "config", label: "Config", content: <div>Config content</div> },
  ];

  it("renders title and tabs", () => {
    render(<CanvasInspector title="Test Node" tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Test Node")).toBeDefined();
    expect(screen.getByText("Overview")).toBeDefined();
    expect(screen.getByText("Config")).toBeDefined();
  });

  it("shows first tab content by default", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} />);
    expect(screen.getByText("Overview content")).toBeDefined();
  });

  it("switches tab on click", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Config"));
    expect(screen.getByText("Config content")).toBeDefined();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<CanvasInspector title="Test" tabs={tabs} onClose={onClose} />);
    // Close button has aria-label
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders actions slot", () => {
    render(<CanvasInspector title="Test" tabs={tabs} onClose={vi.fn()} actions={<button>Retry</button>} />);
    expect(screen.getByText("Retry")).toBeDefined();
  });
});

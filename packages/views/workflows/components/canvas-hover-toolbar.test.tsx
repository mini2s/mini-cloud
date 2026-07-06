import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CanvasHoverToolbar } from "./canvas-hover-toolbar";

describe("CanvasHoverToolbar", () => {
  it("renders delete button", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        mode="editor"
      />
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeDefined();
  });

  it("renders disable button in editor mode", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        onToggleDisabled={vi.fn()}
        mode="editor"
      />
    );
    expect(screen.getByRole("button", { name: /disable/i })).toBeDefined();
  });

  it("does not render disable button in runtime mode", () => {
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 100, y: 50 }}
        onDelete={vi.fn()}
        mode="runtime"
      />
    );
    expect(screen.queryByRole("button", { name: /disable/i })).toBeNull();
  });

  it("positions correctly", () => {
    const { container } = render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 200, y: 100 }}
        onDelete={vi.fn()}
        mode="editor"
      />
    );
    const toolbar = container.firstElementChild as HTMLElement;
    expect(toolbar.style.left).toBe("200px");
    expect(toolbar.style.top).toBe("92px");
  });

  it("calls onDelete when delete clicked", () => {
    const onDelete = vi.fn();
    render(
      <CanvasHoverToolbar
        nodeId="n1"
        position={{ x: 0, y: 0 }}
        onDelete={onDelete}
        mode="editor"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("n1");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodePanel, NODE_GROUPS } from "./node-panel";

describe("NodePanel", () => {
  it("renders all node groups", () => {
    render(<NodePanel isOpen onClose={vi.fn()} />);
    for (const group of NODE_GROUPS) {
      expect(screen.getByText(group.label)).toBeDefined();
    }
  });

  it("filters nodes by search query", () => {
    render(<NodePanel isOpen onClose={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "agent" } });
    // Should still show Agent Worker group but filter others
    expect(screen.getByText("Agent Worker")).toBeDefined();
  });

  it("does not render when closed", () => {
    const { container } = render(<NodePanel isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NodePanel isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NodeTemplatePicker } from "./node-template-picker";

vi.mock("../../../i18n", () => {
  const translations = {
    panorama: {
      node_picker: {
        search_placeholder: "Search nodes or actions...",
        empty: "No matching nodes",
        trigger: "Triggers",
        trigger_description: "Start a workflow",
        action: "Actions",
        action_description: "Do work in a step",
        logic: "Logic",
        logic_description: "Branch or route work",
        ai: "AI",
        ai_description: "Agent-powered steps",
        human: "Human",
        human_description: "Review or approval",
        annotation: "Notes",
        annotation_description: "Explain the canvas",
      },
    },
  };

  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

describe("NodeTemplatePicker", () => {
  it("locks the picker to a viewport-safe height so the list can scroll internally", () => {
    render(<NodeTemplatePicker onSelect={vi.fn()} />);

    const picker = screen.getByTestId("node-template-picker");
    expect(picker.className.split(/\s+/)).toContain("h-[min(420px,calc(100vh-6rem))]");
  });

  it("keeps picker content clipped to the dropdown width", () => {
    render(<NodeTemplatePicker onSelect={vi.fn()} />);

    const picker = screen.getByTestId("node-template-picker");
    const scrollArea = picker.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea?.className).toContain("flex-1");
    expect(scrollArea?.className).toContain("min-h-0");
    expect(picker.className).toContain("max-w-full");
    expect(picker.className).toContain("overflow-hidden");
  });

  it("renders categories and templates", () => {
    render(<NodeTemplatePicker onSelect={vi.fn()} />);

    expect(screen.getByText("Triggers")).toBeInTheDocument();
    expect(screen.getByText("Manual trigger")).toBeInTheDocument();
    expect(screen.getByText("Digital human task")).toBeInTheDocument();
  });

  it("filters templates by search term", () => {
    render(<NodeTemplatePicker onSelect={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search nodes or actions..."), {
      target: { value: "review" },
    });

    expect(screen.getByText("Human review")).toBeInTheDocument();
    expect(screen.queryByText("Manual trigger")).not.toBeInTheDocument();
  });

  it("returns the selected template when a template is clicked", () => {
    const onSelect = vi.fn();
    render(<NodeTemplatePicker onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Digital human task/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "ai-agent-task" }));
  });
});

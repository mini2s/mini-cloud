// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GitBranch } from "lucide-react";
import { NodeDetailSection } from "./workflow-node-detail-panel-shell";

describe("NodeDetailSection", () => {
  it("uses a simple block layout without decorative connector rails", () => {
    render(
      <NodeDetailSection
        sectionId="connections"
        title="Dependencies"
        icon={<GitBranch data-testid="section-icon" className="size-4" />}
      />,
    );

    const section = screen.getByTestId("node-detail-section");

    expect(section).not.toHaveClass("grid-cols-[14px_minmax(0,1fr)]");
    expect(section.querySelector("[data-testid='node-detail-section-rail']")).toBeNull();
  });

  it("does not wrap every section in a bordered card", () => {
    render(
      <NodeDetailSection
        sectionId="connections"
        title="Dependencies"
        icon={<GitBranch data-testid="section-icon" className="size-4" />}
      >
        <p>Content</p>
      </NodeDetailSection>,
    );

    const surface = screen.getByTestId("node-detail-section").firstElementChild;

    expect(surface).not.toHaveClass("border");
    expect(surface).not.toHaveClass("rounded-md");
    expect(surface?.firstElementChild).not.toHaveClass("border-b");
  });

  it("separates functional areas with a lightweight divider", () => {
    render(
      <NodeDetailSection
        sectionId="connections"
        title="Dependencies"
        icon={<GitBranch data-testid="section-icon" className="size-4" />}
      >
        <p>Content</p>
      </NodeDetailSection>,
    );

    const section = screen.getByTestId("node-detail-section");

    expect(section).toHaveClass("border-t", "border-border/60", "pt-4");
    expect(section).toHaveClass("first:border-t-0", "first:pt-0");
  });

  it("centers single-line section titles with their icons", () => {
    render(
      <NodeDetailSection
        sectionId="connections"
        title="Dependencies"
        icon={<GitBranch data-testid="section-icon" className="size-4" />}
      />,
    );

    const titleGroup = screen.getByRole("heading", { name: "Dependencies" }).closest("div")?.parentElement;

    expect(titleGroup).toHaveClass("items-center");
  });
});

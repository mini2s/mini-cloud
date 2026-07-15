// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GitBranch } from "lucide-react";
import { NodeDetailSection } from "./workflow-node-detail-panel-shell";

describe("NodeDetailSection", () => {
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

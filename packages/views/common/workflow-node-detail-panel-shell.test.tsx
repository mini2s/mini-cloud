// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitBranch } from "lucide-react";
import {
  NodeDetailSection,
  WorkflowNodeDetailPanelShell,
} from "./workflow-node-detail-panel-shell";

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

describe("WorkflowNodeDetailPanelShell", () => {
  it("renders an optional footer outside the scrolling content", () => {
    render(
      <WorkflowNodeDetailPanelShell
        mode="edit"
        title="Node settings"
        closeLabel="Close"
        onClose={vi.fn()}
        footer={<button type="button">Save changes</button>}
      >
        <div>Body</div>
      </WorkflowNodeDetailPanelShell>,
    );

    const content = screen.getByTestId("node-detail-panel-content");
    const footer = screen.getByTestId("node-detail-panel-footer");

    expect(content).toContainElement(screen.getByText("Body"));
    expect(content).not.toContainElement(screen.getByRole("button", { name: "Save changes" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "Save changes" }));
  });

  it("uses the wider editor panel width by default", () => {
    render(
      <WorkflowNodeDetailPanelShell
        mode="edit"
        title="节点设置"
        closeLabel="Close"
        onClose={vi.fn()}
      >
        <div>Body</div>
      </WorkflowNodeDetailPanelShell>,
    );

    const panel = screen.getByTestId("workflow-node-detail-panel-shell");
    expect(panel).toHaveClass("w-[620px]");
    expect(panel).toHaveClass("border-l");
    expect(panel.className).toContain("bg-background");
  });

  it("keeps explicit width overrides working", () => {
    render(
      <WorkflowNodeDetailPanelShell
        mode="edit"
        title="节点设置"
        closeLabel="Close"
        onClose={vi.fn()}
        widthClassName="w-[480px]"
      >
        <div>Body</div>
      </WorkflowNodeDetailPanelShell>,
    );

    expect(screen.getByTestId("workflow-node-detail-panel-shell")).toHaveClass("w-[480px]");
  });
});

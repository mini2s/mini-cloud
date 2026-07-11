import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CriticBadgeNode, type CriticBadgeNodeData } from "./critic-badge-node";
import type { Node } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";

function makeWorkerNode(): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "wf-1",
    title: "Code Review",
    description: "",
    worker_type: "agent",
    worker_id: "agent-1",
    critic_type: "agent",
    critic_id: "critic-1",
    critic_api_url: null,
    stage_id: "stage-0",
    format_schema: null,
    position_x: 100,
    position_y: 0,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

function renderWithProvider(node: Node) {
  return render(
    <ReactFlowProvider>
      <CriticBadgeNode
        id={node.id}
        data={node.data}
        selected={false}
        type="criticBadge"
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
        draggable={false}
        selectable={false}
        dragging={false}
        deletable={false}
      />
    </ReactFlowProvider>,
  );
}

describe("CriticBadgeNode", () => {
  const baseData: CriticBadgeNodeData = {
    node: makeWorkerNode(),
    parentNodeId: "node-1",
    criticName: "Security Reviewer",
  };

  it("renders as a compact Soft Slab critic node aligned with worker cards", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("border-white/80");
    expect(el).toHaveClass("ring-slate-200/70");
    expect(el).toHaveClass("bg-gradient-to-br");
    expect(el).toHaveClass("shadow-[0_8px_18px_rgba(15,23,42,0.08)]");
    expect(el).not.toHaveClass("border-border/70");
    expect(el).not.toHaveClass("border-warning/35");
    expect(el.className).not.toContain("via-amber-50/80");
    expect(el).not.toHaveClass("border-dashed");
    expect(el).not.toHaveClass("outline");
    expect(el.className).not.toContain("var(--warning)");
  });

  it("uses the icon only for the critic role indicator", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el.querySelector("[data-testid='critic-badge-icon-node-1:critic']")).toBeInTheDocument();
    expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic")).not.toBeInTheDocument();
  });

  it("shows critic name", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("shows critic-owned metadata using the same footer structure as worker nodes", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);

    const meta = screen.getByTestId("critic-badge-meta-node-1:critic");
    expect(meta).toHaveTextContent("Agent reviewer");
    expect(meta).not.toHaveTextContent("Review step");
    expect(meta).not.toHaveTextContent("Critic");
    expect(meta.className).toContain("border-t");
  });

  it("keeps long reviewer names readable and available in full", () => {
    const longName = "Security Compliance Reviewer for Enterprise Release Approval";
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: {
        ...baseData,
        criticName: longName,
      },
    } as Node;
    renderWithProvider(rfn);

    const title = screen.getByText(longName);
    expect(title).toHaveAttribute("title", longName);
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).toContain("text-[11px]");
    expect(title.className).toContain("font-medium");
    expect(title.className).toContain("text-slate-600");
    expect(title.className).not.toContain("truncate");
    expect(title.className).not.toContain("font-semibold");
    expect(title.className).not.toContain("text-foreground");
  });

  it("keeps long reviewer names and metadata inside the compact card", () => {
    const longName = "Security Compliance Reviewer for Enterprise Release Approval";
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: {
        ...baseData,
        criticName: longName,
      },
    } as Node;
    renderWithProvider(rfn);

    const el = screen.getByTestId("critic-badge-node-1:critic");
    const meta = screen.getByTestId("critic-badge-meta-node-1:critic");
    expect(el).toHaveClass("overflow-hidden", "p-1");
    expect(meta).toHaveClass("pt-0.5", "text-[8px]", "leading-[10px]");
  });

  it("keeps reviewer metadata visually subordinate to the critic icon", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);

    const icon = screen.getByTestId("critic-badge-icon-node-1:critic");
    const metaLabel = screen.getByText("Agent reviewer");
    expect(icon).toHaveClass("text-warning/75");
    expect(metaLabel.className).toContain("text-slate-500");
    expect(metaLabel.className).not.toContain("text-slate-700");
  });

  it("has only a top Handle (target)", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handles = document.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(1);
  });

  it("uses a stable top handle id", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handle = document.querySelector(".react-flow__handle");
    expect(handle?.getAttribute("data-handleid")).toBe("top");
  });

  it("keeps the critic edge anchor on the card top edge", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handle = document.querySelector(".react-flow__handle");
    expect(handle).toHaveStyle({ top: "3px" });
  });

  it("has correct dimensions", () => {
    const rfn = {
      id: "node-1:critic",
      type: "criticBadge",
      position: { x: 100, y: 96 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("critic-badge-node-1:critic");
    expect(el).toHaveClass("h-12", "w-36");
  });
});

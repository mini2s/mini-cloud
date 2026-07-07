import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CompactWorkerNode, type CompactWorkerNodeData } from "./compact-worker-node";
import type { Node } from "@xyflow/react";
import type { WorkflowNode } from "@multica/core/types";

// Minimal mock for the i18n hook
vi.mock("../../../../i18n", () => ({
  useT: () => ({
    t: (getter: (d: { node: Record<string, string> }) => string) => {
      const dict = { node: { worker_name: "Worker", agent_label: "Agent", not_configured: "Not configured" } };
      return getter(dict);
    },
  }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workspace/queries", () => ({
  builtinPluginListOptions: () => ({ queryKey: ["plugins"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
}));

function makeWorkerNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "wf-1",
    title: "Code Review",
    description: "",
    worker_type: "agent",
    worker_id: "agent-1",
    critic_type: "human",
    critic_id: null,
    critic_api_url: null,
    stage_id: "stage-0",
    format_schema: null,
    position_x: 100,
    position_y: 0,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function renderWithProvider(node: Node) {
  return render(
    <ReactFlowProvider>
      <CompactWorkerNode
        id={node.id}
        data={node.data}
        selected={node.selected ?? false}
        type="compactWorker"
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

describe("CompactWorkerNode", () => {
  const baseData: CompactWorkerNodeData = {
    node: makeWorkerNode(),
    stage_id: "stage-0",
    stageColorIndex: 0,
    pluginName: "builtin/code-review",
    workerName: "GPT-4 Agent",
  };

  it("renders with correct dimensions", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("compact-worker-node-1");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("h-16", "w-56");
  });

  it("shows plugin name", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("builtin/code-review")).toBeInTheDocument();
  });

  it("falls back to node title when no plugin name", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: { ...baseData, pluginName: undefined },
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("shows worker name in subtitle", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("GPT-4 Agent")).toBeInTheDocument();
  });

  it("shows 'Not configured' when no worker", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        workerName: undefined,
        node: makeWorkerNode({ worker_id: null, worker_type: "human" }),
      },
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("has testid with node id", () => {
    const rfn = {
      id: "abc-123",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByTestId("compact-worker-abc-123")).toBeInTheDocument();
  });

  it("renders three Handles (Left, Right, Bottom)", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    // Handles are rendered by ReactFlow's Handle component
    const handles = document.querySelectorAll(".react-flow__handle");
    expect(handles.length).toBe(3);
  });

  it("uses stable handle ids for routed edges", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const handles = [...document.querySelectorAll(".react-flow__handle")];
    expect(handles.map((handle) => handle.getAttribute("data-handleid")).sort()).toEqual(["bottom", "left", "right"]);
  });

  it("applies selected styling when selected", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
      selected: true,
    } as Node;
    renderWithProvider(rfn);
    const el = screen.getByTestId("compact-worker-node-1");
    expect(el.className).toContain("border-primary/55");
  });

  it("worker node 是可键盘聚焦的 button", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: { ...baseData, workerName: undefined },
    } as Node;
    renderWithProvider(rfn);

    const node = screen.getByRole("button", { name: /builtin\/code-review\. Not configured/i });
    expect(node).toHaveAttribute("tabIndex", "0");
  });

  it("Enter 和 Space 调用打开回调", () => {
    const onOpen = vi.fn();
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: { ...baseData, onOpen },
    } as Node;
    renderWithProvider(rfn);

    const node = screen.getByRole("button");
    fireEvent.keyDown(node, { key: "Enter" });
    fireEvent.keyDown(node, { key: " " });

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenNthCalledWith(1, "node-1");
    expect(onOpen).toHaveBeenNthCalledWith(2, "node-1");
  });
});

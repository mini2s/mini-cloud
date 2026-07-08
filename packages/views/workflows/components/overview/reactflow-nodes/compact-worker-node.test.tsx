import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CompactWorkerNode, type CompactWorkerNodeData } from "./compact-worker-node";
import { WORKER_HEIGHT } from "../constants";
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
    expect(el).toHaveClass("h-[104px]", "w-[240px]");
    expect(el).toHaveStyle({ height: "104px" });
  });

  it("uses the node title as the primary card label", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.queryByText("builtin/code-review")).not.toBeInTheDocument();
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

  it("renders the Soft Slab node structure with a type badge and footer metadata", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);

    const badge = screen.getByTestId("compact-worker-node-badge-node-1");
    const meta = screen.getByTestId("compact-worker-node-meta-node-1");
    expect(badge).toHaveTextContent("Agent");
    expect(badge).toHaveClass("border-border/55", "bg-background/70", "text-muted-foreground");
    expect(meta).toHaveTextContent("GPT-4 Agent");
    expect(meta).toHaveTextContent("Configured");
    expect(meta).toHaveClass("border-t", "border-border/45");
    expect(meta.className).not.toContain("border-slate-200/55");
  });

  it("does not show missing worker warnings on the card", () => {
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
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs worker")).not.toBeInTheDocument();
  });

  it("shows configured worker metadata without critic, stage, or runtime state", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        stageName: "Intake",
        workerConfigured: true,
        criticConfigured: true,
        runStatus: "completed",
      },
    } as Node;
    renderWithProvider(rfn);

    expect(screen.queryByText("Intake")).not.toBeInTheDocument();
    expect(screen.queryByText("Worker ready")).not.toBeInTheDocument();
    expect(screen.getByText("GPT-4 Agent")).toBeInTheDocument();
    expect(screen.queryByText("Critic")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("keeps preflight-only missing worker state off the card", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        workerName: undefined,
        node: makeWorkerNode({ worker_id: null, worker_type: "agent" }),
        workerConfigured: false,
        criticConfigured: false,
        stageName: "Build",
      },
    } as Node;
    renderWithProvider(rfn);

    expect(screen.queryByText("Build")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs worker")).not.toBeInTheDocument();
    expect(screen.queryByText("Critic")).not.toBeInTheDocument();
  });

  it("renders annotation nodes without worker warnings", () => {
    const rfn = {
      id: "note-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        node: makeWorkerNode({
          id: "note-1",
          title: "Handoff note",
          worker_id: null,
          format_schema: { type: "annotation" },
        }),
        pluginName: undefined,
        workerName: undefined,
        isAnnotation: true,
        stageName: "Intake",
      },
    } as Node;
    renderWithProvider(rfn);

    expect(screen.getByText("Handoff note")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.queryByText("Intake")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs worker")).not.toBeInTheDocument();
  });

  it("renders gateway nodes with gateway semantics instead of worker metadata", () => {
    const rfn = {
      id: "fork-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        node: makeWorkerNode({
          id: "fork-1",
          title: "Fan out work",
          worker_id: null,
          format_schema: { type: "gateway", gateway_kind: "fork", shape: "diamond" },
        }),
        pluginName: undefined,
        workerName: undefined,
      },
    } as Node;
    renderWithProvider(rfn);

    expect(screen.getByText("Fan out work")).toBeInTheDocument();
    expect(screen.getByText("Fork gateway")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs worker")).not.toBeInTheDocument();
  });

  it("uses category-derived semantic shape classes", () => {
    const rfn = {
      id: "trigger-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        node: makeWorkerNode({
          id: "trigger-1",
          title: "Start",
          format_schema: { template_category: "trigger" },
        }),
      },
    } as Node;
    renderWithProvider(rfn);

    const node = screen.getByTestId("compact-worker-trigger-1");
    expect(node).toHaveAttribute("data-node-shape", "pill");
    const surface = node.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("rounded-full");
  });

  it("lets explicit shape override the category-derived shape", () => {
    const rfn = {
      id: "override-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        node: makeWorkerNode({
          id: "override-1",
          title: "Manual Review",
          format_schema: { template_category: "human", shape: "diamond" },
        }),
      },
    } as Node;
    renderWithProvider(rfn);

    const node = screen.getByTestId("compact-worker-override-1");
    expect(node).toHaveAttribute("data-node-shape", "diamond");
    const surface = node.querySelector('[data-node-shape-surface="true"]');
    expect(surface?.className).toContain("rounded-lg");
    expect(surface?.className).not.toContain("clip-path");
    const glyph = node.querySelector('[data-node-shape-glyph="diamond"]');
    expect(glyph).toBeInTheDocument();
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

  it("calls the connected-node add callback from the right plus handle", () => {
    const onOpen = vi.fn();
    const onAddConnectedNode = vi.fn();
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        addConnectedNodeLabel: "Drag to connect, click to add node",
        onOpen,
        onAddConnectedNode,
      },
    } as Node;
    renderWithProvider(rfn);

    const addButton = screen.getByRole("button", { name: "Drag to connect, click to add node" });
    expect(addButton).not.toHaveAttribute("title");
    const tooltip = screen.getByTestId("workflow-canvas-add-connected-node-tooltip");
    expect(tooltip).toHaveTextContent("Drag to connect");
    expect(tooltip).toHaveTextContent("Click to add node");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(addButton.className).toContain("!z-20");
    fireEvent.click(addButton);

    expect(onAddConnectedNode).toHaveBeenCalledWith("node-1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("uses Soft Slab surface and floating add-port styling", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: {
        ...baseData,
        addConnectedNodeLabel: "Drag to connect, click to add node",
        onAddConnectedNode: vi.fn(),
      },
    } as Node;
    renderWithProvider(rfn);

    const node = screen.getByTestId("compact-worker-node-1");
    const surface = node.querySelector('[data-node-shape-surface="true"]');
    const addPort = screen.getByRole("button", { name: "Drag to connect, click to add node" });

    expect(surface?.className).toContain("bg-gradient-to-br");
    expect(surface?.className).toContain("border-white/80");
    expect(surface?.className).toContain("ring-slate-200/70");
    expect(surface?.className).not.toContain("border-border/70");
    expect(surface?.className).not.toContain("border-slate-300/55");
    expect(surface?.className).toContain("shadow-[0_14px_32px_rgba(15,23,42,0.12)]");
    expect(addPort.className).toContain("!shadow-[0_10px_24px_rgba(37,99,235,0.18)]");
    expect(addPort.className).not.toContain("text-slate-300");
    expect(addPort).not.toHaveAttribute("title");
    const tooltip = screen.getByTestId("workflow-canvas-add-connected-node-tooltip");
    expect(tooltip).toHaveTextContent("Drag to connect");
    expect(tooltip).toHaveTextContent("Click to add node");
    expect(tooltip.className).toContain("group-hover/add-port:opacity-100");
    expect(tooltip.className).toContain("bg-popover/95");
  });

  it("anchors lateral handles to the fixed worker midpoint", () => {
    const rfn = {
      id: "node-1",
      type: "compactWorker",
      position: { x: 100, y: 12 },
      data: baseData,
    } as Node;
    renderWithProvider(rfn);
    const leftHandle = document.querySelector('[data-handleid="left"]');
    const rightHandle = document.querySelector('[data-handleid="right"]');

    expect(leftHandle).toHaveStyle({ top: `${WORKER_HEIGHT / 2}px` });
    expect(rightHandle).toHaveStyle({ top: `${WORKER_HEIGHT / 2}px` });
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

    const node = screen.getByRole("button", { name: /Code Review\. builtin\/code-review/i });
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

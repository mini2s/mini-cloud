import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorInspector } from "./editor-inspector";
import type { WorkflowNode } from "@multica/core/types";

vi.mock("@multica/core/workflows/store", () => ({
  useWorkflowEditorStore: vi.fn((selector) => {
    const state = { nodeEdits: {}, cacheNodeEdits: vi.fn(), selectedNodeId: null, selectedNodeIds: [], selectNode: vi.fn() };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("@multica/core/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = { user: { id: "u1" } };
    return selector ? selector(state) : state;
  }),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@multica/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: (t: string, id: string) => `${t}:${id}` }) }));
vi.mock("@multica/core/runtimes/queries", () => ({
  runtimeListOptions: vi.fn(() => ({ queryKey: ["runtimes", "ws1"], queryFn: vi.fn() })),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useQuery: () => ({ data: [] }),
    useQueryClient: () => ({ invalidateQueries: vi.fn(), fetchQuery: vi.fn() }),
    useMutation: (opts?: { onSuccess?: () => void }) => ({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn(),
      isPending: false,
      ...(opts?.onSuccess ? { onSuccess: opts.onSuccess } : {}),
    }),
  };
});
vi.mock("@multica/core/workflows/queries", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useCreateStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteNode: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAssignNodeToStage: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const node: WorkflowNode = {
  id: "n1", workflow_id: "wf1", title: "Test", description: "",
  position_x: 0, position_y: 0, format_schema: null,
  worker_type: "agent", worker_id: null,
  critic_type: "human", critic_id: null, critic_api_url: null,
  sort_order: 0, stage_id: null, created_at: "", updated_at: "",
};

describe("EditorInspector", () => {
  it("renders all tabs", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toContain("Worker");
    expect(tabs.map((t) => t.textContent)).toContain("Critic");
    expect(tabs.map((t) => t.textContent)).toContain("Parameters");
    expect(tabs.map((t) => t.textContent)).toContain("Stage");
  });

  it("renders title in inspector header", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    expect(screen.getByText("Test")).toBeDefined();
  });

  it("renders parameters tab with textarea by default", () => {
    render(<EditorInspector node={node} workflowId="wf1" onClose={vi.fn()} />);
    // Switch to Parameters tab
    fireEvent.click(screen.getByText("Parameters"));
    expect(screen.getByRole("textbox")).toBeDefined(); // Textarea for format_schema
  });
});

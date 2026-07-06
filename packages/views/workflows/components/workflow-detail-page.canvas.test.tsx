// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { WorkflowDetailPage } from "./workflow-detail-page";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReactFlow: () => <div data-testid="reactflow" />,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  ConnectionMode: { Loose: "loose" },
  useReactFlow: () => ({ screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }) }),
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/paths", () => ({ useWorkspacePaths: () => ({ workflows: () => "/workflows" }) }));
vi.mock("../../navigation", () => ({ useNavigation: () => ({ push: vi.fn() }) }));
vi.mock("@multica/core/auth", () => ({ useAuthStore: (selector: any) => selector({ user: { id: "user-1" } }) }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (options: { queryKey?: readonly unknown[] }) => {
      const key = JSON.stringify(options.queryKey ?? []);
      if (key.includes("\"nodes\"")) return { data: [{ id: "node-1", workflow_id: "workflow-1", title: "Test Node", description: "", position_x: 100, position_y: 200, format_schema: null, worker_type: "human", worker_id: null, critic_type: "human", critic_id: null, critic_api_url: null, sort_order: 1, stage_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }], isLoading: false };
      if (key.includes("\"edges\"")) return { data: [], isLoading: false };
      if (key.includes("\"stages\"")) return { data: [], isLoading: false };
      if (key.includes("workflow-admins")) return { data: [{ id: "user-1" }], isLoading: false };
      return {
        data: {
          id: "workflow-1",
          title: "Workflow",
          description: "",
          status: "draft",
          is_template: false,
        },
        isLoading: false,
      };
    },
    useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  };
});

vi.mock("@multica/core/workflows/queries", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/workflows/queries")>("@multica/core/workflows/queries");
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    ...actual,
    workflowDetailOptions: () => ({ queryKey: ["workflow-detail"] }),
    workflowNodesOptions: () => ({ queryKey: ["workflow-detail", "nodes"] }),
    workflowEdgesOptions: () => ({ queryKey: ["workflow-detail", "edges"] }),
    workflowStagesOptions: () => ({ queryKey: ["workflow-detail", "stages"] }),
    useCreateNode: mutation,
    useUpdateNode: mutation,
    useCreateEdge: mutation,
    useUpdateWorkflow: mutation,
    useDeleteWorkflow: mutation,
    useDeleteEdge: mutation,
    useDeleteNode: mutation,
    useToggleWorkflowTemplate: mutation,
    useWorkflowAdmins: () => ({ data: [{ id: "user-1" }] }),
  };
});

describe("WorkflowDetailPage canvas shell", () => {
  it("renders the shared canvas shell area", () => {
    renderWithI18n(<WorkflowDetailPage workflowId="workflow-1" />);
    expect(screen.getByTestId("workflow-canvas-shell")).toBeTruthy();
  });

  it("gives the ReactFlow canvas shell a concrete height", () => {
    renderWithI18n(<WorkflowDetailPage workflowId="workflow-1" />);
    expect(screen.getByTestId("workflow-canvas-shell")).toHaveClass("h-full");
  });
});

// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeDeliverablesEditor } from "./node-deliverables-editor";

const mocks = vi.hoisted(() => ({
  updateDeliverableMutate: vi.fn(),
  createDeliverableMutate: vi.fn(),
  deleteDeliverableMutate: vi.fn(),
  deliverables: [
    {
      id: "deliverable-1",
      workflow_node_id: "node-1",
      kind: "document",
      title: "New deliverable",
      description: "",
      required: true,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.deliverables }),
}));

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@multica/core/workflows/queries", () => ({
  workflowNodeDeliverablesOptions: () => ({ queryKey: ["deliverables"] }),
  useCreateWorkflowNodeDeliverable: () => ({ mutate: mocks.createDeliverableMutate, isPending: false }),
  useUpdateWorkflowNodeDeliverable: () => ({ mutate: mocks.updateDeliverableMutate }),
  useDeleteWorkflowNodeDeliverable: () => ({ mutate: mocks.deleteDeliverableMutate, isPending: false }),
}));

vi.mock("../../i18n", () => {
  const translations = {
    detail_panel: {
      deliverable_kind_document: "Document",
      deliverable_kind_pull_request: "Pull Request",
      deliverable_title_placeholder: "Deliverable title",
      deliverable_required: "Required",
      deliverable_section_label: "Deliverables",
      deliverable_empty: "No deliverables defined. Add required documents or pull requests that must be submitted for this node.",
      deliverable_add: "Add deliverable",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

describe("NodeDeliverablesEditor", () => {
  beforeEach(() => {
    mocks.updateDeliverableMutate.mockReset();
    mocks.createDeliverableMutate.mockReset();
    mocks.deleteDeliverableMutate.mockReset();
  });

  it("keeps Chinese IME text local during composition and saves it after composition ends", () => {
    render(<NodeDeliverablesEditor workflowId="wf-1" nodeId="node-1" />);

    const input = screen.getByDisplayValue("New deliverable");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "设计文档" } });

    expect(input).toHaveValue("设计文档");
    expect(mocks.updateDeliverableMutate).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);

    expect(mocks.updateDeliverableMutate).toHaveBeenCalledWith({
      deliverableId: "deliverable-1",
      title: "设计文档",
    });
  });

  it("creates a blank deliverable without placeholder title text", () => {
    render(<NodeDeliverablesEditor workflowId="wf-1" nodeId="node-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));

    expect(mocks.createDeliverableMutate).toHaveBeenCalledWith({
      kind: "document",
      title: "",
      description: "",
      required: true,
      sort_order: 1,
    });
  });
});

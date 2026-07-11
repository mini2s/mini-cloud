// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NodeDeliverablesEditor, type WorkflowNodeDeliverableDraft } from "./node-deliverables-editor";

const deliverables: WorkflowNodeDeliverableDraft[] = [
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
];

vi.mock("../../i18n", () => {
  const translations = {
    detail_panel: {
      deliverable_kind_document: "Document",
      deliverable_kind_pull_request: "Pull Request",
      deliverable_title_placeholder: "Deliverable title",
      deliverable_required: "Required",
      deliverable_section_label: "Deliverables",
      deliverable_empty: "No deliverables defined. Add required documents or pull requests that must be submitted for this node.",
      deliverable_default_title: "New deliverable",
      deliverable_add: "Add deliverable",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

function renderEditor(initial: WorkflowNodeDeliverableDraft[] = deliverables) {
  let draft = initial;
  let rerender: ReturnType<typeof render>["rerender"];
  const onChange = vi.fn((next: WorkflowNodeDeliverableDraft[]) => {
    draft = next;
    rerender(
      <NodeDeliverablesEditor
        nodeId="node-1"
        deliverables={draft}
        onChange={onChange}
      />,
    );
  });
  const rendered = render(
    <NodeDeliverablesEditor
      nodeId="node-1"
      deliverables={draft}
      onChange={onChange}
    />,
  );
  rerender = rendered.rerender;
  return { onChange };
}

describe("NodeDeliverablesEditor", () => {
  it("keeps Chinese IME text local during composition and emits draft update after composition ends", () => {
    const { onChange } = renderEditor();

    const input = screen.getByDisplayValue("New deliverable");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "设计文档" } });

    expect(input).toHaveValue("设计文档");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "deliverable-1",
        title: "设计文档",
      }),
    ]);
  });

  it("adds a local draft deliverable with a default title accepted by the API", () => {
    const { onChange } = renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));

    expect(onChange).toHaveBeenCalledWith([
      deliverables[0],
      expect.objectContaining({
        workflow_node_id: "node-1",
        kind: "document",
        title: "New deliverable",
        description: "",
        required: true,
        sort_order: 1,
        isDraft: true,
      }),
    ]);
  });
});

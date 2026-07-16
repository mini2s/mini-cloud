// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SplitTask, Workflow } from "@multica/core/types";
import { SplitDraftLedger } from "./split-draft-ledger";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: Record<string, unknown>) => string,
      values?: Record<string, string | number>,
    ) => {
      const detailPanel = {
        split_draft_child_issue_label: "Child issue",
        split_draft_open_child_issue: "Open child issue",
        split_draft_error_prefix: "Error: {{message}}",
        split_draft_empty: "No child issue draft has been generated yet.",
        split_draft_untitled_task: "Untitled task",
        split_draft_execution_workflow_for: "Execution workflow for {{title}}",
        split_draft_select_workflow_placeholder: "Select workflow...",
        split_draft_dependencies_label: "Dependencies: {{deps}}",
        split_draft_dependencies_none: "Dependencies: none",
        split_draft_missing_execution_workflow: "Missing execution workflow",
        split_draft_expand_details: "View details",
        split_draft_collapse_details: "Hide details",
      };
      const template = selector({ detail_panel: detailPanel });
      if (values) {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values[key] ?? ""));
      }
      return template;
    },
  }),
}));

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/test/issues/${id}`,
  }),
}));

vi.mock("../../../navigation", () => ({
  AppLink: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const baseTask: SplitTask = {
  id: "task-1",
  node_run_id: "node-run-1",
  title: "A very long child issue title that must stay readable in the review panel",
  description: "A detailed description that should keep the title column usable.",
  workflow_id: "workflow-1",
  depends_on: [],
  sort_order: 0,
  status: "draft",
  issue_id: null,
  run_id: null,
  version: 1,
  last_error: null,
  created_at: "",
  updated_at: "",
};

const workflows: Workflow[] = [{
  id: "workflow-1",
  workspace_id: "ws-1",
  title: "Implementation workflow",
  description: "",
  status: "active",
  max_retries: 3,
  created_by_type: "member",
  created_by_id: "user-1",
  node_count: 1,
  is_template: false,
  source_template_id: null,
  created_at: "",
  updated_at: "",
}];

describe("SplitDraftLedger", () => {
  it("keeps workflow controls from consuming the draft title column", () => {
    render(<SplitDraftLedger tasks={[baseTask]} workflows={workflows} />);

    const meta = screen.getByTestId("split-draft-meta-task-1");
    const workflow = screen.getByLabelText("Execution workflow for A very long child issue title that must stay readable in the review panel");

    expect(screen.getByTestId("split-draft-row-task-1")).toBeInTheDocument();
    expect(meta).toHaveClass("grid", "min-w-0", "gap-2");
    expect(workflow).toHaveClass("min-w-[12rem]");
  });

  it("marks task-level workflow blockers inside the affected draft row", () => {
    render(<SplitDraftLedger tasks={[{ ...baseTask, workflow_id: null }]} workflows={workflows} />);

    const row = screen.getByTestId("split-draft-row-task-1");

    expect(screen.getByTestId("split-draft-risk-task-1")).toHaveTextContent("Missing execution workflow");
    expect(row).toHaveClass("border-destructive/30");
  });

  it("keeps draft details collapsed until the user asks to view them", async () => {
    const user = userEvent.setup();
    render(<SplitDraftLedger tasks={[baseTask]} workflows={workflows} />);

    const toggle = screen.getByRole("button", { name: "View details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const summary = screen.getByTestId("split-draft-summary-task-1");
    expect(summary).toHaveClass("line-clamp-2");
    expect(screen.queryByTestId("split-draft-details-task-1")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveClass("text-primary");
    expect(toggle.className).not.toContain("border");
    expect(screen.getByTestId("split-draft-summary-task-1")).not.toHaveClass("line-clamp-2");
    expect(screen.queryByTestId("split-draft-details-task-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("split-draft-summary-task-1")).toHaveTextContent("A detailed description that should keep the title column usable.");
  });

  it("does not expand the draft row when changing the execution workflow", async () => {
    const user = userEvent.setup();
    const onWorkflowChange = vi.fn();
    render(
      <SplitDraftLedger
        tasks={[{ ...baseTask, workflow_id: null }]}
        workflows={workflows}
        onWorkflowChange={onWorkflowChange}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Execution workflow for A very long child issue title that must stay readable in the review panel"),
      "workflow-1",
    );

    expect(onWorkflowChange).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), "workflow-1");
    expect(screen.getByRole("button", { name: "View details" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("split-draft-details-task-1")).not.toBeInTheDocument();
  });
});

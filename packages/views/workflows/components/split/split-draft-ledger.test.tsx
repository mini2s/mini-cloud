// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Issue, SplitTask, Workflow } from "@multica/core/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SplitDraftLedger } from "./split-draft-ledger";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: Record<string, unknown>) => string,
      values?: Record<string, string | number>,
    ) => {
      const detailPanel = {
        split_draft_child_issue_label: "Child issue",
        split_draft_issue_status_label: "Issue status",
        split_draft_run_status_label: "Run result",
        split_draft_workflow_label: "Workflow",
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
        split_draft_edit: "Edit draft",
        split_draft_save: "Save draft",
        split_draft_cancel_edit: "Cancel edit",
        split_draft_discard: "Discard draft",
        split_draft_restore: "Restore draft",
        split_draft_discarded_group: "{{count}} discarded drafts",
        split_draft_show_discarded: "Show discarded drafts",
        split_draft_hide_discarded: "Hide discarded drafts",
        split_draft_title_label: "Draft title",
        split_draft_description_label: "Draft description",
			split_draft_recovered: "Recovered",
			split_draft_version: "v{{version}}",
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
  draft_key: null,
  draft_source: "agent",
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

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("SplitDraftLedger", () => {
	it("shows draft version and recovered provenance", () => {
		render(<SplitDraftLedger tasks={[{ ...baseTask, version: 7, draft_source: "recovered" }]} workflows={workflows} />);
		expect(screen.getByText("v7")).toBeInTheDocument();
		expect(screen.getByText("Recovered")).toBeInTheDocument();
	});
  it("keeps workflow controls from consuming the draft title column", () => {
    render(<SplitDraftLedger tasks={[baseTask]} workflows={workflows} />);

    const meta = screen.getByTestId("split-draft-meta-task-1");
    const workflow = screen.getByLabelText("Execution workflow for A very long child issue title that must stay readable in the review panel");

    expect(screen.getByTestId("split-draft-row-task-1")).toBeInTheDocument();
    expect(meta).toHaveClass("grid", "min-w-0", "gap-2.5");
    expect(meta).not.toHaveClass("sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(workflow).toHaveClass("min-w-[10rem]", "flex-1");
    expect(screen.getByText("Workflow")).toBeInTheDocument();
  });

  it("separates review draft metadata from draft row actions", () => {
    render(<SplitDraftLedger tasks={[baseTask]} workflows={workflows} />);

    const metadata = screen.getByTestId("split-draft-metadata-task-1");
    const actions = screen.getByTestId("split-draft-actions-task-1");

    expect(metadata).toContainElement(screen.getByLabelText("Execution workflow for A very long child issue title that must stay readable in the review panel"));
    expect(metadata).not.toContainElement(screen.getByRole("button", { name: "Edit draft" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Edit draft" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Discard draft" }));
  });

  it("renders submitted draft rows as read-only metadata without duplicate workflow controls", () => {
    render(
      <SplitDraftLedger
        readOnly
        tasks={[{ ...baseTask, status: "created" }]}
        workflows={workflows}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByText("Implementation workflow")).toHaveLength(1);
  });

  it("shows materialized child issue metadata once in read-only rows", () => {
    const linkedIssue: Issue = {
      id: "child-1",
      workspace_id: "ws-1",
      number: 478,
      identifier: "DEM-478",
      title: "Child task",
      description: null,
      status: "todo",
      priority: "medium",
      assignee_type: "agent",
      assignee_id: "agent-1",
      creator_type: "member",
      creator_id: "user-1",
      parent_issue_id: "parent-1",
      project_id: null,
      workflow_id: null,
      workflow_run_id: null,
      stage_id: null,
      origin_type: "workflow_split",
      origin_id: "task-1",
      position: 0,
      start_date: null,
      due_date: null,
      metadata: {},
      created_at: "",
      updated_at: "",
    };

    renderWithQueryClient(
      <SplitDraftLedger
        readOnly
        tasks={[{ ...baseTask, status: "failed" }]}
        workflows={workflows}
        taskIssueBySourceId={new Map([["task-1", linkedIssue]])}
      />,
    );

    const metadata = screen.getByTestId("split-draft-metadata-task-1");

    expect(metadata).toContainElement(screen.getByRole("link", { name: "DEM-478" }));
    expect(metadata).toHaveTextContent("Issue status: todo");
    expect(metadata).toHaveTextContent("Run result: Failed");
    expect(metadata).toHaveTextContent("Implementation workflow");
    expect(screen.getByText("Run result: Failed")).toBeInTheDocument();
    expect(screen.queryByText("todo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-draft-actions-task-1")).not.toBeInTheDocument();
  });

  it("marks task-level workflow blockers inside the affected draft row", () => {
    render(<SplitDraftLedger tasks={[{ ...baseTask, workflow_id: "" }]} workflows={workflows} />);

    const row = screen.getByTestId("split-draft-row-task-1");

    expect(screen.getByTestId("split-draft-risk-task-1")).toHaveTextContent("Missing execution workflow");
    expect(row).toHaveClass("border-destructive/40", "bg-destructive/[0.04]");
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
        tasks={[{ ...baseTask, workflow_id: "" }]}
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

  it("lets the user edit draft title and description before saving", async () => {
    const user = userEvent.setup();
    const onDraftSave = vi.fn();
    render(
      <SplitDraftLedger
        tasks={[baseTask]}
        workflows={workflows}
        onDraftSave={onDraftSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    await user.clear(screen.getByLabelText("Draft title"));
    await user.type(screen.getByLabelText("Draft title"), "Updated manual title");
    await user.clear(screen.getByLabelText("Draft description"));
    await user.type(screen.getByLabelText("Draft description"), "Updated manual description.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onDraftSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      {
        title: "Updated manual title",
        description: "Updated manual description.",
      },
    );
  });

  it("supports discarding and restoring draft rows with quick actions", async () => {
    const user = userEvent.setup();
    const onDiscardChange = vi.fn();
    const { rerender } = render(
      <SplitDraftLedger
        tasks={[baseTask]}
        workflows={workflows}
        onDiscardChange={onDiscardChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscardChange).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), true);

    rerender(
      <SplitDraftLedger
        tasks={[{ ...baseTask, status: "discarded" }]}
        workflows={workflows}
        onDiscardChange={onDiscardChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show discarded drafts" }));
    await user.click(screen.getByRole("button", { name: "Restore draft" }));
    expect(onDiscardChange).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), false);
    expect(screen.queryByRole("button", { name: "Edit draft" })).not.toBeInTheDocument();
  });

  it("collapses discarded drafts by default so the active draft is not buried by history", async () => {
    const user = userEvent.setup();
    const tasks = Array.from({ length: 32 }, (_value, index): SplitTask => ({
      ...baseTask,
      id: `task-${index + 1}`,
      title: index === 31 ? "Current active draft" : `Discarded draft ${index + 1}`,
      description: `Description ${index + 1}`,
      status: index === 31 ? "draft" : "discarded",
      sort_order: index,
    }));

    render(<SplitDraftLedger tasks={tasks} workflows={workflows} />);

    expect(screen.getByTestId("split-draft-row-task-32")).toBeInTheDocument();
    expect(screen.getByText("Current active draft")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.queryByText("Discarded draft 1")).not.toBeInTheDocument();
    expect(screen.getByText("31 discarded drafts")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show discarded drafts" }));

    expect(screen.getByText("Discarded draft 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide discarded drafts" })).toBeInTheDocument();
  });
});

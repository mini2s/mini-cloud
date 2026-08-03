// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Issue, SplitTask } from "@multica/core/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { SplitDraftLedger } from "./split-draft-ledger";

vi.mock("../../../i18n", () => ({
  useT: () => ({
    t: (
      selector: (resources: Record<string, unknown>) => string,
      values?: Record<string, string | number>,
    ) => {
      const detailPanel = {
        split_draft_child_issue_label: "Child issue",
        split_draft_created_issue_label: "Created issue",
        split_draft_issue_status_label: "Issue status",
        split_draft_open_child_issue: "Open child issue",
        split_draft_empty: "No child issue draft has been generated yet.",
        split_draft_untitled_task: "Untitled task",
        split_assignee_for: "Assignee for {{title}}",
        split_assignment_required: "Assign every active child issue before approval",
        split_unassigned: "Unassigned",
        split_draft_dependencies_label: "Dependencies: {{deps}}",
        split_draft_dependencies_none: "Dependencies: none",
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
        split_draft_select_all: "Select all drafts",
        split_draft_select_task: "Select {{title}}",
        split_draft_selected_count: "Selected {{selected}}/{{total}}",
        split_draft_batch_assignee: "Set assignee for selected drafts",
      };
      const template = selector({ detail_panel: detailPanel });
      if (values) {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(values[key] ?? ""));
      }
      return template;
    },
  }),
}));

vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (type: string, id: string) => type === "member" && id === "member-1" ? "Alice" : id,
  }),
}));

vi.mock("../../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorType, actorId }: { actorType: string; actorId: string }) => (
    <span data-testid={`avatar-${actorType}-${actorId}`} />
  ),
}));

vi.mock("../../../issues/components/pickers/assignee-picker", () => ({
  AssigneePicker: ({ ariaLabel, allowedTypes, trigger, triggerRender, onUpdate }: {
    ariaLabel?: string;
    allowedTypes?: string[];
    trigger?: ReactNode;
    triggerRender?: ReactElement;
    onUpdate: (update: { assignee_type: "member"; assignee_id: string }) => void;
  }) => {
    const triggerProps = {
      "aria-label": ariaLabel,
      onClick: () => onUpdate({ assignee_type: "member" as const, assignee_id: "member-1" }),
    };
    return (
      <div>
      {triggerRender
        ? cloneElement(triggerRender, triggerProps, trigger ?? "Choose assignee")
        : <button type="button" {...triggerProps}>{trigger ?? "Choose assignee"}</button>}
      {allowedTypes?.includes("member") ? <span>Members</span> : null}
      {allowedTypes?.includes("agent") ? <span>Digital Humans</span> : null}
      {allowedTypes?.includes("squad") ? <span>Squads</span> : null}
      {allowedTypes?.includes("workflow") ? <span>Workflows</span> : null}
      </div>
    );
  },
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
  assignee_type: "workflow",
  assignee_id: "workflow-1",
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
	it("hides internal draft version and shows recovered provenance", () => {
		render(<SplitDraftLedger tasks={[{ ...baseTask, version: 7, draft_source: "recovered" }]} />);
		expect(screen.queryByText("v7")).not.toBeInTheDocument();
		expect(screen.getByText("Recovered")).toBeInTheDocument();
	});

  it("renders the shared four-type assignee picker for every active draft", async () => {
    const onAssigneeChange = vi.fn();
    render(<SplitDraftLedger tasks={[baseTask, { ...baseTask, id: "task-2", title: "Task B" }]} onAssigneeChange={onAssigneeChange} />);

    expect(screen.getByLabelText("Assignee for A very long child issue title that must stay readable in the review panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee for Task B")).toBeInTheDocument();
    expect(screen.getAllByText("Members")).toHaveLength(2);
    expect(screen.getAllByText("Digital Humans")).toHaveLength(2);
    expect(screen.getAllByText("Squads")).toHaveLength(2);
    expect(screen.getAllByText("Workflows")).toHaveLength(2);

    await userEvent.click(screen.getByLabelText("Assignee for Task B"));
    expect(onAssigneeChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-2" }),
      { assignee_type: "member", assignee_id: "member-1" },
    );
  });

  it("selects active drafts with an indeterminate select-all state and excludes discarded drafts", async () => {
    const user = userEvent.setup();
    const onSelectedTaskIdsChange = vi.fn();
    const tasks = [
      baseTask,
      { ...baseTask, id: "task-2", title: "Unassigned task", assignee_type: null, assignee_id: null, sort_order: 1 },
      { ...baseTask, id: "task-3", title: "Discarded task", status: "discarded" as const, sort_order: 2 },
    ];

    render(
      <SplitDraftLedger
        tasks={tasks}
        selectedTaskIds={["task-2"]}
        onSelectedTaskIdsChange={onSelectedTaskIdsChange}
        onBatchAssigneeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Selected 1/2")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all drafts" })).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("checkbox", { name: `Select ${baseTask.title}` })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Unassigned task" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Select Discarded task" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: `Select ${baseTask.title}` }));
    expect(onSelectedTaskIdsChange).toHaveBeenCalledWith(["task-2", "task-1"]);
  });

  it("applies one assignee command to the current selection", async () => {
    const user = userEvent.setup();
    const onBatchAssigneeChange = vi.fn();
    render(
      <SplitDraftLedger
        tasks={[baseTask]}
        selectedTaskIds={["task-1"]}
        onSelectedTaskIdsChange={vi.fn()}
        onBatchAssigneeChange={onBatchAssigneeChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set assignee for selected drafts" }));

    expect(onBatchAssigneeChange).toHaveBeenCalledWith({
      assignee_type: "member",
      assignee_id: "member-1",
    });
  });

  it("disables batch controls with no selection and while an update is pending", () => {
    const { rerender } = render(
      <SplitDraftLedger
        tasks={[baseTask]}
        selectedTaskIds={[]}
        onSelectedTaskIdsChange={vi.fn()}
        onBatchAssigneeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Set assignee for selected drafts" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select all drafts" })).toBeEnabled();

    rerender(
      <SplitDraftLedger
        tasks={[baseTask]}
        selectedTaskIds={["task-1"]}
        onSelectedTaskIdsChange={vi.fn()}
        onBatchAssigneeChange={vi.fn()}
        batchAssigneePending
      />,
    );

    expect(screen.getByRole("button", { name: "Set assignee for selected drafts" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select all drafts" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: `Select ${baseTask.title}` })).toHaveAttribute("aria-disabled", "true");
  });

  it("separates review draft metadata from draft row actions", () => {
    render(<SplitDraftLedger tasks={[baseTask]} />);

    const metadata = screen.getByTestId("split-draft-metadata-task-1");
    const actions = screen.getByTestId("split-draft-actions-task-1");

    expect(metadata).toContainElement(screen.getByLabelText("Assignee for A very long child issue title that must stay readable in the review panel"));
    expect(metadata).not.toContainElement(screen.getByRole("button", { name: "Edit draft" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Edit draft" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Discard draft" }));
  });

  it("renders submitted draft rows as read-only assignee metadata", () => {
    render(
      <SplitDraftLedger
        readOnly
        tasks={[{ ...baseTask, status: "created" }]}
      />,
    );

    expect(screen.queryByLabelText(/Assignee for/)).not.toBeInTheDocument();
    expect(screen.getByText("workflow-1")).toBeInTheDocument();
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
      assignee_type: "member",
      assignee_id: "member-1",
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
        taskIssueBySourceId={new Map([["task-1", linkedIssue]])}
      />,
    );

    const metadata = screen.getByTestId("split-draft-metadata-task-1");
    const childFacts = screen.getByTestId("split-draft-child-facts-task-1");

    expect(metadata).toContainElement(screen.getByRole("link", { name: "DEM-478" }));
    expect(childFacts).toHaveClass("grid", "sm:grid-cols-3", "w-full");
    expect(screen.getByTestId("split-draft-child-issue-task-1")).toHaveTextContent("Created issue");
    expect(screen.getByTestId("split-draft-child-issue-task-1")).toHaveTextContent("DEM-478");
    expect(screen.getByTestId("split-draft-child-status-task-1")).toHaveTextContent("Issue status");
    expect(screen.getByTestId("split-draft-child-status-task-1")).toHaveTextContent("Todo");
    expect(screen.getByTestId("split-draft-child-assignee-task-1")).toHaveTextContent("Alice");
    expect(screen.queryByText(/workflow run/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-draft-actions-task-1")).not.toBeInTheDocument();
  });

  it("honors an explicitly unassigned linked issue instead of the draft snapshot", () => {
    const unassignedIssue = {
      id: "child-1",
      identifier: "DEM-478",
      status: "todo",
      assignee_type: null,
      assignee_id: null,
    } as Issue;

    renderWithQueryClient(
      <SplitDraftLedger
        readOnly
        tasks={[{ ...baseTask, status: "created", issue_id: "child-1" }]}
        taskIssueBySourceId={new Map([["task-1", unassignedIssue]])}
      />,
    );

    expect(screen.getByTestId("split-draft-child-assignee-task-1")).toHaveTextContent("Unassigned");
    expect(screen.getByTestId("split-draft-child-assignee-task-1")).not.toHaveTextContent("workflow-1");
  });

  it("shows an explicit assignee dropdown without marking the draft card as an error", () => {
    render(<SplitDraftLedger tasks={[{ ...baseTask, assignee_type: null, assignee_id: null }]} />);

    const row = screen.getByTestId("split-draft-row-task-1");
    const picker = screen.getByRole("button", { name: "Assignee for A very long child issue title that must stay readable in the review panel" });

    expect(picker).toHaveTextContent("Unassigned");
    expect(picker).toHaveClass("h-8", "justify-start", "border");
    expect(screen.getByText("Unassigned")).toHaveClass("flex-1", "text-left");
    expect(screen.queryByTestId("split-draft-risk-task-1")).not.toBeInTheDocument();
    expect(row).not.toHaveClass("border-destructive/40", "bg-destructive/[0.04]");
  });

  it("keeps draft details collapsed until the user asks to view them", async () => {
    const user = userEvent.setup();
    render(<SplitDraftLedger tasks={[baseTask]} />);

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

  it("does not expand the draft row when changing the assignee", async () => {
    const user = userEvent.setup();
    const onAssigneeChange = vi.fn();
    render(
      <SplitDraftLedger
        tasks={[{ ...baseTask, assignee_type: null, assignee_id: null }]}
        onAssigneeChange={onAssigneeChange}
      />,
    );

    await user.click(screen.getByLabelText("Assignee for A very long child issue title that must stay readable in the review panel"));

    expect(onAssigneeChange).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), {
      assignee_type: "member",
      assignee_id: "member-1",
    });
    expect(screen.getByRole("button", { name: "View details" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("split-draft-details-task-1")).not.toBeInTheDocument();
  });

  it("lets the user edit draft title and description before saving", async () => {
    const user = userEvent.setup();
    const onDraftSave = vi.fn();
    render(
      <SplitDraftLedger
        tasks={[baseTask]}
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
        onDiscardChange={onDiscardChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscardChange).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), true);

    rerender(
      <SplitDraftLedger
        tasks={[{ ...baseTask, status: "discarded" }]}
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

    render(<SplitDraftLedger tasks={tasks} />);

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

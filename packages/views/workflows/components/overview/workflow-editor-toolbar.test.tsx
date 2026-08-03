// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { WorkflowEditorToolbar } from "./workflow-editor-toolbar";

const mocks = vi.hoisted(() => ({
  back: vi.fn(),
  rename: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  save: vi.fn(),
  autoLayout: vi.fn(),
  selectTemplate: vi.fn(),
  testRun: vi.fn(),
  toggleStatus: vi.fn(),
  reviewIssues: vi.fn(),
  openRuns: vi.fn(),
  openSettings: vi.fn(),
  deleteWorkflow: vi.fn(),
}));

vi.mock("../../../i18n", () => {
  const translations = {
    status: {
      draft: "Draft",
      active: "Active",
      paused: "Paused",
      archived: "Archived",
    },
    detail: {
      activate: "Activate",
      deactivate: "Deactivate",
      add_node: "Add node",
      back_to_workflows: "Back to workflows",
      click_to_rename: "Click to rename",
      delete: "Delete",
    },
    panorama: {
      node_picker: {
        search_placeholder: "Search nodes or actions...",
        empty: "No matching nodes",
        trigger: "Triggers",
        trigger_description: "Start a workflow",
        action: "Actions",
        action_description: "Do work in a step",
        logic: "Logic",
        logic_description: "Branch or route work",
        ai: "AI",
        ai_description: "Agent-powered steps",
        human: "Human",
        human_description: "Review or approval",
        annotation: "Notes",
        annotation_description: "Explain the canvas",
      },
      toolbar: {
        undo: "Undo",
        redo: "Redo",
        auto_layout: "Auto layout",
        save: "Save changes",
        saved: "Saved",
        unsaved: "Unsaved",
        editor: "Editor",
        run_history: "Run history",
        run_settings: "Run settings",
        test_run: "Test run",
        save_and_test: "Save & test",
        more: "More",
        blocked_tooltip: "Resolve blocking issues first.",
        activate_disabled_unsaved: "Save changes before activating.",
        activate_before_test: "Activate workflow before testing.",
        available_in_issues: "Available in issues",
        hidden_from_issue_picker: "Hidden from issue picker",
        save_before_activating_status: "Save before activating",
        blocking_issues_left: "{{count}} issue(s) left",
        activate: "Activate",
        save_first: "Save first",
        review_issues: "Review issues",
        reactivate: "Reactivate",
      },
    },
  };

  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string, options?: { count?: number }) =>
        selector(translations).replace("{{count}}", String(options?.count ?? "{{count}}")),
    }),
  };
});

vi.mock("@multica/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

function renderToolbar(overrides: Partial<React.ComponentProps<typeof WorkflowEditorToolbar>> = {}) {
  return render(
    <WorkflowEditorToolbar
      workflow={{ id: "wf-1", title: "Test Workflow", status: "draft" }}
      statusLabel="Draft"
      canUndo={false}
      canRedo={false}
      hasUnsavedEdits={false}
      blockingPreflightIssueCount={0}
      onBackToWorkflows={mocks.back}
      onUpdateTitle={mocks.rename}
      onUndo={mocks.undo}
      onRedo={mocks.redo}
      onSave={mocks.save}
      onAutoLayout={mocks.autoLayout}
      onSelectTemplate={mocks.selectTemplate}
      onTestRun={mocks.testRun}
      onToggleWorkflowStatus={mocks.toggleStatus}
      onReviewIssues={mocks.reviewIssues}
      onOpenRunHistory={mocks.openRuns}
      onOpenRunSettings={mocks.openSettings}
      onDeleteWorkflow={mocks.deleteWorkflow}
      {...overrides}
    />,
  );
}

describe("WorkflowEditorToolbar", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("shows saved state without a primary save button when there are no local edits", () => {
    renderToolbar();

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("shows Save changes and Save & test for active workflows with local edits", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
      hasUnsavedEdits: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.testRun).toHaveBeenCalledTimes(1);
  });

  it("explains that active workflows are available in issues", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
    });

    expect(screen.getByText("Active · Available in issues")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("explains that paused workflows are hidden from the issue picker", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "paused" },
      statusLabel: "Paused",
      blockingPreflightIssueCount: 0,
    });

    expect(screen.getByText("Paused · Hidden from issue picker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("uses save-first copy when inactive workflow has unsaved edits", () => {
    renderToolbar({
      hasUnsavedEdits: true,
      blockingPreflightIssueCount: 0,
    });

    expect(screen.getByText("Draft · Save before activating")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save first" })).toBeDisabled();
  });

  it("opens blocking issue review without toggling workflow status", () => {
    renderToolbar({
      hasUnsavedEdits: false,
      blockingPreflightIssueCount: 3,
    });

    expect(screen.getByText("Draft · 3 issue(s) left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review issues" }));
    expect(mocks.reviewIssues).toHaveBeenCalledOnce();
    expect(mocks.toggleStatus).not.toHaveBeenCalled();
  });

  it("keeps test run available but blocks activation when blocking preflight issues exist", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
      blockingPreflightIssueCount: 1,
    });

    expect(screen.getByRole("button", { name: "Test run" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Deactivate" })).not.toBeDisabled();
  });

  it("disables test run for inactive workflows before it can hit the run API", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "paused" },
      statusLabel: "Paused",
    });

    const testRun = screen.getByRole("button", { name: "Test run" });
    expect(testRun).toBeDisabled();
    fireEvent.click(testRun);
    expect(mocks.testRun).not.toHaveBeenCalled();
  });

  it("keeps deactivate available even when the workflow has local edits and blocking issues", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
      hasUnsavedEdits: true,
      blockingPreflightIssueCount: 1,
    });

    expect(screen.getByRole("button", { name: "Deactivate" })).not.toBeDisabled();
  });

  it("keeps run settings, run history, and delete in the More menu", () => {
    renderToolbar();

    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Run settings/ }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Run history/ }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Delete/ }));

    expect(mocks.openSettings).toHaveBeenCalledTimes(1);
    expect(mocks.openRuns).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWorkflow).toHaveBeenCalledTimes(1);
  });
});

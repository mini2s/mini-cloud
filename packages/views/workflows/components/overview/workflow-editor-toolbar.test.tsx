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
  openRuns: vi.fn(),
  cycleTheme: vi.fn(),
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
      canvas_theme_system: "System theme",
      canvas_theme_light: "Light theme",
      canvas_theme_dark: "Dark theme",
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
        test_run: "Test run",
        save_and_test: "Save & test",
        more: "More",
        theme: "Theme",
        blocked_tooltip: "Resolve blocking issues first.",
        activate_disabled_unsaved: "Save changes before activating.",
      },
    },
  };

  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
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
      hasBlockingPreflightIssues={false}
      canvasColorMode="system"
      onBackToWorkflows={mocks.back}
      onUpdateTitle={mocks.rename}
      onUndo={mocks.undo}
      onRedo={mocks.redo}
      onSave={mocks.save}
      onAutoLayout={mocks.autoLayout}
      onSelectTemplate={mocks.selectTemplate}
      onTestRun={mocks.testRun}
      onToggleWorkflowStatus={mocks.toggleStatus}
      onOpenRunHistory={mocks.openRuns}
      onCycleCanvasColorMode={mocks.cycleTheme}
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
    expect(screen.getByRole("button", { name: "Test run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("shows Save changes and Save & test when there are local edits", () => {
    renderToolbar({ hasUnsavedEdits: true });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & test" }));

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.testRun).toHaveBeenCalledTimes(1);
  });

  it("uses Deactivate for active workflows", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
    });

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(mocks.toggleStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("keeps test run available but blocks activation when blocking preflight issues exist", () => {
    renderToolbar({ hasBlockingPreflightIssues: true });

    expect(screen.getByRole("button", { name: "Test run" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });

  it("keeps deactivate available even when the workflow has local edits and blocking issues", () => {
    renderToolbar({
      workflow: { id: "wf-1", title: "Test Workflow", status: "active" },
      statusLabel: "Active",
      hasUnsavedEdits: true,
      hasBlockingPreflightIssues: true,
    });

    expect(screen.getByRole("button", { name: "Deactivate" })).not.toBeDisabled();
  });

  it("keeps run history, theme, and delete in the More menu", () => {
    renderToolbar();

    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Run history/ }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Theme/ }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Delete/ }));

    expect(mocks.openRuns).toHaveBeenCalledTimes(1);
    expect(mocks.cycleTheme).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWorkflow).toHaveBeenCalledTimes(1);
  });
});

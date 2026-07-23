// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreflightBar } from "./preflight-bar";
import type { PreflightResult } from "@multica/core/workflows/preflight-checks";

vi.mock("../../../i18n", () => {
  const translations = {
    preflight: {
      bar_collapsed_all_clear: "Ready to activate",
      bar_saved_all_clear: "Saved and ready to activate",
      bar_unsaved_all_clear: "Save changes before activating",
      bar_active: "Workflow is active",
      bar_dismiss: "Dismiss",
      bar_expand: "Review issues",
      bar_activate: "Activate",
      bar_active_button: "Active",
      bar_activate_disabled_unsaved: "Save first",
      bar_activating: "Activating...",
      check_dag_cycle: "Cycle",
      check_worker_missing: "No worker",
      check_stage_missing: "No stage",
      check_boundary_start_outgoing: "Start needs an exit",
      check_boundary_end_incoming: "End needs an entry",
      check_boundary_edge_direction: "Invalid boundary connection",
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string, options?: Record<string, string>) => {
        let value = selector(translations);
        if (options) for (const [k, r] of Object.entries(options)) value = value.replace(`{{${k}}}`, String(r));
        return value;
      },
    }),
  };
});

function makeResult(o: Partial<PreflightResult>): PreflightResult {
  return { issues: [], blockingCount: 0, warningCount: 0, passed: true, ...o };
}

describe("PreflightBar", () => {
  const base = { onNavigateToNode: vi.fn(), onActivate: vi.fn(), onDismiss: vi.fn() };

  it("shows all-clear with activate button", () => {
    render(<PreflightBar {...base} result={makeResult({ passed: true, issues: [] })} />);
    expect(screen.getByText("Saved and ready to activate")).toBeDefined();
    expect(screen.getByTestId("preflight-activate-btn")).not.toBeDisabled();
  });

  it("reserves right-side space so the global chat button does not cover actions", () => {
    render(<PreflightBar {...base} result={makeResult({ passed: true, issues: [] })} />);

    const content = screen.getByTestId("preflight-bar-content");
    expect(content.className).toContain("pr-16");
    expect(content.className).toContain("sm:pr-20");
  });

  it("shows activatable state when there are no issues", () => {
    render(
      <PreflightBar
        {...base}
        result={{ issues: [], blockingCount: 0, warningCount: 0, passed: true }}
        hasUnsavedEdits={false}
        workflowStatus="draft"
      />,
    );

    expect(screen.getByText("Saved and ready to activate")).toBeInTheDocument();
    expect(screen.getByTestId("preflight-activate-btn")).not.toBeDisabled();
  });

  it("disables activation when there are unsaved edits", () => {
    render(
      <PreflightBar
        {...base}
        result={{ issues: [], blockingCount: 0, warningCount: 0, passed: true }}
        hasUnsavedEdits
        workflowStatus="draft"
      />,
    );

    expect(screen.getByText("Save changes before activating")).toBeInTheDocument();
    expect(screen.getByTestId("preflight-activate-btn")).toBeDisabled();
    expect(screen.getByTestId("preflight-activate-btn")).toHaveTextContent("Save first");
  });

  it("shows inline chips for issues", () => {
    render(<PreflightBar {...base} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 1,
      issues: [
        { checkId: "worker-missing", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "Node A", message: "" },
        { checkId: "stage-missing", severity: "warning", blocking: false, nodeId: "n2", nodeTitle: "Node B", message: "" },
      ],
    })} />);
    const chips = screen.getAllByTestId("preflight-issue-item");
    expect(chips.length).toBe(2);
    expect(screen.getByTestId("preflight-activate-btn")).toBeDisabled();
  });

  it("shows localized labels for boundary issues", () => {
    render(<PreflightBar {...base} result={makeResult({
      passed: false,
      blockingCount: 1,
      issues: [{
        checkId: "boundary-start-outgoing",
        severity: "error",
        blocking: true,
        nodeId: "start",
        nodeTitle: "Start",
        message: "",
      }],
    })} />);

    expect(screen.getByTestId("preflight-issue-item")).toHaveTextContent("Start needs an exit");
  });

  it("summarizes many issues behind a review popover instead of expanding the bar", () => {
    render(<PreflightBar {...base} result={makeResult({
      passed: false,
      blockingCount: 20,
      warningCount: 0,
      issues: Array.from({ length: 20 }, (_, index) => ({
        checkId: "worker-missing",
        severity: "error",
        blocking: true,
        nodeId: `n${index}`,
        nodeTitle: `Node ${index}`,
        message: "",
      })),
    })} />);

    expect(screen.getByTestId("preflight-bar").className).toContain("h-12");
    expect(screen.getAllByTestId("preflight-issue-item")).toHaveLength(4);
    expect(screen.getByTestId("preflight-review-btn")).toHaveTextContent("Review issues");

    fireEvent.click(screen.getByTestId("preflight-review-btn"));

    expect(screen.getByTestId("preflight-review-list").className).toContain("overflow-y-auto");
    expect(screen.getAllByTestId("preflight-review-issue-item")).toHaveLength(20);
  });

  it("navigates to node when chip clicked", () => {
    const nav = vi.fn();
    render(<PreflightBar {...base} onNavigateToNode={nav} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 0,
      issues: [{ checkId: "dag-cycle", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "A", message: "" }],
    })} />);
    fireEvent.click(screen.getByTestId("preflight-issue-item"));
    expect(nav).toHaveBeenCalledWith("n1");
  });

  it("calls onActivate when no blocking issues", () => {
    const activate = vi.fn();
    render(<PreflightBar {...base} onActivate={activate} result={makeResult({ passed: true, issues: [] })} />);
    fireEvent.click(screen.getByTestId("preflight-activate-btn"));
    expect(activate).toHaveBeenCalledOnce();
  });

  it("shows active state without offering activation again", () => {
    render(<PreflightBar {...base} workflowStatus="active" result={makeResult({ passed: true, issues: [] })} />);
    expect(screen.getByText("Workflow is active")).toBeInTheDocument();
    expect(screen.getByTestId("preflight-activate-btn")).toBeDisabled();
    expect(screen.getByTestId("preflight-activate-btn")).toHaveTextContent("Active");
  });

  it("calls onDismiss", () => {
    const dis = vi.fn();
    render(<PreflightBar {...base} onDismiss={dis} result={makeResult({
      passed: false, blockingCount: 1, warningCount: 0,
      issues: [{ checkId: "worker-missing", severity: "error", blocking: true, nodeId: "n1", nodeTitle: "A", message: "" }],
    })} />);
    fireEvent.click(screen.getByTestId("preflight-dismiss-btn"));
    expect(dis).toHaveBeenCalledOnce();
  });
});
